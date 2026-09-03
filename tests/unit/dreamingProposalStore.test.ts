import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDreamingProposalStore,
  ensureDreamingProposalSchema,
} from '../../electron/dreaming/proposalStore';
import type { ValidatedDreamingProposal } from '../../electron/dreaming/types';

const connections: Database.Database[] = [];

const projectSummary = (
  fingerprint = 'project-summary-one',
): ValidatedDreamingProposal => ({
  kind: 'project_summary',
  payload: { summary: 'A grounded summary' },
  evidence: [{ meetingId: 'meeting-1', excerpt: 'Supporting evidence' }],
  fingerprint,
});

function fixture(options?: {
  now?: string;
  resolveCanonicalEntityId?: (entityId: string) => string;
}) {
  const sql = new Database(':memory:');
  connections.push(sql);
  sql.pragma('foreign_keys = ON');
  ensureDreamingProposalSchema(sql);
  let currentTime = options?.now ?? '2026-08-10T10:00:00.000Z';
  const store = createDreamingProposalStore(sql, {
    now: () => currentTime,
    resolveCanonicalEntityId:
      options?.resolveCanonicalEntityId ?? ((entityId) => entityId),
  });
  return {
    sql,
    store,
    setNow: (now: string) => {
      currentTime = now;
    },
  };
}

afterEach(() => {
  for (const sql of connections.splice(0)) sql.close();
});

const startProject = (
  store: ReturnType<typeof createDreamingProposalStore>,
  sourceRevision = 'revision-1',
  mode: 'automatic' | 'manual' = 'automatic',
) =>
  store.startRun({
    entityId: 'project-1',
    entityType: 'project',
    sourceRevision,
    model: 'gemma4:12b',
    promptVersion: 'dreaming-v1',
    mode,
  });

