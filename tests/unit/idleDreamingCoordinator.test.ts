import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type IdleDreamingPolicy,
  createIdleDreamingCoordinator,
  createRoundRobinEntityQueue,
} from '../../electron/dreaming/idleDreamingCoordinator';
import { buildDreamingGenerationRequest } from '../../electron/dreaming/prompt';

describe('IdleDreamingCoordinator', () => {
  let policy: IdleDreamingPolicy;
  let generateMock: ReturnType<typeof vi.fn>;
  let packageNotesMock: ReturnType<typeof vi.fn>;

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
  });

  it('does not run automatically when on battery', async () => {
    policy.onBattery = true;
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
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
    });

    const result = await coordinator.attemptIdleRun();
    expect(result.status).toBe('ineligible');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('returns no_change and sends the exact production request when eligible', async () => {
    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
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
    );
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
    });

    expect(await coordinator.attemptIdleRun()).toEqual({
      status: 'failed',
      entityId: 'proj-1',
      error: 'invalid_proposed_output',
    });
  });

  it('triggerNow bypasses idle and battery checks for manual testing', async () => {
    policy.onBattery = true;
    policy.systemIdleSeconds = 0;

    const coordinator = createIdleDreamingCoordinator({
      getPolicy: () => policy,
      getNextDirtyEntityId: () => ({ entityId: 'proj-1', type: 'project' }),
      packageNotes: packageNotesMock,
      generate: generateMock,
    });

    const result = await coordinator.triggerNow({
      entityId: 'proj-1',
      force: true,
    });
    expect(result.status).toBe('no_change');
    expect(result.entityId).toBe('proj-1');
    expect(generateMock).toHaveBeenCalledOnce();
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
    });

    const runPromise = coordinator.triggerNow({ force: true });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // User becomes active
    coordinator.notifyForegroundActivity();

    const result = await runPromise;
    expect(result.status).toBe('aborted');
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('createRoundRobinEntityQueue', () => {
  it('fairly rotates through all projects and people before repeating', () => {
    const projects = [{ id: 'proj-1' }, { id: 'proj-2' }];
    const people = [{ id: 'person-1' }, { id: 'person-2' }];

    const queue = createRoundRobinEntityQueue({
      getProjects: () => projects,
      getPeople: () => people,
    });

    // Round 1: Interleaves projects and people fairly
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-2',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-2',
      type: 'person',
    });

    // All entities visited; round 2 starts from beginning
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
  });

  it('handles asymmetric numbers of projects and people', () => {
    const projects = [{ id: 'proj-1' }];
    const people = [{ id: 'person-1' }, { id: 'person-2' }, { id: 'person-3' }];

    const queue = createRoundRobinEntityQueue({
      getProjects: () => projects,
      getPeople: () => people,
    });

    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-2',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-3',
      type: 'person',
    });

    // Cycles back
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });
  });

  it('prunes deleted entities and handles new additions dynamically', () => {
    let projects = [{ id: 'proj-1' }, { id: 'proj-2' }];
    const people = [{ id: 'person-1' }];

    const queue = createRoundRobinEntityQueue({
      getProjects: () => projects,
      getPeople: () => people,
    });

    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });

    // Delete proj-2 and add proj-3
    projects = [{ id: 'proj-1' }, { id: 'proj-3' }];

    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-3',
      type: 'project',
    });
  });

  it('returns null when no entities exist', () => {
    const queue = createRoundRobinEntityQueue({
      getProjects: () => [],
      getPeople: () => [],
    });

    expect(queue.getNextCandidate()).toBeNull();
  });
});
