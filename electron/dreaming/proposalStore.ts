import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  DreamingEntityType,
  DreamingProposalKind,
  DreamingProposalPayloadByKind,
  DreamingRunStatus,
  ValidatedDreamingProposal,
} from './types';

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
  errorCode: DreamingFailureCode | null;
  leaseToken: string | null;
  startedAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  errorCode: row.error_code,
  leaseToken: row.lease_token,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  nextRetryAt: row.next_retry_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toProposalRecord = (row: DreamingProposalRow): DreamingProposalRecord =>
  ({
    id: row.id,
    runId: row.run_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    evidence: JSON.parse(row.evidence_json),
    fingerprint: row.fingerprint,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as DreamingProposalRecord;

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

const proposalKindsByEntityType: Record<
  DreamingEntityType,
  readonly DreamingProposalKind[]
> = {
  project: [
    'project_summary',
    'project_milestone',
    'project_commitment',
    'project_alias',
  ],
  person: [
    'person_headline',
    'person_focus',
    'person_collaborator',
    'person_alias',
  ],
};

const assertProposal = (
  proposal: ValidatedDreamingProposal,
  entityType: DreamingEntityType,
): void => {
  if (
    !proposalKindsByEntityType[entityType].includes(proposal.kind) ||
    !proposal.fingerprint.trim() ||
    !proposal.payload ||
    typeof proposal.payload !== 'object' ||
    !Array.isArray(proposal.evidence)
  ) {
    throw new Error('dreaming_proposal_invalid');
  }
};

const retryAt = (now: string, attemptCount: number): string => {
  const baseDelayMs = 60_000;
  return new Date(
    new Date(now).getTime() + baseDelayMs * 2 ** (attemptCount - 1),
  ).toISOString();
};

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

  const startRun = (input: {
    entityId: string;
    entityType: DreamingEntityType;
    sourceRevision: string;
    model: string;
    promptVersion: string;
    mode?: DreamingStartMode;
  }) =>
    sql.transaction(() => {
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
          if (existing.attempt_count >= 2) {
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
          next_retry_at = NULL, updated_at = ? WHERE id = ?`)
          .run(
            input.model,
            input.promptVersion,
            leaseToken,
            timestamp,
            timestamp,
            existing.id,
          );
        return { status: 'started' as const, run: readRun(existing.id)! };
      }

      const id = `dream_run_${randomUUID()}`;
      const leaseToken = randomUUID();
      sql
        .prepare(`INSERT INTO entity_dreaming_runs (
        id, entity_id, entity_type, source_revision, status, model,
        prompt_version, attempt_count, lease_token, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, 1, ?, ?, ?, ?)`)
        .run(
          id,
          entityId,
          entityType,
          input.sourceRevision,
          input.model,
          input.promptVersion,
          leaseToken,
          timestamp,
          timestamp,
          timestamp,
        );
      return { status: 'started' as const, run: readRun(id)! };
    })();

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
          assertProposal(proposal, row.entity_type);
          insert.run(
            `dream_prop_${randomUUID()}`,
            row.id,
            row.entity_id,
            row.entity_type,
            proposal.kind,
            JSON.stringify(proposal.payload),
            JSON.stringify(proposal.evidence),
            proposal.fingerprint,
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
      const nextRetryAt =
        row.attempt_count < 2 ? retryAt(timestamp, row.attempt_count) : null;
      sql
        .prepare(`UPDATE entity_dreaming_runs SET status = 'failed',
        error_code = ?, lease_token = NULL, completed_at = ?, next_retry_at = ?,
        updated_at = ? WHERE id = ?`)
        .run(errorCode, timestamp, nextRetryAt, timestamp, row.id);
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
          'SELECT * FROM entity_dreaming_runs WHERE entity_id = ? AND entity_type = ? ORDER BY created_at, id',
        )
        .all(canonicalId, type) as DreamingRunRow[]
    ).map(toRunRecord);
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
          WHERE entity_id = ? AND entity_type = ? AND status = 'pending'
          ORDER BY created_at, rowid`)
        .all(canonicalId, type) as DreamingProposalRow[]
    ).map(toProposalRecord);
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
