import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { withSavedDreamingProjectMilestone } from '../../src/utils/projectMilestones';
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
  isCorrectionPresent?: (
    entityId: string,
    entityType: DreamingEntityType,
    fingerprint: string,
  ) => boolean;
}

export type DreamingDecisionResult =
  | {
      status: 'accepted' | 'rejected' | 'stale' | 'removed' | 'restored';
      proposalId: string;
    }
  | { status: 'review_required' | 'not_pending'; proposalId: string };

export interface DreamingDecisionInput {
  proposalId: string;
  getCurrentSourceRevision: (
    entityId: string,
    entityType: DreamingEntityType,
  ) => string | null;
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

    CREATE TABLE IF NOT EXISTS entity_dreaming_aliases (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES entity_dreaming_proposals(id),
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'person')),
      normalized_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source = 'dreaming'),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      removed_at TEXT,
      CHECK((active = 1 AND removed_at IS NULL) OR (active = 0 AND removed_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_dreaming_aliases_active_name
      ON entity_dreaming_aliases(entity_type, normalized_name) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_entity_dreaming_aliases_entity
      ON entity_dreaming_aliases(entity_id, entity_type, active);
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
  const isCorrectionPresent =
    dependencies.isCorrectionPresent ??
    ((
      entityId: string,
      entityType: DreamingEntityType,
      fingerprint: string,
    ) => {
      const rows = sql
        .prepare(`SELECT correction.entity_id
          FROM entity_corrections correction
          LEFT JOIN entities entity ON entity.id = correction.entity_id
          WHERE correction.fingerprint = ?
            AND (entity.type = ? OR correction.entity_id = ?)`)
        .all(fingerprint, entityType, entityId) as Array<{ entity_id: string }>;
      return rows.some(
        (row) =>
          row.entity_id === entityId ||
          resolveCanonicalEntityId(row.entity_id, entityType) === entityId,
      );
    });
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
          if (
            isCorrectionPresent(
              row.entity_id,
              row.entity_type,
              parsed.fingerprint,
            )
          ) {
            throw new Error('dreaming_proposal_corrected');
          }
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

  const markProposalStale = (
    proposalId: string,
    timestamp: string,
  ): DreamingDecisionResult => {
    sql
      .prepare(`UPDATE entity_dreaming_proposals SET status = 'stale',
        decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(timestamp, timestamp, proposalId);
    return { status: 'stale', proposalId };
  };

  const readDecisionProposal = (
    proposalId: string,
  ): { proposal: DreamingProposalRecord; run: DreamingRunRow } | null => {
    const row = sql
      .prepare('SELECT * FROM entity_dreaming_proposals WHERE id = ?')
      .get(proposalId) as DreamingProposalRow | undefined;
    if (!row || row.status !== 'pending') return null;
    const run = sql
      .prepare('SELECT * FROM entity_dreaming_runs WHERE id = ?')
      .get(row.run_id) as DreamingRunRow | undefined;
    if (
      !run ||
      run.entity_id !== row.entity_id ||
      run.entity_type !== row.entity_type
    ) {
      throw new Error('dreaming_proposal_run_mismatch');
    }
    return { proposal: toProposalRecord(row), run };
  };

  const normalizeName = (value: string): string =>
    value.toLocaleLowerCase().trim().replace(/\s+/g, ' ');

  const parseObject = (value: string | null): Record<string, unknown> => {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const applyProjectSummary = (
    proposal: Extract<DreamingProposalRecord, { kind: 'project_summary' }>,
    timestamp: string,
  ) => {
    const entity = sql
      .prepare('SELECT type, metadata FROM entities WHERE id = ?')
      .get(proposal.entityId) as
      | { type: string; metadata: string | null }
      | undefined;
    if (!entity || entity.type !== 'project')
      throw new Error('dreaming_entity_invalid');
    const metadata = parseObject(entity.metadata);
    const existing = isRecord(metadata.projectThemeSynthesis)
      ? metadata.projectThemeSynthesis
      : {};
    const sourceMeetingIds = [
      ...new Set([
        ...(Array.isArray(existing.sourceMeetingIds)
          ? existing.sourceMeetingIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : []),
        ...proposal.evidence.map((item) => item.meetingId),
      ]),
    ];
    const sourceContexts = {
      ...(isRecord(existing.sourceContexts) ? existing.sourceContexts : {}),
      ...Object.fromEntries(
        proposal.evidence.map((item) => [item.meetingId, item.excerpt]),
      ),
    };
    const nextTheme = {
      ...existing,
      version: 1,
      sourceMeetingIds,
      candidateProjectIds: Array.isArray(existing.candidateProjectIds)
        ? existing.candidateProjectIds
        : [proposal.entityId],
      outcome:
        typeof existing.outcome === 'string'
          ? existing.outcome
          : proposal.payload.summary,
      currentFocus: proposal.payload.summary,
      recentChanges: Array.isArray(existing.recentChanges)
        ? existing.recentChanges
        : [],
      openThreads: Array.isArray(existing.openThreads)
        ? existing.openThreads
        : [],
      synthesizedAt: timestamp,
      sourceContexts,
    };
    sql
      .prepare('UPDATE entities SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(
        JSON.stringify({ ...metadata, projectThemeSynthesis: nextTheme }),
        timestamp,
        proposal.entityId,
      );
  };

  const applyProjectMilestone = (
    proposal: Extract<DreamingProposalRecord, { kind: 'project_milestone' }>,
    timestamp: string,
  ) => {
    const entity = sql
      .prepare('SELECT type, metadata FROM entities WHERE id = ?')
      .get(proposal.entityId) as
      | { type: string; metadata: string | null }
      | undefined;
    if (!entity || entity.type !== 'project')
      throw new Error('dreaming_entity_invalid');
    const saved = withSavedDreamingProjectMilestone(
      entity.metadata,
      { title: proposal.payload.name, status: proposal.payload.status },
      {
        id: `dream_ms_${proposal.id}`,
        now: timestamp,
        proposalId: proposal.id,
        runId: proposal.runId,
        evidence: proposal.evidence,
      },
    );
    sql
      .prepare('UPDATE entities SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(saved.metadata, timestamp, proposal.entityId);
  };

  const deterministicId = (prefix: string, value: string): string =>
    `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;

  const applyProjectCommitment = (
    proposal: Extract<DreamingProposalRecord, { kind: 'project_commitment' }>,
    timestamp: string,
  ) => {
    const project = sql
      .prepare('SELECT type FROM entities WHERE id = ?')
      .get(proposal.entityId) as { type: string } | undefined;
    if (!project || project.type !== 'project')
      throw new Error('dreaming_entity_invalid');
    const actionId = deterministicId(
      'dream_action',
      `${proposal.entityId}:${proposal.fingerprint}`,
    );
    const metadata = JSON.stringify({
      source: 'dreaming',
      dreaming_proposal_id: proposal.id,
      dreaming_run_id: proposal.runId,
      dreaming_fingerprint: proposal.fingerprint,
      source_meeting_id: proposal.evidence[0].meetingId,
      source_meeting_ids: proposal.evidence.map((item) => item.meetingId),
      source_excerpts: proposal.evidence.map((item) => item.excerpt),
      ownership_confirmed: false,
    });
    sql
      .prepare(`INSERT OR IGNORE INTO entities(
      id, type, name, normalized_name, status, assigned_to, metadata, updated_at
    ) VALUES (?, 'action_item', ?, ?, 'active', NULL, ?, ?)`)
      .run(
        actionId,
        proposal.payload.task,
        normalizeName(proposal.payload.task),
        metadata,
        timestamp,
      );
    const action = sql
      .prepare('SELECT type, assigned_to FROM entities WHERE id = ?')
      .get(actionId) as
      | { type: string; assigned_to: string | null }
      | undefined;
    if (
      !action ||
      action.type !== 'action_item' ||
      action.assigned_to !== null
    ) {
      throw new Error('dreaming_commitment_conflict');
    }
    sql
      .prepare(`INSERT OR IGNORE INTO entity_links(
      id, source_entity_id, target_entity_id, relationship, meeting_id,
      state, evidence_meeting_id, evidence_quote, source, confidence,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'belongs_to', ?, 'confirmed', ?, ?, 'synthesis', 1, ?, ?)`)
      .run(
        deterministicId('dream_link', `${actionId}:${proposal.entityId}`),
        actionId,
        proposal.entityId,
        proposal.evidence[0].meetingId,
        proposal.evidence[0].meetingId,
        proposal.evidence[0].excerpt,
        timestamp,
        timestamp,
      );
  };

  const applyPersonContext = (
    proposal: Extract<
      DreamingProposalRecord,
      { kind: 'person_headline' | 'person_focus' | 'person_collaborator' }
    >,
    timestamp: string,
  ) => {
    const person = sql
      .prepare('SELECT type FROM entities WHERE id = ?')
      .get(proposal.entityId) as { type: string } | undefined;
    if (!person || person.type !== 'person')
      throw new Error('dreaming_entity_invalid');
    const doc = sql
      .prepare(`SELECT id, structured_json FROM knowledge_docs
      WHERE scope_type = 'person_context' AND scope_key = ?`)
      .get(proposal.entityId) as
      | { id: string; structured_json: string | null }
      | undefined;
    if (!doc) throw new Error('dreaming_person_context_missing');
    const structured = parseObject(doc.structured_json);
    const currentRead = isRecord(structured.current_read)
      ? structured.current_read
      : {};
    const value =
      proposal.kind === 'person_headline'
        ? proposal.payload.headline
        : proposal.kind === 'person_focus'
          ? proposal.payload.focus
          : proposal.payload.name;
    const supportingBullets = Array.isArray(currentRead.supporting_bullets)
      ? currentRead.supporting_bullets.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    if (
      proposal.kind !== 'person_headline' &&
      !supportingBullets.includes(value)
    ) {
      supportingBullets.push(value);
    }
    const dreamingEvidence = Array.isArray(currentRead.dreamingEvidence)
      ? currentRead.dreamingEvidence
      : [];
    dreamingEvidence.push({
      proposalId: proposal.id,
      runId: proposal.runId,
      kind: proposal.kind,
      sourceMeetingIds: proposal.evidence.map((item) => item.meetingId),
      excerpts: proposal.evidence.map((item) => item.excerpt),
    });
    const nextCurrentRead = {
      ...currentRead,
      ...(proposal.kind === 'person_headline' ? { headline: value } : {}),
      supporting_bullets: supportingBullets,
      dreamingEvidence,
    };
    sql
      .prepare(
        'UPDATE knowledge_docs SET structured_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        JSON.stringify({ ...structured, current_read: nextCurrentRead }),
        timestamp,
        doc.id,
      );
  };

  const applyAlias = (
    proposal: Extract<
      DreamingProposalRecord,
      { kind: 'project_alias' | 'person_alias' }
    >,
  ): 'applied' | 'review_required' => {
    const expectedType =
      proposal.kind === 'project_alias' ? 'project' : 'person';
    const alias = proposal.payload.alias.trim().replace(/\s+/g, ' ');
    const normalized = normalizeName(alias);
    const entity = sql
      .prepare('SELECT id, type, normalized_name FROM entities WHERE id = ?')
      .get(proposal.entityId) as
      | { id: string; type: string; normalized_name: string }
      | undefined;
    if (!entity || entity.type !== expectedType)
      throw new Error('dreaming_entity_invalid');
    if (normalized === entity.normalized_name) return 'applied';
    const collision = sql
      .prepare(
        'SELECT id FROM entities WHERE type = ? AND normalized_name = ? AND id <> ?',
      )
      .get(expectedType, normalized, entity.id) as { id: string } | undefined;
    if (collision) return 'review_required';
    if (expectedType === 'person') {
      const userAliasOwners = sql
        .prepare(`SELECT person_id FROM person_name_aliases
          WHERE normalized_name = ?`)
        .all(normalized) as Array<{ person_id: string }>;
      if (
        userAliasOwners.some(
          (owner) =>
            resolveCanonicalEntityId(owner.person_id, 'person') !== entity.id,
        )
      ) {
        return 'review_required';
      }
    }
    const aliasCollision = sql
      .prepare(
        `SELECT entity_id AS id FROM entity_dreaming_aliases
         WHERE entity_type = ? AND normalized_name = ? AND active = 1
           AND entity_id <> ?`,
      )
      .get(expectedType, normalized, entity.id) as { id: string } | undefined;
    if (aliasCollision) return 'review_required';
    sql
      .prepare(`INSERT INTO entity_dreaming_aliases(
        id, proposal_id, entity_id, entity_type, normalized_name,
        display_name, source, evidence_json, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'dreaming', ?, 1, ?)
      ON CONFLICT(proposal_id) DO UPDATE SET
        display_name=excluded.display_name, evidence_json=excluded.evidence_json,
        active=1, removed_at=NULL, updated_at=excluded.updated_at`)
      .run(
        deterministicId('dream_alias', proposal.id),
        proposal.id,
        entity.id,
        expectedType,
        normalized,
        alias,
        JSON.stringify(proposal.evidence),
        now(),
      );
    return 'applied';
  };

  const acceptDreamingProposal = (
    input: DreamingDecisionInput,
  ): DreamingDecisionResult =>
    sql.transaction((): DreamingDecisionResult => {
      const decision = readDecisionProposal(input.proposalId);
      if (!decision)
        return { status: 'not_pending', proposalId: input.proposalId };
      const { proposal, run } = decision;
      const timestamp = now();
      if (
        input.getCurrentSourceRevision(
          proposal.entityId,
          proposal.entityType,
        ) !== run.source_revision
      ) {
        return markProposalStale(proposal.id, timestamp);
      }
      if (
        isCorrectionPresent(
          proposal.entityId,
          proposal.entityType,
          proposal.fingerprint,
        )
      ) {
        return markProposalStale(proposal.id, timestamp);
      }
      let application: 'applied' | 'review_required' = 'applied';
      if (proposal.kind === 'project_summary')
        applyProjectSummary(proposal, timestamp);
      else if (proposal.kind === 'project_milestone')
        applyProjectMilestone(proposal, timestamp);
      else if (proposal.kind === 'project_commitment')
        applyProjectCommitment(proposal, timestamp);
      else if (
        proposal.kind === 'person_headline' ||
        proposal.kind === 'person_focus' ||
        proposal.kind === 'person_collaborator'
      )
        applyPersonContext(proposal, timestamp);
      else if (
        proposal.kind === 'project_alias' ||
        proposal.kind === 'person_alias'
      ) {
        application = applyAlias(proposal);
      } else {
        throw new Error('dreaming_application_unsupported');
      }
      if (application === 'review_required') {
        return { status: 'review_required', proposalId: proposal.id };
      }
      sql
        .prepare(`UPDATE entity_dreaming_proposals SET status = 'accepted',
        decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(timestamp, timestamp, proposal.id);
      return { status: 'accepted', proposalId: proposal.id };
    })();

  const rejectDreamingProposal = (
    input: DreamingDecisionInput,
  ): DreamingDecisionResult =>
    sql.transaction((): DreamingDecisionResult => {
      const decision = readDecisionProposal(input.proposalId);
      if (!decision)
        return { status: 'not_pending', proposalId: input.proposalId };
      const { proposal, run } = decision;
      const timestamp = now();
      if (
        input.getCurrentSourceRevision(
          proposal.entityId,
          proposal.entityType,
        ) !== run.source_revision
      ) {
        return markProposalStale(proposal.id, timestamp);
      }
      const correctionId = `corr_${randomUUID()}`;
      sql
        .prepare(`INSERT INTO entity_corrections(id, entity_id, item_type, fingerprint, reason)
        VALUES (?, ?, ?, ?, 'dreaming_proposal_rejected')
        ON CONFLICT(entity_id, item_type, fingerprint) DO UPDATE SET reason=excluded.reason`)
        .run(
          correctionId,
          proposal.entityId,
          `dreaming:${proposal.kind}`,
          proposal.fingerprint,
        );
      sql
        .prepare(`UPDATE entity_dreaming_proposals SET status = 'rejected',
        decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(timestamp, timestamp, proposal.id);
      return { status: 'rejected', proposalId: proposal.id };
    })();

  const removeDreamingAlias = (input: {
    proposalId: string;
  }): DreamingDecisionResult =>
    sql.transaction((): DreamingDecisionResult => {
      const timestamp = now();
      const result = sql
        .prepare(`UPDATE entity_dreaming_aliases SET active = 0,
          removed_at = ?, updated_at = ?
          WHERE proposal_id = ? AND active = 1`)
        .run(timestamp, timestamp, input.proposalId);
      return {
        status: result.changes === 1 ? 'removed' : 'not_pending',
        proposalId: input.proposalId,
      };
    })();

  const restoreDreamingAlias = (input: {
    proposalId: string;
  }): DreamingDecisionResult =>
    sql.transaction((): DreamingDecisionResult => {
      const alias = sql
        .prepare(`SELECT * FROM entity_dreaming_aliases
          WHERE proposal_id = ? AND active = 0`)
        .get(input.proposalId) as
        | {
            entity_id: string;
            entity_type: DreamingEntityType;
            normalized_name: string;
          }
        | undefined;
      if (!alias)
        return { status: 'not_pending', proposalId: input.proposalId };
      const entityCollision = sql
        .prepare(`SELECT 1 FROM entities WHERE type = ? AND normalized_name = ?
          AND id <> ? LIMIT 1`)
        .get(alias.entity_type, alias.normalized_name, alias.entity_id);
      const aliasCollision = sql
        .prepare(`SELECT 1 FROM entity_dreaming_aliases WHERE entity_type = ?
          AND normalized_name = ? AND entity_id <> ? AND active = 1 LIMIT 1`)
        .get(alias.entity_type, alias.normalized_name, alias.entity_id);
      const userAliasCollision =
        alias.entity_type === 'person' &&
        (
          sql
            .prepare(`SELECT person_id FROM person_name_aliases
              WHERE normalized_name = ?`)
            .all(alias.normalized_name) as Array<{ person_id: string }>
        ).some(
          (owner) =>
            resolveCanonicalEntityId(owner.person_id, 'person') !==
            resolveCanonicalEntityId(alias.entity_id, 'person'),
        );
      if (entityCollision || aliasCollision || userAliasCollision) {
        return { status: 'review_required', proposalId: input.proposalId };
      }
      const timestamp = now();
      sql
        .prepare(`UPDATE entity_dreaming_aliases SET active = 1,
        removed_at = NULL, updated_at = ? WHERE proposal_id = ?`)
        .run(timestamp, input.proposalId);
      return { status: 'restored', proposalId: input.proposalId };
    })();

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
    acceptDreamingProposal,
    rejectDreamingProposal,
    removeDreamingAlias,
    restoreDreamingAlias,
    recoverStaleRuns,
  };
}
