import { buildDreamingGenerationRequest } from './prompt';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  DreamingRunResult,
} from './types';
import { validateDreamingOutput } from './validateDreamingOutput';

export interface IdleDreamingPolicy {
  systemIdleSeconds: number;
  onBattery: boolean;
  thermalState: string;
  paused: boolean;
}

export interface DirtyEntityCandidate {
  entityId: string;
  type: DreamingEntityType;
}

type EntityDreamingRunResult = DreamingRunResult & { entityId: string };

export type IdleDreamingResult =
  | EntityDreamingRunResult
  | {
      status: 'ineligible' | 'no_work';
      entityId?: string;
    };

export {
  createRoundRobinEntityQueue,
  type RoundRobinEntityQueue,
  type RoundRobinEntityQueueDeps,
} from './entityQueue';

export interface IdleDreamingCoordinatorDeps {
  getPolicy: () => IdleDreamingPolicy;
  getNextDirtyEntityId: () => DirtyEntityCandidate | null | undefined;
  packageNotes: (entityId: string) => DreamingInputPackage | null;
  generate: (
    prompt: string,
    responseSchema: Record<string, unknown>,
    signal: AbortSignal,
    model: string,
    promptVersion: string,
  ) => Promise<string>;
  getEntity?: (entityId: string) => { type: string } | null | undefined;
  idleThresholdSeconds?: number;
  unloadModel?: () => Promise<void> | void;
}

export interface DreamingGenerationProvider {
  synthesizeKnowledgeDocument(
    prompt: string,
    options: {
      purpose: 'dreaming';
      responseSchema: Record<string, unknown>;
      signal: AbortSignal;
      model: string;
      promptVersion: string;
    },
  ): Promise<string>;
}

export const generateDreamingWithProvider = (
  provider: DreamingGenerationProvider,
  prompt: string,
  responseSchema: Record<string, unknown>,
  signal: AbortSignal,
  model: string,
  promptVersion: string,
): Promise<string> =>
  provider.synthesizeKnowledgeDocument(prompt, {
    purpose: 'dreaming',
    responseSchema,
    signal,
    model,
    promptVersion,
  });

export const createIdleDreamingCoordinator = (
  deps: IdleDreamingCoordinatorDeps,
) => {
  const idleThreshold = deps.idleThresholdSeconds ?? 300;
  let activeController: AbortController | null = null;
  let activeRun: Promise<IdleDreamingResult> | null = null;
  const isEntityType = (value: string): value is DreamingEntityType =>
    value === 'project' || value === 'person';

  const isEligible = () => {
    const policy = deps.getPolicy();
    return (
      policy.systemIdleSeconds >= idleThreshold &&
      !policy.onBattery &&
      (policy.thermalState === 'nominal' || policy.thermalState === 'fair') &&
      !policy.paused
    );
  };

  const notifyForegroundActivity = () => {
    if (activeController) {
      activeController.abort(
        new DOMException('Foreground activity resumed', 'AbortError'),
      );
      activeController = null;
      deps.unloadModel?.();
    }
  };

  const executeEntityRun = async (
    candidate: DirtyEntityCandidate,
    signal: AbortSignal,
  ): Promise<IdleDreamingResult> => {
    try {
      const pkg = deps.packageNotes(candidate.entityId);
      if (!pkg || pkg.recentMeetingNotes.length === 0) {
        return { status: 'no_work', entityId: candidate.entityId };
      }
      if (pkg.entityId !== candidate.entityId) {
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: 'entity_id_mismatch',
        };
      }
      if (pkg.entityType !== candidate.type) {
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: 'entity_type_mismatch',
        };
      }

      const request = buildDreamingGenerationRequest(pkg);

      const raw = await deps.generate(
        request.prompt,
        request.schema,
        signal,
        request.model,
        request.promptVersion,
      );
      if (signal.aborted) {
        return { status: 'cancelled', entityId: candidate.entityId };
      }

      const validated = validateDreamingOutput(raw, pkg);
      if (!validated.valid) {
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: validated.error,
        };
      }
      if (validated.status === 'no_change') {
        return {
          status: 'no_change',
          entityId: candidate.entityId,
          proposals: [],
        };
      }
      return {
        status: 'proposed',
        entityId: candidate.entityId,
        proposals: validated.proposals,
      };
    } catch (err) {
      if (
        signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return { status: 'cancelled', entityId: candidate.entityId };
      }
      return {
        status: 'failed',
        entityId: candidate.entityId,
        errorCode: 'generation_failed',
      };
    }
  };

  const triggerNow = async (options?: {
    entityId?: string;
    force?: boolean;
  }): Promise<IdleDreamingResult> => {
    if (activeRun) return activeRun;

    if (!options?.force && !isEligible()) {
      return { status: 'ineligible' };
    }

    let candidate: DirtyEntityCandidate | null | undefined;
    if (options?.entityId) {
      const entity = deps.getEntity?.(options.entityId);
      if (!entity) return { status: 'no_work', entityId: options.entityId };
      if (!isEntityType(entity.type)) {
        return {
          status: 'failed',
          entityId: options.entityId,
          errorCode: 'invalid_entity_type',
        };
      }
      candidate = { entityId: options.entityId, type: entity.type };
    } else {
      candidate = deps.getNextDirtyEntityId();
      if (candidate && !isEntityType(candidate.type)) {
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: 'invalid_entity_type',
        };
      }
    }

    if (!candidate) return { status: 'no_work' };

    const controller = new AbortController();
    activeController = controller;

    activeRun = executeEntityRun(candidate, controller.signal).finally(() => {
      activeController = null;
      activeRun = null;
    });

    return activeRun;
  };

  const attemptIdleRun = async (): Promise<IdleDreamingResult> => {
    return triggerNow({ force: false });
  };

  return {
    isEligible,
    attemptIdleRun,
    triggerNow,
    notifyForegroundActivity,
  };
};