describe('dreaming proposal persistence', () => {
  it('keeps one logical run for an entity and source revision', () => {
    const { store } = fixture();

    const first = startProject(store);
    const duplicate = startProject(store);

    expect(first.status).toBe('started');
    expect(duplicate.status).toBe('existing');
    expect(duplicate.run.id).toBe(first.run.id);
    expect(duplicate.run.leaseToken).toBe(first.run.leaseToken);
    expect(store.listRuns('project-1', 'project')).toHaveLength(1);
  });

  it('atomically completes a proposed run with all proposals', () => {
    const { store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');

    const run = store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken!,
      status: 'proposed',
      proposals: [
        projectSummary(),
        {
          kind: 'project_milestone',
          payload: { name: 'Ship preview', status: 'in_progress' },
          evidence: [
            { meetingId: 'meeting-2', excerpt: 'Preview is in progress' },
          ],
          fingerprint: 'project-milestone-ship-preview',
        },
      ],
    });

    expect(run?.status).toBe('proposed');
    expect(run?.leaseToken).toBeNull();
    expect(store.listPendingProposals('project-1', 'project')).toEqual([
      expect.objectContaining({
        runId: started.run.id,
        entityId: 'project-1',
        kind: 'project_summary',
        payload: { summary: 'A grounded summary' },
        evidence: [{ meetingId: 'meeting-1', excerpt: 'Supporting evidence' }],
      }),
      expect.objectContaining({
        kind: 'project_milestone',
        payload: { name: 'Ship preview', status: 'in_progress' },
      }),
    ]);
  });

  it('stores no_change as a terminal run without proposals', () => {
    const { store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');

    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken!,
      status: 'no_change',
      proposals: [],
    });

    expect(startProject(store).status).toBe('existing');
    expect(store.getRun(started.run.id)).toMatchObject({
      status: 'no_change',
      completedAt: '2026-08-10T10:00:00.000Z',
      leaseToken: null,
    });
    expect(store.listPendingProposals('project-1', 'project')).toEqual([]);
  });

  it('rolls back the run transition and every proposal when insertion fails', () => {
    const { sql, store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');
    sql.exec(`CREATE TRIGGER reject_second_dreaming_proposal
      BEFORE INSERT ON entity_dreaming_proposals
      WHEN NEW.fingerprint = 'reject-me'
      BEGIN SELECT RAISE(ABORT, 'injected_proposal_failure'); END;`);

    expect(() =>
      store.completeRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken!,
        status: 'proposed',
        proposals: [projectSummary(), projectSummary('reject-me')],
      }),
    ).toThrow('injected_proposal_failure');

    expect(store.getRun(started.run.id)).toMatchObject({
      status: 'running',
      leaseToken: started.run.leaseToken,
      completedAt: null,
    });
    expect(
      sql
        .prepare('SELECT COUNT(*) AS count FROM entity_dreaming_proposals')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('cancels stale running leases and rejects late completion', () => {
    const { store, setNow } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');
    setNow('2026-08-10T10:10:00.000Z');

    expect(
      store.recoverStaleRuns({ staleBefore: '2026-08-10T10:05:00.000Z' }),
    ).toBe(1);
    expect(store.getRun(started.run.id)).toMatchObject({
      status: 'cancelled',
      leaseToken: null,
      completedAt: '2026-08-10T10:10:00.000Z',
    });
    expect(
      store.completeRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken!,
        status: 'no_change',
        proposals: [],
      }),
    ).toBeNull();

    const restarted = startProject(store);
    expect(restarted.status).toBe('started');
    expect(restarted.run.id).toBe(started.run.id);
    expect(restarted.run.leaseToken).not.toBe(started.run.leaseToken);
  });

  it('persists at most two automatic attempts with exponential backoff', () => {
    const { store, setNow } = fixture();
    const first = startProject(store);
    expect(first.status).toBe('started');
    expect(first.run.attemptCount).toBe(1);

    store.failRun({
      runId: first.run.id,
      leaseToken: first.run.leaseToken!,
      errorCode: 'provider_unavailable',
    });
    expect(store.getRun(first.run.id)?.nextRetryAt).toBe(
      '2026-08-10T10:01:00.000Z',
    );
    expect(startProject(store).status).toBe('backoff');

    setNow('2026-08-10T10:01:00.000Z');
    const second = startProject(store);
    expect(second.status).toBe('started');
    expect(second.run.attemptCount).toBe(2);
    store.failRun({
      runId: second.run.id,
      leaseToken: second.run.leaseToken!,
      errorCode: 'generation_failed',
    });
    expect(store.getRun(second.run.id)?.nextRetryAt).toBeNull();
    expect(startProject(store).status).toBe('exhausted');

    const manual = startProject(store, 'revision-1', 'manual');
    expect(manual.status).toBe('started');
    expect(manual.run.attemptCount).toBe(3);
  });

  it('persists only stable content-free failure codes', () => {
    const { store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');

    expect(() =>
      store.failRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken!,
        errorCode: 'Alice notes: launch is late',
      }),
    ).toThrow('dreaming_error_code_invalid');
    expect(store.getRun(started.run.id)).toMatchObject({
      status: 'running',
      errorCode: null,
    });

    store.failRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken!,
      errorCode: 'validation_failed',
    });
    expect(store.getRun(started.run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'validation_failed',
    });
  });

  it('lists pending proposals under the canonical entity only', () => {
    const { store } = fixture({
      resolveCanonicalEntityId: (entityId) =>
        entityId === 'project-alias' ? 'project-1' : entityId,
    });
    const started = store.startRun({
      entityId: 'project-alias',
      entityType: 'project',
      sourceRevision: 'revision-alias',
      model: 'gemma4:12b',
      promptVersion: 'dreaming-v1',
      mode: 'automatic',
    });
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken!,
      status: 'proposed',
      proposals: [projectSummary()],
    });

    expect(store.listPendingProposals('project-alias', 'project')).toHaveLength(
      1,
    );
    expect(store.listPendingProposals('project-other', 'project')).toEqual([]);
    expect(store.listRuns('project-1', 'project')[0].entityId).toBe(
      'project-1',
    );
  });
});
