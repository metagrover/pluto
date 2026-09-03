import { buildDreamingGenerationRequest } from './prompt';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  ValidatedDreamingProposal,
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

export type IdleDreamingResult =
  | { status: 'no_change'; entityId: string; proposals: [] }
  | {
      status: 'proposed';
      entityId: string;
      proposals: [ValidatedDreamingProposal, ...ValidatedDreamingProposal[]];
    }
  | {
      status: 'ineligible' | 'no_work' | 'aborted' | 'failed';
      entityId?: string;
      error?: string;
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
  ) => Promise<string>;
  getEntity?: (entityId: string) => { type: string } | null | undefined;
  idleThresholdSeconds?: number;
  unloadModel?: () => Promise<void> | void;
}

export const createIdleDreamingCoordinator = (
  deps: IdleDreamingCoordinatorDeps,
) => {
  const idleThreshold = deps.idleThresholdSeconds ?? 300;
  let activeController: AbortController | null = null;
  let activeRun: Promise<IdleDreamingResult> | null = null;

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

      const request = buildDreamingGenerationRequest(pkg);

      const raw = await deps.generate(request.prompt, request.schema, signal);
      if (signal.aborted) {
        return { status: 'aborted', entityId: candidate.entityId };
      }

      const validated = validateDreamingOutput(raw, pkg);
      if (!validated.valid) {
        return {
          status: 'failed',
          entityId: candidate.entityId,
          error: validated.error,
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
        return { status: 'aborted', entityId: candidate.entityId };
      }
      return {
        status: 'failed',
        entityId: candidate.entityId,
        error: err instanceof Error ? err.message : String(err),
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

    const candidate = options?.entityId
      ? {
          entityId: options.entityId,
          type:
            (deps.getEntity?.(options.entityId)?.type as DreamingEntityType) ??
            'project',
        }
      : deps.getNextDirtyEntityId();

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
