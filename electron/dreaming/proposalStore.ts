import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { parseDreamingProposal } from './proposalParser';
import type {
  DreamingEntityType,
  DreamingProposalKind,
  DreamingProposalPayloadByKind,
  DreamingRunStatus,
  ValidatedDreamingProposal,
} from './types';

export { parseDreamingProposal } from './proposalParser';

export const DREAMING_FAILURE_CODES = [
  'provider_unavailable',
  'generation_failed',
  'validation_failed',
  'persistence_failed',
  'lease_expired',
] as const;

export type DreamingFailureCode = (typeof DREAMING_FAILURE_CODES)[number];
export type DreamingStartMode = 'automatic' | 'manual';
export type DreamingProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale';

export interface DreamingRunRecord {
  id: string;
  entityId: string;
  entityType: DreamingEntityType;
  sourceRevision: string;
  status: DreamingRunStatus;
  model: string;
  promptVersion: string;
  attemptCount: number;
  failureCount: number;
  errorCode: DreamingFailureCode | null;
  startedAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DreamingLeasedRunRecord extends DreamingRunRecord {
  leaseToken: string;
}

export interface DreamingStartInput {
  entityId: string;
  entityType: DreamingEntityType;
  sourceRevision: string;
  model: string;
  promptVersion: string;
  mode?: DreamingStartMode;
}

export type DreamingStartResult =
  | { status: 'started'; run: DreamingLeasedRunRecord }
  | {
      status: 'existing' | 'backoff' | 'exhausted';
      run: DreamingRunRecord;
    }
  | { status: 'busy' };

type DreamingProposalRecordByKind = {
  [Kind in DreamingProposalKind]: {
    id: string;
    runId: string;
    entityId: string;
    entityType: DreamingEntityType;
    kind: Kind;
    payload: DreamingProposalPayloadByKind[Kind];
    evidence: ValidatedDreamingProposal['evidence'];
    fingerprint: string;
    status: DreamingProposalStatus;
    decidedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type DreamingProposalRecord =
  DreamingProposalRecordByKind[DreamingProposalKind];

interface DreamingRunRow {
  id: string;
  entity_id: string;
  entity_type: DreamingEntityType;
  source_revision: string;
  status: DreamingRunStatus;
  model: string;
  prompt_version: string;
  attempt_count: number;
  failure_count: number;
  start_mode: DreamingStartMode;
  error_code: DreamingFailureCode | null;
  lease_token: string | null;
  started_at: string;
  completed_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DreamingProposalRow {
  id: string;
  run_id: string;
  entity_id: string;
  entity_type: DreamingEntityType;
  kind: DreamingProposalKind;
  payload_json: string;
  evidence_json: string;
  fingerprint: string;
  status: DreamingProposalStatus;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DreamingProposalStoreDependencies {
  now?: () => string;
  resolveCanonicalEntityId?: (
    entityId: string,
    entityType: DreamingEntityType,
  ) => string;
}

export function ensureDreamingProposalSchema(sql: Database.Database): void {
  // V0 is append-only: the store exposes no run deletion or proposal cleanup.
  // The FK is defense in depth when the connection enables foreign keys; no
  // lifecycle correctness depends on cascade behavior or changing that pragma.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entity_dreaming_runs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'person')),
      source_revision TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'no_change', 'proposed', 'failed', 'cancelled')),
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0 AND failure_count <= attempt_count),
      start_mode TEXT NOT NULL CHECK(start_mode IN ('automatic', 'manual')),
      error_code TEXT CHECK(error_code IS NULL OR error_code IN (
        'provider_unavailable', 'generation_failed', 'validation_failed',
        'persistence_failed', 'lease_expired'
      )),
      lease_token TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(
        (status = 'running' AND lease_token IS NOT NULL AND completed_at IS NULL) OR
        (status <> 'running' AND lease_token IS NULL AND completed_at IS NOT NULL)
      ),
      CHECK(
        (status = 'failed' AND error_code IS NOT NULL) OR
        (status <> 'failed' AND error_code IS NULL)
      ),
      CHECK(next_retry_at IS NULL OR status = 'failed'),
      UNIQUE(entity_id, source_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_dreaming_runs_status_retry
      ON entity_dreaming_runs(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_entity_dreaming_runs_entity_created
      ON entity_dreaming_runs(entity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS entity_dreaming_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES entity_dreaming_runs(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'person')),
      kind TEXT NOT NULL CHECK(kind IN (
        'project_summary', 'project_milestone', 'project_commitment',
        'project_alias', 'person_headline', 'person_focus',
        'person_collaborator', 'person_alias'
      )),
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      fingerprint TEXT NOT NULL CHECK(length(fingerprint) > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'stale')),
      decided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(
        (status = 'pending' AND decided_at IS NULL) OR
        (status <> 'pending' AND decided_at IS NOT NULL)
      ),
      UNIQUE(run_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_dreaming_proposals_entity_status
      ON entity_dreaming_proposals(entity_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_entity_dreaming_proposals_run
      ON entity_dreaming_proposals(run_id);
  `);
}

const toRunRecord = (row: DreamingRunRow): DreamingRunRecord => ({
  id: row.id,
  entityId: row.entity_id,
  entityType: row.entity_type,
  sourceRevision: row.source_revision,
  status: row.status,
  model: row.model,
  promptVersion: row.prompt_version,
  attemptCount: row.attempt_count,
  failureCount: row.failure_count,
  errorCode: row.error_code,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  nextRetryAt: row.next_retry_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLeasedRunRecord = (row: DreamingRunRow): DreamingLeasedRunRecord => {
  if (!row.lease_token) throw new Error('dreaming_lease_missing');
  return { ...toRunRecord(row), leaseToken: row.lease_token };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toProposalRecord = (row: DreamingProposalRow): DreamingProposalRecord => {
  let proposal: ValidatedDreamingProposal | null = null;
  try {
    proposal = parseDreamingProposal(
      {
        kind: row.kind,
        payload: JSON.parse(row.payload_json),
        evidence: JSON.parse(row.evidence_json),
        fingerprint: row.fingerprint,
      },
      row.entity_type,
    );
  } catch {
    proposal = null;
  }
  if (!proposal) throw new Error('dreaming_proposal_corrupt');
  return {
    id: row.id,
    runId: row.run_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    kind: proposal.kind,
    payload: proposal.payload,
    evidence: proposal.evidence,
    fingerprint: proposal.fingerprint,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as DreamingProposalRecord;
};

const assertEntityType = (value: string): DreamingEntityType => {
  if (value !== 'project' && value !== 'person') {
    throw new Error('dreaming_entity_type_invalid');
  }
  return value;
};

const assertFailureCode = (value: string): DreamingFailureCode => {
  if (!(DREAMING_FAILURE_CODES as readonly string[]).includes(value)) {
    throw new Error('dreaming_error_code_invalid');
  }
  return value as DreamingFailureCode;
};

const retryAt = (now: string, failureCount: number): string => {
  const baseDelayMs = 60_000;
  return new Date(
    new Date(now).getTime() + baseDelayMs * 2 ** (failureCount - 1),
  ).toISOString();
};

const isDatabaseBusy = (error: unknown): boolean =>
  isRecord(error) &&
  (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_BUSY_SNAPSHOT');

export function createDreamingProposalStore(
  sql: Database.Database,
  dependencies: DreamingProposalStoreDependencies = {},
) {
  ensureDreamingProposalSchema(sql);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const resolveCanonicalEntityId =
    dependencies.resolveCanonicalEntityId ?? ((entityId: string) => entityId);
  const readRun = (id: string): DreamingRunRecord | null => {
    const row = sql
      .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
      .get(id) as DreamingRunRow | undefined;
    return row ? toRunRecord(row) : null;
  };

  const startRunTransaction = sql.transaction((input: DreamingStartInput) => {
    const entityType = assertEntityType(input.entityType);
    const entityId = resolveCanonicalEntityId(
      input.entityId.trim(),
      entityType,
    ).trim();
    if (
      !entityId ||
      !input.sourceRevision.trim() ||
      !input.model.trim() ||
      !input.promptVersion.trim()
    ) {
      throw new Error('dreaming_run_input_invalid');
    }
    const timestamp = now();
    const existing = sql
      .prepare(
        'SELECT * FROM entity_dreaming_runs WHERE entity_id = ? AND source_revision = ?',
      )
      .get(entityId, input.sourceRevision) as DreamingRunRow | undefined;

    if (existing) {
      const run = toRunRecord(existing);
      if (
        existing.status === 'running' ||
        existing.status === 'no_change' ||
        existing.status === 'proposed'
      ) {
        return { status: 'existing' as const, run };
      }
      if (input.mode !== 'manual') {
        if (existing.failure_count >= 2) {
          return { status: 'exhausted' as const, run };
        }
        if (existing.next_retry_at && existing.next_retry_at > timestamp) {
          return { status: 'backoff' as const, run };
        }
      }
      const leaseToken = randomUUID();
      sql
        .prepare(`UPDATE entity_dreaming_runs SET
          status = 'running', model = ?, prompt_version = ?,
          attempt_count = attempt_count + 1, error_code = NULL,
          lease_token = ?, started_at = ?, completed_at = NULL,
          next_retry_at = NULL, start_mode = ?, updated_at = ? WHERE id = ?`)
        .run(
          input.model,
          input.promptVersion,
          leaseToken,
          timestamp,
          input.mode ?? 'automatic',
          timestamp,
          existing.id,
        );
      const restarted = sql
        .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
        .get(existing.id) as DreamingRunRow;
      return {
        status: 'started' as const,
        run: toLeasedRunRecord(restarted),
      };
    }

    const id = `dream_run_${randomUUID()}`;
    const leaseToken = randomUUID();
    sql
      .prepare(`INSERT INTO entity_dreaming_runs (
        id, entity_id, entity_type, source_revision, status, model,
        prompt_version, attempt_count, failure_count, start_mode, lease_token,
        started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, 1, 0, ?, ?, ?, ?, ?)`)
      .run(
        id,
        entityId,
        entityType,
        input.sourceRevision,
        input.model,
        input.promptVersion,
        input.mode ?? 'automatic',
        leaseToken,
        timestamp,
        timestamp,
        timestamp,
      );
    const started = sql
      .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
      .get(id) as DreamingRunRow;
    return { status: 'started' as const, run: toLeasedRunRecord(started) };
  });

  const startRun = (input: DreamingStartInput): DreamingStartResult => {
    try {
      return startRunTransaction.immediate(input);
    } catch (error) {
      if (isDatabaseBusy(error)) return { status: 'busy' as const };
      throw error;
    }
  };

  const completeRun = (
    input:
      | {
          runId: string;
          leaseToken: string;
          status: 'no_change';
          proposals: [];
        }
      | {
          runId: string;
          leaseToken: string;
          status: 'proposed';
          proposals: [
            ValidatedDreamingProposal,
            ...ValidatedDreamingProposal[],
          ];
        },
  ): DreamingRunRecord | null =>
    sql.transaction(() => {
      const row = sql
        .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
        .get(input.runId) as DreamingRunRow | undefined;
      if (
        !row ||
        row.status !== 'running' ||
        row.lease_token !== input.leaseToken
      ) {
        return null;
      }
      if (input.status === 'no_change' && input.proposals.length !== 0) {
        throw new Error('dreaming_no_change_proposals_invalid');
      }
      if (input.status === 'proposed' && input.proposals.length === 0) {
        throw new Error('dreaming_proposals_required');
      }

      const timestamp = now();
      if (input.status === 'proposed') {
        const insert = sql.prepare(`INSERT INTO entity_dreaming_proposals (
          id, run_id, entity_id, entity_type, kind, payload_json,
          evidence_json, fingerprint, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`);
        for (const proposal of input.proposals) {
          const parsed = parseDreamingProposal(proposal, row.entity_type);
          if (!parsed) throw new Error('dreaming_proposal_invalid');
          insert.run(
            `dream_prop_${randomUUID()}`,
            row.id,
            row.entity_id,
            row.entity_type,
            parsed.kind,
            JSON.stringify(parsed.payload),
            JSON.stringify(parsed.evidence),
            parsed.fingerprint,
            timestamp,
            timestamp,
          );
        }
      }
      sql
        .prepare(`UPDATE entity_dreaming_runs SET status = ?, error_code = NULL,
        lease_token = NULL, completed_at = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ?`)
        .run(input.status, timestamp, timestamp, row.id);
      return readRun(row.id);
    })();

  const failRun = (input: {
    runId: string;
    leaseToken: string;
    errorCode: string;
  }): DreamingRunRecord | null => {
    const errorCode = assertFailureCode(input.errorCode);
    return sql.transaction(() => {
      const row = sql
        .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
        .get(input.runId) as DreamingRunRow | undefined;
      if (
        !row ||
        row.status !== 'running' ||
        row.lease_token !== input.leaseToken
      ) {
        return null;
      }
      const timestamp = now();
      const automaticFailure = row.start_mode === 'automatic';
      const failureCount = row.failure_count + (automaticFailure ? 1 : 0);
      const nextRetryAt =
        automaticFailure && failureCount < 2
          ? retryAt(timestamp, failureCount)
          : null;
      sql
        .prepare(`UPDATE entity_dreaming_runs SET status = 'failed',
        error_code = ?, lease_token = NULL, completed_at = ?, next_retry_at = ?,
        failure_count = ?, updated_at = ? WHERE id = ?`)
        .run(
          errorCode,
          timestamp,
          nextRetryAt,
          failureCount,
          timestamp,
          row.id,
        );
      return readRun(row.id);
    })();
  };

  const cancelRun = (input: {
    runId: string;
    leaseToken: string;
  }): DreamingRunRecord | null =>
    sql.transaction(() => {
      const timestamp = now();
      const result = sql
        .prepare(`UPDATE entity_dreaming_runs SET
        status = 'cancelled', error_code = NULL, lease_token = NULL,
        completed_at = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_token = ?`)
        .run(timestamp, timestamp, input.runId, input.leaseToken);
      return result.changes === 1 ? readRun(input.runId) : null;
    })();

  const listRuns = (
    entityId: string,
    entityType: DreamingEntityType,
  ): DreamingRunRecord[] => {
    const type = assertEntityType(entityType);
    const canonicalId = resolveCanonicalEntityId(entityId.trim(), type);
    return (
      sql
        .prepare(
          'SELECT * FROM entity_dreaming_runs WHERE entity_type = ? ORDER BY created_at, id',
        )
        .all(type) as DreamingRunRow[]
    )
      .filter(
        (row) => resolveCanonicalEntityId(row.entity_id, type) === canonicalId,
      )
      .map(toRunRecord);
  };

  const listPendingProposals = (
    entityId: string,
    entityType: DreamingEntityType,
  ): DreamingProposalRecord[] => {
    const type = assertEntityType(entityType);
    const canonicalId = resolveCanonicalEntityId(entityId.trim(), type);
    return (
      sql
        .prepare(`SELECT * FROM entity_dreaming_proposals
          WHERE entity_type = ? AND status = 'pending'
          ORDER BY created_at, rowid`)
        .all(type) as DreamingProposalRow[]
    )
      .filter(
        (row) => resolveCanonicalEntityId(row.entity_id, type) === canonicalId,
      )
      .map((row) => ({ ...toProposalRecord(row), entityId: canonicalId }));
  };

  const recoverStaleRuns = (input: { staleBefore: string }): number => {
    const timestamp = now();
    return sql
      .prepare(`UPDATE entity_dreaming_runs SET status = 'cancelled',
        error_code = NULL, lease_token = NULL, completed_at = ?,
        next_retry_at = NULL, updated_at = ?
        WHERE status = 'running' AND updated_at <= ?`)
      .run(timestamp, timestamp, input.staleBefore).changes;
  };

  return {
    startRun,
    completeRun,
    failRun,
    cancelRun,
    getRun: readRun,
    listRuns,
    listPendingProposals,
    recoverStaleRuns,
  };
}
