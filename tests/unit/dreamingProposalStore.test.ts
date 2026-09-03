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
  sql.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      normalized_name TEXT NOT NULL, status TEXT, due_date TEXT,
      assigned_to TEXT, metadata TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entity_links (
      id TEXT PRIMARY KEY, source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL, relationship TEXT NOT NULL,
      meeting_id TEXT, state TEXT NOT NULL, evidence_meeting_id TEXT,
      evidence_quote TEXT, source TEXT NOT NULL, confidence REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entity_corrections (
      id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, item_type TEXT NOT NULL,
      fingerprint TEXT NOT NULL, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(entity_id, item_type, fingerprint)
    );
    CREATE TABLE person_name_aliases (
      person_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
      display_name TEXT NOT NULL, source TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(person_id, normalized_name)
    );
    CREATE TABLE project_name_aliases (
      project_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
      display_name TEXT NOT NULL, source TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(project_id, normalized_name)
    );
    CREATE TABLE knowledge_docs (
      id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_key TEXT NOT NULL,
      title TEXT NOT NULL, structured_json TEXT, status TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scope_type, scope_key)
    );
  `);
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

  it('rejects a pending proposal and records its fingerprint atomically', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.rejectDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toEqual({ status: 'rejected', proposalId: proposal.id });
    expect(
      sql
        .prepare('SELECT status FROM entity_dreaming_proposals WHERE id=?')
        .get(proposal.id),
    ).toEqual({ status: 'rejected' });
    expect(
      sql
        .prepare(
          'SELECT entity_id,item_type,fingerprint FROM entity_corrections',
        )
        .get(),
    ).toEqual({
      entity_id: 'project-1',
      item_type: 'dreaming:project_summary',
      fingerprint: 'project-summary-one',
    });
    expect(
      createDreamingProposalStore(sql).listPendingProposals(
        'project-1',
        'project',
      ),
    ).toEqual([]);
  });

  it('keeps a proposal pending when its rejection correction cannot be stored', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];
    sql.exec(`CREATE TRIGGER fail_correction BEFORE INSERT ON entity_corrections
      BEGIN SELECT RAISE(ABORT, 'injected_correction_failure'); END;`);

    expect(() =>
      store.rejectDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toThrow('injected_correction_failure');
    expect(store.listPendingProposals('project-1', 'project')).toHaveLength(1);
  });

  it('marks a proposal stale without canonical or correction writes when the revision changed', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-2',
      }),
    ).toEqual({
      status: 'stale',
      proposalId: proposal.id,
    });
    expect(
      sql.prepare(`SELECT metadata FROM entities WHERE id='project-1'`).get(),
    ).toEqual({ metadata: '{}' });
    expect(
      sql.prepare('SELECT COUNT(*) count FROM entity_corrections').get(),
    ).toEqual({ count: 0 });
  });

  it('accepts a project summary into the existing theme without changing a confirmed title', () => {
    const { sql, store } = fixture();
    const metadata = JSON.stringify({
      projectDisplayTitle: 'User title',
      projectDisplayTitleSource: 'user',
      projectThemeSynthesis: {
        version: 1,
        sourceMeetingIds: ['old'],
        candidateProjectIds: ['project-1'],
        outcome: 'Existing outcome',
        currentFocus: 'Old focus',
        recentChanges: [],
        openThreads: [],
        synthesizedAt: 'old',
      },
    });
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha',?)`)
      .run(metadata);
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toEqual({ status: 'accepted', proposalId: proposal.id });
    const saved = JSON.parse(
      (
        sql
          .prepare(`SELECT metadata FROM entities WHERE id='project-1'`)
          .get() as { metadata: string }
      ).metadata,
    );
    expect(saved.projectDisplayTitle).toBe('User title');
    expect(saved.projectThemeSynthesis).toMatchObject({
      outcome: 'Existing outcome',
      currentFocus: 'A grounded summary',
      sourceMeetingIds: ['old', 'meeting-1'],
      sourceContexts: { 'meeting-1': 'Supporting evidence' },
    });
  });

  it('returns review_required rather than merging an alias that names another entity', () => {
    const { sql, store } = fixture();
    sql.exec(`INSERT INTO entities(id,type,name,normalized_name,metadata) VALUES
      ('project-1','project','Alpha','alpha','{}'),
      ('project-2','project','Beta','beta','{}')`);
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_alias',
          payload: { alias: 'Beta' },
          evidence: [{ meetingId: 'meeting-1', excerpt: 'Beta' }],
          fingerprint: 'beta',
        },
      ],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toEqual({ status: 'review_required', proposalId: proposal.id });
    expect(
      sql.prepare('SELECT COUNT(*) count FROM project_name_aliases').get(),
    ).toEqual({ count: 0 });
    expect(store.listPendingProposals('project-1', 'project')).toHaveLength(1);
  });

  it('accepts a non-colliding project alias without creating or merging an entity', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_alias',
          payload: { alias: 'Alpha launch' },
          evidence: [{ meetingId: 'meeting-1', excerpt: 'Alpha launch' }],
          fingerprint: 'alpha-launch',
        },
      ],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toEqual({ status: 'accepted', proposalId: proposal.id });
    expect(sql.prepare('SELECT COUNT(*) count FROM entities').get()).toEqual({
      count: 1,
    });
    expect(
      sql.prepare('SELECT * FROM project_name_aliases').get(),
    ).toMatchObject({
      project_id: 'project-1',
      normalized_name: 'alpha launch',
      display_name: 'Alpha launch',
      source: 'dreaming',
    });
  });

  it('accepts an evidence-backed generated milestone without disturbing user milestones', () => {
    const { sql, store } = fixture();
    const metadata = JSON.stringify({
      projectMilestonesVersion: 1,
      projectMilestones: [
        {
          id: 'user-1',
          title: 'User milestone',
          status: 'planned',
          targetDate: null,
          note: null,
          createdAt: 'old',
          updatedAt: 'old',
        },
      ],
    });
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha',?)`)
      .run(metadata);
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_milestone',
          payload: { name: 'Generated milestone', status: 'in_progress' },
          evidence: [{ meetingId: 'meeting-1', excerpt: 'Work is underway' }],
          fingerprint: 'generated-milestone',
        },
      ],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }).status,
    ).toBe('accepted');
    const saved = JSON.parse(
      (
        sql
          .prepare(`SELECT metadata FROM entities WHERE id='project-1'`)
          .get() as { metadata: string }
      ).metadata,
    );
    expect(saved.projectMilestones).toEqual([
      expect.objectContaining({ id: 'user-1', title: 'User milestone' }),
      expect.objectContaining({
        title: 'Generated milestone',
        source: 'dreaming',
        dreamingProposalId: proposal.id,
        dreamingRunId: started.run.id,
        sourceMeetingIds: ['meeting-1'],
        sourceExcerpts: ['Work is underway'],
      }),
    ]);
  });

  it('accepts a commitment as one unowned canonical action with a confirmed project link', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_commitment',
          payload: { task: 'Ship the preview' },
          evidence: [
            { meetingId: 'meeting-1', excerpt: 'We will ship the preview' },
          ],
          fingerprint: 'ship-preview',
        },
      ],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }).status,
    ).toBe('accepted');
    expect(
      sql
        .prepare(
          `SELECT type,name,assigned_to FROM entities WHERE type='action_item'`,
        )
        .all(),
    ).toEqual([
      { type: 'action_item', name: 'Ship the preview', assigned_to: null },
    ]);
    expect(
      sql
        .prepare(
          'SELECT relationship,state,evidence_meeting_id,evidence_quote FROM entity_links',
        )
        .get(),
    ).toEqual({
      relationship: 'belongs_to',
      state: 'confirmed',
      evidence_meeting_id: 'meeting-1',
      evidence_quote: 'We will ship the preview',
    });
  });

  it('updates person current_read claims while preserving unrelated knowledge fields and evidence', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('person-1','person','Avery','avery','{}')`)
      .run();
    sql
      .prepare(`INSERT INTO knowledge_docs(id,scope_type,scope_key,title,structured_json,status)
      VALUES ('doc-1','person_context','person-1','Avery',?,'up_to_date')`)
      .run(
        JSON.stringify({
          schema_version: 2,
          current_read: {
            headline: 'Old headline',
            supporting_bullets: ['Keep me'],
          },
          active_streams: [{ id: 'keep' }],
        }),
      );
    const started = store.startRun({
      entityId: 'person-1',
      entityType: 'person',
      sourceRevision: 'person-rev',
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
          payload: { focus: 'Launch readiness' },
          evidence: [
            { meetingId: 'meeting-1', excerpt: 'Focused on launch readiness' },
          ],
          fingerprint: 'launch-readiness',
        },
      ],
    });
    const proposal = store.listPendingProposals('person-1', 'person')[0];

    expect(
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'person-rev',
      }).status,
    ).toBe('accepted');
    const saved = JSON.parse(
      (
        sql
          .prepare(
            `SELECT structured_json FROM knowledge_docs WHERE id='doc-1'`,
          )
          .get() as { structured_json: string }
      ).structured_json,
    );
    expect(saved.active_streams).toEqual([{ id: 'keep' }]);
    expect(saved.current_read).toMatchObject({
      headline: 'Old headline',
      supporting_bullets: ['Keep me', 'Launch readiness'],
      dreamingEvidence: expect.arrayContaining([
        expect.objectContaining({
          proposalId: proposal.id,
          kind: 'person_focus',
          sourceMeetingIds: ['meeting-1'],
        }),
      ]),
    });
  });

  it('rolls back canonical application when accepting status cannot be persisted', () => {
    const { sql, store } = fixture();
    sql
      .prepare(`INSERT INTO entities(id,type,name,normalized_name,metadata)
      VALUES ('project-1','project','Alpha','alpha','{}')`)
      .run();
    const started = startProject(store);
    expect(started.status).toBe('started');
    store.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [projectSummary()],
    });
    const proposal = store.listPendingProposals('project-1', 'project')[0];
    sql.exec(`CREATE TRIGGER fail_accept BEFORE UPDATE OF status ON entity_dreaming_proposals
      WHEN NEW.status='accepted' BEGIN SELECT RAISE(ABORT, 'injected_accept_failure'); END;`);

    expect(() =>
      store.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => 'revision-1',
      }),
    ).toThrow('injected_accept_failure');
    expect(
      sql.prepare(`SELECT metadata FROM entities WHERE id='project-1'`).get(),
    ).toEqual({ metadata: '{}' });
    expect(store.listPendingProposals('project-1', 'project')).toHaveLength(1);
  });
});
