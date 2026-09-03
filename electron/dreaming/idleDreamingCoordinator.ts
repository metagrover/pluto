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
  rendererQuiet?: boolean;
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
        | 'invalid_request'
        | 'no_work'
        | 'existing'
        | 'busy'
        | 'backoff'
        | 'exhausted';
      entityId?: string;
      errorCode?: string;
    };

export {
  createDirtyEntityQueue,
  type DirtyEntityQueue,
  type DirtyEntityQueueDeps,
} from './entityQueue';

export const DREAMING_ENTITY_DEADLINE_MS = 3 * 60_000;

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
  deadlineMs?: number;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  recoverStaleRuns?: (input: { staleBefore: string }) => number;
  onRetryable?: (candidate: DirtyEntityCandidate, delayMs: number) => void;
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
  const deadlineMs = deps.deadlineMs ?? DREAMING_ENTITY_DEADLINE_MS;
  const scheduleTimeout = deps.setTimeout ?? setTimeout;
  const cancelTimeout = deps.clearTimeout ?? clearTimeout;
  const now = deps.now ?? Date.now;
  let activeController: AbortController | null = null;
  let activeRun: Promise<IdleDreamingResult> | null = null;
  let activeCandidate: DirtyEntityCandidate | null = null;
  let unloadPromise: Promise<void> | null = null;
  let closed = false;
  const isEntityType = (value: string): value is DreamingEntityType =>
    value === 'project' || value === 'person';

  const isEligible = () => {
    const policy = deps.getPolicy();
    return (
      policy.systemIdleSeconds >= idleThreshold &&
      !policy.onBattery &&
      (policy.thermalState === 'nominal' || policy.thermalState === 'fair') &&
      !policy.paused &&
      policy.rendererQuiet !== false
    );
  };

  const unloadModel = (): Promise<void> => {
    try {
      unloadPromise = Promise.resolve(deps.unloadModel?.()).catch(
        () => undefined,
      );
    } catch {
      // Unloading is best-effort and cannot hold the coordinator lifecycle.
      unloadPromise = Promise.resolve();
    }
    return unloadPromise;
  };

  const requeue = (candidate: DirtyEntityCandidate, delayMs = 0) => {
    try {
      deps.onRetryable?.(candidate, delayMs);
    } catch {
      // Scheduling is advisory; the persisted run remains authoritative.
    }
  };

  const recoverStaleRuns = () =>
    deps.recoverStaleRuns?.({
      staleBefore: new Date(now() - deadlineMs).toISOString(),
    });

  const notifyForegroundActivity = () => {
    if (activeController) {
      activeController.abort(
        new DOMException('Foreground activity resumed', 'AbortError'),
      );
    }
  };

  const generateWithDeadline = (
    request: ReturnType<typeof buildDreamingGenerationRequest>,
    signal: AbortSignal,
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cancelTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () =>
        finish(() =>
          reject(
            signal.reason ??
              new DOMException('Dreaming cancelled', 'AbortError'),
          ),
        );
      const timer = scheduleTimeout(
        () =>
          finish(() => {
            const error = new Error('dreaming_timeout');
            activeController?.abort(error);
            reject(error);
          }),
        deadlineMs,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      void deps
        .generate(
          request.prompt,
          request.schema,
          signal,
          request.model,
          request.promptVersion,
        )
        .then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
    });

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
          if (start.status === 'existing' && start.run.status === 'running') {
            const staleAt = Date.parse(start.run.updatedAt) + deadlineMs;
            requeue(
              candidate,
              Number.isFinite(staleAt)
                ? Math.max(1_000, staleAt - now())
                : deadlineMs,
            );
          }
          return { status: start.status, entityId: candidate.entityId };
        }
        lease = start.run;
      }

      const raw = await generateWithDeadline(request, signal);
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
        requeue(candidate);
        return { status: 'cancelled', entityId: candidate.entityId };
      }
      const currentPackage = deps.packageNotes(candidate.entityId);
      if (
        !currentPackage ||
        currentPackage.entityId !== pkg.entityId ||
        currentPackage.entityType !== pkg.entityType ||
        currentPackage.sourceRevision !== pkg.sourceRevision ||
        (lease?.sourceRevision !== undefined &&
          currentPackage.sourceRevision !== lease.sourceRevision)
      ) {
        if (lease) {
          deps.proposalStore.cancelRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
          });
        }
        requeue(candidate);
        return {
          status: 'cancelled',
          entityId: candidate.entityId,
        };
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
      if (err instanceof Error && err.message === 'dreaming_timeout') {
        if (lease) {
          deps.proposalStore.failRun({
            runId: lease.id,
            leaseToken: lease.leaseToken,
            errorCode: 'generation_failed',
          });
        }
        return {
          status: 'failed',
          entityId: candidate.entityId,
          errorCode: 'timeout',
        };
      }
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
        requeue(candidate);
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

  const triggerNow = async (options: {
    entityId: string;
  }): Promise<IdleDreamingResult> => {
    if (closed) return { status: 'ineligible' };
    if (!options?.entityId) {
      return {
        status: 'invalid_request',
        errorCode: 'entity_id_required',
      };
    }
    if (activeRun) {
      return activeCandidate?.entityId === options.entityId
        ? activeRun
        : { status: 'busy', entityId: options.entityId };
    }
    // Manual requests bypass idle, power, thermal, and renderer-quiet checks,
    // but never foreground/capture/transcription/downstream pause locks.
    if (deps.getPolicy().paused) {
      return { status: 'ineligible' };
    }
    const entity = deps.getEntity?.(options.entityId);
    if (!entity) return { status: 'no_work', entityId: options.entityId };
    if (!isEntityType(entity.type)) {
      return {
        status: 'failed',
        entityId: options.entityId,
        errorCode: 'invalid_entity_type',
      };
    }
    const candidate = { entityId: options.entityId, type: entity.type };

    const controller = new AbortController();
    activeController = controller;
    activeCandidate = candidate;

    activeRun = executeEntityRun(
      candidate,
      controller.signal,
      'manual',
    ).finally(() => {
      activeController = null;
      activeCandidate = null;
      activeRun = null;
      void unloadModel();
    });

    return activeRun;
  };

  const attemptIdleRun = async (): Promise<IdleDreamingResult> => {
    if (closed) return { status: 'ineligible' };
    recoverStaleRuns();
    if (activeRun)
      return { status: 'busy', entityId: activeCandidate?.entityId };
    if (!isEligible()) return { status: 'ineligible' };
    const candidate = deps.getNextDirtyEntityId();
    if (!candidate) return { status: 'no_work' };
    if (!isEntityType(candidate.type)) {
      return {
        status: 'failed',
        entityId: candidate.entityId,
        errorCode: 'invalid_entity_type',
      };
    }
    const controller = new AbortController();
    activeController = controller;
    activeCandidate = candidate;
    activeRun = executeEntityRun(
      candidate,
      controller.signal,
      'automatic',
    ).finally(() => {
      activeController = null;
      activeCandidate = null;
      activeRun = null;
      void unloadModel();
    });
    return activeRun;
  };

  return {
    isEligible,
    attemptIdleRun,
    triggerNow,
    notifyForegroundActivity,
    async close() {
      if (closed) {
        await unloadPromise;
        return;
      }
      closed = true;
      const run = activeRun;
      notifyForegroundActivity();
      if (run) {
        await run;
        await unloadPromise;
      } else {
        await unloadModel();
      }
    },
  };
};
