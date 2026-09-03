import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDreamingProposalStore,
  ensureDreamingProposalSchema,
} from '../../electron/dreaming/proposalStore';
import type { ValidatedDreamingProposal } from '../../electron/dreaming/types';

const connections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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
    expect('leaseToken' in duplicate.run).toBe(false);
    expect(
      store.completeRun({
        runId: duplicate.run.id,
        leaseToken: (duplicate.run as { leaseToken?: string }).leaseToken ?? '',
        status: 'no_change',
        proposals: [],
      }),
    ).toBeNull();
    expect(store.listRuns('project-1', 'project')).toHaveLength(1);
  });

  it('atomically completes a proposed run with all proposals', () => {
    const { sql, store } = fixture();
    sql.pragma('foreign_keys = OFF');
    expect(sql.pragma('foreign_keys', { simple: true })).toBe(0);
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
    expect(run && 'leaseToken' in run).toBe(false);
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
      completedAt: null,
    });
    expect(
      sql
        .prepare('SELECT lease_token FROM entity_dreaming_runs WHERE id = ?')
        .get(started.run.id),
    ).toEqual({ lease_token: started.run.leaseToken });
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

  it('does not spend the automatic failure budget on cancellation or stale recovery', () => {
    const { store, setNow } = fixture();
    const cancelled = startProject(store);
    expect(cancelled.status).toBe('started');
    expect(
      store.cancelRun({
        runId: cancelled.run.id,
        leaseToken: cancelled.run.leaseToken,
      }),
    ).toMatchObject({ status: 'cancelled', failureCount: 0 });

    setNow('2026-08-10T10:01:00.000Z');
    const stale = startProject(store);
    expect(stale.status).toBe('started');
    expect(
      store.recoverStaleRuns({ staleBefore: '2026-08-10T10:01:00.000Z' }),
    ).toBe(1);

    setNow('2026-08-10T10:02:00.000Z');
    const third = startProject(store);
    expect(third.status).toBe('started');
    expect(third.run).toMatchObject({ attemptCount: 3, failureCount: 0 });
    expect(
      store.completeRun({
        runId: third.run.id,
        leaseToken: third.run.leaseToken,
        status: 'no_change',
        proposals: [],
      }),
    ).toMatchObject({ status: 'no_change', failureCount: 0 });
  });

  it('persists at most two automatic attempts with exponential backoff', () => {
    const { store, setNow } = fixture();
    const first = startProject(store);
    expect(first.status).toBe('started');
    expect(first.run.attemptCount).toBe(1);
    expect(first.run.failureCount).toBe(0);

    store.failRun({
      runId: first.run.id,
      leaseToken: first.run.leaseToken!,
      errorCode: 'provider_unavailable',
    });
    expect(store.getRun(first.run.id)?.nextRetryAt).toBe(
      '2026-08-10T10:01:00.000Z',
    );
    expect(store.getRun(first.run.id)?.failureCount).toBe(1);
    expect(startProject(store).status).toBe('backoff');

    setNow('2026-08-10T10:01:00.000Z');
    const second = startProject(store);
    expect(second.status).toBe('started');
    expect(second.run.attemptCount).toBe(2);
    expect(second.run.failureCount).toBe(1);
    store.failRun({
      runId: second.run.id,
      leaseToken: second.run.leaseToken!,
      errorCode: 'generation_failed',
    });
    expect(store.getRun(second.run.id)?.nextRetryAt).toBeNull();
    expect(store.getRun(second.run.id)?.failureCount).toBe(2);
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
    let aliasMerged = false;
    const { store } = fixture({
      resolveCanonicalEntityId: (entityId) =>
        aliasMerged && entityId === 'project-alias' ? 'project-1' : entityId,
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
    aliasMerged = true;

    expect(store.listPendingProposals('project-alias', 'project')).toHaveLength(
      1,
    );
    expect(store.listPendingProposals('project-other', 'project')).toEqual([]);
    expect(store.listRuns('project-1', 'project')[0].entityId).toBe(
      'project-alias',
    );
  });

  it('finds person proposals when identity becomes an alias after persistence', () => {
    let aliasMerged = false;
    const { store } = fixture({
      resolveCanonicalEntityId: (entityId) =>
        aliasMerged && entityId === 'person-old'
          ? 'person-canonical'
          : entityId,
    });
    const started = store.startRun({
      entityId: 'person-old',
      entityType: 'person',
      sourceRevision: 'person-revision',
      model: 'gemma4:12b',
      promptVersion: 'dreaming-v1',
    });
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'person_focus',
          payload: { focus: 'Grounded focus' },
          evidence: [{ meetingId: 'meeting-1', excerpt: 'Grounded focus' }],
          fingerprint: 'person-focus-grounded',
        },
      ],
    });
    aliasMerged = true;

    const proposals = store.listPendingProposals('person-canonical', 'person');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].entityId).toBe('person-canonical');
  });

  it('rejects malformed proposal payloads, evidence, and fingerprints before writing', () => {
    const { store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');
    const malformed = [
      { ...projectSummary(), payload: { summary: '' } },
      { ...projectSummary(), payload: { summary: 'ok', extra: true } },
      { ...projectSummary(), evidence: [] },
      {
        ...projectSummary(),
        evidence: [{ meetingId: 'meeting-1', excerpt: '' }],
      },
      { ...projectSummary(), fingerprint: ' Not-Normalized ' },
    ];

    for (const proposal of malformed) {
      expect(() =>
        store.completeRun({
          runId: started.run.id,
          leaseToken: started.run.leaseToken,
          status: 'proposed',
          proposals: [proposal as ValidatedDreamingProposal],
        }),
      ).toThrow('dreaming_proposal_invalid');
    }
    expect(store.listPendingProposals('project-1', 'project')).toEqual([]);
    expect(store.getRun(started.run.id)?.status).toBe('running');
  });

  it('fails closed when a durable proposal row has an invalid shape', () => {
    const { sql, store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    sql
      .prepare(
        'UPDATE entity_dreaming_proposals SET payload_json = \'{"summary":""}\'',
      )
      .run();

    expect(() => store.listPendingProposals('project-1', 'project')).toThrow(
      'dreaming_proposal_corrupt',
    );
  });

  it('enforces run and proposal cross-field constraints in SQLite', () => {
    const { sql, store } = fixture();
    const started = startProject(store);
    expect(started.status).toBe('started');

    expect(() =>
      sql
        .prepare(
          'UPDATE entity_dreaming_runs SET lease_token = NULL WHERE id = ?',
        )
        .run(started.run.id),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      sql
        .prepare(
          "UPDATE entity_dreaming_runs SET error_code = 'validation_failed' WHERE id = ?",
        )
        .run(started.run.id),
    ).toThrow(/CHECK constraint failed/);

    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    expect(() =>
      sql
        .prepare(
          "UPDATE entity_dreaming_proposals SET status = 'accepted' WHERE run_id = ?",
        )
        .run(started.run.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps one run when two database connections contend for the revision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pluto-dreaming-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'pluto.db');
    const firstSql = new Database(path);
    const secondSql = new Database(path);
    connections.push(firstSql, secondSql);
    firstSql.pragma('busy_timeout = 0');
    secondSql.pragma('busy_timeout = 0');
    const firstStore = createDreamingProposalStore(firstSql);
    const secondStore = createDreamingProposalStore(secondSql);

    let first: ReturnType<typeof startProject> | undefined;
    firstSql.transaction(() => {
      first = startProject(firstStore, 'contended-revision');
      expect(startProject(secondStore, 'contended-revision')).toEqual({
        status: 'busy',
      });
    })();
    expect(first?.status).toBe('started');

    const duplicate = startProject(secondStore, 'contended-revision');
    expect(duplicate.status).toBe('existing');
    expect('leaseToken' in duplicate.run).toBe(false);
    expect(secondStore.listRuns('project-1', 'project')).toHaveLength(1);
  });
});
