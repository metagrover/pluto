import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IdleDreamingPolicy,
  type IdleDreamingResult,
  createIdleDreamingCoordinator,
} from '../../electron/dreaming/idleDreamingCoordinator';
import { buildDreamingGenerationRequest } from '../../electron/dreaming/prompt';

describe('IdleDreamingCoordinator', () => {
  let policy: IdleDreamingPolicy;
  let generateMock: ReturnType<typeof vi.fn>;
  let packageNotesMock: ReturnType<typeof vi.fn>;
  let proposalStore: {
    startRun: ReturnType<typeof vi.fn>;
    completeRun: ReturnType<typeof vi.fn>;
    failRun: ReturnType<typeof vi.fn>;
    cancelRun: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    policy = {
      systemIdleSeconds: 400,
      onBattery: false,
      thermalState: 'nominal',
      paused: false,
    };
    generateMock = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ status: 'no_change', proposals: [] }),
      );
    packageNotesMock = vi.fn().mockReturnValue({
      entityId: 'proj-1',
      entityType: 'project',
      entityName: 'Test Project',
      sourceRevision: 'revision-1',
      recentMeetingNotes: [
        {
          meetingId: 'm-1',
          title: 'M1',
          startedAt: null,
          notesContent: 'Notes',
        },
      ],
      negativeConstraints: [],
    });
    proposalStore = {
      startRun: vi.fn().mockReturnValue({
        status: 'started',
        run: { id: 'run-1', leaseToken: 'lease-1' },
      }),
      completeRun: vi.fn().mockReturnValue({ id: 'run-1' }),
      failRun: vi.fn().mockReturnValue({ id: 'run-1' }),
      cancelRun: vi.fn().mockReturnValue({ id: 'run-1' }),
    };
  });

  it('does not run automatically when on battery', async () => {
    policy.onBattery = true;
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const result = await coordinator.attemptIdleRun();
    expect(result.status).toBe('ineligible');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('does not run automatically when idle seconds < 300', async () => {
    policy.systemIdleSeconds = 120;
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    const result = await coordinator.attemptIdleRun();
    expect(result.status).toBe('ineligible');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('requires renderer quiet for an automatic run', async () => {
    policy.rendererQuiet = false;
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    await expect(coordinator.attemptIdleRun()).resolves.toEqual({
      status: 'ineligible',
    });
    expect(packageNotesMock).not.toHaveBeenCalled();
  });

  it('returns no_change and sends the exact production request when eligible', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    const result = await coordinator.attemptIdleRun();
    expect(result.status).toBe('no_change');
    expect(result.entityId).toBe('proj-1');
    expect(generateMock).toHaveBeenCalledOnce();
    const request = buildDreamingGenerationRequest(packageNotesMock());
    expect(generateMock).toHaveBeenCalledWith(
      request.prompt,
      request.schema,
      expect.any(AbortSignal),
      request.model,
      request.promptVersion,
      'background',
      expect.any(Function),
      expect.any(Function),
    );
    expect(proposalStore.startRun).toHaveBeenCalledWith({
      entityId: 'proj-1',
      entityType: 'project',
      sourceRevision: 'revision-1',
      model: request.model,
      promptVersion: request.promptVersion,
      mode: 'automatic',
    });
    expect(proposalStore.completeRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      status: 'no_change',
      proposals: [],
    });
  });

  it('returns validated proposals without mutating canonical data', async () => {
    generateMock.mockResolvedValue(
      JSON.stringify({
        status: 'proposed',
        proposals: [
          {
            kind: 'project_milestone',
            payload: { name: 'Grounded work', status: 'in_progress' },
            evidence: [{ meetingId: 'm-1', excerpt: 'Notes' }],
          },
        ],
      }),
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    const result = await coordinator.attemptIdleRun();
    expect(result).toMatchObject({
      status: 'proposed',
      entityId: 'proj-1',
      proposals: [
        {
          kind: 'project_milestone',
          payload: { name: 'Grounded work', status: 'in_progress' },
        },
      ],
    });
    expect(proposalStore.completeRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      status: 'proposed',
      proposals: expect.any(Array),
    });
  });

  it('returns a stable failure for invalid model output', async () => {
    generateMock.mockResolvedValue(
      JSON.stringify({ status: 'updated', proposals: [] }),
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'invalid_proposed_output',
    });
    expect(proposalStore.failRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      errorCode: 'validation_failed',
    });
  });

  it('records a stable persistence failure when atomic completion throws', async () => {
    proposalStore.completeRun.mockImplementation(() => {
      throw new Error('notes must not escape');
    });
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'persistence_failed',
    });
    expect(proposalStore.failRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      errorCode: 'persistence_failed',
    });
  });

  it('records provider_unavailable for a failed local provider connection', async () => {
    generateMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1'));
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'provider_unavailable',
    });
    expect(proposalStore.failRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      errorCode: 'provider_unavailable',
    });
  });

  it('cancels the lease when automatic eligibility changes before persistence', async () => {
    generateMock.mockImplementation(async () => {
      policy.onBattery = true;
      return JSON.stringify({ status: 'no_change', proposals: [] });
    });
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'cancelled',
      entityId: 'proj-1',
    });
    expect(proposalStore.cancelRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
    });
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
  });

  it('does not report success when the lease expires before completion', async () => {
    proposalStore.completeRun.mockReturnValue(null);
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'lease_expired',
    });
    expect(proposalStore.failRun).not.toHaveBeenCalled();
  });

  it('triggerNow bypasses idle and battery checks for manual testing', async () => {
    policy.onBattery = true;
    policy.systemIdleSeconds = 0;

    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const result = await coordinator.triggerNow({
      entityId: 'proj-1',
    });
    expect(result.status).toBe('no_change');
    expect(result.entityId).toBe('proj-1');
    expect(generateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(String),
      expect.any(String),
      'manual_notes',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('does not let a manual request bypass a foreground pause lock', async () => {
    policy.paused = true;
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    await expect(
      coordinator.triggerNow({ entityId: 'proj-1' }),
    ).resolves.toEqual({ status: 'ineligible' });
    expect(packageNotesMock).not.toHaveBeenCalled();
  });

  it('does not guess a project type for a missing forced entity', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => null,
    });

    expect(await coordinator.triggerNow({ entityId: 'missing' })).toEqual({
      status: 'no_work',
      entityId: 'missing',
    });
    expect(packageNotesMock).not.toHaveBeenCalled();
  });

  it('fails a forced entity with an unsupported runtime type', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'topic' }),
    });

    expect(await coordinator.triggerNow({ entityId: 'topic-1' })).toEqual({
      status: 'failed',
      entityId: 'topic-1',
      errorCode: 'invalid_entity_type',
    });
    expect(packageNotesMock).not.toHaveBeenCalled();
  });

  it('fails when a forced entity package has the wrong supported type', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'person' }),
    });

    expect(await coordinator.triggerNow({ entityId: 'proj-1' })).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'entity_type_mismatch',
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('preempts immediately when notifyForegroundActivity is called', async () => {
    let capturedSignal: AbortSignal | undefined;

    generateMock.mockImplementation(
      async (_prompt: string, _schema: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve('{}'), 5000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
    );

    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const runPromise = coordinator.attemptIdleRun();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // User becomes active
    coordinator.notifyForegroundActivity();

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(capturedSignal?.aborted).toBe(true);
    expect(proposalStore.cancelRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
    });
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
  });

  it('keeps an explicit manual run alive through ordinary foreground activity', async () => {
    let capturedSignal: AbortSignal | undefined;
    let release!: () => void;
    generateMock.mockImplementation(
      async (_prompt: string, _schema: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<string>((resolve) => {
          release = () =>
            resolve(JSON.stringify({ status: 'no_change', proposals: [] }));
        });
      },
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const run = coordinator.triggerNow({ entityId: 'proj-1' });
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    coordinator.notifyForegroundActivity();
    expect(capturedSignal?.aborted).toBe(false);
    release();
    await expect(run).resolves.toMatchObject({ status: 'no_change' });
  });

  it('promotes an in-flight automatic run to manual when triggerNow is called', async () => {
    let capturedSignal: AbortSignal | undefined;
    let release!: () => void;
    generateMock.mockImplementation(
      async (_prompt: string, _schema: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<string>((resolve) => {
          release = () =>
            resolve(JSON.stringify({ status: 'no_change', proposals: [] }));
        });
      },
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const idleRun = coordinator.attemptIdleRun();
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());

    const manualRun = coordinator.triggerNow({ entityId: 'proj-1' });

    policy.systemIdleSeconds = 0;
    policy.rendererQuiet = false;
    coordinator.notifyForegroundActivity();

    expect(capturedSignal?.aborted).toBe(false);

    release();
    const [idleResult, manualResult] = await Promise.all([idleRun, manualRun]);
    expect(manualResult).toMatchObject({ status: 'no_change' });
    expect(idleResult).toMatchObject({ status: 'no_change' });
    expect(proposalStore.cancelRun).not.toHaveBeenCalled();
    expect(proposalStore.completeRun).toHaveBeenCalledOnce();
  });

  it('recovers with a fresh manual run when triggerNow is called on an already-aborted run', async () => {
    let attempt = 0;
    let releaseSecond!: (val: string) => void;
    generateMock.mockImplementation(
      async (_prompt: string, _schema: unknown, signal: AbortSignal) => {
        attempt += 1;
        const currentAttempt = attempt;
        return new Promise<string>((resolve, reject) => {
          if (currentAttempt === 1) {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          } else {
            releaseSecond = resolve;
          }
        });
      },
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const idleRun = coordinator.attemptIdleRun();
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));

    coordinator.notifyForegroundActivity();
    await expect(idleRun).resolves.toMatchObject({ status: 'cancelled' });

    const manualRun = coordinator.triggerNow({ entityId: 'proj-1' });
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));

    releaseSecond(JSON.stringify({ status: 'no_change', proposals: [] }));
    await expect(manualRun).resolves.toMatchObject({ status: 'no_change' });
  });

  it('retries when a manual run is preempted by foreground task gate', async () => {
    let attempt = 0;
    generateMock.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new DOMException('foreground_preempted', 'AbortError');
      }
      return JSON.stringify({ status: 'no_change', proposals: [] });
    });
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const manualRun = coordinator.triggerNow({ entityId: 'proj-1' });
    await expect(manualRun).resolves.toMatchObject({ status: 'no_change' });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('still cancels a manual run when a safety pause lock becomes active', async () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const run = coordinator.triggerNow({ entityId: 'proj-1' });
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    policy.paused = true;
    coordinator.notifyForegroundActivity();
    await expect(run).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('settles cancellation even when the provider ignores AbortSignal', async () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    const run = coordinator.attemptIdleRun();
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    coordinator.notifyForegroundActivity();
    await expect(run).resolves.toEqual({
      status: 'cancelled',
      entityId: 'proj-1',
    });
    expect(proposalStore.cancelRun).toHaveBeenCalledOnce();
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
  });

  it.each(['existing', 'busy', 'backoff', 'exhausted'] as const)(
    'does not generate when starting the revision returns %s',
    async (status) => {
      proposalStore.startRun.mockReturnValue(
        status === 'busy'
          ? { status }
          : { status, run: { id: 'run-existing', status: 'no_change' } },
      );
      const coordinator = createIdleDreamingCoordinator({
        getPolicy: () => policy,
        getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
        packageNotes: packageNotesMock,
        generate: generateMock,
        proposalStore,
      });

      expect(await coordinator.attemptIdleRun()).toMatchObject({
        status,
        entityId: 'proj-1',
      });
      expect(generateMock).not.toHaveBeenCalled();
    },
  );

  it('retains a young orphan until stale recovery makes it retryable', async () => {
    let nowMs = Date.parse('2026-09-02T10:02:00.000Z');
    let recovered = false;
    let queued = true;
    let retryDelay: number | undefined;
    proposalStore.startRun.mockImplementation(() =>
      recovered
        ? {
            status: 'started',
            run: { id: 'run-1', leaseToken: 'lease-new' },
          }
        : {
            status: 'existing',
            run: {
              id: 'run-1',
              status: 'running',
              updatedAt: '2026-09-02T10:00:00.000Z',
            },
          },
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => {
        if (!queued) return null;
        queued = false;
        return { entityId: 'proj-1', type: 'project' };
      },
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      now: () => nowMs,
      recoverStaleRuns: ({ staleBefore }) => {
        recovered =
          Date.parse(staleBefore) >= Date.parse('2026-09-02T10:00:00.000Z');
        return recovered ? 1 : 0;
      },
      onRetryable: (_candidate, delayMs) => {
        queued = true;
        retryDelay = delayMs;
      },
    });

    await expect(coordinator.attemptIdleRun()).resolves.toMatchObject({
      status: 'existing',
    });
    expect(retryDelay).toBe(480_000);
    expect(generateMock).not.toHaveBeenCalled();

    nowMs += retryDelay!;
    await expect(coordinator.attemptIdleRun()).resolves.toMatchObject({
      status: 'no_change',
    });
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it('never recovers leases while a manual run is active at the stale boundary', async () => {
    let release!: (value: string) => void;
    generateMock.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const recoverStaleRuns = vi.fn();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-2', type: 'project' }),
      getEntity: () => ({ type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      recoverStaleRuns,
    });
    const manual = coordinator.triggerNow({ entityId: 'proj-1' });
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());

    await expect(coordinator.attemptIdleRun()).resolves.toMatchObject({
      status: 'busy',
      entityId: 'proj-1',
    });
    expect(recoverStaleRuns).not.toHaveBeenCalled();
    expect(proposalStore.failRun).not.toHaveBeenCalled();
    release(JSON.stringify({ status: 'no_change', proposals: [] }));
    await manual;
  });

  it('cancels and requeues when authoritative source changes during generation', async () => {
    packageNotesMock
      .mockReturnValueOnce({
        ...packageNotesMock(),
        sourceRevision: 'revision-before',
      })
      .mockReturnValueOnce({
        ...packageNotesMock(),
        sourceRevision: 'revision-after',
      });
    const onRetryable = vi.fn();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      onRetryable,
    });

    await expect(coordinator.attemptIdleRun()).resolves.toEqual({
      status: 'cancelled',
      entityId: 'proj-1',
    });
    expect(proposalStore.cancelRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
    });
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
    expect(onRetryable).toHaveBeenCalledWith(
      { entityId: 'proj-1', type: 'project' },
      0,
    );
  });

  it('requires a concrete entity for a manual run', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    const unsafeTrigger = coordinator.triggerNow as (options?: {
      entityId: string;
    }) => Promise<IdleDreamingResult>;
    await expect(unsafeTrigger()).resolves.toEqual({
      status: 'invalid_request',
      errorCode: 'entity_id_required',
    });
    expect(packageNotesMock).not.toHaveBeenCalled();
  });

  it('does not coalesce a different manual entity with the active run', async () => {
    let release!: () => void;
    generateMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = () =>
            resolve(JSON.stringify({ status: 'no_change', proposals: [] }));
        }),
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: (id) => ({ ...packageNotesMock(), entityId: id }),
      generate: generateMock,
      proposalStore,
      getEntity: () => ({ type: 'project' }),
    });

    const first = coordinator.triggerNow({ entityId: 'proj-1' });
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    await expect(
      coordinator.triggerNow({ entityId: 'proj-2' }),
    ).resolves.toEqual({ status: 'busy', entityId: 'proj-2' });
    release();
    await first;
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it('settles a provider that ignores abort at the entity deadline', async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: string) => void;
    let admit!: () => void;
    generateMock.mockImplementation(
      (
        _prompt: string,
        _schema: unknown,
        _signal: AbortSignal,
        _model: string,
        _promptVersion: string,
        _workClass: string,
        onStart: () => void,
      ) => {
        admit = onStart;
        return new Promise<string>((resolve) => {
          resolveLate = resolve;
        });
      },
    );
    const unloadModel = vi.fn();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      deadlineMs: 100,
      unloadModel,
    });

    const run = coordinator.attemptIdleRun();
    await vi.advanceTimersByTimeAsync(100);
    expect(proposalStore.failRun).not.toHaveBeenCalled();
    admit();
    await vi.advanceTimersByTimeAsync(100);
    await expect(run).resolves.toEqual({
      status: 'failed',
      entityId: 'proj-1',
      errorCode: 'timeout',
    });
    expect(proposalStore.failRun).toHaveBeenCalledWith({
      runId: 'run-1',
      leaseToken: 'lease-1',
      errorCode: 'generation_failed',
    });
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
    expect(unloadModel).toHaveBeenCalledOnce();
    resolveLate(JSON.stringify({ status: 'no_change', proposals: [] }));
    await Promise.resolve();
    expect(proposalStore.completeRun).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('resets the idle window when onProgress is called during generation', async () => {
    vi.useFakeTimers();
    let resolveGen!: (value: string) => void;
    let admit!: () => void;
    let progress!: () => void;
    generateMock.mockImplementation(
      (
        _prompt: string,
        _schema: unknown,
        _signal: AbortSignal,
        _model: string,
        _promptVersion: string,
        _workClass: string,
        onStart: () => void,
        onProgress: () => void,
      ) => {
        admit = onStart;
        progress = onProgress;
        return new Promise<string>((resolve) => {
          resolveGen = resolve;
        });
      },
    );
    const unloadModel = vi.fn();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      deadlineMs: 1_000,
      unloadModel,
    });

    const run = coordinator.attemptIdleRun();
    admit();
    await vi.advanceTimersByTimeAsync(400);
    expect(proposalStore.failRun).not.toHaveBeenCalled();
    progress();
    await vi.advanceTimersByTimeAsync(400);
    expect(proposalStore.failRun).not.toHaveBeenCalled();
    resolveGen(JSON.stringify({ status: 'no_change', proposals: [] }));
    await expect(run).resolves.toEqual({
      status: 'no_change',
      entityId: 'proj-1',
      proposals: [],
    });
    vi.useRealTimers();
  });

  it('awaits model unload when closed while idle', async () => {
    let finishUnload!: () => void;
    const unloadModel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
    );
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      unloadModel,
    });

    let closed = false;
    const closing = coordinator.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(unloadModel).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    finishUnload();
    await closing;
    expect(closed).toBe(true);
  });

  it('unloads once at the end of a multi-entity dirty batch', async () => {
    const candidates = [
      { entityId: 'proj-1', type: 'project' as const },
      { entityId: 'proj-2', type: 'project' as const },
    ];
    const unloadModel = vi.fn();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => candidates.shift(),
      packageNotes: (entityId) => ({ ...packageNotesMock(), entityId }),
      generate: generateMock,
      proposalStore,
      hasPendingWork: () => candidates.length > 0,
      unloadModel,
    });

    await coordinator.attemptIdleRun();
    expect(unloadModel).not.toHaveBeenCalled();
    proposalStore.startRun.mockReturnValue({
      status: 'started',
      run: { id: 'run-2', leaseToken: 'lease-2' },
    });
    await coordinator.attemptIdleRun();
    expect(unloadModel).toHaveBeenCalledOnce();
  });

  it('bounds an ignored shutdown unload', async () => {
    vi.useFakeTimers();
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => null,
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      unloadModel: () => new Promise(() => {}),
      cleanupDeadlineMs: 50,
    });
    const closing = coordinator.close();
    await vi.advanceTimersByTimeAsync(50);
    await expect(closing).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('cancels an active run and awaits its unload when closed', async () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const unloadModel = vi.fn().mockResolvedValue(undefined);
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
      unloadModel,
    });

    const run = coordinator.attemptIdleRun();
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    await coordinator.close();
    await expect(run).resolves.toMatchObject({ status: 'cancelled' });
    expect(unloadModel).toHaveBeenCalledOnce();
  });
});
