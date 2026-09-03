import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IdleDreamingPolicy,
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
    expect(generateMock).toHaveBeenCalledOnce();
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

    const runPromise = coordinator.triggerNow({ entityId: 'proj-1' });
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

  it('requires a concrete entity for a manual run', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
      proposalStore,
    });

    await expect(coordinator.triggerNow()).resolves.toEqual({
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
    generateMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveLate = resolve;
      }),
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
});
