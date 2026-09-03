import { classifyAskPlutoFailure } from '../intelligence/askPlutoFailures';
import { buildDreamingGenerationRequest } from './prompt';
import type {
  DreamingLeasedRunRecord,
  DreamingStartInput,
  DreamingStartResult,
} from './proposalStore';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  DreamingRunResult,
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

type EntityDreamingRunResult = DreamingRunResult & { entityId: string };

export type IdleDreamingResult =
  | EntityDreamingRunResult
  | {
      status:
        | 'ineligible'
        | 'no_work'
        | 'existing'
        | 'busy'
        | 'backoff'
        | 'exhausted';
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
  proposalStore: {
    startRun(input: DreamingStartInput): DreamingStartResult;
    completeRun(input: {
      runId: string;
      leaseToken: string;
      status: 'no_change' | 'proposed';
      proposals:
        | []
        | [ValidatedDreamingProposal, ...ValidatedDreamingProposal[]];
    }): unknown;
    failRun(input: {
      runId: string;
      leaseToken: string;
      errorCode: string;
    }): unknown;
    cancelRun(input: { runId: string; leaseToken: string }): unknown;
  };
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
    mode: 'automatic' | 'manual',
  ): Promise<IdleDreamingResult> => {
    let lease: DreamingLeasedRunRecord | null = null;
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
      if (deps.proposalStore) {
        const start = deps.proposalStore.startRun({
          entityId: pkg.entityId,
          entityType: pkg.entityType,
          sourceRevision: pkg.sourceRevision,
          model: request.model,
          promptVersion: request.promptVersion,
          mode,
        });
        if (start.status !== 'started') {
          return { status: start.status, entityId: candidate.entityId };
        }
        lease = start.run;
      }

      const raw = await deps.generate(
        request.prompt,
        request.schema,
        signal,
        request.model,
        request.promptVersion,
      );
      if (signal.aborted) {
        if (lease) {
          deps.proposalStore.cancelRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
          });
        }
        return { status: 'cancelled', entityId: candidate.entityId };
      }

      const validated = validateDreamingOutput(raw, pkg);
      if (!validated.valid) {
        if (lease) {
          deps.proposalStore.failRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
            errorCode: 'validation_failed',
          });
        }
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: validated.error,
        };
      }
      if (lease && mode === 'automatic' && !isEligible()) {
        deps.proposalStore.cancelRun({
          runId: lease.id,
          leaseToken: lease.leaseToken,
        });
        return { status: 'cancelled', entityId: candidate.entityId };
      }
      if (validated.status === 'no_change') {
        if (lease) {
          try {
            const completed = deps.proposalStore.completeRun({
              runId: lease.id,
              leaseToken: lease.leaseToken,
              status: 'no_change',
              proposals: [],
            });
            if (!completed) {
              return {
                status: 'failed',
                entityId: candidate.entityId,
                errorCode: 'lease_expired',
              };
            }
          } catch {
            deps.proposalStore.failRun({
              runId: lease.id,
              leaseToken: lease.leaseToken,
              errorCode: 'persistence_failed',
            });
            return {
              status: 'failed',
              entityId: candidate.entityId,
              errorCode: 'persistence_failed',
            };
          }
        }
        return {
          status: 'no_change',
          entityId: candidate.entityId,
          proposals: [],
        };
      }
      if (lease) {
        try {
          const completed = deps.proposalStore.completeRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
            status: 'proposed',
            proposals: validated.proposals,
          });
          if (!completed) {
            return {
              status: 'failed',
              entityId: candidate.entityId,
              errorCode: 'lease_expired',
            };
          }
        } catch {
          deps.proposalStore.failRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
            errorCode: 'persistence_failed',
          });
          return {
            status: 'failed',
            entityId: candidate.entityId,
            errorCode: 'persistence_failed',
          };
        }
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
        if (lease) {
          deps.proposalStore.cancelRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
          });
        }
        return { status: 'cancelled', entityId: candidate.entityId };
      }
      const errorCode =
        classifyAskPlutoFailure(err).reason === 'provider_unavailable'
          ? 'provider_unavailable'
          : 'generation_failed';
      if (lease) {
        deps.proposalStore.failRun({
          runId: lease.id,
          leaseToken: lease.leaseToken,
          errorCode,
        });
      }
      return {
        status: 'failed',
        entityId: candidate.entityId,
        errorCode,
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

    activeRun = executeEntityRun(
      candidate,
      controller.signal,
      options?.force ? 'manual' : 'automatic',
    ).finally(() => {
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
