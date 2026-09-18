import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  type DownstreamProcessingLease,
  buildDownstreamProcessingLease,
  readDownstreamProcessingLease,
} from '../src/services/downstreamProcessingLease';
import type { SpeakerAttributionDiagnostics } from '../src/services/finalTranscription/applyRecoveredChannelEvidence';
import {
  type FinalTranscriptionLease,
  finishFinalTranscriptionLease,
  readFinalTranscriptionLease,
} from '../src/services/finalTranscription/finalTranscriptionLease';
import type { SpeakerCandidateEvidence } from '../src/services/speakerCandidateEvidence';
import {
  type TranscriptValidationRetryFailure,
  type TranscriptValidationRetryLease,
  type TranscriptValidationRetryStage,
  beginRetryLease,
  finishRetryLease,
  mergeTranscriptOwnedFields,
  parseIntegrityRecord,
  readRetryLease,
} from '../src/services/transcriptValidationRetryLease';
import type { MeetingFinalizationStatus } from '../src/types';
import type {
  LiveMeetingContextCheckpointV1,
  MeetingContextAttributeValue,
  MeetingContextEvent,
  MeetingContextEventInput,
  MeetingContextEvidenceReference,
  MeetingContextRollingStateV1,
  MeetingContextSnapshot,
} from '../src/types/meetingContext';
import {
  getCommitmentState,
  mergeCommitmentReview,
  parseActionMetadata,
} from '../src/utils/actionCommitment';
import {
  getAnalysisEditBlocks,
  parseAnalysisDocumentV3Json,
  parseAnalysisEditConflictsJson,
  parseUserEditsJson,
} from '../src/utils/analysisDocument';
import {
  type PreservedEditConflict,
  rebaseMeetingNotesEdits,
} from '../src/utils/meetingNotesEditRebase';
import {
  ANALYSIS_SNAPSHOT_PATH,
  createAnalysisSnapshot,
  restoreAnalysisSnapshot,
} from '../src/utils/meetingNotesHistory';
import { meetingTitleNeedsGeneration } from '../src/utils/meetingTitle';
import {
  type PersonBriefingCommitment,
  type PersonBriefingCommitmentCandidate,
  type PersonBriefingMeeting,
  type PersonBriefingSummary,
  type PersonCommitmentCandidate,
  type PersonMeetingRecord,
  isUsablePersonName,
  mergePersonMeetingEvidence,
  parsePersonRole,
  selectPersonCommitments,
} from '../src/utils/personBriefing';
import {
  type ProjectBrief,
  type ProjectBriefingMeeting,
  buildProjectHealth,
  buildProjectMeetingStats,
  buildProjectMilestones,
  buildProjectMomentum,
  buildUserProjectMilestones,
  readProjectDisplayTitle,
  readProjectThemeSynthesis,
  sortProjectMilestones,
  withProjectDisplayTitle,
} from '../src/utils/projectBriefing';
import {
  type UserProjectMilestone,
  type UserProjectMilestoneInput,
  restoreUserProjectMilestone,
  withSavedUserProjectMilestone,
  withoutProjectMilestone,
} from '../src/utils/projectMilestones';
import type { ProjectPortfolioEntry } from '../src/utils/projectPortfolio';
import {
  type ProjectPortfolioDisposition,
  readProjectQualification,
  withProjectPortfolioDisposition,
} from '../src/utils/projectQualification';
import { canDeleteMeeting } from '../src/utils/recordingFinalization';
import {
  hasVerifiedSpeakerAttribution,
  readStoredSpeakerAttribution,
} from '../src/utils/speakerAttributionTrust';
import type { TranscriptLifecycleStatus } from '../src/utils/transcriptIntegrity';
import { withTranscriptLifecycleStatus } from '../src/utils/transcriptSchema';
import {
  assertValidTranscriptTrustCandidate,
  parseTranscriptTrustEnvelope,
} from '../src/utils/transcriptTrustState';
import type { TrustStatus } from '../src/utils/trustStatus';
import { createCalendarStore } from './calendar/store';
import type { CalendarEvent } from './calendar/types';
import { getApplicationDatabase } from './database/applicationDatabase';
import {
  type MeetingContextSectionIntegrity,
  type MeetingContextSectionRow,
  type SearchIndexIntegrity,
  getMeetingContextSectionIntegrity as readMeetingContextSectionIntegrity,
  getMeetingFtsIntegrity as readMeetingFtsIntegrity,
  getMeetingNotesFtsIntegrity as readMeetingNotesFtsIntegrity,
  refreshMeetingFts as refreshMeetingSearchFts,
  repairMeetingContextSectionIndex as repairMeetingContextSectionSearchIndex,
  repairMeetingNotesFtsIndex as repairMeetingNotesSearchFtsIndex,
  repairMeetingFtsIndex as repairMeetingSearchFtsIndex,
} from './database/meetingSearchMaintenance';
import {
  type DreamingDecisionInput,
  type DreamingDecisionResult,
  createDreamingProposalStore,
} from './dreaming/proposalStore';
import { generateItemFingerprint } from './dreaming/validateDreamingOutput';
import { createIdentityStore } from './identityStore';
import type {
  AttentionEvidenceReference,
  AttentionItem,
  AttentionItemStatus,
  AttentionItemUpsert,
  AttentionScoreBreakdown,
  MidFrontmatter,
} from './intelligence/intelligenceTypes';
import { analysisDocumentV3ToMarkdown } from './llm/analysisDocumentV3';
import type { AnalysisDocumentV3 } from './llm/analysisTypes';
import {
  type MeetingNotesRunMetric,
  parseMeetingNotesRunMetric,
  serializeMeetingNotesRunMetric,
} from './llm/meetingNotesRunMetrics';
import { createNotesSource } from './llm/meetingNotesSource';
import { createLogger } from './logger';
import { MEETING_INSERT_SQL } from './meetingInsertSql';
import { buildMeetingNotesIdentityProjection } from './meetingParticipantIdentity';
import { preserveOmittedTranscriptOwnedFields } from './meetingTranscriptOwnedFields';
import { createSecureSettingsManager } from './secureSettings';
import { saveMeetingSpeakerCandidates } from './speakerVoiceStore';

const dbLog = createLogger('DB');

export const db = getApplicationDatabase();

type AttentionItemRow = {
  id: string;
  dedupe_key: string;
  kind: string;
  severity: string;
  score: number;
  status: string;
  title: string;
  reason: string;
  source: string;
  score_breakdown_json: string | null;
  evidence_json: string | null;
  related_entity_ids_json: string | null;
  related_stream_ids_json: string | null;
  related_meeting_ids_json: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

type WorkingMemorySnapshotRow = {
  id: string;
  scope_type: string;
  scope_key: string;
  title: string;
  source_doc_id: string;
  source_doc_last_synthesized_at: string | null;
  freshness: string;
  trust_status: string;
  source_count: number;
  cited_meeting_count: number;
  payload_json: string;
  generated_at: string;
  updated_at: string;
};

type MeetingContextEventRow = {
  id: string;
  meeting_id: string;
  event_key: string;
  kind: string;
  summary: string;
  evidence_json: string;
  attributes_json: string | null;
  supersedes_event_id: string | null;
  observed_at_ms: number;
  created_at: string;
};

type MeetingContextSnapshotRow = {
  id: string;
  meeting_id: string;
  revision: number;
  state_json: string;
  last_segment_id: string | null;
  last_segment_timestamp_ms: number | null;
  generated_at: string;
  created_at: string;
};

type LiveMeetingContextCheckpointRow = {
  meeting_id: string;
  schema_version: number;
  state_json: string;
  last_segment_id: string | null;
  last_segment_timestamp_ms: number | null;
  generated_at: string;
  updated_at: string;
};

export interface PersistedMeeting {
  id: string | number;
  title: string;
  meeting_type?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  audio_path?: string | null;
  transcript_json?: string | null;
  user_notes?: string | null;
  enhanced_notes?: string | null;
  analysis_json?: string | null;
  analysis_schema_version?: number | null;
  analysis_format_pass?: boolean | number | null;
  analysis_retry_count?: number | null;
  analysis_fallback_used?: boolean | number | null;
  analysis_provider?: string | null;
  analysis_model?: string | null;
  analysis_generation_path?: string | null;
  analysis_prompt_version?: string | null;
  analysis_generated_at?: string | null;
  analysis_error_categories_json?: string | null;
  value_signals_json?: string | null;
  follow_up_drafts_json?: string | null;
  folder_id?: string | null;
  is_favorite?: boolean | number | null;
  end_reason?: string | null;
  mid_json?: string | null;
  user_edits_json?: string | null;
  analysis_edit_conflicts_json?: string | null;
  transcript_status?: TranscriptLifecycleStatus | null;
  transcript_integrity_json?: string | null;
  system_audio_path?: string | null;
  mixed_audio_path?: string | null;
  transcript_validated_at?: string | null;
  finalization_status?: MeetingFinalizationStatus | null;
  finalization_error_category?:
    | 'journal_seal_failed'
    | 'capture_journal_write_failed'
    | null;
  downstream_processing_json?: string | null;
  capture_journal_generation?: string | null;
  created_at?: string | null;
}

export interface MeetingSummary {
  id: string | number;
  title: string;
  meeting_type: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  folder_id: string | null;
  is_favorite: number;
  end_reason: string | null;
  created_at: string;
  transcript_status: TranscriptLifecycleStatus | null;
  transcript_validated_at: string | null;
  finalization_status: MeetingFinalizationStatus | null;
  finalization_error_category: string | null;
  downstream_processing_json: string | null;
  capture_journal_generation: string | null;
  has_transcript: boolean;
  has_transcript_text: boolean;
  has_audio: boolean;
  has_analysis: boolean;
  analysis_run_json: string | null;
}

export interface MeetingProcessingStatus {
  id: string | number;
  has_capture_gap: boolean;
  recovered_awaiting_validation: boolean;
  final_transcription_policy: string | null;
  final_transcription_state: string | null;
  final_transcription_engine: string | null;
  speaker_attribution_verified: boolean | null;
  automatic_attempts_exhausted: boolean;
}

export interface MeetingDashboardPreview {
  id: string | number;
  dashboard_detail: string | null;
  recent_win_title: string | null;
  recent_win_why: string | null;
  recent_win_evidence: string | null;
  recent_win_source: string | null;
}

export type MeetingAnalysisRunStatus =
  | 'running'
  | 'published'
  | 'failed'
  | 'cancelled';
export type MeetingAnalysisSecondaryStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'superseded';

export type MeetingAnalysisRun = {
  meeting_id: string;
  run_id: string;
  input_revision: string;
  source_revision: string;
  eligibility_revision: string;
  user_notes_hash: string;
  notes_status: MeetingAnalysisRunStatus;
  secondary_status: MeetingAnalysisSecondaryStatus;
  stage: string;
  queue_position: number | null;
  error_code: string | null;
  automatic_attempt_count: number;
  started_at: string;
  updated_at: string;
};

type ExtractionAuthoredPersonRole = {
  id: string;
  metadata: string;
  role: string;
};

/**
 * Remove only roles with both forms of provenance for the known failure mode:
 * the role equals another person entity and extraction wrote the same Role:
 * context on a meeting link. Other metadata and ambiguous roles are preserved.
 */
export function repairExtractionAuthoredPersonRoles(): number {
  const candidates = db
    .prepare(`
      WITH person_roles AS (
        SELECT
          person.id,
          person.metadata,
          json_extract(
            CASE WHEN json_valid(person.metadata) THEN person.metadata ELSE '{}' END,
            '$.role'
          ) AS role
        FROM entities person
        WHERE person.type = 'person'
      )
      SELECT candidate.id, candidate.metadata, candidate.role
      FROM person_roles candidate
      WHERE typeof(candidate.role) = 'text'
        AND TRIM(candidate.role) != ''
        AND EXISTS (
          SELECT 1
          FROM entities other
          WHERE other.type = 'person'
            AND other.id != candidate.id
            AND other.normalized_name = LOWER(TRIM(candidate.role))
        )
        AND EXISTS (
          SELECT 1
          FROM meeting_entities source
          WHERE source.entity_id = candidate.id
            AND source.context = 'Role: ' || candidate.role
        )
    `)
    .all() as ExtractionAuthoredPersonRole[];

  const updatePerson = db.prepare(`
    UPDATE entities
    SET metadata = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND json_extract(
        CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.role'
      ) = ?
  `);
  const clearExtractionContext = db.prepare(`
    UPDATE meeting_entities
    SET context = NULL
    WHERE entity_id = ? AND context = ?
  `);
  const repair = db.transaction(() => {
    let repairedCount = 0;
    for (const candidate of candidates) {
      const metadata = JSON.parse(candidate.metadata) as Record<
        string,
        unknown
      >;
      const { role: _removedRole, ...preservedMetadata } = metadata;
      const nextMetadata =
        Object.keys(preservedMetadata).length > 0
          ? JSON.stringify(preservedMetadata)
          : null;
      const result = updatePerson.run(
        nextMetadata,
        candidate.id,
        candidate.role,
      );
      if (result.changes !== 1) continue;
      clearExtractionContext.run(candidate.id, `Role: ${candidate.role}`);
      repairedCount++;
    }
    return repairedCount;
  });
  return repair();
}

export const calendarStore = createCalendarStore(db);
export const identityStore = createIdentityStore(db);
export const dreamingProposalStore = createDreamingProposalStore(db, {
  resolveCanonicalEntityId: (entityId, entityType) =>
    entityType === 'person'
      ? resolvePersonIdentityId(entityId)
      : resolveProjectIdentityId(entityId),
  upsertProjectCommitment: (input) =>
    upsertCanonicalDreamingProjectCommitment(input),
});
export const acceptDreamingProposal = (
  input: DreamingDecisionInput,
): DreamingDecisionResult =>
  dreamingProposalStore.acceptDreamingProposal(input);
export const rejectDreamingProposal = (
  input: DreamingDecisionInput,
): DreamingDecisionResult =>
  dreamingProposalStore.rejectDreamingProposal(input);
export const removeDreamingAlias = (input: {
  proposalId: string;
}): DreamingDecisionResult => dreamingProposalStore.removeDreamingAlias(input);
export const restoreDreamingAlias = (input: {
  proposalId: string;
}): DreamingDecisionResult => dreamingProposalStore.restoreDreamingAlias(input);

export const getIdentityInputRevision = () =>
  (
    db
      .prepare(
        'SELECT revision FROM identity_input_revision WHERE singleton = 1',
      )
      .get() as { revision: number }
  ).revision;

/**
 * Settings Management
 */
const plaintextSettingsStore = {
  get(key: string) {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },
  set(key: string, value: string) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    );
    return stmt.run(key, value);
  },
  delete(key: string) {
    return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  },
};

const secureSettings = createSecureSettingsManager({
  plaintext: plaintextSettingsStore,
});

export const getSetting = (key: string) => {
  return secureSettings.get(key);
};

export const setSetting = (key: string, value: string) => {
  return secureSettings.set(key, value);
};

export const deleteCredential = (
  provider: import('./llm/inferenceTypes').CloudProviderId,
) => secureSettings.delete(`${provider}_api_key`);

export const setCredential = (
  provider: import('./llm/inferenceTypes').CloudProviderId,
  value: string,
) => secureSettings.set(`${provider}_api_key`, value);

export const getCredentialStatus = (
  provider: import('./llm/inferenceTypes').CloudProviderId,
) => secureSettings.status(provider);

export const upsertAttentionItem = (
  input: AttentionItemUpsert,
): AttentionItem => {
  const dedupeKey = input.dedupe_key.trim();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM attention_items WHERE dedupe_key = ?')
    .get(dedupeKey) as AttentionItemRow | undefined;
  const existingItem = existing ? mapAttentionItemRow(existing) : null;
  const preservedStatus =
    input.preserve_status !== false &&
    input.status === 'active' &&
    input.source !== 'manual' &&
    existingItem &&
    (existingItem.status === 'resolved' ||
      existingItem.status === 'dismissed' ||
      existingItem.status === 'snoozed' ||
      existingItem.status === 'pinned')
      ? existingItem.status
      : input.status;
  const resolvedAt =
    preservedStatus === 'resolved' ||
    preservedStatus === 'dismissed' ||
    preservedStatus === 'superseded'
      ? (input.resolved_at ?? existing?.resolved_at ?? now)
      : null;

  if (existing) {
    db.prepare(`
      UPDATE attention_items
      SET severity = ?, score = ?, status = ?, title = ?, reason = ?, source = ?,
          score_breakdown_json = ?, evidence_json = ?, related_entity_ids_json = ?,
          related_stream_ids_json = ?, related_meeting_ids_json = ?, updated_at = ?,
          last_seen_at = ?, resolved_at = ?
      WHERE dedupe_key = ?
    `).run(
      input.severity,
      input.score,
      preservedStatus,
      input.title,
      input.reason,
      input.source,
      serializeAttentionScoreBreakdown(input.score_breakdown),
      serializeAttentionEvidence(input.evidence),
      serializeAttentionStringArray(input.related_entity_ids),
      serializeAttentionStringArray(input.related_stream_ids),
      serializeAttentionStringArray(input.related_meeting_ids),
      now,
      now,
      resolvedAt,
      dedupeKey,
    );
  } else {
    db.prepare(`
      INSERT INTO attention_items (
        id, dedupe_key, kind, severity, score, status, title, reason, source,
        score_breakdown_json, evidence_json, related_entity_ids_json,
        related_stream_ids_json, related_meeting_ids_json, created_at, updated_at,
        last_seen_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      dedupeKey,
      input.kind,
      input.severity,
      input.score,
      input.status,
      input.title,
      input.reason,
      input.source,
      serializeAttentionScoreBreakdown(input.score_breakdown),
      serializeAttentionEvidence(input.evidence),
      serializeAttentionStringArray(input.related_entity_ids),
      serializeAttentionStringArray(input.related_stream_ids),
      serializeAttentionStringArray(input.related_meeting_ids),
      now,
      now,
      now,
      resolvedAt,
    );
  }

  const row = db
    .prepare('SELECT * FROM attention_items WHERE dedupe_key = ?')
    .get(dedupeKey) as AttentionItemRow | undefined;

  if (!row) {
    throw new Error(`Failed to upsert attention item ${dedupeKey}`);
  }

  return mapAttentionItemRow(row);
};

export const updateAttentionItemStatus = (
  id: string,
  status: AttentionItemStatus,
): AttentionItem | null => {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const existing = listAttentionItems().find(
    (item) => item.id === normalizedId,
  );
  if (!existing) return null;

  return upsertAttentionItem({
    dedupe_key: existing.dedupe_key,
    kind: existing.kind,
    severity: existing.severity,
    score: existing.score,
    status,
    title: existing.title,
    reason: existing.reason,
    source: existing.source,
    score_breakdown: existing.score_breakdown,
    evidence: existing.evidence,
    related_entity_ids: existing.related_entity_ids,
    related_stream_ids: existing.related_stream_ids,
    related_meeting_ids: existing.related_meeting_ids,
    preserve_status: false,
    resolved_at:
      status === 'resolved' || status === 'dismissed' || status === 'superseded'
        ? (existing.resolved_at ?? new Date().toISOString())
        : null,
  });
};

export const listAttentionItems = (options?: {
  status?: AttentionItemStatus | AttentionItemStatus[];
  limit?: number;
  meetingId?: string;
}): AttentionItem[] => {
  const statusFilter = options?.status
    ? new Set(Array.isArray(options.status) ? options.status : [options.status])
    : null;
  const meetingId = options?.meetingId?.trim();
  const rows = db
    .prepare('SELECT * FROM attention_items')
    .all() as AttentionItemRow[];

  const items = rows
    .map(mapAttentionItemRow)
    .filter((item) => {
      if (statusFilter && !statusFilter.has(item.status)) return false;
      if (meetingId && !item.related_meeting_ids.includes(meetingId)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const statusDelta =
        ATTENTION_STATUS_ORDER[left.status] -
        ATTENTION_STATUS_ORDER[right.status];
      if (statusDelta !== 0) return statusDelta;
      if (left.score !== right.score) return right.score - left.score;
      return (
        new Date(right.updated_at).getTime() -
        new Date(left.updated_at).getTime()
      );
    });

  return typeof options?.limit === 'number'
    ? items.slice(0, options.limit)
    : items;
};

export const clearAttentionItemsForMeeting = (meetingId: string): void => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return;
  const rows = db
    .prepare('SELECT * FROM attention_items')
    .all() as AttentionItemRow[];

  for (const row of rows) {
    const relatedMeetingIds = parseAttentionJsonArray(
      row.related_meeting_ids_json,
    );
    if (!relatedMeetingIds.includes(normalizedMeetingId)) continue;
    db.prepare('DELETE FROM attention_items WHERE id = ?').run(row.id);
  }
};

export const getWorkingMemorySnapshot = (
  scopeType: WorkingMemorySnapshotScopeType,
  scopeKey: string,
): WorkingMemorySnapshot | undefined => {
  const row = db
    .prepare(
      'SELECT * FROM working_memory_snapshots WHERE scope_type = ? AND scope_key = ?',
    )
    .get(scopeType, scopeKey) as WorkingMemorySnapshotRow | undefined;

  return row ? mapWorkingMemorySnapshotRow(row) : undefined;
};

export const listWorkingMemorySnapshots = (): WorkingMemorySnapshot[] => {
  const rows = db
    .prepare('SELECT * FROM working_memory_snapshots')
    .all() as WorkingMemorySnapshotRow[];

  return rows
    .map(mapWorkingMemorySnapshotRow)
    .sort(
      (left, right) =>
        new Date(right.generated_at).getTime() -
        new Date(left.generated_at).getTime(),
    );
};

export const upsertWorkingMemorySnapshot = (input: {
  scope_type: WorkingMemorySnapshotScopeType;
  scope_key: string;
  title: string;
  source_doc_id: string;
  source_doc_last_synthesized_at: string | null;
  freshness: WorkingMemorySnapshot['freshness'];
  trust_status: TrustStatus;
  source_count: number;
  cited_meeting_count: number;
  payload: WorkingMemorySnapshotPayload;
  generated_at?: string;
}): WorkingMemorySnapshot => {
  const existing = getWorkingMemorySnapshot(input.scope_type, input.scope_key);
  const payloadJson = JSON.stringify(input.payload);
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const updatedAt = generatedAt;

  if (
    existing &&
    existing.title === input.title &&
    existing.source_doc_id === input.source_doc_id &&
    existing.source_doc_last_synthesized_at ===
      input.source_doc_last_synthesized_at &&
    existing.freshness === input.freshness &&
    existing.trust_status === input.trust_status &&
    existing.source_count === input.source_count &&
    existing.cited_meeting_count === input.cited_meeting_count &&
    JSON.stringify(existing.payload) === payloadJson
  ) {
    return existing;
  }

  if (existing) {
    db.prepare(`
      UPDATE working_memory_snapshots
      SET title = ?, source_doc_id = ?, source_doc_last_synthesized_at = ?,
          freshness = ?, trust_status = ?, source_count = ?, cited_meeting_count = ?,
          payload_json = ?, generated_at = ?, updated_at = ?
      WHERE scope_type = ? AND scope_key = ?
    `).run(
      input.title,
      input.source_doc_id,
      input.source_doc_last_synthesized_at,
      input.freshness,
      input.trust_status,
      input.source_count,
      input.cited_meeting_count,
      payloadJson,
      generatedAt,
      updatedAt,
      input.scope_type,
      input.scope_key,
    );
  } else {
    db.prepare(`
      INSERT INTO working_memory_snapshots (
        id, scope_type, scope_key, title, source_doc_id,
        source_doc_last_synthesized_at, freshness, trust_status,
        source_count, cited_meeting_count, payload_json, generated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.scope_type,
      input.scope_key,
      input.title,
      input.source_doc_id,
      input.source_doc_last_synthesized_at,
      input.freshness,
      input.trust_status,
      input.source_count,
      input.cited_meeting_count,
      payloadJson,
      generatedAt,
      updatedAt,
    );
  }

  const saved = getWorkingMemorySnapshot(input.scope_type, input.scope_key);
  if (!saved) {
    throw new Error(
      `Failed to upsert working-memory snapshot ${input.scope_type}:${input.scope_key}`,
    );
  }

  return saved;
};

const requireMeetingContextText = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Meeting context ${label} is required`);
  return normalized;
};

const normalizeMeetingContextEvidence = (
  evidence: MeetingContextEvidenceReference[],
): MeetingContextEvidenceReference[] => {
  const normalized = evidence
    .map((reference) => ({
      segmentId: reference.segmentId.trim(),
      timestampMs: reference.timestampMs,
      ...(reference.quote?.trim() ? { quote: reference.quote.trim() } : {}),
    }))
    .filter(
      (reference) =>
        reference.segmentId.length > 0 &&
        Number.isFinite(reference.timestampMs) &&
        reference.timestampMs >= 0,
    );
  if (normalized.length === 0) {
    throw new Error('Meeting context event evidence is required');
  }
  return normalized;
};

export const getMeetingContextEventByKey = (
  meetingId: string,
  eventKey: string,
): MeetingContextEvent | undefined => {
  const normalizedMeetingId = meetingId.trim();
  const normalizedEventKey = eventKey.trim();
  if (!normalizedMeetingId || !normalizedEventKey) return undefined;
  const row = db
    .prepare(
      `SELECT * FROM meeting_context_events
       WHERE meeting_id = ? AND event_key = ?`,
    )
    .get(normalizedMeetingId, normalizedEventKey) as
    | MeetingContextEventRow
    | undefined;
  return row ? mapMeetingContextEventRow(row) : undefined;
};

export const appendMeetingContextEvent = (
  input: MeetingContextEventInput,
): MeetingContextEvent => {
  const meetingId = requireMeetingContextText(input.meetingId, 'meeting ID');
  const eventKey = requireMeetingContextText(input.eventKey, 'event key');
  const summary = requireMeetingContextText(input.summary, 'event summary');
  if (!Number.isFinite(input.observedAtMs) || input.observedAtMs < 0) {
    throw new Error('Meeting context observed timestamp must be non-negative');
  }
  const evidence = normalizeMeetingContextEvidence(input.evidence);
  const attributes = input.attributes ?? {};
  const supersedesEventId = input.supersedesEventId?.trim() || null;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO meeting_context_events (
      id, meeting_id, event_key, kind, summary, evidence_json, attributes_json,
      supersedes_event_id, observed_at_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    meetingId,
    eventKey,
    input.kind,
    summary,
    JSON.stringify(evidence),
    JSON.stringify(attributes),
    supersedesEventId,
    input.observedAtMs,
    createdAt,
  );

  const saved = getMeetingContextEventByKey(meetingId, eventKey);
  if (!saved) {
    throw new Error(`Failed to append meeting context event ${eventKey}`);
  }
  return saved;
};

export const listMeetingContextEvents = (
  meetingId: string,
): MeetingContextEvent[] => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return [];
  const rows = db
    .prepare(
      `SELECT * FROM meeting_context_events
       WHERE meeting_id = ?
       ORDER BY observed_at_ms ASC, created_at ASC`,
    )
    .all(normalizedMeetingId) as MeetingContextEventRow[];
  return rows.map(mapMeetingContextEventRow);
};

export const listMeetingContextEventsSince = (
  meetingId: string,
  observedAtMs: number,
): MeetingContextEvent[] => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId || !Number.isFinite(observedAtMs)) return [];
  const rows = db
    .prepare(
      `SELECT * FROM meeting_context_events
       WHERE meeting_id = ? AND observed_at_ms >= ?
       ORDER BY observed_at_ms ASC, created_at ASC`,
    )
    .all(
      normalizedMeetingId,
      Math.max(0, observedAtMs),
    ) as MeetingContextEventRow[];
  return rows.map(mapMeetingContextEventRow);
};

export const getLatestMeetingContextSnapshot = (
  meetingId: string,
): MeetingContextSnapshot | undefined => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return undefined;
  const row = db
    .prepare(
      `SELECT * FROM meeting_context_snapshots
       WHERE meeting_id = ?
       ORDER BY revision DESC
       LIMIT 1`,
    )
    .get(normalizedMeetingId) as MeetingContextSnapshotRow | undefined;
  return row ? mapMeetingContextSnapshotRow(row) : undefined;
};

export const listMeetingContextSnapshots = (
  meetingId: string,
  limit = 20,
): MeetingContextSnapshot[] => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return [];
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = db
    .prepare(
      `SELECT * FROM meeting_context_snapshots
       WHERE meeting_id = ?
       ORDER BY revision DESC
       LIMIT ?`,
    )
    .all(normalizedMeetingId, boundedLimit) as MeetingContextSnapshotRow[];
  return rows.map(mapMeetingContextSnapshotRow);
};

export const saveMeetingContextSnapshot = (
  state: MeetingContextRollingStateV1,
  options?: { generatedAt?: string },
): MeetingContextSnapshot => {
  const save = db.transaction(() => {
    if (state.schemaVersion !== 1) {
      throw new Error('Unsupported meeting context snapshot schema');
    }
    const meetingId = requireMeetingContextText(state.meetingId, 'meeting ID');
    const normalizedState: MeetingContextRollingStateV1 = {
      ...state,
      meetingId,
    };
    const stateJson = JSON.stringify(normalizedState);
    const latest = getLatestMeetingContextSnapshot(meetingId);
    if (latest && JSON.stringify(latest.state) === stateJson) return latest;

    const revision = (latest?.revision ?? 0) + 1;
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const createdAt = generatedAt;
    db.prepare(`
      INSERT INTO meeting_context_snapshots (
        id, meeting_id, revision, state_json, last_segment_id,
        last_segment_timestamp_ms, generated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      meetingId,
      revision,
      stateJson,
      normalizedState.updatedThrough.segmentId,
      normalizedState.updatedThrough.timestampMs,
      generatedAt,
      createdAt,
    );

    const saved = getLatestMeetingContextSnapshot(meetingId);
    if (!saved || saved.revision !== revision) {
      throw new Error(
        `Failed to save meeting context snapshot ${meetingId}:${revision}`,
      );
    }
    return saved;
  });

  return save();
};

export const getLiveMeetingContextCheckpoint = (
  meetingId: string,
): LiveMeetingContextCheckpointV1 | undefined => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return undefined;
  const row = db
    .prepare(
      'SELECT * FROM live_meeting_context_checkpoints WHERE meeting_id = ?',
    )
    .get(normalizedMeetingId) as LiveMeetingContextCheckpointRow | undefined;
  if (!row) return undefined;
  const checkpoint = parseMeetingContextJson<LiveMeetingContextCheckpointV1>(
    row.state_json,
    'live checkpoint',
  );
  if (
    row.schema_version !== 1 ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.meetingId !== normalizedMeetingId ||
    !Array.isArray(checkpoint.segments)
  ) {
    throw new Error('Invalid live meeting context checkpoint');
  }
  return checkpoint;
};

export const saveLiveMeetingContextCheckpoint = (
  checkpoint: LiveMeetingContextCheckpointV1,
): void => {
  const meetingId = requireMeetingContextText(
    checkpoint.meetingId,
    'meeting ID',
  );
  if (checkpoint.schemaVersion !== 1 || !Array.isArray(checkpoint.segments)) {
    throw new Error('Unsupported live meeting context checkpoint');
  }
  const stateJson = JSON.stringify({ ...checkpoint, meetingId });
  if (Buffer.byteLength(stateJson, 'utf8') > 300_000) {
    throw new Error('Live meeting context checkpoint is too large');
  }
  db.prepare(
    `INSERT INTO live_meeting_context_checkpoints (
       meeting_id, schema_version, state_json, last_segment_id,
       last_segment_timestamp_ms, generated_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET
       schema_version = excluded.schema_version,
       state_json = excluded.state_json,
       last_segment_id = excluded.last_segment_id,
       last_segment_timestamp_ms = excluded.last_segment_timestamp_ms,
       generated_at = excluded.generated_at,
       updated_at = excluded.updated_at`,
  ).run(
    meetingId,
    checkpoint.schemaVersion,
    stateJson,
    checkpoint.updatedThrough.segmentId,
    checkpoint.updatedThrough.timestampMs,
    checkpoint.generatedAt,
    new Date().toISOString(),
  );
};

export const deleteLiveMeetingContextCheckpoint = (meetingId: string): void => {
  const normalizedMeetingId = meetingId.trim();
  if (!normalizedMeetingId) return;
  db.prepare(
    'DELETE FROM live_meeting_context_checkpoints WHERE meeting_id = ?',
  ).run(normalizedMeetingId);
};

/**
 * Meeting Management
 */
function refreshMeetingFts(meeting: PersistedMeeting) {
  refreshMeetingSearchFts(
    db,
    meeting,
    getMeetingNotesIdentityProjection(meeting.id).speakerDisplayNames,
  );
}

export const refreshMeetingIdentityProjection = (
  meetingId: string | number,
): boolean => {
  const meeting = db
    .prepare('SELECT * FROM meetings WHERE id = ?')
    .get(String(meetingId)) as PersistedMeeting | undefined;
  if (!meeting) return false;
  refreshMeetingFts(meeting);
  return true;
};

export const listMeetingIdsForPersonIdentity = (
  personIds: string[],
): string[] => {
  const targets = new Set(
    personIds
      .filter(Boolean)
      .map((personId) => resolvePersonIdentityId(personId)),
  );
  if (targets.size === 0) return [];
  const meetingIds = new Set<string>();
  const bindings = db
    .prepare('SELECT meeting_id, payload FROM identity_bindings')
    .all() as Array<{ meeting_id: string; payload: string }>;
  for (const row of bindings) {
    try {
      const personId = (JSON.parse(row.payload) as { personId?: unknown })
        .personId;
      if (
        typeof personId === 'string' &&
        targets.has(resolvePersonIdentityId(personId))
      ) {
        meetingIds.add(row.meeting_id);
      }
    } catch {
      // Invalid legacy identity rows remain unresolved.
    }
  }
  const captures = db
    .prepare(
      `SELECT meeting_id, self_person_id
       FROM identity_captures
       WHERE origin = 'local'`,
    )
    .all() as Array<{ meeting_id: string; self_person_id: string | null }>;
  const currentSelfPersonId = identityStore.getSelfPersonId();
  const currentSelfMatches = Boolean(
    currentSelfPersonId &&
      targets.has(resolvePersonIdentityId(currentSelfPersonId)),
  );
  for (const capture of captures) {
    if (
      (capture.self_person_id &&
        targets.has(resolvePersonIdentityId(capture.self_person_id))) ||
      (!capture.self_person_id && currentSelfMatches)
    ) {
      meetingIds.add(capture.meeting_id);
    }
  }
  return [...meetingIds];
};

export const listMeetingIdsWithSavedNotes = (): string[] =>
  (
    db
      .prepare(
        `SELECT id FROM meetings
         WHERE analysis_json IS NOT NULL OR enhanced_notes IS NOT NULL
         ORDER BY COALESCE(started_at, created_at) DESC`,
      )
      .all() as Array<{ id: string }>
  ).map(({ id }) => String(id));

export function getMeetingFtsIntegrity(): SearchIndexIntegrity {
  return readMeetingFtsIntegrity(db);
}

export function getMeetingNotesFtsIntegrity(): SearchIndexIntegrity {
  return readMeetingNotesFtsIntegrity(db);
}

export function getMeetingContextSectionIntegrity(): MeetingContextSectionIntegrity {
  return readMeetingContextSectionIntegrity(db);
}

export function repairMeetingFtsIndex(options: { force?: boolean } = {}): {
  rebuilt: boolean;
  indexedMeetingCount: number;
} {
  return repairMeetingSearchFtsIndex(db, options);
}

export function repairMeetingNotesFtsIndex(options: { force?: boolean } = {}): {
  rebuilt: boolean;
  indexedMeetingCount: number;
} {
  return repairMeetingNotesSearchFtsIndex(db, options);
}

export function repairMeetingContextSectionIndex(
  options: { force?: boolean } = {},
): { rebuilt: boolean; indexedMeetingCount: number; sectionCount: number } {
  return repairMeetingContextSectionSearchIndex(db, options);
}

const saveMeetingRecord = (incomingMeeting: PersistedMeeting) => {
  // Ensure ID is a string
  const id = String(incomingMeeting.id);
  const current = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | PersistedMeeting
    | undefined;
  const meeting = preserveOmittedTranscriptOwnedFields(
    current,
    incomingMeeting,
  );

  let payloadLifecycleStatus: TranscriptLifecycleStatus | null = null;
  try {
    const payload = JSON.parse(meeting.transcript_json || '{}') as {
      lifecycleStatus?: unknown;
    };
    payloadLifecycleStatus =
      typeof payload.lifecycleStatus === 'string'
        ? (payload.lifecycleStatus as TranscriptLifecycleStatus)
        : null;
  } catch {
    payloadLifecycleStatus = null;
  }
  const trustRecord = parseIntegrityRecord(meeting.transcript_integrity_json);
  if (trustRecord.schemaVersion === 2) {
    const parsedTrust = parseTranscriptTrustEnvelope(
      meeting.transcript_integrity_json,
      {
        transcriptStatus: meeting.transcript_status,
        transcriptValidatedAt: meeting.transcript_validated_at,
        payloadLifecycleStatus,
      },
    );
    if (!parsedTrust.ok) {
      throw new Error(`invalid_transcript_trust_state:${parsedTrust.failure}`);
    }
  }

  const stmt = db.prepare(MEETING_INSERT_SQL);

  let metadataRecord: Record<string, unknown> = {};
  try {
    if (meeting.analysis_json) {
      const parsed = JSON.parse(meeting.analysis_json) as Record<
        string,
        unknown
      >;
      metadataRecord =
        parsed.generation_metadata &&
        typeof parsed.generation_metadata === 'object'
          ? (parsed.generation_metadata as Record<string, unknown>)
          : {};
    }
  } catch {
    metadataRecord = {};
  }

  const result = stmt.run(
    id,
    meeting.title,
    meeting.meeting_type || 'General',
    meeting.started_at,
    meeting.ended_at,
    meeting.duration_seconds || 0,
    meeting.audio_path,
    meeting.transcript_json,
    meeting.user_notes || '',
    meeting.enhanced_notes || '',
    meeting.analysis_json || null,
    meeting.analysis_schema_version || null,
    typeof meeting.analysis_format_pass === 'boolean'
      ? meeting.analysis_format_pass
        ? 1
        : 0
      : null,
    Number.isFinite(meeting.analysis_retry_count)
      ? meeting.analysis_retry_count
      : 0,
    typeof meeting.analysis_fallback_used === 'boolean'
      ? meeting.analysis_fallback_used
        ? 1
        : 0
      : 0,
    meeting.analysis_provider ||
      (typeof metadataRecord.provider === 'string'
        ? metadataRecord.provider
        : null),
    meeting.analysis_model ||
      (typeof metadataRecord.model === 'string' ? metadataRecord.model : null),
    meeting.analysis_generation_path ||
      (typeof metadataRecord.generation_path === 'string'
        ? metadataRecord.generation_path
        : null),
    meeting.analysis_prompt_version ||
      (typeof metadataRecord.prompt_version === 'string'
        ? metadataRecord.prompt_version
        : null),
    meeting.analysis_generated_at ||
      (typeof metadataRecord.generated_at === 'string'
        ? metadataRecord.generated_at
        : null),
    meeting.analysis_error_categories_json ||
      (Array.isArray(metadataRecord.error_categories)
        ? JSON.stringify(metadataRecord.error_categories)
        : null),
    meeting.value_signals_json || null,
    meeting.follow_up_drafts_json || null,
    meeting.folder_id,
    meeting.is_favorite ? 1 : 0,
    meeting.end_reason || 'manual',
    meeting.user_edits_json || null,
    meeting.analysis_edit_conflicts_json || null,
    Object.prototype.hasOwnProperty.call(meeting, 'transcript_status')
      ? meeting.transcript_status
      : 'provisional',
    meeting.transcript_integrity_json || null,
    meeting.system_audio_path || null,
    meeting.mixed_audio_path || null,
    meeting.transcript_validated_at || null,
    meeting.finalization_status || 'finalized',
    meeting.finalization_error_category || null,
    meeting.downstream_processing_json || null,
    meeting.capture_journal_generation || null,
    meeting.mid_json || null,
    meeting.created_at,
  );

  refreshMeetingFts(meeting);

  dbLog.info(`Save successful for meeting: ${id}`);
  return result;
};

const saveMeetingTransaction = db.transaction(saveMeetingRecord);

export const saveMeeting = (meeting: PersistedMeeting) =>
  saveMeetingTransaction(meeting);

const readMeetingFinalTranscriptionLease = (
  integrityJson: string | null | undefined,
): FinalTranscriptionLease | null => {
  const integrity = parseIntegrityRecord(integrityJson);
  return readFinalTranscriptionLease(integrity.finalTranscription);
};

const finalTranscriptionDigest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const finalTranscriptionSourcePathsDigest = (
  meeting: Pick<
    PersistedMeeting,
    'audio_path' | 'system_audio_path' | 'mixed_audio_path'
  >,
): string =>
  finalTranscriptionDigest(
    JSON.stringify([
      meeting.audio_path ?? null,
      meeting.system_audio_path ?? null,
      meeting.mixed_audio_path ?? null,
    ]),
  );

export const claimMeetingFinalTranscription = (
  meetingId: string | number,
  lease: FinalTranscriptionLease,
  options: { manualRetry?: boolean } = {},
): boolean =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (
      !current ||
      current.capture_journal_generation !== lease.captureGeneration ||
      (!['provisional', 'needs_attention'].includes(
        String(current.transcript_status),
      ) &&
        !(
          current.transcript_status === 'validated' &&
          (options.manualRetry === true ||
            readStoredSpeakerAttribution(current.transcript_json)?.source ===
              'recovered_channel_acoustic_v1' ||
            !hasVerifiedSpeakerAttribution(current.transcript_json))
        ))
    ) {
      return false;
    }
    const active = readMeetingFinalTranscriptionLease(
      current.transcript_integrity_json,
    );
    if (active && Date.parse(active.deadlineAt) > Date.parse(lease.startedAt)) {
      return false;
    }
    const priorIntegrity = current.transcript_integrity_json ?? null;
    const integrity = parseIntegrityRecord(priorIntegrity);
    const claimedTranscriptJson = withTranscriptLifecycleStatus(
      current.transcript_json,
      'validating',
    );
    const claimedLease: FinalTranscriptionLease = {
      ...lease,
      expectedTranscriptSHA256: finalTranscriptionDigest(claimedTranscriptJson),
      expectedSourcePathsSHA256: finalTranscriptionSourcePathsDigest(current),
    };
    const nextIntegrity = JSON.stringify({
      ...integrity,
      state: 'validating',
      causes: [],
      validationProof: undefined,
      retry: undefined,
      finalTranscription: claimedLease,
    });
    return (
      db
        .prepare(
          `UPDATE meetings
           SET transcript_status = 'validating',
               transcript_json = ?,
               transcript_integrity_json = ?
           WHERE id = ?
             AND capture_journal_generation = ?
             AND transcript_integrity_json IS ?`,
        )
        .run(
          claimedTranscriptJson,
          nextIntegrity,
          String(meetingId),
          lease.captureGeneration,
          priorIntegrity,
        ).changes === 1
    );
  })();

export const updateMeetingFinalTranscriptionStage = (
  meetingId: string | number,
  runId: string,
  stage: FinalTranscriptionLease['stage'],
): boolean =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const lease = readFinalTranscriptionLease(integrity.finalTranscription);
    if (!lease || lease.runId !== runId) return false;
    return (
      db
        .prepare(
          `UPDATE meetings SET transcript_integrity_json = ?
           WHERE id = ? AND transcript_integrity_json IS ?`,
        )
        .run(
          JSON.stringify({
            ...integrity,
            finalTranscription: { ...lease, stage },
          }),
          String(meetingId),
          current.transcript_integrity_json,
        ).changes === 1
    );
  })();

export const commitMeetingFinalTranscription = (input: {
  meetingId: string | number;
  runId: string;
  captureGeneration: string;
  canonicalTranscriptJson: string;
  transcriptIntegrityJson: string;
  transcriptValidatedAt: string;
  speakerCandidates?: SpeakerCandidateEvidence[];
}): false | { committed: true; transcriptJson: string } =>
  db.transaction(() => {
    const current = getMeeting(input.meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const currentIntegrity = parseIntegrityRecord(
      current.transcript_integrity_json,
    );
    const lease = readFinalTranscriptionLease(
      currentIntegrity.finalTranscription,
    );
    if (
      !lease ||
      lease.runId !== input.runId ||
      lease.captureGeneration !== input.captureGeneration ||
      current.capture_journal_generation !== input.captureGeneration ||
      current.transcript_status !== 'validating' ||
      (lease.expectedTranscriptSHA256 !== undefined &&
        finalTranscriptionDigest(current.transcript_json || '') !==
          lease.expectedTranscriptSHA256) ||
      (lease.expectedSourcePathsSHA256 !== undefined &&
        finalTranscriptionSourcePathsDigest(current) !==
          lease.expectedSourcePathsSHA256)
    ) {
      return false;
    }
    let suppliedIntegrity: Record<string, unknown>;
    try {
      const parsed = JSON.parse(input.transcriptIntegrityJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
      }
      suppliedIntegrity = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
    const nextIntegrity = JSON.stringify({
      ...suppliedIntegrity,
      finalTranscription: finishFinalTranscriptionLease(lease),
    });
    assertValidTranscriptTrustCandidate(
      {
        transcript_status: 'validated',
        transcript_validated_at: input.transcriptValidatedAt,
        transcript_integrity_json: nextIntegrity,
        transcript_json: input.canonicalTranscriptJson,
      },
      'commit_final_transcription',
      { requireV2: true },
    );
    const changed = db
      .prepare(
        `UPDATE meetings
         SET transcript_json = ?,
             transcript_integrity_json = ?,
             transcript_validated_at = ?,
             transcript_status = 'validated',
             finalization_status = 'finalized',
             finalization_error_category = NULL,
             enhanced_notes = NULL,
             analysis_json = NULL,
             value_signals_json = NULL,
             downstream_processing_json = NULL
         WHERE id = ?
           AND capture_journal_generation = ?
           AND transcript_status = 'validating'
           AND transcript_integrity_json IS ?`,
      )
      .run(
        input.canonicalTranscriptJson,
        nextIntegrity,
        input.transcriptValidatedAt,
        String(input.meetingId),
        input.captureGeneration,
        current.transcript_integrity_json,
      ).changes;
    if (changed !== 1) return false;
    if (input.speakerCandidates !== undefined) {
      saveMeetingSpeakerCandidates(
        String(input.meetingId),
        input.captureGeneration,
        input.speakerCandidates,
        db,
      );
    }
    const updated = getMeeting(input.meetingId) as PersistedMeeting | undefined;
    if (updated) refreshMeetingFts(updated);
    return {
      committed: true as const,
      transcriptJson: input.canonicalTranscriptJson,
    };
  })();

export const failMeetingFinalTranscription = (
  meetingId: string | number,
  runId: string,
  failure: Parameters<typeof finishFinalTranscriptionLease>[1],
  reasons: string[] = [],
  attributionDiagnostics?: SpeakerAttributionDiagnostics,
): boolean =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const lease = readFinalTranscriptionLease(integrity.finalTranscription);
    if (!lease || lease.runId !== runId || !failure) return false;
    const boundedReasons = [
      ...new Set(
        reasons
          .filter((reason) => typeof reason === 'string' && reason.length > 0)
          .map((reason) => reason.slice(0, 128)),
      ),
    ].slice(0, 16);
    const boundedAttributionDiagnostics = (() => {
      if (
        failure !== 'speaker_attribution_rejected' ||
        !attributionDiagnostics ||
        attributionDiagnostics.schemaVersion !== 1 ||
        attributionDiagnostics.pipelineVersion !==
          'recovered_channel_acoustic_v2'
      ) {
        return undefined;
      }
      const values = [
        attributionDiagnostics.confidence,
        attributionDiagnostics.minimumConfidence,
        attributionDiagnostics.attributedSeconds,
        attributionDiagnostics.unattributedSeconds,
        attributionDiagnostics.totalSeconds,
      ];
      if (values.some((value) => !Number.isFinite(value) || value < 0)) {
        return undefined;
      }
      if (
        attributionDiagnostics.confidence > 1 ||
        attributionDiagnostics.minimumConfidence > 1 ||
        attributionDiagnostics.attributedSeconds >
          attributionDiagnostics.totalSeconds ||
        attributionDiagnostics.unattributedSeconds >
          attributionDiagnostics.totalSeconds
      ) {
        return undefined;
      }
      return {
        ...attributionDiagnostics,
        attemptedAt: lease.startedAt,
        completedAt: new Date().toISOString(),
      };
    })();
    return (
      db
        .prepare(
          `UPDATE meetings
           SET transcript_status = 'needs_attention',
               finalization_status = 'needs_attention',
               transcript_json = ?,
               transcript_integrity_json = ?
           WHERE id = ? AND transcript_integrity_json IS ?`,
        )
        .run(
          withTranscriptLifecycleStatus(
            current.transcript_json,
            'needs_attention',
          ),
          JSON.stringify({
            ...integrity,
            state: 'needs_attention',
            causes: [
              {
                code:
                  failure === 'required_source_failed'
                    ? 'required_source_failed'
                    : 'processing_stage_failed',
                stage: 'source_transcription',
              },
            ],
            validationProof: undefined,
            retry: undefined,
            reasons: boundedReasons,
            finalTranscription: {
              ...finishFinalTranscriptionLease(lease, failure),
              ...(boundedAttributionDiagnostics
                ? { diagnostics: boundedAttributionDiagnostics }
                : {}),
            },
          }),
          String(meetingId),
          current.transcript_integrity_json,
        ).changes === 1
    );
  })();

export const expireInterruptedFinalTranscription = (): number =>
  db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id, transcript_integrity_json
         FROM meetings
         WHERE transcript_status = 'validating'`,
      )
      .all() as Array<{
      id: string;
      transcript_integrity_json: string | null;
    }>;
    let expired = 0;
    for (const row of rows) {
      const integrity = parseIntegrityRecord(row.transcript_integrity_json);
      const lease = readFinalTranscriptionLease(integrity.finalTranscription);
      if (!lease) continue;
      expired += db
        .prepare(
          `UPDATE meetings
           SET transcript_status = 'needs_attention',
               finalization_status = 'needs_attention',
               transcript_json = ?,
               transcript_integrity_json = ?
           WHERE id = ? AND transcript_integrity_json IS ?`,
        )
        .run(
          withTranscriptLifecycleStatus(
            (getMeeting(row.id) as PersistedMeeting | undefined)
              ?.transcript_json,
            'needs_attention',
          ),
          JSON.stringify({
            ...integrity,
            state: 'needs_attention',
            causes: [
              {
                code: 'processing_stage_failed',
                stage: 'source_transcription',
              },
            ],
            validationProof: undefined,
            retry: undefined,
            finalTranscription: finishFinalTranscriptionLease(
              lease,
              'runtime_unavailable',
            ),
          }),
          row.id,
          row.transcript_integrity_json,
        ).changes;
    }
    return expired;
  })();

export type ConditionalMeetingUpdateOutcome =
  | 'updated'
  | 'already_current'
  | 'conflict'
  | 'missing';

export type FinalizeCheckpointTranscriptOutcome =
  | 'committed_and_claimed'
  | 'already_committed'
  | 'superseded';

export type FinalizeCheckpointTranscriptInput = {
  meetingId: string | number;
  journalGeneration: string;
  expectedTranscriptStatus: TranscriptLifecycleStatus;
  expectedValidationRunId: string | null;
  canonicalTranscriptJson: string;
  transcriptIntegrityJson: string;
  transcriptValidatedAt: string;
  downstreamRunId: string;
};

export const finalizeCheckpointTranscript = (
  input: FinalizeCheckpointTranscriptInput,
): FinalizeCheckpointTranscriptOutcome =>
  db.transaction(() => {
    const current = getMeeting(input.meetingId) as PersistedMeeting | undefined;
    if (!current) return 'superseded';

    const downstreamProcessingJson = JSON.stringify(
      buildDownstreamProcessingLease({
        runId: input.downstreamRunId,
        transcriptValidatedAt: input.transcriptValidatedAt,
        stage: 'analysis',
      }),
    );
    const currentDownstreamLease = readDownstreamProcessingLease(
      current.downstream_processing_json,
    );
    const alreadyCommitted =
      current.capture_journal_generation === input.journalGeneration &&
      current.transcript_status === 'validated' &&
      current.transcript_json === input.canonicalTranscriptJson &&
      current.transcript_integrity_json === input.transcriptIntegrityJson &&
      current.transcript_validated_at === input.transcriptValidatedAt &&
      currentDownstreamLease?.schemaVersion === 1 &&
      currentDownstreamLease?.runId === input.downstreamRunId &&
      currentDownstreamLease.transcriptValidatedAt ===
        input.transcriptValidatedAt;
    if (alreadyCommitted) {
      assertValidTranscriptTrustCandidate(
        {
          transcript_status: 'validated',
          transcript_validated_at: input.transcriptValidatedAt,
          transcript_integrity_json: input.transcriptIntegrityJson,
          transcript_json: input.canonicalTranscriptJson,
        },
        'finalize_checkpoint_transcript',
        { requireV2: true },
      );
      return 'already_committed';
    }

    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const currentValidationRunId = readRetryLease(integrity)?.runId ?? null;
    if (
      current.capture_journal_generation !== input.journalGeneration ||
      current.transcript_status !== input.expectedTranscriptStatus ||
      currentValidationRunId !== input.expectedValidationRunId ||
      current.transcript_validated_at !== null
    ) {
      return 'superseded';
    }

    assertValidTranscriptTrustCandidate(
      {
        transcript_status: 'validated',
        transcript_validated_at: input.transcriptValidatedAt,
        transcript_integrity_json: input.transcriptIntegrityJson,
        transcript_json: input.canonicalTranscriptJson,
      },
      'finalize_checkpoint_transcript',
      { requireV2: true },
    );

    const updated = db
      .prepare(
        `UPDATE meetings
         SET transcript_json = ?,
             transcript_integrity_json = ?,
             transcript_validated_at = ?,
             transcript_status = 'validated',
             finalization_status = 'finalized',
             finalization_error_category = NULL,
             downstream_processing_json = ?
         WHERE id = ?
           AND capture_journal_generation = ?
           AND transcript_status = ?
           AND transcript_validated_at IS NULL
           AND transcript_integrity_json IS ?`,
      )
      .run(
        input.canonicalTranscriptJson,
        input.transcriptIntegrityJson,
        input.transcriptValidatedAt,
        downstreamProcessingJson,
        String(input.meetingId),
        input.journalGeneration,
        input.expectedTranscriptStatus,
        current.transcript_integrity_json,
      ).changes;
    return updated === 1 ? 'committed_and_claimed' : 'superseded';
  })();

export const patchStopToValidatedLatency = (input: {
  meetingId: string | number;
  expectedTranscriptJson: string;
  expectedTranscriptIntegrityJson: string;
  expectedTranscriptValidatedAt: string;
  replacementTranscriptJson: string;
}): ConditionalMeetingUpdateOutcome =>
  db.transaction(() => {
    const current = getMeeting(input.meetingId) as PersistedMeeting | undefined;
    if (!current) return 'missing';
    const generationMatches =
      current.transcript_json === input.expectedTranscriptJson &&
      current.transcript_integrity_json ===
        input.expectedTranscriptIntegrityJson &&
      current.transcript_validated_at === input.expectedTranscriptValidatedAt &&
      current.transcript_status === 'validated';
    if (!generationMatches) {
      const alreadyCurrent =
        current.transcript_json === input.replacementTranscriptJson &&
        current.transcript_integrity_json ===
          input.expectedTranscriptIntegrityJson &&
        current.transcript_validated_at ===
          input.expectedTranscriptValidatedAt &&
        current.transcript_status === 'validated';
      return alreadyCurrent ? 'already_current' : 'conflict';
    }
    if (input.expectedTranscriptJson === input.replacementTranscriptJson) {
      return 'already_current';
    }
    const result = db
      .prepare(
        `UPDATE meetings SET transcript_json = ?
         WHERE id = ? AND transcript_json = ?
           AND transcript_integrity_json = ?
           AND transcript_validated_at = ?
           AND transcript_status = 'validated'`,
      )
      .run(
        input.replacementTranscriptJson,
        String(input.meetingId),
        input.expectedTranscriptJson,
        input.expectedTranscriptIntegrityJson,
        input.expectedTranscriptValidatedAt,
      );
    return result.changes === 1 ? 'updated' : 'conflict';
  })();

export const updateMeetingTitleIfCurrent = (input: {
  meetingId: string | number;
  expectedTitle: string;
  title: string;
}): ConditionalMeetingUpdateOutcome =>
  db.transaction(() => {
    const result = db
      .prepare('UPDATE meetings SET title = ? WHERE id = ? AND title = ?')
      .run(input.title, String(input.meetingId), input.expectedTitle);
    if (result.changes === 1) {
      const updated = getMeeting(input.meetingId) as
        | PersistedMeeting
        | undefined;
      if (!updated) return 'missing';
      refreshMeetingFts(updated);
      return 'updated';
    }
    const current = getMeeting(input.meetingId) as PersistedMeeting | undefined;
    if (!current) return 'missing';
    return current.title === input.title ? 'already_current' : 'conflict';
  })();

export const saveDerivedMeetingFieldsIfTranscriptCurrent = (input: {
  meetingId: string | number;
  expectedTranscriptJson: string;
  expectedTranscriptIntegrityJson: string;
  expectedTranscriptValidatedAt: string;
  expectedTitle: string;
  title: string;
  enhancedNotes: string;
  analysisJson: string;
  analysisSchemaVersion: number;
  analysisFormatPass: boolean;
  analysisRetryCount: number;
  analysisFallbackUsed: boolean;
  analysisProvider?: string | null;
  analysisModel?: string | null;
  analysisGenerationPath?: string | null;
  analysisPromptVersion?: string | null;
  analysisGeneratedAt?: string | null;
  analysisErrorCategoriesJson?: string | null;
  valueSignalsJson: string;
  downstreamProcessingJson?: string | null;
}): Exclude<ConditionalMeetingUpdateOutcome, 'already_current'> =>
  db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE meetings SET
           title = CASE WHEN title = ? THEN ? ELSE title END,
           enhanced_notes = ?,
           analysis_json = ?,
           analysis_schema_version = ?,
           analysis_format_pass = ?,
           analysis_retry_count = ?,
           analysis_fallback_used = ?,
           analysis_provider = ?,
           analysis_model = ?,
           analysis_generation_path = ?,
           analysis_prompt_version = ?,
           analysis_generated_at = ?,
           analysis_error_categories_json = ?,
           value_signals_json = ?,
           downstream_processing_json = COALESCE(?, downstream_processing_json)
         WHERE id = ? AND transcript_json = ?
           AND transcript_integrity_json = ?
           AND transcript_validated_at = ?
           AND transcript_status = 'validated'`,
      )
      .run(
        input.expectedTitle,
        input.title,
        input.enhancedNotes,
        input.analysisJson,
        input.analysisSchemaVersion,
        input.analysisFormatPass ? 1 : 0,
        input.analysisRetryCount,
        input.analysisFallbackUsed ? 1 : 0,
        input.analysisProvider ?? null,
        input.analysisModel ?? null,
        input.analysisGenerationPath ?? null,
        input.analysisPromptVersion ?? null,
        input.analysisGeneratedAt ?? null,
        input.analysisErrorCategoriesJson ?? null,
        input.valueSignalsJson,
        input.downstreamProcessingJson ?? null,
        String(input.meetingId),
        input.expectedTranscriptJson,
        input.expectedTranscriptIntegrityJson,
        input.expectedTranscriptValidatedAt,
      );
    if (result.changes !== 1) {
      return db
        .prepare('SELECT 1 FROM meetings WHERE id = ?')
        .get(String(input.meetingId))
        ? 'conflict'
        : 'missing';
    }
    const updated = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(String(input.meetingId)) as PersistedMeeting | undefined;
    if (!updated) return 'missing';
    refreshMeetingFts(updated);
    return 'updated';
  })();

export const updateMeetingFollowUpDrafts = (
  meetingId: string | number,
  followUpDraftsJson: string | null,
): boolean => {
  const result = db
    .prepare('UPDATE meetings SET follow_up_drafts_json = ? WHERE id = ?')
    .run(followUpDraftsJson, String(meetingId));
  return result.changes === 1;
};

export const saveMeetingIfTranscriptRunCurrent = (
  meeting: PersistedMeeting,
  expectedValidationRunId: string,
) =>
  db.transaction(() => {
    const current = getMeeting(meeting.id) as PersistedMeeting | undefined;
    if (!current) return false;
    let currentRunId: string | null = null;
    try {
      const integrity = JSON.parse(
        current.transcript_integrity_json || '{}',
      ) as { validation_run_id?: unknown };
      currentRunId =
        readRetryLease(integrity)?.runId ??
        (typeof integrity.validation_run_id === 'string'
          ? integrity.validation_run_id
          : null);
    } catch {
      currentRunId = null;
    }
    if (currentRunId !== expectedValidationRunId) return false;
    saveMeetingTransaction(meeting);
    return true;
  })();

export const claimMeetingDownstreamProcessing = (
  meetingId: string | number,
  lease: DownstreamProcessingLease,
) =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    if (lease.schemaVersion === 1) {
      if (
        current.transcript_status !== 'validated' ||
        current.transcript_validated_at !== lease.transcriptValidatedAt
      ) {
        return false;
      }
    } else {
      let hasCaptureGap = false;
      try {
        const integrity = JSON.parse(
          current.transcript_integrity_json || '{}',
        ) as { causes?: Array<{ code?: unknown }>; reasons?: unknown };
        hasCaptureGap = Boolean(
          integrity.causes?.some(
            (cause) =>
              cause.code === 'capture_gap_detected' ||
              cause.code === 'required_source_failed',
          ) ||
            (Array.isArray(integrity.reasons) &&
              integrity.reasons.includes('system_capture_incomplete')),
        );
      } catch {
        return false;
      }
      const hash = (value: string | null | undefined) =>
        createHash('sha256')
          .update(value || '')
          .digest('hex');
      if (
        current.transcript_status !== 'needs_attention' ||
        !hasCaptureGap ||
        current.capture_journal_generation !==
          lease.source.captureJournalGeneration ||
        hash(current.transcript_json) !== lease.source.transcriptSha256 ||
        hash(current.transcript_integrity_json) !==
          lease.source.transcriptIntegritySha256
      ) {
        return false;
      }
    }
    const active = readDownstreamProcessingLease(
      current.downstream_processing_json,
    );
    if (active && Date.parse(active.deadlineAt) > Date.parse(lease.startedAt)) {
      return false;
    }
    const prior = current.downstream_processing_json ?? null;
    return (
      db
        .prepare(
          `UPDATE meetings
           SET downstream_processing_json = ?
           WHERE id = ? AND downstream_processing_json IS ?`,
        )
        .run(JSON.stringify(lease), String(meetingId), prior).changes === 1
    );
  })();

export const expireInterruptedDownstreamProcessing = (): number =>
  db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id, downstream_processing_json
         FROM meetings
         WHERE json_extract(downstream_processing_json, '$.state') = 'processing'`,
      )
      .all() as Array<{
      id: string;
      downstream_processing_json: string | null;
    }>;
    let expired = 0;
    for (const row of rows) {
      const lease = readDownstreamProcessingLease(
        row.downstream_processing_json,
      );
      if (!lease) continue;
      const failed =
        lease.schemaVersion === 2
          ? {
              schemaVersion: 2,
              state: 'failed',
              source: lease.source,
              stage: lease.stage,
              failure: 'interrupted',
            }
          : {
              schemaVersion: 1,
              state: 'failed',
              transcriptValidatedAt: lease.transcriptValidatedAt,
              stage: lease.stage,
              failure: 'interrupted',
            };
      expired += db
        .prepare(
          `UPDATE meetings
           SET downstream_processing_json = ?
           WHERE id = ? AND downstream_processing_json IS ?`,
        )
        .run(
          JSON.stringify(failed),
          row.id,
          row.downstream_processing_json,
        ).changes;
    }
    return expired;
  })();

export const saveMeetingIfDownstreamRunCurrent = (
  meeting: PersistedMeeting,
  expectedDownstreamRunId: string,
  expectedTitle?: string,
) =>
  db.transaction(() => {
    const current = getMeeting(meeting.id) as PersistedMeeting | undefined;
    if (!current) return false;
    const active = readDownstreamProcessingLease(
      current.downstream_processing_json,
    );
    if (active?.runId !== expectedDownstreamRunId) return false;
    const merged = {
      ...current,
      enhanced_notes: meeting.enhanced_notes,
      analysis_json: meeting.analysis_json,
      value_signals_json: meeting.value_signals_json,
      downstream_processing_json: meeting.downstream_processing_json,
    };
    if (expectedTitle !== undefined && current.title === expectedTitle) {
      merged.title = meeting.title;
    }
    saveMeetingTransaction(merged);
    return true;
  })();

export const saveTranscriptValidationResultIfRunCurrent = (
  meetingId: string | number,
  expectedValidationRunId: string,
  transcriptFields: Partial<PersistedMeeting>,
  expectedTitle?: string,
) =>
  db.transaction(() => {
    const current = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(String(meetingId)) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    if (readRetryLease(integrity)?.runId !== expectedValidationRunId) {
      return false;
    }
    const merged = mergeTranscriptOwnedFields(
      current as PersistedMeeting & Record<string, unknown>,
      transcriptFields as Record<string, unknown>,
    );
    if (
      expectedTitle !== undefined &&
      current.title === expectedTitle &&
      typeof transcriptFields.title === 'string'
    ) {
      merged.title = transcriptFields.title;
    }
    saveMeetingTransaction(merged);
    return true;
  })();

export const claimMeetingTranscriptValidationRetry = (
  meetingId: string | number,
  lease: TranscriptValidationRetryLease,
) =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const active = readRetryLease(integrity);
    if (
      current.transcript_status === 'validating' &&
      active &&
      Date.parse(active.deadlineAt) > Date.parse(lease.startedAt)
    ) {
      return false;
    }
    const nextIntegrity = beginRetryLease(integrity, lease);
    const nextTranscriptJson = withTranscriptLifecycleStatus(
      current.transcript_json,
      'validating',
    );
    return (
      db
        .prepare(
          `UPDATE meetings
           SET transcript_status = 'validating',
               transcript_integrity_json = ?,
               transcript_json = ?
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(nextIntegrity),
          nextTranscriptJson,
          String(meetingId),
        ).changes === 1
    );
  })();

export const updateMeetingTranscriptValidationRetryStage = (
  meetingId: string | number,
  runId: string,
  stage: TranscriptValidationRetryStage,
) =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const lease = readRetryLease(integrity);
    if (!lease || lease.runId !== runId) return false;
    integrity.retry = { ...lease, stage };
    return (
      db
        .prepare(
          'UPDATE meetings SET transcript_integrity_json = ? WHERE id = ?',
        )
        .run(JSON.stringify(integrity), String(meetingId)).changes === 1
    );
  })();

export const failMeetingTranscriptValidationRetry = (
  meetingId: string | number,
  runId: string,
  failure: TranscriptValidationRetryFailure,
) =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const integrity = parseIntegrityRecord(current.transcript_integrity_json);
    const lease = readRetryLease(integrity);
    if (!lease || lease.runId !== runId) return false;
    const nextTranscriptJson = withTranscriptLifecycleStatus(
      current.transcript_json,
      'needs_attention',
    );
    return (
      db
        .prepare(
          `UPDATE meetings
           SET transcript_status = 'needs_attention',
               transcript_integrity_json = ?,
               transcript_json = ?,
               transcript_validated_at = NULL
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(finishRetryLease(integrity, failure)),
          nextTranscriptJson,
          String(meetingId),
        ).changes === 1
    );
  })();

export const recoverExpiredTranscriptValidationRetries = (nowMs = Date.now()) =>
  db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT id, transcript_status, transcript_integrity_json, transcript_json FROM meetings WHERE transcript_status IN ('validating', 'validated')",
      )
      .all() as Array<{
      id: string;
      transcript_status: TranscriptLifecycleStatus;
      transcript_integrity_json: string | null;
      transcript_json: string | null;
    }>;
    let recovered = 0;
    for (const row of rows) {
      const integrity = parseIntegrityRecord(row.transcript_integrity_json);
      const lease = readRetryLease(integrity);
      if (!lease) continue;
      if (Date.parse(lease.deadlineAt) > nowMs) {
        if (row.transcript_status === 'validating') {
          const nextTranscriptJson = withTranscriptLifecycleStatus(
            row.transcript_json,
            'validating',
          );
          if (nextTranscriptJson !== row.transcript_json) {
            recovered += db
              .prepare(
                `UPDATE meetings
                 SET transcript_json = ?
                 WHERE id = ? AND transcript_status = 'validating'`,
              )
              .run(nextTranscriptJson, row.id).changes;
          }
        }
        continue;
      }
      const nextStatus =
        row.transcript_status === 'validated' ? 'validated' : 'needs_attention';
      const nextTranscriptJson =
        nextStatus === 'validated'
          ? row.transcript_json
          : withTranscriptLifecycleStatus(
              row.transcript_json,
              'needs_attention',
            );
      const result = db
        .prepare(
          `UPDATE meetings
           SET transcript_status = ?,
               transcript_integrity_json = ?,
               transcript_json = ?,
               transcript_validated_at = CASE
                 WHEN ? = 'validated' THEN transcript_validated_at
                 ELSE NULL
               END
           WHERE id = ? AND transcript_status = ?`,
        )
        .run(
          nextStatus,
          JSON.stringify(finishRetryLease(integrity, 'retry_interrupted')),
          nextTranscriptJson,
          nextStatus,
          row.id,
          row.transcript_status,
        );
      recovered += result.changes;
    }
    return recovered;
  })();

export const getMeetings = () => {
  recoverExpiredTranscriptValidationRetries();
  return db
    .prepare(
      'SELECT * FROM meetings ORDER BY COALESCE(started_at, created_at) DESC',
    )
    .all();
};

export const getMeetingSummaries = (
  meetingId?: string | number,
): MeetingSummary[] => {
  recoverExpiredTranscriptValidationRetries();
  const statement = db.prepare(
    `SELECT
         m.id,
         m.title,
         m.meeting_type,
         COALESCE(m.started_at, m.created_at, '') AS started_at,
         m.ended_at,
         m.duration_seconds,
         m.folder_id,
         COALESCE(m.is_favorite, 0) AS is_favorite,
         m.end_reason,
         COALESCE(m.created_at, '') AS created_at,
         m.transcript_status,
         m.transcript_validated_at,
         m.finalization_status,
         m.finalization_error_category,
         m.downstream_processing_json,
         m.capture_journal_generation,
         CASE WHEN m.transcript_json IS NOT NULL THEN 1 ELSE 0 END AS has_transcript,
         CASE
           WHEN m.transcript_json IS NOT NULL THEN 1
           ELSE 0
         END AS has_transcript_text,
         CASE
           WHEN COALESCE(m.audio_path, '') != '' OR COALESCE(m.system_audio_path, '') != '' OR COALESCE(m.mixed_audio_path, '') != '' THEN 1
           ELSE 0
         END AS has_audio,
         CASE WHEN m.analysis_json IS NOT NULL OR m.enhanced_notes IS NOT NULL THEN 1 ELSE 0 END AS has_analysis,
         CASE WHEN r.meeting_id IS NULL THEN NULL ELSE json_object(
           'run_id', r.run_id,
           'input_revision', r.input_revision,
           'notes_status', r.notes_status,
           'secondary_status', r.secondary_status,
           'stage', r.stage,
           'queue_position', r.queue_position,
           'error_code', r.error_code,
           'started_at', r.started_at,
           'updated_at', r.updated_at
         ) END AS analysis_run_json
       FROM meetings AS m
       LEFT JOIN meeting_analysis_runs AS r ON r.meeting_id = m.id
       ${meetingId === undefined ? '' : 'WHERE m.id = ?'}
       ORDER BY COALESCE(m.started_at, m.created_at) DESC`,
  );
  const rows = (
    meetingId === undefined ? statement.all() : statement.all(String(meetingId))
  ) as Array<
    Omit<
      MeetingSummary,
      'has_transcript' | 'has_transcript_text' | 'has_audio' | 'has_analysis'
    > & {
      has_transcript: number;
      has_transcript_text: number;
      has_audio: number;
      has_analysis: number;
    }
  >;
  return rows.map((row) => ({
    ...row,
    has_transcript: Boolean(row.has_transcript),
    has_transcript_text: Boolean(row.has_transcript_text),
    has_audio: Boolean(row.has_audio),
    has_analysis: Boolean(row.has_analysis),
  }));
};

const readMeetingProcessingStatus = (row: {
  id: string | number;
  transcript_integrity_json: string | null;
  automatic_attempt_count: number | null;
  notes_status: string | null;
}): MeetingProcessingStatus => {
  const integrity = parseIntegrityRecord(row.transcript_integrity_json);
  const finalTranscription =
    integrity.finalTranscription &&
    typeof integrity.finalTranscription === 'object'
      ? (integrity.finalTranscription as Record<string, unknown>)
      : null;
  const finalResult =
    integrity.finalTranscriptionResult &&
    typeof integrity.finalTranscriptionResult === 'object'
      ? (integrity.finalTranscriptionResult as Record<string, unknown>)
      : null;
  let automaticAttemptsExhausted = false;
  if (
    row.notes_status === 'failed' &&
    (row.automatic_attempt_count ?? 0) >= 2
  ) {
    const meeting = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(String(row.id)) as PersistedMeeting | undefined;
    const run = getMeetingAnalysisRun(row.id);
    automaticAttemptsExhausted = isMeetingAnalysisAutomaticRetryExhausted(
      meeting,
      run,
    );
  }
  return {
    id: row.id,
    has_capture_gap: Array.isArray(integrity.causes)
      ? integrity.causes.some(
          (cause) =>
            cause &&
            typeof cause === 'object' &&
            (cause as { code?: unknown }).code === 'capture_gap_detected',
        )
      : false,
    recovered_awaiting_validation: Array.isArray(integrity.causes)
      ? integrity.causes.some(
          (cause) =>
            cause &&
            typeof cause === 'object' &&
            (cause as { code?: unknown }).code ===
              'recovered_awaiting_validation',
        )
      : false,
    final_transcription_policy:
      typeof finalTranscription?.policy === 'string'
        ? finalTranscription.policy
        : null,
    final_transcription_state:
      typeof finalTranscription?.state === 'string'
        ? finalTranscription.state
        : null,
    final_transcription_engine:
      typeof finalResult?.engine === 'string' ? finalResult.engine : null,
    speaker_attribution_verified:
      finalTranscription?.policy === 'parakeet_final_v1' &&
      finalTranscription.state === 'complete'
        ? integrity.speakerAttributionVerified === true
        : null,
    automatic_attempts_exhausted: automaticAttemptsExhausted,
  };
};

export const getMeetingProcessingStatuses = (
  meetingId?: string | number,
): MeetingProcessingStatus[] => {
  const statement = db.prepare(
    `SELECT m.id, m.transcript_integrity_json,
            r.automatic_attempt_count, r.notes_status
     FROM meetings AS m
     LEFT JOIN meeting_analysis_runs AS r ON r.meeting_id = m.id
     WHERE ${
       meetingId === undefined
         ? `(m.transcript_status = 'needs_attention'
            OR (m.transcript_status = 'validated' AND (
              (m.analysis_json IS NULL AND m.enhanced_notes IS NULL)
              OR m.downstream_processing_json IS NOT NULL
              OR lower(trim(m.title)) IN (
                'meeting',
                'new meeting',
                'meeting (mic only)',
                'recovered recording',
                'untitled meeting',
                'untitled session'
              )
            )))`
         : 'm.id = ?'
     }`,
  );
  const rows = (
    meetingId === undefined ? statement.all() : statement.all(String(meetingId))
  ) as Array<{
    id: string | number;
    transcript_integrity_json: string | null;
    automatic_attempt_count: number | null;
    notes_status: string | null;
  }>;
  return rows.map(readMeetingProcessingStatus);
};

export const getMeetingSummary = (
  meetingId: string | number,
): (MeetingSummary & Partial<MeetingProcessingStatus>) | null => {
  const summary = getMeetingSummaries(meetingId)[0];
  if (!summary) return null;
  const processingStatus = getMeetingProcessingStatuses(meetingId)[0];
  return processingStatus ? { ...summary, ...processingStatus } : summary;
};

export const getMeetingDashboardPreviews = (): MeetingDashboardPreview[] =>
  db
    .prepare(
      `SELECT
         id,
         substr(COALESCE(
           CASE WHEN json_valid(analysis_json) THEN json_extract(analysis_json, '$.overview') END,
           enhanced_notes
         ), 1, 280) AS dashboard_detail,
         substr(CASE WHEN json_valid(analysis_json) THEN json_extract(analysis_json, '$.recent_win.win') END, 1, 160) AS recent_win_title,
         substr(CASE WHEN json_valid(analysis_json) THEN json_extract(analysis_json, '$.recent_win.why_it_counts') END, 1, 240) AS recent_win_why,
         substr(CASE WHEN json_valid(analysis_json) THEN json_extract(analysis_json, '$.recent_win.evidence') END, 1, 240) AS recent_win_evidence,
         substr(CASE WHEN json_valid(analysis_json) THEN json_extract(analysis_json, '$.recent_win.source') END, 1, 160) AS recent_win_source
       FROM meetings
       WHERE analysis_json IS NOT NULL OR enhanced_notes IS NOT NULL
       ORDER BY COALESCE(started_at, created_at) DESC`,
    )
    .all() as MeetingDashboardPreview[];

export const searchMeetingSummaries = (
  query: string,
  requestedLimit = 5,
): Array<{
  id: string | number;
  title: string;
  started_at: string;
  created_at: string;
}> => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const limit = Math.min(
    20,
    Math.max(1, Number.isSafeInteger(requestedLimit) ? requestedLimit : 5),
  );
  const pattern = `%${normalized}%`;
  return db
    .prepare(
      `SELECT id, title,
              COALESCE(started_at, created_at, '') AS started_at,
              COALESCE(created_at, '') AS created_at
       FROM meetings
       WHERE lower(COALESCE(title, '')) LIKE ?
          OR lower(COALESCE(enhanced_notes, '')) LIKE ?
          OR lower(COALESCE(user_notes, '')) LIKE ?
          OR lower(COALESCE(analysis_json, '')) LIKE ?
       ORDER BY COALESCE(started_at, created_at) DESC
       LIMIT ?`,
    )
    .all(pattern, pattern, pattern, pattern, limit) as Array<{
    id: string | number;
    title: string;
    started_at: string;
    created_at: string;
  }>;
};

export const getMeeting = (id: string | number) => {
  recoverExpiredTranscriptValidationRetries();
  return db.prepare('SELECT * FROM meetings WHERE id = ?').get(String(id));
};

export const getMeetingSpeakerSampleSource = (
  id: string | number,
): Pick<
  PersistedMeeting,
  'id' | 'transcript_json' | 'system_audio_path'
> | null =>
  (db
    .prepare(
      'SELECT id, transcript_json, system_audio_path FROM meetings WHERE id = ?',
    )
    .get(String(id)) as
    | Pick<PersistedMeeting, 'id' | 'transcript_json' | 'system_audio_path'>
    | undefined) ?? null;

const validNotesStatus = new Set<MeetingAnalysisRunStatus>([
  'running',
  'published',
  'failed',
  'cancelled',
]);
const validSecondaryStatus = new Set<MeetingAnalysisSecondaryStatus>([
  'pending',
  'running',
  'complete',
  'failed',
  'superseded',
]);

export const beginMeetingAnalysisRun = (input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  reason: 'automatic' | 'manual';
  stage?: 'queued' | 'notes_writer';
  queuePosition?: number | null;
}): { status: 'started' } => {
  const now = new Date().toISOString();
  const stage = input.stage ?? 'notes_writer';
  const queuePosition =
    stage === 'queued' &&
    Number.isSafeInteger(input.queuePosition) &&
    (input.queuePosition ?? 0) > 0
      ? input.queuePosition!
      : null;
  const reason = input.reason;
  db.prepare(
    `INSERT INTO meeting_analysis_runs (
      meeting_id, run_id, input_revision, source_revision, eligibility_revision,
      user_notes_hash, notes_status, secondary_status, stage, queue_position,
      error_code, automatic_attempt_count, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', 'pending', ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(meeting_id) DO UPDATE SET
      run_id = excluded.run_id,
      input_revision = excluded.input_revision,
      source_revision = excluded.source_revision,
      eligibility_revision = excluded.eligibility_revision,
      user_notes_hash = excluded.user_notes_hash,
      notes_status = 'running',
      secondary_status = 'pending',
      stage = excluded.stage,
      queue_position = excluded.queue_position,
      error_code = NULL,
      automatic_attempt_count = CASE
        WHEN ? != 'automatic' THEN meeting_analysis_runs.automatic_attempt_count
        WHEN meeting_analysis_runs.input_revision = excluded.input_revision
          THEN meeting_analysis_runs.automatic_attempt_count + 1
        ELSE 1
      END,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at`,
  ).run(
    String(input.meetingId),
    input.runId,
    input.inputRevision,
    input.sourceRevision,
    input.eligibilityRevision,
    input.userNotesHash,
    stage,
    queuePosition,
    reason === 'automatic' ? 1 : 0,
    now,
    now,
    reason,
  );
  return { status: 'started' };
};

export const getMeetingAnalysisRun = (
  meetingId: string | number,
): MeetingAnalysisRun | null =>
  (db
    .prepare('SELECT * FROM meeting_analysis_runs WHERE meeting_id = ?')
    .get(String(meetingId)) as MeetingAnalysisRun | undefined) ?? null;

export const listMeetingIdsWithFailedSecondary = (): string[] =>
  (
    db
      .prepare(
        `SELECT meeting_id FROM meeting_analysis_runs
         WHERE notes_status = 'published'
           AND secondary_status = 'failed'
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{ meeting_id: string }>
  ).map((row) => String(row.meeting_id));

export const updateMeetingAnalysisRunStatus = (input: {
  meetingId: string | number;
  runId: string;
  notesStatus: MeetingAnalysisRunStatus;
  secondaryStatus: MeetingAnalysisSecondaryStatus;
  stage: string;
  errorCode?: string | null;
}): boolean => {
  if (
    !validNotesStatus.has(input.notesStatus) ||
    !validSecondaryStatus.has(input.secondaryStatus)
  ) {
    throw new Error('invalid_meeting_analysis_run_status');
  }
  const result = db
    .prepare(
      `UPDATE meeting_analysis_runs
       SET notes_status = ?, secondary_status = ?, stage = ?,
           queue_position = CASE WHEN ? = 'queued' THEN queue_position ELSE NULL END,
           error_code = ?, updated_at = ?
       WHERE meeting_id = ? AND run_id = ?`,
    )
    .run(
      input.notesStatus,
      input.secondaryStatus,
      input.stage,
      input.stage,
      input.errorCode ?? null,
      new Date().toISOString(),
      String(input.meetingId),
      input.runId,
    );
  return result.changes === 1;
};

export const updateMeetingAnalysisQueuePosition = (input: {
  meetingId: string | number;
  runId: string;
  queuePosition: number | null;
}): boolean => {
  if (
    input.queuePosition !== null &&
    (!Number.isSafeInteger(input.queuePosition) || input.queuePosition <= 0)
  ) {
    throw new Error('invalid_meeting_analysis_queue_position');
  }
  const result = db
    .prepare(
      `UPDATE meeting_analysis_runs
       SET queue_position = ?, updated_at = ?
       WHERE meeting_id = ? AND run_id = ? AND notes_status = 'running'`,
    )
    .run(
      input.queuePosition,
      new Date().toISOString(),
      String(input.meetingId),
      input.runId,
    );
  return result.changes === 1;
};

export const updateMeetingAnalysisQueueSnapshot = (
  updates: Array<{
    meetingId: string | number;
    runId: string;
    queuePosition: number | null;
  }>,
): number => {
  for (const update of updates) {
    if (
      update.queuePosition !== null &&
      (!Number.isSafeInteger(update.queuePosition) || update.queuePosition <= 0)
    ) {
      throw new Error('invalid_meeting_analysis_queue_position');
    }
  }
  const statement = db.prepare(
    `UPDATE meeting_analysis_runs
     SET queue_position = ?, updated_at = ?
     WHERE meeting_id = ? AND run_id = ? AND notes_status = 'running'`,
  );
  const applySnapshot = db.transaction(
    (
      entries: Array<{
        meetingId: string | number;
        runId: string;
        queuePosition: number | null;
      }>,
    ) => {
      const now = new Date().toISOString();
      return entries.reduce(
        (changes, entry) =>
          changes +
          statement.run(
            entry.queuePosition,
            now,
            String(entry.meetingId),
            entry.runId,
          ).changes,
        0,
      );
    },
  );
  return applySnapshot.immediate(updates);
};

export type MeetingAnalysisRunMetricRecord = {
  runId: string;
  meetingId: string;
  reason: 'automatic' | 'manual';
  status: 'published' | 'failed' | 'cancelled';
  errorCode: string | null;
  metrics: MeetingNotesRunMetric;
  startedAt: string;
  completedAt: string;
};

const terminalMetricStatuses = new Set<
  MeetingAnalysisRunMetricRecord['status']
>(['published', 'failed', 'cancelled']);

export const upsertMeetingAnalysisRunMetric = (input: {
  meetingId: string | number;
  runId: string;
  reason: 'automatic' | 'manual';
  status: 'published' | 'failed' | 'cancelled';
  errorCode?: string | null;
  metrics: MeetingNotesRunMetric;
  startedAt: string;
  completedAt: string;
}): void => {
  if (
    !input.runId.trim() ||
    !terminalMetricStatuses.has(input.status) ||
    input.metrics.reason !== input.reason ||
    input.metrics.status !== input.status
  ) {
    throw new Error('invalid_meeting_notes_run_metric');
  }
  const metricsJson = serializeMeetingNotesRunMetric(input.metrics);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO meeting_analysis_run_history (
         run_id, meeting_id, reason, status, error_code, metrics_json, started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         meeting_id = excluded.meeting_id,
         reason = excluded.reason,
         status = excluded.status,
         error_code = excluded.error_code,
         metrics_json = excluded.metrics_json,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at`,
    ).run(
      input.runId,
      String(input.meetingId),
      input.reason,
      input.status,
      input.errorCode ?? null,
      metricsJson,
      input.startedAt,
      input.completedAt,
    );
    db.prepare(
      `DELETE FROM meeting_analysis_run_history
       WHERE run_id NOT IN (
         SELECT run_id FROM meeting_analysis_run_history
         ORDER BY completed_at DESC, rowid DESC
         LIMIT 100
       )`,
    ).run();
  })();
};

export const listMeetingAnalysisRunMetrics = (input: {
  limit: number;
}): MeetingAnalysisRunMetricRecord[] => {
  const limit = Math.min(
    1_000,
    Math.max(1, Number.isSafeInteger(input.limit) ? input.limit : 100),
  );
  const rows = db
    .prepare(
      `SELECT run_id, meeting_id, reason, status, error_code, metrics_json, started_at, completed_at
       FROM meeting_analysis_run_history
       WHERE completed_at IS NOT NULL
       ORDER BY completed_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    run_id: string;
    meeting_id: string;
    reason: 'automatic' | 'manual';
    status: 'published' | 'failed' | 'cancelled';
    error_code: string | null;
    metrics_json: string;
    started_at: string;
    completed_at: string;
  }>;
  return rows.map((row) => ({
    runId: row.run_id,
    meetingId: row.meeting_id,
    reason: row.reason,
    status: row.status,
    errorCode: row.error_code,
    metrics: parseMeetingNotesRunMetric(row.metrics_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
};

const hashMeetingAnalysisValue = (value: string | null | undefined): string =>
  createHash('sha256')
    .update(value ?? '', 'utf8')
    .digest('hex');

export type MeetingAnalysisPublicationRevisions = {
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
};

export const getMeetingNotesIdentityProjection = (
  meetingId: string | number,
): {
  speakerDisplayNames: Record<string, string>;
  trustedUserTerms: string[];
} => {
  const meeting = db
    .prepare('SELECT id, transcript_json FROM meetings WHERE id = ?')
    .get(String(meetingId)) as
    | Pick<PersistedMeeting, 'id' | 'transcript_json'>
    | undefined;
  if (!meeting?.transcript_json) {
    return { speakerDisplayNames: {}, trustedUserTerms: [] };
  }
  const bindings = identityStore
    .getBindings(String(meetingId))
    .map((binding) => ({
      ...binding,
      personId: binding.personId
        ? resolvePersonIdentityId(binding.personId)
        : null,
    }));
  const people = [
    ...new Set(
      getEntitiesByType('person').map(({ id }) => resolvePersonIdentityId(id)),
    ),
  ].flatMap((id) => {
    const person = getEntity(id);
    return person?.type === 'person' ? [{ id, name: person.name }] : [];
  });
  const storedSelfPersonId = identityStore.getSelfPersonId();
  const storedCapture = identityStore.getCapture(String(meetingId));
  return buildMeetingNotesIdentityProjection({
    transcriptJson: meeting.transcript_json,
    bindings,
    people,
    capture: {
      ...storedCapture,
      selfPersonId: storedCapture.selfPersonId
        ? resolvePersonIdentityId(storedCapture.selfPersonId)
        : null,
    },
    currentSelfPersonId: storedSelfPersonId
      ? resolvePersonIdentityId(storedSelfPersonId)
      : null,
  });
};

export const hasPublishedMeetingNotes = (meetingId: string | number): boolean =>
  Boolean(
    db
      .prepare(
        `SELECT 1 FROM meetings
         WHERE id = ?
           AND (analysis_json IS NOT NULL OR enhanced_notes IS NOT NULL)`,
      )
      .get(String(meetingId)),
  );

const meetingEditConflictKey = (conflict: PreservedEditConflict): string =>
  JSON.stringify([
    conflict.path,
    conflict.original,
    conflict.edited,
    conflict.edited_at,
    conflict.previousSourceKey,
  ]);

const mergeMeetingEditConflicts = (
  existing: PreservedEditConflict[],
  next: PreservedEditConflict[],
): PreservedEditConflict[] => {
  const seen = new Set<string>();
  return [...existing, ...next].filter((conflict) => {
    const key = meetingEditConflictKey(conflict);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Derives the exact persisted inputs a notes run is allowed to publish against.
 * Invalid or empty transcript payloads are intentionally ineligible instead of
 * being represented by a synthetic revision.
 */
export const getMeetingAnalysisPublicationRevisions = (
  meeting: PersistedMeeting | null | undefined,
): MeetingAnalysisPublicationRevisions | null => {
  if (!meeting?.transcript_json) return null;
  try {
    const source = createNotesSource(meeting.transcript_json);
    const partialLease = readDownstreamProcessingLease(
      meeting.downstream_processing_json,
    );
    const eligibilityRevision = hashMeetingAnalysisValue(
      JSON.stringify({
        transcriptStatus: meeting.transcript_status ?? null,
        transcriptIntegrityJson: meeting.transcript_integrity_json ?? null,
        finalizationStatus: meeting.finalization_status ?? null,
        captureJournalGeneration: meeting.capture_journal_generation ?? null,
        partialCaptureAuthorization:
          meeting.transcript_status === 'needs_attention' &&
          partialLease?.schemaVersion === 2
            ? partialLease.source
            : null,
      }),
    );
    return {
      sourceRevision: source.revision,
      eligibilityRevision,
      userNotesHash: hashMeetingAnalysisValue(meeting.user_notes),
    };
  } catch {
    return null;
  }
};

export const isMeetingAnalysisAutomaticRetryExhausted = (
  meeting: PersistedMeeting | null | undefined,
  existingRun?: MeetingAnalysisRun | null,
): boolean => {
  if (!meeting) return false;
  const run = existingRun ?? getMeetingAnalysisRun(meeting.id);
  if (
    !run ||
    run.notes_status !== 'failed' ||
    run.automatic_attempt_count < 2
  ) {
    return false;
  }
  const revisions = getMeetingAnalysisPublicationRevisions(meeting);
  return Boolean(
    revisions &&
      run.source_revision === revisions.sourceRevision &&
      run.eligibility_revision === revisions.eligibilityRevision &&
      run.user_notes_hash === revisions.userNotesHash,
  );
};

/**
 * Restores the persisted generated-notes snapshot without accepting a stale
 * renderer meeting object. The transaction changes only analysis-owned fields.
 */
export const restoreMeetingNotesSnapshot = (
  meetingId: string | number,
): boolean =>
  db.transaction(() => {
    const current = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;
    const restored = restoreAnalysisSnapshot(current);
    if (!restored) return false;
    const analysis = parseAnalysisDocumentV3Json(restored.analysis_json);
    const metadata = analysis?.generation_metadata;
    const quality = analysis?.quality;
    const result = db
      .prepare(
        `UPDATE meetings
         SET enhanced_notes = ?,
             analysis_json = ?,
             analysis_schema_version = ?,
             analysis_format_pass = ?,
             analysis_retry_count = ?,
             analysis_fallback_used = ?,
             analysis_provider = ?,
             analysis_model = ?,
             analysis_generation_path = ?,
             analysis_prompt_version = ?,
             analysis_generated_at = ?,
             analysis_error_categories_json = ?,
             user_edits_json = ?,
             analysis_edit_conflicts_json = ?
         WHERE id = ?`,
      )
      .run(
        restored.enhanced_notes ?? null,
        restored.analysis_json ?? null,
        restored.analysis_schema_version ?? null,
        quality?.format_pass === undefined ? null : Number(quality.format_pass),
        quality?.retry_count ?? null,
        quality?.fallback_used === undefined
          ? null
          : Number(quality.fallback_used),
        metadata?.provider ?? null,
        metadata?.model ?? null,
        metadata?.generation_path ?? null,
        metadata?.prompt_version ?? null,
        metadata?.generated_at ?? null,
        metadata ? JSON.stringify(metadata.error_categories) : null,
        restored.user_edits_json ?? null,
        restored.analysis_edit_conflicts_json ?? null,
        String(meetingId),
      );
    if (result.changes !== 1) return false;
    db.prepare(
      `UPDATE meeting_analysis_runs SET notes_status = 'cancelled', secondary_status = 'superseded', stage = 'restored', queue_position = NULL, error_code = 'notes_superseded', updated_at = ? WHERE meeting_id = ?`,
    ).run(new Date().toISOString(), String(meetingId));
    const updated = getMeeting(meetingId) as PersistedMeeting | undefined;
    if (updated) refreshMeetingFts(updated);
    return true;
  })();

export const publishMeetingNotesIfCurrent = (input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  analysis: AnalysisDocumentV3;
}): boolean => {
  const analysisJson = JSON.stringify(input.analysis);
  if (typeof analysisJson !== 'string') {
    throw new Error('invalid_meeting_analysis_document');
  }

  const metadata = input.analysis.generation_metadata;
  const enhancedNotes = analysisDocumentV3ToMarkdown(input.analysis);
  return db.transaction(() => {
    const meetingId = String(input.meetingId);
    const current = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(meetingId) as PersistedMeeting | undefined;
    if (!current) return false;

    const currentRevisions = getMeetingAnalysisPublicationRevisions(current);
    if (
      !currentRevisions ||
      currentRevisions.sourceRevision !== input.sourceRevision ||
      currentRevisions.eligibilityRevision !== input.eligibilityRevision ||
      currentRevisions.userNotesHash !== input.userNotesHash
    ) {
      return false;
    }

    const run = db
      .prepare(
        `SELECT * FROM meeting_analysis_runs
         WHERE meeting_id = ?
           AND run_id = ?
           AND input_revision = ?
           AND source_revision = ?
           AND eligibility_revision = ?
           AND user_notes_hash = ?
           AND notes_status = 'running'`,
      )
      .get(
        meetingId,
        input.runId,
        input.inputRevision,
        input.sourceRevision,
        input.eligibilityRevision,
        input.userNotesHash,
      ) as MeetingAnalysisRun | undefined;
    if (!run) return false;

    const currentEdits = parseUserEditsJson(current.user_edits_json);
    delete currentEdits[ANALYSIS_SNAPSHOT_PATH];
    const rebased = rebaseMeetingNotesEdits({
      edits: currentEdits,
      previousBlocks: getAnalysisEditBlocks(
        parseAnalysisDocumentV3Json(current.analysis_json),
      ),
      nextBlocks: getAnalysisEditBlocks(input.analysis),
    });
    const mergedConflicts = mergeMeetingEditConflicts(
      parseAnalysisEditConflictsJson(current.analysis_edit_conflicts_json),
      rebased.conflicts,
    );
    if (current.analysis_json || current.enhanced_notes)
      rebased.edits[ANALYSIS_SNAPSHOT_PATH] =
        createAnalysisSnapshot(current)[ANALYSIS_SNAPSHOT_PATH];

    const previousAnalysis = parseAnalysisDocumentV3Json(current.analysis_json);
    const previousModelTitle =
      typeof previousAnalysis?.title === 'string'
        ? previousAnalysis.title.trim()
        : '';
    const previousFirstTopicTitle = previousAnalysis?.topics
      ?.map((topic) =>
        typeof topic?.title === 'string' ? topic.title.trim() : '',
      )
      .find((title) => title.length > 0 && title.length <= 120);
    const legacyTopicFallbackTitle =
      !previousModelTitle &&
      Boolean(previousFirstTopicTitle) &&
      previousFirstTopicTitle === current.title?.trim();
    const replaceableTitle =
      meetingTitleNeedsGeneration(current.title) || legacyTopicFallbackTitle;
    const modelTitle =
      typeof input.analysis.title === 'string' &&
      input.analysis.title.trim().length > 0 &&
      input.analysis.title.trim().length <= 120
        ? input.analysis.title.trim()
        : null;
    const nextTitle = replaceableTitle
      ? (modelTitle ?? current.title)
      : current.title;

    const meetingUpdate = db
      .prepare(
        `UPDATE meetings
         SET title = ?, enhanced_notes = ?,
             analysis_json = ?,
             analysis_schema_version = ?,
             analysis_format_pass = 1,
             analysis_retry_count = ?,
             analysis_fallback_used = 0,
             analysis_provider = ?,
             analysis_model = ?,
             analysis_generation_path = ?,
             analysis_prompt_version = ?,
             analysis_generated_at = ?,
             analysis_error_categories_json = ?,
             user_edits_json = ?,
             analysis_edit_conflicts_json = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        enhancedNotes,
        analysisJson,
        input.analysis.analysis_schema_version,
        input.analysis.quality.retry_count,
        metadata?.provider ?? null,
        metadata?.model ?? null,
        metadata?.generation_path ?? null,
        metadata?.prompt_version ?? null,
        metadata?.generated_at ?? null,
        JSON.stringify(metadata?.error_categories ?? []),
        JSON.stringify(rebased.edits),
        JSON.stringify(mergedConflicts),
        meetingId,
      );
    if (meetingUpdate.changes !== 1) {
      throw new Error('meeting_analysis_publication_update_failed');
    }

    const runUpdate = db
      .prepare(
        `UPDATE meeting_analysis_runs
         SET notes_status = 'published', stage = 'published', queue_position = NULL, updated_at = ?
         WHERE meeting_id = ? AND run_id = ? AND notes_status = 'running'`,
      )
      .run(new Date().toISOString(), meetingId, input.runId);
    if (runUpdate.changes !== 1) {
      throw new Error('meeting_analysis_publication_run_update_failed');
    }

    const updated = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(meetingId) as PersistedMeeting | undefined;
    if (!updated) throw new Error('meeting_analysis_publication_missing');
    refreshMeetingFts(updated);
    return true;
  })();
};

/** Invoke once at application startup, before accepting notes requests. */
export const recoverInterruptedMeetingAnalysisRuns = (): void => {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE meeting_analysis_runs SET notes_status = 'failed', stage = 'interrupted', queue_position = NULL, error_code = 'notes_interrupted', updated_at = ? WHERE notes_status = 'running'`,
    ).run(now);
    db.prepare(
      `UPDATE meeting_analysis_runs SET secondary_status = 'failed', stage = 'secondary_interrupted', error_code = 'secondary_interrupted', updated_at = ? WHERE notes_status = 'published' AND secondary_status IN ('pending', 'running')`,
    ).run(now);
  })();
};

export const isMeetingAnalysisRunCurrent = (input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  notesStatus?: MeetingAnalysisRunStatus;
  requirePublished?: boolean;
}): boolean => {
  const current = getMeeting(input.meetingId) as PersistedMeeting | undefined;
  if (!current) return false;

  const run = getMeetingAnalysisRun(input.meetingId);
  if (
    !run ||
    run.run_id !== input.runId ||
    run.input_revision !== input.inputRevision ||
    run.source_revision !== input.sourceRevision ||
    run.eligibility_revision !== input.eligibilityRevision ||
    run.user_notes_hash !== input.userNotesHash
  ) {
    return false;
  }

  const requirePublished =
    input.requirePublished ?? input.notesStatus === 'published';

  if (requirePublished) {
    return run.notes_status === 'published' && Boolean(current.analysis_json);
  }

  const revisions = getMeetingAnalysisPublicationRevisions(current);
  if (
    !revisions ||
    revisions.sourceRevision !== input.sourceRevision ||
    revisions.eligibilityRevision !== input.eligibilityRevision ||
    revisions.userNotesHash !== input.userNotesHash
  ) {
    return false;
  }

  return true;
};

export const updateMeetingAnalysisRunStatusIfCurrent = (input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  notesStatus: MeetingAnalysisRunStatus;
  secondaryStatus: MeetingAnalysisSecondaryStatus;
  stage: string;
  errorCode?: string | null;
}): boolean => {
  if (
    !isMeetingAnalysisRunCurrent({
      ...input,
      requirePublished: input.notesStatus === 'published',
    })
  ) {
    return false;
  }
  return updateMeetingAnalysisRunStatus(input);
};

export const saveMeetingAnalysisSecondaryFieldsIfCurrent = (input: {
  meetingId: string | number;
  runId: string;
  inputRevision: string;
  sourceRevision: string;
  eligibilityRevision: string;
  userNotesHash: string;
  valueSignalsJson?: string | null;
  midJson?: string | null;
}): boolean =>
  db.transaction(() => {
    if (!isMeetingAnalysisRunCurrent({ ...input, requirePublished: true })) {
      return false;
    }
    const updates: string[] = [];
    const values: Array<string | null> = [];
    if (input.valueSignalsJson !== undefined) {
      updates.push('value_signals_json = ?');
      values.push(input.valueSignalsJson);
    }
    if (input.midJson !== undefined) {
      updates.push('mid_json = ?');
      values.push(input.midJson);
    }
    if (updates.length === 0) return true;
    const result = db
      .prepare(`UPDATE meetings SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values, String(input.meetingId));
    return result.changes === 1;
  })();

export const getAnalysisQualityStats = () => {
  const rows = db
    .prepare(`
    SELECT
      COALESCE(analysis_provider, 'unknown') AS provider,
      COALESCE(analysis_generation_path, 'unknown') AS generation_path,
      COUNT(*) AS total_meetings,
      SUM(CASE WHEN analysis_format_pass = 1 THEN 1 ELSE 0 END) AS format_pass_count,
      SUM(CASE WHEN analysis_retry_count > 0 THEN 1 ELSE 0 END) AS retried_count,
      SUM(CASE WHEN analysis_fallback_used = 1 THEN 1 ELSE 0 END) AS fallback_count
    FROM meetings
    WHERE analysis_schema_version IS NOT NULL
    GROUP BY COALESCE(analysis_provider, 'unknown'), COALESCE(analysis_generation_path, 'unknown')
  `)
    .all() as Array<{
    provider: string | null;
    generation_path: string | null;
    total_meetings: number | null;
    format_pass_count: number | null;
    retried_count: number | null;
    fallback_count: number | null;
  }>;

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_meetings += Number(row.total_meetings || 0);
      acc.format_pass_count += Number(row.format_pass_count || 0);
      acc.retried_count += Number(row.retried_count || 0);
      acc.fallback_count += Number(row.fallback_count || 0);
      return acc;
    },
    {
      total_meetings: 0,
      format_pass_count: 0,
      retried_count: 0,
      fallback_count: 0,
    },
  );

  return {
    total_meetings: totals.total_meetings,
    format_pass_count: totals.format_pass_count,
    format_pass_rate:
      totals.total_meetings > 0
        ? totals.format_pass_count / totals.total_meetings
        : 0,
    retried_count: totals.retried_count,
    fallback_count: totals.fallback_count,
    by_provider_path: rows.map((row) => {
      const total = Number(row.total_meetings || 0);
      const formatPassCount = Number(row.format_pass_count || 0);
      return {
        provider: row.provider || 'unknown',
        generation_path: row.generation_path || 'unknown',
        total_meetings: total,
        format_pass_count: formatPassCount,
        format_pass_rate: total > 0 ? formatPassCount / total : 0,
        retried_count: Number(row.retried_count || 0),
        fallback_count: Number(row.fallback_count || 0),
      };
    }),
  };
};

export const searchMeetings = (query: string) => {
  return db
    .prepare(`
    SELECT meetings.* FROM meetings
    JOIN meetings_fts ON meetings.id = meetings_fts.meeting_id
    WHERE meetings_fts MATCH ?
    ORDER BY rank
  `)
    .all(query);
};

export const deleteMeeting = (id: string | number) => {
  const safeId = String(id);
  const meeting = getMeeting(safeId) as PersistedMeeting | undefined;

  if (!meeting) {
    dbLog.warn(`deleteMeeting: Meeting not found for id: ${safeId}`);
    return;
  }

  if (!canDeleteMeeting(meeting.finalization_status ?? undefined)) {
    throw new Error('Meeting recovery must complete before deletion');
  }

  // 1. Delete audio file if it exists
  if (meeting.audio_path && fs.existsSync(meeting.audio_path)) {
    try {
      fs.unlinkSync(meeting.audio_path);
      dbLog.debug(`Deleted audio file: ${meeting.audio_path}`);
    } catch (e) {
      dbLog.warn(`Failed to delete audio file: ${meeting.audio_path}`, e);
    }
  }

  // 2. Delete from FTS index
  db.prepare('DELETE FROM meetings_fts WHERE meeting_id = ?').run(safeId);
  db.prepare('DELETE FROM meeting_notes_fts WHERE meeting_id = ?').run(safeId);
  db.prepare(
    'DELETE FROM meeting_context_sections_fts WHERE meeting_id = ?',
  ).run(safeId);
  db.prepare('DELETE FROM meeting_context_sections WHERE meeting_id = ?').run(
    safeId,
  );

  // 3. Delete from entity_links (ones specifically created for this meeting)
  db.prepare('DELETE FROM entity_links WHERE meeting_id = ?').run(safeId);

  // Embedded context contains transcript-derived private evidence. Explicit
  // deletion also protects databases created before these tables had FKs.
  db.prepare('DELETE FROM meeting_context_events WHERE meeting_id = ?').run(
    safeId,
  );
  db.prepare('DELETE FROM meeting_context_snapshots WHERE meeting_id = ?').run(
    safeId,
  );

  // 4. Delete the meeting itself
  // meeting_entities will be deleted by CASCADE
  for (const table of [
    'meeting_speaker_candidates',
    'speaker_voice_rejections',
    'identity_captures',
    'identity_resolutions',
    'identity_resolution_history',
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE meeting_id = ?`).run(safeId);
  }
  db.prepare(
    'DELETE FROM speaker_voice_enrollments WHERE source_meeting_id = ?',
  ).run(safeId);
  const result = db.prepare('DELETE FROM meetings WHERE id = ?').run(safeId);

  if (result.changes === 1) {
    db.prepare('DELETE FROM meeting_analysis_runs WHERE meeting_id = ?').run(
      safeId,
    );
    db.prepare(
      'DELETE FROM meeting_analysis_run_history WHERE meeting_id = ?',
    ).run(safeId);
  }

  dbLog.info(`Deleted meeting: ${safeId}`);

  // 5. Clean up orphan entities (optional but requested "knowledge related to the meeting")
  // We delete entities that have no remaining meeting connections AND no remaining links
  try {
    db.prepare(`
      DELETE FROM entities 
      WHERE id NOT IN (SELECT entity_id FROM meeting_entities)
        AND id NOT IN (SELECT source_entity_id FROM entity_links)
        AND id NOT IN (SELECT target_entity_id FROM entity_links)
        AND NOT EXISTS (SELECT 1 FROM identity_workspace w WHERE w.self_person_id = entities.id)
        AND NOT EXISTS (SELECT 1 FROM identity_captures c WHERE c.self_person_id = entities.id)
        AND NOT EXISTS (SELECT 1 FROM identity_bindings b WHERE json_extract(b.payload, '$.personId') = entities.id)
        AND NOT EXISTS (SELECT 1 FROM identity_person_aliases a WHERE a.person_id = entities.id)
        AND NOT EXISTS (SELECT 1 FROM person_aliases a
          WHERE (a.person_id = entities.id OR a.canonical_id = entities.id)
            AND a.active = 1)
        AND NOT EXISTS (SELECT 1 FROM person_name_aliases a
          WHERE a.person_id = entities.id)
    `).run();
  } catch (e) {
    dbLog.warn('Failed to clean up orphan entities:', e);
  }

  // Update entities FTS
  try {
    db.prepare(`
      DELETE FROM entities_fts 
      WHERE entity_id NOT IN (SELECT id FROM entities)
    `).run();
  } catch (e) {
    // Ignore FTS cleanup errors
  }

  return result;
};

// =============================================
// KNOWLEDGE GRAPH OPERATIONS (Sprint 2)
// =============================================

export type EntityType =
  | 'person'
  | 'topic'
  | 'action_item'
  | 'decision'
  | 'project';
export type EntityStatus =
  | 'active'
  | 'completed'
  | 'stale'
  | 'overdue'
  | 'merge_pending'
  | null;
export type RelationshipType =
  | 'discussed'
  | 'assigned_to'
  | 'belongs_to'
  | 'relates_to'
  | 'attended'
  | 'produced'
  | 'impacts'
  | 'works_on'
  | 'involved_in'
  | 'depends_on'
  | 'blocked_by'
  | 'owns';
export type RelationshipState = 'suggested' | 'confirmed' | 'rejected';
export type LinkSource = 'pipeline' | 'synthesis' | 'user';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  normalized_name: string;
  status: EntityStatus;
  due_date: string | null;
  assigned_to: string | null;
  metadata: string | null; // JSON string
  saliency_score: number;
  domain_tag: string;
  created_at: string;
  updated_at: string;
}

export interface BlockedActionItem extends Entity {
  blocker_entity_id: string;
  blocker_name: string;
  blocker_meeting_id: string | null;
  blocker_evidence_quote: string | null;
  blocker_updated_at: string | null;
  blocker_relationship_state: RelationshipState;
}

export interface EntityLink {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id: string | null;
  state: RelationshipState;
  evidence_meeting_id: string | null;
  evidence_quote: string | null;
  source: LinkSource;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface MeetingEntity {
  meeting_id: string;
  entity_id: string;
  mention_count: number;
  first_mentioned_at: number | null;
  context: string | null;
  created_at: string;
}

export type KnowledgeFeedTypeFilter = 'all' | 'topic' | 'decision';
export type KnowledgeFeedSort = 'recent' | 'most_mentioned';

export interface KnowledgeFeedQueryParams {
  type?: KnowledgeFeedTypeFilter;
  search?: string;
  sort?: KnowledgeFeedSort;
}

export interface KnowledgeFeedItemSummary {
  entity_id: string;
  type: 'topic' | 'decision';
  name: string;
  updated_at: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
  latest_context: string | null;
}

export type KnowledgeDocScopeType =
  | 'global'
  | 'project'
  | 'team_tracker'
  | 'person_context';
export type KnowledgeDocStatus =
  | 'synthesizing'
  | 'up_to_date'
  | 'stale'
  | 'failed'
  | 'inactive';

export interface KnowledgeDocConfig {
  member_entity_ids?: string[];
  synthesis_version?: number;
}

export interface KnowledgeDoc {
  id: string;
  scope_type: KnowledgeDocScopeType;
  scope_key: string;
  title: string;
  rendered_content: string | null;
  structured_json: string | null;
  config: string | null; // JSON KnowledgeDocConfig
  status: KnowledgeDocStatus;
  last_synthesized_at: string | null;
  last_source_cursor: string | null;
  updated_at: string;
}

export interface KnowledgeDocSource {
  doc_id: string;
  meeting_id: string;
  contributed_at: string;
}

export interface KnowledgeDocSourceDetail extends KnowledgeDocSource {
  meeting_title: string;
  started_at: string | null;
  created_at: string | null;
  mention_count: number;
  context: string | null;
}

export interface KnowledgeDocVersion {
  doc_id: string;
  version_no: number;
  structured_json: string | null;
  rendered_content: string | null;
  changelog_json: string | null;
  synthesized_at: string;
  source_count: number;
}

export type KnowledgeCorrectionTargetKind =
  | 'source'
  | 'stream'
  | 'item'
  | 'claim';
export type KnowledgeCorrectionAction =
  | 'exclude_source'
  | 'rename_stream'
  | 'merge_stream'
  | 'split_stream'
  | 'pin_stream'
  | 'promote_item'
  | 'demote_item'
  | 'correct_classification'
  | 'correct_claim';

export interface KnowledgeCorrection {
  id: string;
  doc_id: string;
  target_kind: KnowledgeCorrectionTargetKind;
  target_id: string;
  action: KnowledgeCorrectionAction;
  payload_json: string | null;
  created_at: string;
}

export interface KnowledgeDocUserEdit {
  id: string;
  doc_id: string;
  edited_content: string;
  edited_at: string;
  edited_by: string;
}

export interface KnowledgeDocNote {
  doc_id: string;
  markdown: string;
  parsed_links_json: string | null;
  updated_at: string;
}

export interface KnowledgeBacklink {
  id: string;
  source_doc_id: string;
  target_kind: 'entity' | 'doc';
  target_id: string;
  label: string;
  snippet: string | null;
  created_at: string;
}

export interface KnowledgeDocWikiLink {
  label: string;
  target_kind: 'entity' | 'doc' | null;
  target_id: string | null;
  snippet: string;
}

export type WorkingMemorySnapshotScopeType =
  | 'global'
  | 'project'
  | 'person_context'
  | 'team_tracker';

export interface WorkingMemorySnapshotPayload {
  schema_version: 1;
  scope: {
    type: WorkingMemorySnapshotScopeType;
    key: string;
    title: string;
    member_entity_ids?: string[];
  };
  source: {
    knowledge_doc_id: string;
    knowledge_doc_last_synthesized_at: string | null;
    knowledge_doc_last_source_cursor?: string | null;
  };
  current_read: {
    headline: string;
    supporting_bullets: string[];
    freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
    trust_status: TrustStatus;
    trust_message: string;
    source_count: number;
    cited_item_count: number;
    cited_meeting_count: number;
    evidence_quality: {
      mode: 'direct' | 'inferred';
      confidence: number;
      cited_meeting_count: number;
      source_count: number;
      last_reinforced_at: string | null;
      freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
    };
  };
  active_streams: unknown[];
  open_loops: unknown[];
  patterns: unknown[];
  risks_and_unknowns: unknown[];
  evidence_index: unknown[];
  source_quality_summary?: {
    included_count: number;
    excluded_count: number;
    weak_count: number;
    records: unknown[];
  };
  change_summary?: {
    generated_at: string | null;
    added_count: number;
    removed_count: number;
    updated_count: number;
    notable_changes: string[];
  };
}

export interface WorkingMemorySnapshot {
  id: string;
  scope_type: WorkingMemorySnapshotScopeType;
  scope_key: string;
  title: string;
  source_doc_id: string;
  source_doc_last_synthesized_at: string | null;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  trust_status: TrustStatus;
  source_count: number;
  cited_meeting_count: number;
  payload: WorkingMemorySnapshotPayload;
  generated_at: string;
  updated_at: string;
}

const ATTENTION_STATUS_ORDER: Record<AttentionItemStatus, number> = {
  pinned: 0,
  active: 1,
  snoozed: 2,
  stale: 3,
  dismissed: 4,
  resolved: 5,
  superseded: 6,
};

const parseAttentionJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
};

const serializeAttentionStringArray = (values: string[]): string =>
  JSON.stringify(
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(),
  );

const parseAttentionEvidence = (
  value: string | null,
): AttentionEvidenceReference[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const meetingId =
        typeof entry.meeting_id === 'string' ? entry.meeting_id : '';
      const quote = typeof entry.quote === 'string' ? entry.quote : '';
      if (!meetingId || !quote) return [];
      return [
        {
          meeting_id: meetingId,
          quote,
          entity_id:
            typeof entry.entity_id === 'string' ? entry.entity_id : null,
          source_kind:
            typeof entry.source_kind === 'string' ? entry.source_kind : null,
        },
      ];
    });
  } catch {
    return [];
  }
};

const serializeAttentionEvidence = (
  evidence: AttentionEvidenceReference[],
): string =>
  JSON.stringify(
    evidence
      .filter((entry) => entry.meeting_id && entry.quote)
      .map((entry) => ({
        meeting_id: entry.meeting_id,
        quote: entry.quote,
        entity_id: entry.entity_id ?? null,
        source_kind: entry.source_kind ?? null,
      })),
  );

const parseAttentionScoreBreakdown = (
  value: string | null,
): AttentionScoreBreakdown | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const keys = [
      'urgency',
      'recency',
      'repetition',
      'commitment',
      'blocker',
      'project_relevance',
      'evidence',
      'feedback',
      'stale_penalty',
      'weak_evidence_penalty',
      'total',
    ] as const;
    if (
      keys.every(
        (key) =>
          typeof parsed[key] === 'number' && Number.isFinite(parsed[key]),
      )
    ) {
      return parsed as unknown as AttentionScoreBreakdown;
    }
  } catch {
    return null;
  }
  return null;
};

const serializeAttentionScoreBreakdown = (
  scoreBreakdown?: AttentionScoreBreakdown | null,
): string | null => {
  if (!scoreBreakdown) return null;
  return JSON.stringify(scoreBreakdown);
};

const parseWorkingMemoryPayload = (
  value: string,
): WorkingMemorySnapshotPayload => {
  try {
    return JSON.parse(value) as WorkingMemorySnapshotPayload;
  } catch {
    throw new Error('Invalid working-memory snapshot payload');
  }
};

const mapAttentionItemRow = (row: AttentionItemRow): AttentionItem => ({
  id: row.id,
  dedupe_key: row.dedupe_key,
  kind: row.kind as AttentionItem['kind'],
  severity: row.severity as AttentionItem['severity'],
  score: typeof row.score === 'number' ? row.score : Number(row.score || 0),
  status: row.status as AttentionItem['status'],
  title: row.title,
  reason: row.reason,
  source: row.source as AttentionItem['source'],
  score_breakdown: parseAttentionScoreBreakdown(row.score_breakdown_json),
  evidence: parseAttentionEvidence(row.evidence_json),
  related_entity_ids: parseAttentionJsonArray(row.related_entity_ids_json),
  related_stream_ids: parseAttentionJsonArray(row.related_stream_ids_json),
  related_meeting_ids: parseAttentionJsonArray(row.related_meeting_ids_json),
  created_at: row.created_at,
  updated_at: row.updated_at,
  last_seen_at: row.last_seen_at,
  resolved_at: row.resolved_at,
});

const mapWorkingMemorySnapshotRow = (
  row: WorkingMemorySnapshotRow,
): WorkingMemorySnapshot => ({
  id: row.id,
  scope_type: row.scope_type as WorkingMemorySnapshotScopeType,
  scope_key: row.scope_key,
  title: row.title,
  source_doc_id: row.source_doc_id,
  source_doc_last_synthesized_at: row.source_doc_last_synthesized_at,
  freshness: row.freshness as WorkingMemorySnapshot['freshness'],
  trust_status: row.trust_status as TrustStatus,
  source_count: Number(row.source_count || 0),
  cited_meeting_count: Number(row.cited_meeting_count || 0),
  payload: parseWorkingMemoryPayload(row.payload_json),
  generated_at: row.generated_at,
  updated_at: row.updated_at,
});

const parseMeetingContextJson = <T>(value: string, label: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid meeting context ${label}`);
  }
};

const mapMeetingContextEventRow = (
  row: MeetingContextEventRow,
): MeetingContextEvent => ({
  id: row.id,
  meetingId: row.meeting_id,
  eventKey: row.event_key,
  kind: row.kind as MeetingContextEvent['kind'],
  summary: row.summary,
  evidence: parseMeetingContextJson<MeetingContextEvidenceReference[]>(
    row.evidence_json,
    'event evidence',
  ),
  attributes: row.attributes_json
    ? parseMeetingContextJson<Record<string, MeetingContextAttributeValue>>(
        row.attributes_json,
        'event attributes',
      )
    : {},
  supersedesEventId: row.supersedes_event_id,
  observedAtMs: Number(row.observed_at_ms),
  createdAt: row.created_at,
});

const mapMeetingContextSnapshotRow = (
  row: MeetingContextSnapshotRow,
): MeetingContextSnapshot => ({
  id: row.id,
  meetingId: row.meeting_id,
  revision: Number(row.revision),
  state: parseMeetingContextJson<MeetingContextRollingStateV1>(
    row.state_json,
    'snapshot state',
  ),
  lastSegmentId: row.last_segment_id,
  lastSegmentTimestampMs:
    row.last_segment_timestamp_ms === null
      ? null
      : Number(row.last_segment_timestamp_ms),
  generatedAt: row.generated_at,
  createdAt: row.created_at,
});

export interface KnowledgeGraphNode {
  id: string;
  type: EntityType;
  label: string;
  status: EntityStatus;
  mention_count: number;
  metadata: string | null;
}

export interface KnowledgeGraphEdge extends EntityLink {
  source_label: string;
  target_label: string;
}

export interface KnowledgeTimelineItem {
  id: string;
  kind: 'synthesis' | 'dependency' | 'notes';
  title: string;
  detail: string;
  timestamp: string;
  doc_id: string;
}

export interface KnowledgeProjectHealthCard {
  doc_id: string;
  project_id: string;
  title: string;
  open_blockers: number;
  dependency_count: number;
  recent_changes: number;
  staleness_days: number;
}

export interface KnowledgeWorkspacePayload {
  docs: KnowledgeDoc[];
  selected_doc: KnowledgeDoc | null;
  notes: KnowledgeDocNote | null;
  graph: {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
  };
  timeline: KnowledgeTimelineItem[];
  backlinks: KnowledgeBacklink[];
  project_cards: KnowledgeProjectHealthCard[];
}

export interface KnowledgeDocProjectCandidate {
  project_id: string;
  project_name: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
}

export interface KnowledgeDocSourceMeeting extends PersistedMeeting {
  mention_count: number;
  context: string | null;
}

/**
 * Normalize entity name for deduplication
 */
const normalizeEntityName = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
};

const extractWikiLinks = (
  markdown: string,
): Array<{ label: string; snippet: string }> => {
  if (!markdown.trim()) return [];
  const matches = Array.from(markdown.matchAll(/\[\[([^\]]+)\]\]/g));
  const links: Array<{ label: string; snippet: string }> = [];

  for (const match of matches) {
    const label = (match[1] || '').trim();
    if (!label) continue;
    const start = Math.max(0, (match.index || 0) - 28);
    const end = Math.min(
      markdown.length,
      (match.index || 0) + match[0].length + 28,
    );
    const snippet = markdown.slice(start, end).replace(/\s+/g, ' ').trim();
    links.push({ label, snippet });
  }

  return links;
};

const findEntityAnyTypeByName = (name: string): Entity | undefined => {
  const normalized = normalizeEntityName(name);
  if (!normalized) return undefined;

  return db
    .prepare(
      `
        SELECT *
        FROM entities
        WHERE normalized_name = ?
        ORDER BY
          CASE type
            WHEN 'project' THEN 0
            WHEN 'action_item' THEN 1
            WHEN 'topic' THEN 2
            WHEN 'decision' THEN 3
            WHEN 'person' THEN 4
            ELSE 5
          END,
          updated_at DESC
        LIMIT 1
      `,
    )
    .get(normalized) as Entity | undefined;
};

/**
 * Generate a simple UUID
 */
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get a knowledge doc by id.
 */
export const getKnowledgeDoc = (id: string): KnowledgeDoc | undefined => {
  return db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as
    | KnowledgeDoc
    | undefined;
};

/**
 * Get a knowledge doc by scope tuple.
 */
export const getKnowledgeDocByScope = (
  scopeType: KnowledgeDocScopeType,
  scopeKey: string,
): KnowledgeDoc | undefined => {
  return db
    .prepare(
      'SELECT * FROM knowledge_docs WHERE scope_type = ? AND scope_key = ?',
    )
    .get(scopeType, scopeKey) as KnowledgeDoc | undefined;
};

/**
 * Create or update a knowledge doc.
 */
export const upsertKnowledgeDoc = (doc: {
  id?: string;
  scope_type: KnowledgeDocScopeType;
  scope_key: string;
  title: string;
  rendered_content?: string | null;
  structured_json?: string | null;
  config?: KnowledgeDocConfig | null;
  status?: KnowledgeDocStatus;
  last_synthesized_at?: string | null;
  last_source_cursor?: string | null;
}): KnowledgeDoc => {
  const existing =
    (doc.id ? getKnowledgeDoc(doc.id) : undefined) ||
    getKnowledgeDocByScope(doc.scope_type, doc.scope_key);

  if (existing) {
    db.prepare(`
      UPDATE knowledge_docs
      SET
        scope_type = ?,
        scope_key = ?,
        title = ?,
        rendered_content = ?,
        structured_json = ?,
        config = ?,
        status = ?,
        last_synthesized_at = ?,
        last_source_cursor = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      doc.scope_type,
      doc.scope_key,
      doc.title || existing.title,
      doc.rendered_content === undefined
        ? existing.rendered_content
        : doc.rendered_content,
      doc.structured_json === undefined
        ? existing.structured_json
        : doc.structured_json,
      doc.config === undefined
        ? existing.config
        : doc.config
          ? JSON.stringify(doc.config)
          : existing.config,
      doc.status || existing.status,
      doc.last_synthesized_at === undefined
        ? existing.last_synthesized_at
        : doc.last_synthesized_at,
      doc.last_source_cursor === undefined
        ? existing.last_source_cursor
        : doc.last_source_cursor,
      existing.id,
    );
    return getKnowledgeDoc(existing.id) as KnowledgeDoc;
  }

  const id = doc.id || generateId();
  db.prepare(`
    INSERT INTO knowledge_docs (
      id,
      scope_type,
      scope_key,
      title,
      rendered_content,
      structured_json,
      config,
      status,
      last_synthesized_at,
      last_source_cursor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    doc.scope_type,
    doc.scope_key,
    doc.title,
    doc.rendered_content ?? null,
    doc.structured_json ?? null,
    doc.config ? JSON.stringify(doc.config) : null,
    doc.status || 'stale',
    doc.last_synthesized_at ?? null,
    doc.last_source_cursor ?? null,
  );

  return getKnowledgeDoc(id) as KnowledgeDoc;
};

/**
 * List knowledge docs with optional filters.
 */
export const getKnowledgeDocs = (filters?: {
  includeInactive?: boolean;
  scopeType?: KnowledgeDocScopeType | 'all';
}): KnowledgeDoc[] => {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!filters?.includeInactive) {
    conditions.push(`status != 'inactive'`);
  }

  if (filters?.scopeType && filters.scopeType !== 'all') {
    conditions.push('scope_type = ?');
    values.push(filters.scopeType);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return db
    .prepare(`
      SELECT * FROM knowledge_docs
      ${whereClause}
      ORDER BY
        CASE scope_type
          WHEN 'global' THEN 0
          WHEN 'team_tracker' THEN 1
          WHEN 'project' THEN 2
          WHEN 'person_context' THEN 3
          ELSE 4
        END,
        updated_at DESC
    `)
    .all(...values) as KnowledgeDoc[];
};

/**
 * Ensure the canonical global knowledge doc exists.
 */
export const ensureGlobalKnowledgeDoc = (): KnowledgeDoc => {
  const existing = getKnowledgeDocByScope('global', 'global');
  if (existing) return existing;
  return upsertKnowledgeDoc({
    scope_type: 'global',
    scope_key: 'global',
    title: 'Global Knowledge Context',
    status: 'stale',
  });
};

/**
 * Get project candidates eligible for project-scoped knowledge docs.
 */
export const getKnowledgeDocProjectCandidates = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
}): KnowledgeDocProjectCandidate[] => {
  const activeDays = options?.activeDays ?? 30;
  const minMeetings = options?.minMeetings ?? 2;
  const minMentions = options?.minMentions ?? 3;

  return db
    .prepare(`
      SELECT
        canonical.id AS project_id,
        canonical.name AS project_name,
        COUNT(DISTINCT me.meeting_id) AS meeting_count,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at
      FROM entities e
      LEFT JOIN project_aliases pa
        ON pa.project_id = e.id AND pa.active = 1
      JOIN entities canonical
        ON canonical.id = COALESCE(pa.canonical_id, e.id)
      JOIN meeting_entities me ON me.entity_id = e.id
      LEFT JOIN meetings m ON m.id = me.meeting_id
      WHERE e.type = 'project'
        AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
      GROUP BY canonical.id, canonical.name
      HAVING COUNT(DISTINCT me.meeting_id) >= ?
        AND COALESCE(SUM(me.mention_count), 0) >= ?
      ORDER BY mention_count DESC, last_mentioned_at DESC
    `)
    .all(
      activeDays,
      minMeetings,
      minMentions,
    ) as KnowledgeDocProjectCandidate[];
};

/**
 * Sync project docs to active/inactive lifecycle.
 */
export const syncKnowledgeProjectLifecycle = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
  inactiveDays?: number;
}): {
  activeDocIds: string[];
  createdDocIds: string[];
  inactivatedDocIds: string[];
} => {
  const candidates = getKnowledgeDocProjectCandidates(options);
  const activeProjectIds = new Set(
    candidates.map((candidate) => candidate.project_id),
  );
  const activeDocIds: string[] = [];
  const createdDocIds: string[] = [];

  for (const candidate of candidates) {
    const existing = getKnowledgeDocByScope('project', candidate.project_id);
    const saved = upsertKnowledgeDoc({
      id: existing?.id,
      scope_type: 'project',
      scope_key: candidate.project_id,
      title: `${candidate.project_name} Context`,
      status: 'stale',
    });
    activeDocIds.push(saved.id);
    if (!existing) createdDocIds.push(saved.id);
  }

  const projectDocs = db
    .prepare(
      "SELECT * FROM knowledge_docs WHERE scope_type = 'project' ORDER BY updated_at DESC",
    )
    .all() as KnowledgeDoc[];
  const inactiveDocIds: string[] = [];
  const inactiveDays = options?.inactiveDays ?? 45;

  for (const doc of projectDocs) {
    if (activeProjectIds.has(doc.scope_key)) continue;
    const hasRecentMention = (
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM meeting_entities me
          LEFT JOIN meetings m ON m.id = me.meeting_id
          WHERE me.entity_id = ?
            AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
        `)
        .get(doc.scope_key, inactiveDays) as { count: number }
    ).count;
    if (hasRecentMention > 0) continue;

    const updated = upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'project',
      scope_key: doc.scope_key,
      title: doc.title,
      status: 'inactive',
    });
    inactiveDocIds.push(updated.id);
  }

  return {
    activeDocIds,
    createdDocIds,
    inactivatedDocIds: inactiveDocIds,
  };
};

/**
 * Get project entity ids mentioned in a specific meeting.
 */
export const getProjectEntityIdsForMeeting = (meetingId: string): string[] => {
  const rows = db
    .prepare(`
      SELECT DISTINCT e.id
      FROM entities e
      JOIN meeting_entities me ON me.entity_id = e.id
      WHERE me.meeting_id = ? AND e.type = 'project'
    `)
    .all(meetingId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

/**
 * Get person entity ids mentioned in a specific meeting.
 */
export const getPersonEntityIdsForMeeting = (meetingId: string): string[] => {
  const rows = db
    .prepare(`
      WITH person_identity AS (
        SELECT person.id AS source_id,
          COALESCE(alias.canonical_id, person.id) AS canonical_id
        FROM entities person
        LEFT JOIN person_aliases alias
          ON alias.person_id = person.id AND alias.active = 1
        WHERE person.type = 'person'
      )
      SELECT DISTINCT identity.canonical_id AS id
      FROM person_identity identity
      JOIN meeting_entities me ON me.entity_id = identity.source_id
      WHERE me.meeting_id = ?
      UNION
      SELECT DISTINCT identity.canonical_id AS id
      FROM identity_bindings binding
      JOIN person_identity identity
        ON identity.source_id = json_extract(binding.payload, '$.personId')
      WHERE binding.meeting_id = ?
        AND json_valid(binding.payload)
        AND json_extract(binding.payload, '$.individual') = 1
        AND json_type(binding.payload, '$.personId') = 'text'
      ORDER BY id
    `)
    .all(meetingId, meetingId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

export interface KnowledgeDocPersonCandidate {
  person_id: string;
  person_name: string;
  meeting_count: number;
  mention_count: number;
  last_mentioned_at: string | null;
}

export interface TranscriptionPersonCandidate {
  name: string;
  saliencyScore: number;
  meetingCount: number;
  mentionCount: number;
  lastMentionedAt: string | null;
}

export const getTranscriptionPersonCandidates =
  (): TranscriptionPersonCandidate[] => {
    const rows = db
      .prepare(`
      WITH person_identity AS (
        SELECT e.id AS source_id,
          COALESCE(alias.canonical_id, e.id) AS canonical_id
        FROM entities e LEFT JOIN person_aliases alias
          ON alias.person_id = e.id AND alias.active = 1
        WHERE e.type = 'person'
      )
      SELECT
        canonical.name,
        COALESCE(canonical.saliency_score, 0) AS saliency_score,
        COUNT(DISTINCT me.meeting_id) AS meeting_count,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(COALESCE(m.started_at, m.created_at, me.created_at,
          canonical.updated_at)) AS last_mentioned_at
      FROM person_identity identity
      JOIN entities canonical ON canonical.id = identity.canonical_id
      JOIN meeting_entities me ON me.entity_id = identity.source_id
      JOIN meetings m ON m.id = me.meeting_id
      GROUP BY canonical.id, canonical.name, canonical.saliency_score
    `)
      .all() as Array<{
      name: string;
      saliency_score: number;
      meeting_count: number;
      mention_count: number;
      last_mentioned_at: string | null;
    }>;

    return rows
      .filter((row) => isUsablePersonName(row.name))
      .map((row) => ({
        name: row.name,
        saliencyScore: row.saliency_score,
        meetingCount: row.meeting_count,
        mentionCount: row.mention_count,
        lastMentionedAt: row.last_mentioned_at,
      }));
  };

/**
 * Get person entities eligible for person_context knowledge docs.
 */
export const getKnowledgeDocPersonCandidates = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
}): KnowledgeDocPersonCandidate[] => {
  const activeDays = options?.activeDays ?? 60;
  const minMeetings = options?.minMeetings ?? 2;
  const minMentions = options?.minMentions ?? 3;

  return db
    .prepare(`
      WITH person_identity AS (
        SELECT e.id AS source_id,
          COALESCE(alias.canonical_id, e.id) AS canonical_id
        FROM entities e LEFT JOIN person_aliases alias
          ON alias.person_id = e.id AND alias.active = 1
        WHERE e.type = 'person'
      )
      SELECT
        canonical.id AS person_id,
        canonical.name AS person_name,
        COUNT(DISTINCT me.meeting_id) AS meeting_count,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at
      FROM person_identity identity
      JOIN entities canonical ON canonical.id = identity.canonical_id
      JOIN meeting_entities me ON me.entity_id = identity.source_id
      LEFT JOIN meetings m ON m.id = me.meeting_id
      WHERE COALESCE(m.started_at, m.created_at, me.created_at) >=
        datetime('now', '-' || ? || ' days')
      GROUP BY canonical.id, canonical.name
      HAVING COUNT(DISTINCT me.meeting_id) >= ?
        AND COALESCE(SUM(me.mention_count), 0) >= ?
      ORDER BY meeting_count DESC, mention_count DESC
    `)
    .all(activeDays, minMeetings, minMentions) as KnowledgeDocPersonCandidate[];
};

/**
 * Sync person_context docs: auto-create for active people, deactivate stale ones.
 */
export const syncKnowledgePersonLifecycle = (options?: {
  activeDays?: number;
  minMeetings?: number;
  minMentions?: number;
  inactiveDays?: number;
}): {
  activeDocIds: string[];
  createdDocIds: string[];
  inactivatedDocIds: string[];
} => {
  const candidates = getKnowledgeDocPersonCandidates(options);
  const activePersonIds = new Set(candidates.map((c) => c.person_id));
  const activeDocIds: string[] = [];
  const createdDocIds: string[] = [];

  for (const candidate of candidates) {
    const existing = getKnowledgeDocByScope(
      'person_context',
      candidate.person_id,
    );
    const saved = upsertKnowledgeDoc({
      id: existing?.id,
      scope_type: 'person_context',
      scope_key: candidate.person_id,
      title: `Conversations with ${candidate.person_name}`,
      status: 'stale',
    });
    activeDocIds.push(saved.id);
    if (!existing) createdDocIds.push(saved.id);
  }

  const personDocs = db
    .prepare(
      "SELECT * FROM knowledge_docs WHERE scope_type = 'person_context' ORDER BY updated_at DESC",
    )
    .all() as KnowledgeDoc[];
  const inactiveDocIds: string[] = [];
  const inactiveDays = options?.inactiveDays ?? 90;

  for (const doc of personDocs) {
    if (activePersonIds.has(doc.scope_key)) continue;
    const hasRecentMention = (
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM meeting_entities me
          LEFT JOIN meetings m ON m.id = me.meeting_id
          WHERE me.entity_id = ?
            AND COALESCE(m.started_at, m.created_at, me.created_at) >= datetime('now', '-' || ? || ' days')
        `)
        .get(doc.scope_key, inactiveDays) as { count: number }
    ).count;
    if (hasRecentMention > 0) continue;

    upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'person_context',
      scope_key: doc.scope_key,
      title: doc.title,
      status: 'inactive',
    });
    inactiveDocIds.push(doc.id);
  }

  return { activeDocIds, createdDocIds, inactivatedDocIds: inactiveDocIds };
};

/**
 * Create a team tracker doc with a set of member person entity IDs.
 */
export const createTeamTrackerDoc = (params: {
  title: string;
  memberEntityIds: string[];
}): KnowledgeDoc => {
  const scopeKey = `team-${generateId()}`;
  return upsertKnowledgeDoc({
    scope_type: 'team_tracker',
    scope_key: scopeKey,
    title: params.title,
    config: { member_entity_ids: params.memberEntityIds },
    status: 'stale',
  });
};

/**
 * Update an existing team tracker's members.
 */
export const updateTeamTrackerMembers = (
  docId: string,
  memberEntityIds: string[],
): KnowledgeDoc | undefined => {
  const doc = getKnowledgeDoc(docId);
  if (!doc || doc.scope_type !== 'team_tracker') return undefined;
  return upsertKnowledgeDoc({
    id: doc.id,
    scope_type: 'team_tracker',
    scope_key: doc.scope_key,
    title: doc.title,
    config: { member_entity_ids: memberEntityIds },
    status: 'stale',
  });
};

/**
 * Get team tracker docs that include a specific person entity.
 */
export const getTeamTrackerDocsForPerson = (
  personEntityId: string,
): KnowledgeDoc[] => {
  const docs = getKnowledgeDocs({
    includeInactive: false,
    scopeType: 'team_tracker',
  });
  return docs.filter((doc) => {
    const config = parseDocConfig(doc.config);
    return config.member_entity_ids?.includes(personEntityId);
  });
};

/**
 * Get source meetings used for synthesizing a given knowledge doc.
 */
const MEETING_QUALITY_FILTER = `(
  COALESCE(m.duration_seconds, 0) >= 120
  AND lower(trim(m.title)) NOT IN (
    'meeting',
    'new meeting',
    'meeting (mic only)',
    'recovered recording',
    'untitled meeting',
    'untitled session'
  )
  AND lower(trim(m.title)) NOT IN (
    'test',
    'testing',
    'test meeting',
    'audio test',
    'mic test',
    'microphone test',
    'transcription test',
    'recording test'
  )
  AND (
    (
      length(COALESCE(m.analysis_json, '')) >= 900
      AND length(COALESCE(m.enhanced_notes, '')) >= 700
    )
    OR length(COALESCE(m.enhanced_notes, '')) >= 1000
    OR length(COALESCE(m.user_notes, '')) >= 120
    OR (
      SELECT COUNT(*)
      FROM meeting_entities me_quality
      WHERE me_quality.meeting_id = m.id
    ) >= 3
    OR (
      SELECT COALESCE(SUM(me_quality.mention_count), 0)
      FROM meeting_entities me_quality
      WHERE me_quality.meeting_id = m.id
    ) >= 3
  )
)`;

const MEETING_SOURCE_ORDER = `
  m.analysis_format_pass DESC,
  length(COALESCE(m.enhanced_notes, '')) DESC,
  COALESCE(SUM(me.mention_count), 0) DESC,
  COALESCE(m.started_at, m.created_at) DESC
`;

const parseDocConfig = (raw: string | null): KnowledgeDocConfig => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as KnowledgeDocConfig;
  } catch {
    return {};
  }
};

export const getKnowledgeDocSourceMeetings = (
  docId: string,
  limit = 80,
): KnowledgeDocSourceMeeting[] => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return [];

  if (doc.scope_type === 'global') {
    return db
      .prepare(`
        SELECT
          m.*,
          COALESCE(SUM(me.mention_count), 0) AS mention_count,
          MAX(me.context) AS context
        FROM meetings m
        LEFT JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE ${MEETING_QUALITY_FILTER}
        GROUP BY m.id
        ORDER BY ${MEETING_SOURCE_ORDER}
        LIMIT ?
      `)
      .all(limit) as KnowledgeDocSourceMeeting[];
  }

  if (doc.scope_type === 'team_tracker') {
    const config = parseDocConfig(doc.config);
    const memberIds = config.member_entity_ids || [];
    if (memberIds.length === 0) return [];

    const placeholders = memberIds.map(() => '?').join(', ');
    return db
      .prepare(`
        SELECT
          m.*,
          COALESCE(SUM(me.mention_count), 0) AS mention_count,
          MAX(me.context) AS context
        FROM meetings m
        JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE me.entity_id IN (${placeholders})
          AND ${MEETING_QUALITY_FILTER}
        GROUP BY m.id
        HAVING COUNT(DISTINCT me.entity_id) >= 1
        ORDER BY ${MEETING_SOURCE_ORDER}
        LIMIT ?
      `)
      .all(...memberIds, limit) as KnowledgeDocSourceMeeting[];
  }

  if (doc.scope_type === 'project') {
    return db
      .prepare(`
        WITH family(id) AS (
          SELECT ? UNION SELECT project_id FROM project_aliases
          WHERE canonical_id = ? AND active = 1
        )
        SELECT
          m.*,
          COALESCE(SUM(me.mention_count), 0) AS mention_count,
          MAX(me.context) AS context
        FROM meetings m
        JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE me.entity_id IN (SELECT id FROM family)
          AND ${MEETING_QUALITY_FILTER}
        GROUP BY m.id
        ORDER BY ${MEETING_SOURCE_ORDER}
        LIMIT ?
      `)
      .all(doc.scope_key, doc.scope_key, limit) as KnowledgeDocSourceMeeting[];
  }

  // person_context uses scope_key = entity id.
  return db
    .prepare(`
      SELECT
        m.*,
        COALESCE(SUM(me.mention_count), 0) AS mention_count,
        MAX(me.context) AS context
      FROM meetings m
      JOIN meeting_entities me ON me.meeting_id = m.id
      WHERE me.entity_id = ?
        AND ${MEETING_QUALITY_FILTER}
      GROUP BY m.id
      ORDER BY ${MEETING_SOURCE_ORDER}
      LIMIT ?
    `)
    .all(doc.scope_key, limit) as KnowledgeDocSourceMeeting[];
};

/**
 * Replace source meeting links for a knowledge doc.
 */
export const replaceKnowledgeDocSources = (
  docId: string,
  meetingIds: string[],
): void => {
  const uniqueMeetingIds = Array.from(new Set(meetingIds.map(String)));
  const tx = db.transaction((targetDocId: string, ids: string[]) => {
    db.prepare('DELETE FROM knowledge_doc_sources WHERE doc_id = ?').run(
      targetDocId,
    );
    const insert = db.prepare(`
      INSERT OR IGNORE INTO knowledge_doc_sources (doc_id, meeting_id)
      VALUES (?, ?)
    `);
    for (const meetingId of ids) {
      insert.run(targetDocId, meetingId);
    }
  });
  tx(docId, uniqueMeetingIds);
};

/**
 * Get source links for a knowledge doc.
 */
export const getKnowledgeDocSources = (docId: string): KnowledgeDocSource[] => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_sources
      WHERE doc_id = ?
      ORDER BY contributed_at DESC
    `)
    .all(docId) as KnowledgeDocSource[];
};

/**
 * Get source links with meeting metadata for rendering evidence context.
 */
export const getKnowledgeDocSourceDetails = (
  docId: string,
  limit = 50,
): KnowledgeDocSourceDetail[] => {
  return db
    .prepare(`
      SELECT
        kds.doc_id,
        kds.meeting_id,
        kds.contributed_at,
        COALESCE(m.title, 'Untitled Session') AS meeting_title,
        m.started_at,
        m.created_at,
        CASE
          WHEN kd.scope_type IN ('project', 'person_context')
            THEN COALESCE((
              SELECT SUM(me.mention_count)
              FROM meeting_entities me
              WHERE me.meeting_id = kds.meeting_id AND me.entity_id = kd.scope_key
            ), 0)
          ELSE COALESCE((
            SELECT SUM(me.mention_count)
            FROM meeting_entities me
            WHERE me.meeting_id = kds.meeting_id
          ), 0)
        END AS mention_count,
        CASE
          WHEN kd.scope_type IN ('project', 'person_context')
            THEN (
              SELECT MAX(me.context)
              FROM meeting_entities me
              WHERE me.meeting_id = kds.meeting_id AND me.entity_id = kd.scope_key
            )
          ELSE NULL
        END AS context
      FROM knowledge_doc_sources kds
      JOIN knowledge_docs kd ON kd.id = kds.doc_id
      LEFT JOIN meetings m ON m.id = kds.meeting_id
      WHERE kds.doc_id = ?
      ORDER BY COALESCE(m.started_at, m.created_at, kds.contributed_at) DESC
      LIMIT ?
    `)
    .all(docId, limit) as KnowledgeDocSourceDetail[];
};

/**
 * Save a synthesized knowledge-doc version.
 */
export const saveKnowledgeDocVersion = (input: {
  doc_id: string;
  structured_json: string | null;
  rendered_content: string | null;
  changelog_json: string | null;
  source_count: number;
  synthesized_at?: string;
}): KnowledgeDocVersion => {
  const nextVersion = (
    db
      .prepare(
        'SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM knowledge_doc_versions WHERE doc_id = ?',
      )
      .get(input.doc_id) as { next_version: number }
  ).next_version;

  db.prepare(`
    INSERT INTO knowledge_doc_versions (
      doc_id,
      version_no,
      structured_json,
      rendered_content,
      changelog_json,
      synthesized_at,
      source_count
    ) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
  `).run(
    input.doc_id,
    nextVersion,
    input.structured_json,
    input.rendered_content,
    input.changelog_json,
    input.synthesized_at ?? null,
    input.source_count,
  );

  return db
    .prepare(
      'SELECT * FROM knowledge_doc_versions WHERE doc_id = ? AND version_no = ?',
    )
    .get(input.doc_id, nextVersion) as KnowledgeDocVersion;
};

/**
 * Get synthesized version history for a knowledge doc.
 */
export const getKnowledgeDocVersions = (
  docId: string,
  limit = 10,
): KnowledgeDocVersion[] => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_versions
      WHERE doc_id = ?
      ORDER BY version_no DESC
      LIMIT ?
    `)
    .all(docId, limit) as KnowledgeDocVersion[];
};

export const getKnowledgeCorrections = (
  docId: string,
): KnowledgeCorrection[] => {
  return db
    .prepare(
      `
        SELECT *
        FROM knowledge_corrections
        WHERE doc_id = ?
        ORDER BY created_at DESC
      `,
    )
    .all(docId) as KnowledgeCorrection[];
};

export const saveKnowledgeCorrection = (input: {
  doc_id: string;
  target_kind: KnowledgeCorrectionTargetKind;
  target_id: string;
  action: KnowledgeCorrectionAction;
  payload?: Record<string, unknown> | null;
}): KnowledgeCorrection => {
  const id = generateId();
  db.prepare(
    `
      INSERT INTO knowledge_corrections (
        id, doc_id, target_kind, target_id, action, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.doc_id,
    input.target_kind,
    input.target_id,
    input.action,
    input.payload ? JSON.stringify(input.payload) : null,
  );

  const doc = getKnowledgeDoc(input.doc_id);
  if (doc) {
    upsertKnowledgeDoc({
      id: doc.id,
      scope_type: doc.scope_type,
      scope_key: doc.scope_key,
      title: doc.title,
      status: doc.status === 'inactive' ? 'inactive' : 'stale',
    });
  }

  return db
    .prepare('SELECT * FROM knowledge_corrections WHERE id = ?')
    .get(id) as KnowledgeCorrection;
};

/**
 * Save a user edit snapshot for a knowledge doc.
 */
export const saveKnowledgeDocUserEdit = (
  docId: string,
  content: string,
  editedBy = 'local-user',
): KnowledgeDocUserEdit => {
  const id = generateId();
  db.prepare(`
    INSERT INTO knowledge_doc_user_edits (id, doc_id, edited_content, edited_by)
    VALUES (?, ?, ?, ?)
  `).run(id, docId, content, editedBy);

  // Dual-layer behavior: preserve synthesized content as authoritative and store user-authored notes separately.
  saveKnowledgeDocNotes(docId, content);

  return db
    .prepare('SELECT * FROM knowledge_doc_user_edits WHERE id = ?')
    .get(id) as KnowledgeDocUserEdit;
};

/**
 * Get the latest saved user edit for a knowledge doc.
 */
export const getLatestKnowledgeDocUserEdit = (
  docId: string,
): KnowledgeDocUserEdit | undefined => {
  return db
    .prepare(`
      SELECT * FROM knowledge_doc_user_edits
      WHERE doc_id = ?
      ORDER BY edited_at DESC
      LIMIT 1
    `)
    .get(docId) as KnowledgeDocUserEdit | undefined;
};

const resolveWikiLinkTarget = (
  label: string,
): Pick<KnowledgeDocWikiLink, 'target_kind' | 'target_id'> => {
  const entity = findEntityAnyTypeByName(label);
  if (entity) {
    return { target_kind: 'entity', target_id: entity.id };
  }

  const normalized = normalizeEntityName(label);
  if (!normalized) {
    return { target_kind: null, target_id: null };
  }

  const matchingDoc = db
    .prepare(
      `
        SELECT id
        FROM knowledge_docs
        WHERE LOWER(TRIM(title)) = ?
           OR LOWER(TRIM(scope_key)) = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    )
    .get(normalized, normalized) as { id: string } | undefined;

  if (!matchingDoc) {
    return { target_kind: null, target_id: null };
  }

  return { target_kind: 'doc', target_id: matchingDoc.id };
};

const parseKnowledgeDocWikiLinks = (
  markdown: string,
): KnowledgeDocWikiLink[] => {
  return extractWikiLinks(markdown).map((link) => {
    const target = resolveWikiLinkTarget(link.label);
    return {
      label: link.label,
      target_kind: target.target_kind,
      target_id: target.target_id,
      snippet: link.snippet,
    };
  });
};

export const getKnowledgeDocNotes = (
  docId: string,
): KnowledgeDocNote | undefined => {
  const existing = db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote | undefined;
  if (existing) return existing;

  const latestEdit = getLatestKnowledgeDocUserEdit(docId);
  if (!latestEdit) return undefined;

  const parsedLinks = parseKnowledgeDocWikiLinks(latestEdit.edited_content);
  db.prepare(`
    INSERT OR REPLACE INTO knowledge_doc_notes (doc_id, markdown, parsed_links_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(docId, latestEdit.edited_content, JSON.stringify(parsedLinks));

  return db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote;
};

export const getKnowledgeBacklinks = (
  docId: string,
  options?: {
    target_kind?: 'entity' | 'doc';
    target_id?: string;
  },
): KnowledgeBacklink[] => {
  const where: string[] = ['source_doc_id = ?'];
  const values: unknown[] = [docId];

  if (options?.target_kind) {
    where.push('target_kind = ?');
    values.push(options.target_kind);
  }
  if (options?.target_id) {
    where.push('target_id = ?');
    values.push(options.target_id);
  }

  return db
    .prepare(
      `
        SELECT *
        FROM knowledge_backlinks
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
      `,
    )
    .all(...values) as KnowledgeBacklink[];
};

export const rebuildKnowledgeBacklinks = (docId: string): void => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM knowledge_backlinks WHERE source_doc_id = ?').run(
      docId,
    );

    const note = getKnowledgeDocNotes(docId);
    if (note?.parsed_links_json) {
      try {
        const parsed = JSON.parse(
          note.parsed_links_json,
        ) as KnowledgeDocWikiLink[];
        const insertBacklink = db.prepare(`
          INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const link of parsed) {
          if (!link.target_kind || !link.target_id) continue;
          insertBacklink.run(
            generateId(),
            docId,
            link.target_kind,
            link.target_id,
            link.label,
            link.snippet || null,
          );
        }
      } catch (error) {
        dbLog.warn('Failed to parse note links for backlinks:', error);
      }
    }

    // Synthesis chapter backlinks: map statement text to known entities in scope.
    if (doc.structured_json) {
      try {
        const structured = JSON.parse(doc.structured_json) as {
          chapters?: Array<{
            title?: string;
            decisions?: Array<{ text?: string; why_it_matters?: string }>;
            topic_evolution?: Array<{ text?: string; why_it_matters?: string }>;
            open_risks?: Array<{ text?: string; why_it_matters?: string }>;
            signals?: Array<{ text?: string; why_it_matters?: string }>;
          }>;
        };

        const isBroadScope =
          doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
        const candidateEntities = (
          isBroadScope
            ? db
                .prepare(
                  `
                    SELECT *
                    FROM entities
                    WHERE type IN ('project', 'person', 'topic', 'decision', 'action_item')
                      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                        '$.meeting_regeneration_retired_at') IS NULL
                    ORDER BY updated_at DESC
                    LIMIT 160
                  `,
                )
                .all()
            : db
                .prepare(
                  `
                    SELECT DISTINCT e.*
                    FROM entities e
                    LEFT JOIN entity_links l
                      ON l.source_entity_id = e.id OR l.target_entity_id = e.id
                    WHERE (e.id = ?
                       OR l.source_entity_id = ?
                       OR l.target_entity_id = ?)
                      AND json_type(CASE WHEN json_valid(e.metadata) THEN e.metadata ELSE '{}' END,
                        '$.meeting_regeneration_retired_at') IS NULL
                    ORDER BY e.updated_at DESC
                    LIMIT 120
                  `,
                )
                .all(doc.scope_key, doc.scope_key, doc.scope_key)
        ) as Entity[];

        const insertBacklink = db.prepare(`
          INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
          VALUES (?, ?, 'entity', ?, ?, ?)
        `);

        for (const chapter of structured.chapters || []) {
          const sectionLists = [
            chapter.decisions || [],
            chapter.topic_evolution || [],
            chapter.open_risks || [],
            chapter.signals || [],
          ];
          for (const list of sectionLists) {
            for (const item of list) {
              const text =
                `${item.text || ''} ${item.why_it_matters || ''}`.trim();
              if (!text) continue;
              const normalizedText = normalizeEntityName(text);
              for (const entity of candidateEntities) {
                const normalizedEntity = normalizeEntityName(entity.name);
                if (!normalizedEntity || normalizedEntity.length < 4) continue;
                if (!normalizedText.includes(normalizedEntity)) continue;
                insertBacklink.run(
                  generateId(),
                  docId,
                  entity.id,
                  entity.name,
                  text.slice(0, 240),
                );
              }
            }
          }
        }
      } catch (error) {
        dbLog.warn('Failed to derive synthesis backlinks:', error);
      }
    }

    const isBroadScopeLinks =
      doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
    const entityLinks = db
      .prepare(
        `
          SELECT *
          FROM entity_links
          WHERE source IN ('pipeline', 'synthesis', 'user')
            AND state != 'rejected'
            AND (
              ? = 1
              OR source_entity_id = ?
              OR target_entity_id = ?
            )
          ORDER BY updated_at DESC
          LIMIT 120
        `,
      )
      .all(
        isBroadScopeLinks ? 1 : 0,
        doc.scope_key,
        doc.scope_key,
      ) as EntityLink[];

    const insertBacklink = db.prepare(`
      INSERT INTO knowledge_backlinks (id, source_doc_id, target_kind, target_id, label, snippet)
      VALUES (?, ?, 'entity', ?, ?, ?)
    `);

    for (const link of entityLinks) {
      const sourceEntity = getEntity(link.source_entity_id);
      const targetEntity = getEntity(link.target_entity_id);
      if (!sourceEntity || !targetEntity) continue;

      const label = `${sourceEntity.name} ${link.relationship.replace(/_/g, ' ')} ${targetEntity.name}`;
      const snippet = link.evidence_quote || null;

      insertBacklink.run(
        generateId(),
        docId,
        sourceEntity.id,
        sourceEntity.name,
        snippet,
      );
      insertBacklink.run(
        generateId(),
        docId,
        targetEntity.id,
        targetEntity.name,
        snippet,
      );
      insertBacklink.run(generateId(), docId, sourceEntity.id, label, snippet);
      insertBacklink.run(generateId(), docId, targetEntity.id, label, snippet);
    }
  });

  tx();
};

export const saveKnowledgeDocNotes = (
  docId: string,
  markdown: string,
): KnowledgeDocNote => {
  const parsedLinks = parseKnowledgeDocWikiLinks(markdown);
  db.prepare(`
    INSERT INTO knowledge_doc_notes (doc_id, markdown, parsed_links_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(doc_id) DO UPDATE SET
      markdown = excluded.markdown,
      parsed_links_json = excluded.parsed_links_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(docId, markdown, JSON.stringify(parsedLinks));

  const saved = db
    .prepare('SELECT * FROM knowledge_doc_notes WHERE doc_id = ?')
    .get(docId) as KnowledgeDocNote;

  rebuildKnowledgeBacklinks(docId);
  return saved;
};

export const setEntityLinkState = (
  id: string,
  state: RelationshipState,
): EntityLink | undefined => {
  db.prepare(`
    UPDATE entity_links
    SET state = ?, source = 'user', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(state, id);

  const updated = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(id) as EntityLink | undefined;

  if (updated) {
    const docs = getKnowledgeDocs({ includeInactive: true });
    for (const doc of docs) {
      if (
        doc.scope_type === 'global' ||
        doc.scope_key === updated.source_entity_id ||
        doc.scope_key === updated.target_entity_id
      ) {
        rebuildKnowledgeBacklinks(doc.id);
      }
    }
  }

  return updated;
};

export const resolveConflictLinks = (
  winnerId: string,
  loserId: string,
): { winner: EntityLink | undefined; loser: EntityLink | undefined } => {
  db.transaction(() => {
    db.prepare(`
      UPDATE entity_links
      SET state = 'confirmed', source = 'user', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(winnerId);

    db.prepare(`
      UPDATE entity_links
      SET state = 'rejected', source = 'user', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(loserId);
  })();

  const winner = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(winnerId) as EntityLink | undefined;
  const loser = db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(loserId) as EntityLink | undefined;

  const docs = getKnowledgeDocs({ includeInactive: true });
  for (const doc of docs) {
    if (
      doc.scope_type === 'global' ||
      (winner &&
        (doc.scope_key === winner.source_entity_id ||
          doc.scope_key === winner.target_entity_id)) ||
      (loser &&
        (doc.scope_key === loser.source_entity_id ||
          doc.scope_key === loser.target_entity_id))
    ) {
      rebuildKnowledgeBacklinks(doc.id);
    }
  }

  return { winner, loser };
};

export const getKnowledgeGraph = (
  docId: string,
  options?: {
    includeRejected?: boolean;
    nodeTypes?: EntityType[];
    maxNodes?: number;
    maxEdges?: number;
    minConfidence?: number;
  },
): {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
} => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) {
    return { nodes: [], edges: [] };
  }

  const maxEdges = Math.min(300, Math.max(10, options?.maxEdges ?? 120));
  const maxNodes = Math.min(120, Math.max(10, options?.maxNodes ?? 50));
  const minConfidence = options?.minConfidence ?? 0;
  const includeRejected = options?.includeRejected ?? false;
  const stateFilter = includeRejected ? '' : "AND l.state != 'rejected'";

  // Resolve scope entity IDs for edge filtering
  const isGlobalLike =
    doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
  const scopeEntityIds: string[] = [];
  if (doc.scope_type === 'team_tracker') {
    const config = parseDocConfig(doc.config);
    scopeEntityIds.push(...(config.member_entity_ids || []));
  } else if (!isGlobalLike) {
    scopeEntityIds.push(doc.scope_key);
  }

  let edges: KnowledgeGraphEdge[];
  if (isGlobalLike && scopeEntityIds.length === 0) {
    edges = db
      .prepare(
        `
          SELECT l.*, src.name AS source_label, tgt.name AS target_label
          FROM entity_links l
          JOIN entities src ON src.id = l.source_entity_id
          JOIN entities tgt ON tgt.id = l.target_entity_id
          WHERE l.confidence >= ? ${stateFilter}
          ORDER BY
            CASE l.state WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
            l.updated_at DESC, l.confidence DESC
          LIMIT ?
        `,
      )
      .all(minConfidence, maxEdges) as KnowledgeGraphEdge[];
  } else if (scopeEntityIds.length > 0) {
    const ph = scopeEntityIds.map(() => '?').join(', ');
    edges = db
      .prepare(
        `
          SELECT l.*, src.name AS source_label, tgt.name AS target_label
          FROM entity_links l
          JOIN entities src ON src.id = l.source_entity_id
          JOIN entities tgt ON tgt.id = l.target_entity_id
          WHERE l.confidence >= ? ${stateFilter}
            AND (l.source_entity_id IN (${ph}) OR l.target_entity_id IN (${ph}))
          ORDER BY
            CASE l.state WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
            l.updated_at DESC, l.confidence DESC
          LIMIT ?
        `,
      )
      .all(
        minConfidence,
        ...scopeEntityIds,
        ...scopeEntityIds,
        maxEdges,
      ) as KnowledgeGraphEdge[];
  } else {
    edges = [];
  }

  // Project aliases only at the read boundary. Original edges remain intact
  // so their source evidence and endpoints can be restored later.
  edges = edges.flatMap((edge) => {
    const source = resolveCommitmentIdentity(edge.source_entity_id);
    const target = resolveCommitmentIdentity(edge.target_entity_id);
    if (!source || !target || source.id === target.id) return [];
    return [
      {
        ...edge,
        source_entity_id: source.id,
        target_entity_id: target.id,
        source_label: source.name,
        target_label: target.name,
      },
    ];
  });

  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.source_entity_id);
    nodeIds.add(edge.target_entity_id);
  }

  if (doc.scope_type === 'project' || doc.scope_type === 'person_context') {
    nodeIds.add(doc.scope_key);
  }
  if (doc.scope_type === 'team_tracker') {
    for (const id of scopeEntityIds) nodeIds.add(id);
  }

  let preferredNodeIds: Array<{ id: string }> = [];
  if (isGlobalLike) {
    preferredNodeIds = db
      .prepare(
        `
          SELECT
            e.id
          FROM entities e
          LEFT JOIN meeting_entities me ON me.entity_id = e.id
          WHERE e.type IN ('project', 'person', 'decision')
          GROUP BY e.id
          HAVING COALESCE(SUM(me.mention_count), 0) >= 2
            AND COALESCE(e.saliency_score, 1.0) >= 0.7
          ORDER BY
            CASE e.type
              WHEN 'project' THEN 0
              WHEN 'person' THEN 1
              WHEN 'decision' THEN 2
              ELSE 3
            END,
            COALESCE(SUM(me.mention_count), 0) DESC,
            e.updated_at DESC
          LIMIT ?
        `,
      )
      .all(maxNodes) as Array<{ id: string }>;
    for (const row of preferredNodeIds) nodeIds.add(row.id);
  }

  if (nodeIds.size === 0 && isGlobalLike) {
    const fallbackNodeIds = db
      .prepare(
        `
          SELECT id
          FROM entities
          WHERE type IN ('project', 'person', 'topic', 'decision', 'action_item')
            AND NOT EXISTS (SELECT 1 FROM commitment_aliases a
              WHERE a.extraction_id = entities.id AND a.active = 1)
            AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
              '$.meeting_regeneration_retired_at') IS NULL
          ORDER BY updated_at DESC
          LIMIT ?
        `,
      )
      .all(maxNodes) as Array<{ id: string }>;
    for (const row of fallbackNodeIds) nodeIds.add(row.id);
  }

  let nodeIdList: string[] = [];
  if (isGlobalLike && preferredNodeIds.length > 0) {
    const ordered = new Set<string>();
    for (const row of preferredNodeIds) ordered.add(row.id);
    for (const id of nodeIds) ordered.add(id);
    nodeIdList = Array.from(ordered).slice(0, maxNodes);
  } else {
    nodeIdList = Array.from(nodeIds).slice(0, maxNodes);
  }
  if (nodeIdList.length === 0) {
    return { nodes: [], edges };
  }

  const placeholders = nodeIdList.map(() => '?').join(', ');
  const typeFilter = options?.nodeTypes?.length
    ? `AND e.type IN (${options.nodeTypes.map(() => '?').join(', ')})`
    : '';
  const typeValues = options?.nodeTypes?.length ? options.nodeTypes : [];

  const nodes = db
    .prepare(
      `
        SELECT
          e.id,
          e.type,
          e.name AS label,
          e.status,
          e.metadata,
          e.saliency_score,
          e.domain_tag,
          COALESCE((
            SELECT SUM(me.mention_count)
            FROM meeting_entities me
            WHERE me.entity_id = e.id
          ), 0) AS mention_count
        FROM entities e
        WHERE e.id IN (${placeholders})
          ${typeFilter}
        ORDER BY
          CASE e.type
            WHEN 'project' THEN 0
            WHEN 'action_item' THEN 1
            WHEN 'decision' THEN 2
            WHEN 'topic' THEN 3
            WHEN 'person' THEN 4
            ELSE 5
          END,
          e.updated_at DESC
      `,
    )
    .all(...nodeIdList, ...typeValues) as KnowledgeGraphNode[];

  return { nodes, edges };
};

export const getKnowledgeTimeline = (
  docId: string,
  limit = 20,
): KnowledgeTimelineItem[] => {
  const doc = getKnowledgeDoc(docId);
  if (!doc) return [];

  const items: KnowledgeTimelineItem[] = [];
  const versions = getKnowledgeDocVersions(docId, 8);
  for (const version of versions) {
    if (!version.changelog_json) continue;
    try {
      const parsed = JSON.parse(version.changelog_json) as {
        sections?: Array<{
          section: string;
          added_count: number;
          removed_count: number;
          updated_count: number;
        }>;
      };
      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      for (const section of sections) {
        if (
          section.added_count === 0 &&
          section.removed_count === 0 &&
          section.updated_count === 0
        ) {
          continue;
        }
        items.push({
          id: `${docId}:synth:${version.version_no}:${section.section}`,
          kind: 'synthesis',
          title: section.section,
          detail: `+${section.added_count} / -${section.removed_count} / ~${section.updated_count}`,
          timestamp: version.synthesized_at,
          doc_id: docId,
        });
      }
    } catch {
      // Ignore malformed legacy changelog blobs.
    }
  }

  const isBroadTimeline =
    doc.scope_type === 'global' || doc.scope_type === 'team_tracker';
  const dependencyRows = db
    .prepare(
      `
        SELECT l.*, src.name AS source_label, tgt.name AS target_label
        FROM entity_links l
        JOIN entities src ON src.id = l.source_entity_id
        JOIN entities tgt ON tgt.id = l.target_entity_id
        WHERE l.relationship IN ('depends_on', 'blocked_by', 'owns', 'impacts')
          AND l.state != 'rejected'
          AND (
            ? = 1
            OR l.source_entity_id = ?
            OR l.target_entity_id = ?
          )
        ORDER BY l.updated_at DESC
        LIMIT 30
      `,
    )
    .all(isBroadTimeline ? 1 : 0, doc.scope_key, doc.scope_key) as Array<
    EntityLink & { source_label: string; target_label: string }
  >;

  for (const row of dependencyRows) {
    items.push({
      id: `${docId}:dep:${row.id}`,
      kind: 'dependency',
      title: `${row.source_label} ${row.relationship.replace(/_/g, ' ')} ${row.target_label}`,
      detail: `${row.state} · ${(row.confidence * 100).toFixed(0)}% confidence`,
      timestamp: row.updated_at || row.created_at,
      doc_id: docId,
    });
  }

  const note = getKnowledgeDocNotes(docId);
  if (note) {
    items.push({
      id: `${docId}:notes:${note.updated_at}`,
      kind: 'notes',
      title: 'Notes updated',
      detail: 'Wiki-linked project notes changed.',
      timestamp: note.updated_at,
      doc_id: docId,
    });
  }

  return items
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, Math.max(5, limit));
};

const getProjectHealthCards = (limit = 24): KnowledgeProjectHealthCard[] => {
  const docs = getKnowledgeDocs({
    includeInactive: false,
    scopeType: 'project',
  });
  const cards: KnowledgeProjectHealthCard[] = [];

  for (const doc of docs.slice(0, limit)) {
    const projectId = doc.scope_key;
    const blockers = (
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM entity_links
            WHERE relationship = 'blocked_by'
              AND state != 'rejected'
              AND (source_entity_id = ? OR target_entity_id = ?)
          `,
        )
        .get(projectId, projectId) as { count: number }
    ).count;

    const dependencies = (
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM entity_links
            WHERE relationship IN ('depends_on', 'blocked_by', 'owns', 'impacts')
              AND state != 'rejected'
              AND (source_entity_id = ? OR target_entity_id = ?)
          `,
        )
        .get(projectId, projectId) as { count: number }
    ).count;

    const latestVersion = getKnowledgeDocVersions(doc.id, 1)[0];
    let recentChanges = 0;
    if (latestVersion?.changelog_json) {
      try {
        const parsed = JSON.parse(latestVersion.changelog_json) as {
          sections?: Array<{
            added_count: number;
            removed_count: number;
            updated_count: number;
          }>;
        };
        for (const section of parsed.sections || []) {
          recentChanges +=
            section.added_count + section.removed_count + section.updated_count;
        }
      } catch {
        recentChanges = 0;
      }
    }

    const anchorDate = doc.last_synthesized_at || doc.updated_at;
    const stalenessDays = anchorDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(anchorDate).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 999;

    cards.push({
      doc_id: doc.id,
      project_id: projectId,
      title: doc.title,
      open_blockers: blockers,
      dependency_count: dependencies,
      recent_changes: recentChanges,
      staleness_days: stalenessDays,
    });
  }

  return cards.sort((a, b) => {
    const riskA = a.open_blockers * 4 + a.staleness_days + a.dependency_count;
    const riskB = b.open_blockers * 4 + b.staleness_days + b.dependency_count;
    return riskB - riskA;
  });
};

export const getKnowledgeWorkspace = (params?: {
  docId?: string;
  includeRejected?: boolean;
}): KnowledgeWorkspacePayload => {
  const docs = getKnowledgeDocs({ includeInactive: true });
  const selectedDoc =
    (params?.docId ? getKnowledgeDoc(params.docId) : undefined) ||
    docs[0] ||
    null;

  if (!selectedDoc) {
    return {
      docs: [],
      selected_doc: null,
      notes: null,
      graph: { nodes: [], edges: [] },
      timeline: [],
      backlinks: [],
      project_cards: [],
    };
  }

  const notes = getKnowledgeDocNotes(selectedDoc.id) || null;
  const graph = getKnowledgeGraph(selectedDoc.id, {
    includeRejected: params?.includeRejected,
  });
  const timeline = getKnowledgeTimeline(selectedDoc.id, 24);
  rebuildKnowledgeBacklinks(selectedDoc.id);
  const backlinks = getKnowledgeBacklinks(selectedDoc.id);
  const projectCards =
    selectedDoc.scope_type === 'global' ||
    selectedDoc.scope_type === 'team_tracker'
      ? getProjectHealthCards(24)
      : [];

  return {
    docs,
    selected_doc: selectedDoc,
    notes,
    graph,
    timeline,
    backlinks,
    project_cards: projectCards,
  };
};

/**
 * Create or update an entity
 */
export const resolvePersonIdentityId = (personId: string): string => {
  let current = personId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const alias = db
      .prepare(
        'SELECT canonical_id FROM person_aliases WHERE person_id = ? AND active = 1',
      )
      .get(current) as { canonical_id: string } | undefined;
    if (!alias) return current;
    current = alias.canonical_id;
  }
  throw new Error('person_alias_cycle');
};

export const upsertEntity = (entity: {
  id?: string; // Optional ID to force update on specific entity
  type: EntityType;
  name: string;
  status?: EntityStatus;
  due_date?: string | null;
  assigned_to?: string | null;
  metadata?: Record<string, unknown>;
  dedupe_by_name?: boolean;
  saliency_score?: number;
  domain_tag?: string;
}): Entity => {
  const normalizedName = normalizeEntityName(entity.name);
  if (entity.type === 'person' && !isUsablePersonName(entity.name)) {
    throw new Error('person_name_invalid');
  }

  let existing: Entity | undefined;
  let matchedProjectAlias = false;
  let matchedPersonAlias = false;

  // 1. If ID provided, try to find by ID first
  if (entity.id) {
    existing = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(entity.id) as Entity | undefined;
  }

  // 2. If no ID or not found by ID, try normalization match unless the caller
  // explicitly requests a distinct entity.
  if (!existing && entity.dedupe_by_name !== false) {
    existing = db
      .prepare(`
        SELECT * FROM entities WHERE type = ? AND normalized_name = ?
      `)
      .get(entity.type, normalizedName) as Entity | undefined;
  }

  if (existing?.type === 'project') {
    const canonicalId = resolveProjectIdentityId(existing.id);
    if (canonicalId !== existing.id) {
      existing = getEntity(canonicalId);
      matchedProjectAlias = true;
    }
  }

  if (existing?.type === 'person') {
    const canonicalId = resolvePersonIdentityId(existing.id);
    if (canonicalId !== existing.id) {
      existing = db
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(canonicalId) as Entity | undefined;
      matchedPersonAlias = true;
    }
  }

  if (
    !existing &&
    entity.type === 'project' &&
    entity.dedupe_by_name !== false
  ) {
    existing = db
      .prepare(
        `SELECT project.* FROM entity_dreaming_aliases name_alias
         JOIN entities project ON project.id = name_alias.entity_id
         WHERE name_alias.entity_type = 'project'
           AND name_alias.active = 1 AND name_alias.normalized_name = ?`,
      )
      .get(normalizedName) as Entity | undefined;
    if (existing) existing = getEntity(resolveProjectIdentityId(existing.id));
    matchedProjectAlias = Boolean(existing);
  }

  if (
    !existing &&
    entity.type === 'project' &&
    entity.dedupe_by_name !== false
  ) {
    existing = db
      .prepare(
        `SELECT canonical.* FROM project_aliases pa
         JOIN entities alias ON alias.id = pa.project_id
         JOIN entities canonical ON canonical.id = pa.canonical_id
         WHERE pa.active = 1 AND alias.normalized_name = ?`,
      )
      .get(normalizedName) as Entity | undefined;
    matchedProjectAlias = Boolean(existing);
  }

  if (
    !existing &&
    entity.type === 'person' &&
    entity.dedupe_by_name !== false
  ) {
    existing = db
      .prepare(
        `SELECT person.* FROM entity_dreaming_aliases name_alias
         JOIN entities person ON person.id = name_alias.entity_id
         WHERE name_alias.entity_type = 'person'
           AND name_alias.active = 1 AND name_alias.normalized_name = ?`,
      )
      .get(normalizedName) as Entity | undefined;
    if (existing) existing = getEntity(resolvePersonIdentityId(existing.id));
    matchedPersonAlias = Boolean(existing);
  }

  if (
    !existing &&
    entity.type === 'person' &&
    entity.dedupe_by_name !== false
  ) {
    const matches = db
      .prepare(
        `SELECT DISTINCT COALESCE(pa.canonical_id, person.id) AS canonical_id
         FROM person_name_aliases name_alias
         JOIN entities person ON person.id = name_alias.person_id
         LEFT JOIN person_aliases pa
           ON pa.person_id = person.id AND pa.active = 1
         WHERE name_alias.normalized_name = ?`,
      )
      .all(normalizedName) as Array<{ canonical_id: string }>;
    if (matches.length === 1) {
      existing = db
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(matches[0].canonical_id) as Entity | undefined;
      matchedPersonAlias = Boolean(existing);
    }
  }

  if (existing) {
    // Update existing entity
    const stmt = db.prepare(`
      UPDATE entities SET
        name = COALESCE(?, name),
        status = COALESCE(?, status),
        due_date = COALESCE(?, due_date),
        assigned_to = COALESCE(?, assigned_to),
        metadata = COALESCE(?, metadata),
        saliency_score = COALESCE(?, saliency_score),
        domain_tag = COALESCE(?, domain_tag),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      matchedProjectAlias || matchedPersonAlias ? null : entity.name,
      entity.status,
      entity.due_date,
      entity.assigned_to,
      entity.metadata ? JSON.stringify(entity.metadata) : null,
      entity.saliency_score ?? null,
      entity.domain_tag ?? null,
      existing.id,
    );

    // Return updated entity
    const updated = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(existing.id) as Entity;

    // Update FTS index
    try {
      db.prepare('DELETE FROM entities_fts WHERE entity_id = ?').run(
        existing.id,
      );
      db.prepare(
        'INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)',
      ).run(updated.name, existing.id);
    } catch (e) {
      dbLog.warn(`Failed to update FTS for entity ${existing.id}:`, e);
    }

    return updated;
  }

  // Create new entity
  const id = entity.id || generateId(); // Use provided ID or generate new
  const stmt = db.prepare(`
    INSERT INTO entities (id, type, name, normalized_name, status, due_date, assigned_to, metadata, saliency_score, domain_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    entity.type,
    entity.name,
    normalizedName,
    entity.status || null,
    entity.due_date || null,
    entity.assigned_to || null,
    entity.metadata ? JSON.stringify(entity.metadata) : null,
    entity.saliency_score ?? 1.0,
    entity.domain_tag || 'work',
  );

  // Update FTS index
  db.prepare(`
    INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)
  `).run(entity.name, id);

  dbLog.debug(`Created entity: ${entity.type} - "${entity.name}"`);
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Entity;
};

/**
 * Get entity by ID
 */
export const getEntity = (id: string): Entity | undefined => {
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
    | Entity
    | undefined;
};

export const getPersonNameAliases = (personId: string): string[] => {
  const canonicalId = resolvePersonIdentityId(personId);
  const rows = db
    .prepare(
      `WITH family(id) AS (
         SELECT ? UNION SELECT person_id FROM person_aliases
         WHERE canonical_id = ? AND active = 1
       ), names AS (
         SELECT display_name AS name, normalized_name
         FROM person_name_aliases
         WHERE person_id IN (SELECT id FROM family)
         UNION
         SELECT name, normalized_name FROM entities
         WHERE id IN (SELECT id FROM family) AND id != ?
       )
       SELECT name FROM names
       WHERE normalized_name != (
         SELECT normalized_name FROM entities WHERE id = ?
       )
       GROUP BY normalized_name
       ORDER BY MIN(name)`,
    )
    .all(canonicalId, canonicalId, canonicalId, canonicalId) as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
};

export const updatePersonName = (personId: string, name: string): Entity =>
  db.transaction(() => {
    const canonicalId = resolvePersonIdentityId(personId);
    const person = getEntity(canonicalId);
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!person || person.type !== 'person' || !trimmed)
      throw new Error('person_name_invalid');
    const normalizedName = normalizeEntityName(trimmed);
    if (normalizedName === person.normalized_name) {
      if (trimmed === person.name) return person;
    } else {
      db.prepare(
        `INSERT INTO person_name_aliases(
           person_id, normalized_name, display_name, source
         ) VALUES (?, ?, ?, 'rename')
         ON CONFLICT(person_id, normalized_name) DO UPDATE SET
           display_name = excluded.display_name`,
      ).run(person.id, person.normalized_name, person.name);
    }
    db.prepare(
      `UPDATE entities SET name = ?, normalized_name = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(trimmed, normalizedName, person.id);
    try {
      db.prepare('DELETE FROM entities_fts WHERE entity_id = ?').run(person.id);
      db.prepare(
        'INSERT INTO entities_fts (name, entity_id) VALUES (?, ?)',
      ).run(trimmed, person.id);
    } catch (error) {
      dbLog.warn(
        `Failed to update person search index for ${person.id}:`,
        error,
      );
    }
    return getEntity(person.id)!;
  })();

export const addPersonNameAlias = (
  personId: string,
  aliasName: string,
): void => {
  const canonicalId = resolvePersonIdentityId(personId);
  const person = getEntity(canonicalId);
  const trimmed = aliasName.trim().replace(/\s+/g, ' ');
  if (!person || person.type !== 'person' || !trimmed) {
    throw new Error('person_name_alias_invalid');
  }
  const normalizedName = normalizeEntityName(trimmed);
  if (normalizedName === person.normalized_name) {
    return;
  }
  db.prepare(
    `INSERT INTO person_name_aliases(
       person_id, normalized_name, display_name, source
     ) VALUES (?, ?, ?, 'alias_suggestion')
     ON CONFLICT(person_id, normalized_name) DO UPDATE SET
       display_name = excluded.display_name`,
  ).run(person.id, normalizedName, trimmed);
};

export const mergePerson = (
  personId: string,
  destinationPersonId: string,
): void => {
  const source = getEntity(personId);
  const destinationId = resolvePersonIdentityId(destinationPersonId);
  const destination = getEntity(destinationId);
  if (
    !source ||
    !destination ||
    source.type !== 'person' ||
    destination.type !== 'person' ||
    source.id === destination.id ||
    resolvePersonIdentityId(source.id) === destinationId
  ) {
    throw new Error('person_merge_invalid');
  }
  db.transaction(() => {
    const movedAliases = (
      db
        .prepare(
          'SELECT person_id FROM person_aliases WHERE canonical_id = ? AND active = 1',
        )
        .all(source.id) as Array<{ person_id: string }>
    ).map((alias) => alias.person_id);
    db.prepare(
      `INSERT INTO person_aliases(
         person_id, canonical_id, moved_aliases_json, active, restored_at
       ) VALUES (?, ?, ?, 1, NULL)
       ON CONFLICT(person_id) DO UPDATE SET
         canonical_id = excluded.canonical_id,
         moved_aliases_json = excluded.moved_aliases_json,
         active = 1,
         restored_at = NULL,
         created_at = CURRENT_TIMESTAMP`,
    ).run(source.id, destinationId, JSON.stringify(movedAliases));
    db.prepare(
      `UPDATE person_aliases SET canonical_id = ?
       WHERE canonical_id = ? AND active = 1`,
    ).run(destinationId, source.id);
  })();
};

export const restorePersonMerge = (personId: string): void => {
  db.transaction(() => {
    const alias = db
      .prepare(
        `SELECT moved_aliases_json FROM person_aliases
         WHERE person_id = ? AND active = 1`,
      )
      .get(personId) as { moved_aliases_json: string | null } | undefined;
    if (!alias) return;
    let movedAliases: string[] = [];
    try {
      const parsed = JSON.parse(alias.moved_aliases_json || '[]');
      if (Array.isArray(parsed)) {
        movedAliases = parsed.filter(
          (value): value is string => typeof value === 'string',
        );
      }
    } catch {
      movedAliases = [];
    }
    if (movedAliases.length > 0) {
      const placeholders = movedAliases.map(() => '?').join(', ');
      db.prepare(
        `UPDATE person_aliases SET canonical_id = ?
         WHERE person_id IN (${placeholders}) AND active = 1`,
      ).run(personId, ...movedAliases);
    }
    db.prepare(
      `UPDATE person_aliases SET active = 0, restored_at = CURRENT_TIMESTAMP
       WHERE person_id = ? AND active = 1`,
    ).run(personId);
  })();
};

export interface CommitmentAliasInput {
  extractionId: string;
  canonicalId: string;
  meetingId: string;
  description: string;
  reason: string;
  original?: {
    owner: string | null;
    due: string | null;
    evidence: string;
    normalizedDue?: string | null;
    sourceEvidence?: string | null;
    identityProof?: {
      ownerKey: string;
      candidateFingerprint: string;
      canonicalFingerprint: string;
    };
  };
}

// The full snapshot includes source revisions: an edit during model work must
// invalidate the decision even when SQLite timestamps share one second.
export const getCommitmentQueueRevision = (): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        identityStore.getRevision(),
        db
          .prepare(
            "SELECT id, name FROM entities WHERE type IN ('person', 'project') ORDER BY id",
          )
          .all(),
        db.prepare('SELECT * FROM person_aliases ORDER BY person_id').all(),
        db
          .prepare(
            'SELECT * FROM person_name_aliases ORDER BY person_id, normalized_name',
          )
          .all(),
        db
          .prepare(
            "SELECT * FROM entities WHERE type = 'action_item' ORDER BY id",
          )
          .all(),
        db
          .prepare('SELECT * FROM commitment_aliases ORDER BY extraction_id')
          .all(),
        db
          .prepare(`SELECT me.* FROM meeting_entities me JOIN entities e ON e.id = me.entity_id
      WHERE e.type = 'action_item' ORDER BY me.meeting_id, me.entity_id`)
          .all(),
        db
          .prepare(
            'SELECT id, title, transcript_json, analysis_json, user_notes, started_at FROM meetings ORDER BY id',
          )
          .all(),
        db
          .prepare(`SELECT l.* FROM entity_links l WHERE l.source_entity_id IN
      (SELECT id FROM entities WHERE type = 'action_item') OR l.target_entity_id IN
      (SELECT id FROM entities WHERE type = 'action_item') ORDER BY l.id`)
          .all(),
      ]),
    )
    .digest('hex');

export const resolveCommitmentIdentity = (id: string): Entity | undefined => {
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const alias = db
      .prepare(
        'SELECT canonical_id FROM commitment_aliases WHERE extraction_id = ? AND active = 1',
      )
      .get(current) as { canonical_id: string } | undefined;
    if (!alias) {
      const entity = getEntity(current);
      return entity && !isMeetingRegenerationRetired(entity.metadata)
        ? entity
        : undefined;
    }
    current = alias.canonical_id;
  }
  throw new Error('commitment_alias_cycle');
};

const isMeetingRegenerationRetired = (metadata: string | null): boolean => {
  try {
    const parsed = JSON.parse(metadata || '{}') as Record<string, unknown>;
    return typeof parsed.meeting_regeneration_retired_at === 'string';
  } catch {
    return false;
  }
};

export const isRetiredCommitment = (id: string): boolean =>
  !!db
    .prepare(
      'SELECT 1 FROM commitment_aliases WHERE extraction_id = ? AND active = 1',
    )
    .get(id) || isMeetingRegenerationRetired(getEntity(id)?.metadata ?? null);

export const retireMeetingDerivedCommitments = (
  meetingId: string,
  retiredAt = new Date().toISOString(),
): number => {
  const rows = db
    .prepare(
      `SELECT id, metadata FROM entities
       WHERE type = 'action_item'
         AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.origin') = 'extraction'
         AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.source_meeting_id') = ?
         AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.meeting_regeneration_retired_at') IS NULL`,
    )
    .all(meetingId) as Array<{ id: string; metadata: string | null }>;
  const update = db.prepare(
    'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata || '{}') as Record<
      string,
      unknown
    >;
    update.run(
      JSON.stringify({
        ...metadata,
        meeting_regeneration_retired_at: retiredAt,
      }),
      row.id,
    );
  }
  return rows.length;
};

export const wasCommitmentRestored = (id: string): boolean =>
  !!db
    .prepare(
      'SELECT 1 FROM commitment_aliases WHERE extraction_id = ? AND active = 0',
    )
    .get(id);

export const withCommitmentTransaction = <T>(operation: () => T): T =>
  db.transaction(operation)();

export const getIdentityReconciliationInputs = () => ({
  actions: db
    .prepare(`SELECT * FROM entities WHERE type = 'action_item'
      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL ORDER BY id`)
    .all() as Entity[],
  people: getEntitiesByType('person').map(({ id, name }) => ({ id, name })),
  projects: db
    .prepare("SELECT id, name FROM entities WHERE type = 'project' ORDER BY id")
    .all(),
  links: db.prepare('SELECT * FROM entity_links ORDER BY id').all(),
  associations: db
    .prepare('SELECT * FROM meeting_entities ORDER BY meeting_id, entity_id')
    .all(),
  meetings: db
    .prepare(
      'SELECT id, title, transcript_json, analysis_json, started_at FROM meetings ORDER BY id',
    )
    .all() as PersistedMeeting[],
});

export const getActiveCommitmentAliases = (): CommitmentAliasInput[] =>
  (
    db
      .prepare(
        'SELECT * FROM commitment_aliases WHERE active = 1 ORDER BY extraction_id',
      )
      .all() as {
      extraction_id: string;
      canonical_id: string;
      meeting_id: string;
      description: string;
      reason: string;
      original_json: string | null;
    }[]
  ).map((row) => ({
    extractionId: row.extraction_id,
    canonicalId: row.canonical_id,
    meetingId: row.meeting_id,
    description: row.description,
    reason: row.reason,
    original: row.original_json ? JSON.parse(row.original_json) : undefined,
  }));

/** Evidence reads must never use the alias-family projections used by the UI. */
export const getCommitmentSourceRelations = (id: string) => ({
  projects: db
    .prepare(`SELECT DISTINCT e.id, e.name FROM entity_links l JOIN entities e
    ON e.id = CASE WHEN l.source_entity_id = ? THEN l.target_entity_id ELSE l.source_entity_id END
    WHERE (l.source_entity_id = ? OR l.target_entity_id = ?) AND e.type = 'project' AND COALESCE(l.state, 'inferred') != 'rejected' ORDER BY e.id`)
    .all(id, id, id) as { id: string; name: string }[],
  meetings: db
    .prepare(`SELECT m.*, me.context FROM meetings m JOIN meeting_entities me ON m.id = me.meeting_id
    WHERE me.entity_id = ? AND NOT EXISTS (SELECT 1 FROM commitment_aliases a WHERE a.canonical_id = ?
      AND a.meeting_id = me.meeting_id AND a.association_inserted = 1 AND me.context = a.description)
    ORDER BY m.started_at DESC, m.id`)
    .all(id, id) as (PersistedMeeting & { context: string | null })[],
});

export const refreshCommitmentIdentityProof = (
  expectedRevision: string,
  alias: CommitmentAliasInput,
) => {
  if (getCommitmentQueueRevision() !== expectedRevision)
    throw new Error('commitment_reconciliation_stale');
  db.prepare(
    'UPDATE commitment_aliases SET original_json = ? WHERE extraction_id = ? AND active = 1',
  ).run(JSON.stringify(alias.original), alias.extractionId);
};

/** Only the explicit user-edit boundary may promote assigned_to to authority. */
export const correctActionOwner = (
  id: string,
  personId: string | null,
): Entity =>
  withCommitmentTransaction(() => {
    const entity = getEntity(id);
    if (!entity || entity.type !== 'action_item')
      throw new Error('identity_action_invalid');
    if (personId !== null && getEntity(personId)?.type !== 'person')
      throw new Error('identity_person_invalid');
    const canonicalPersonId =
      personId === null ? null : resolvePersonIdentityId(personId);
    const metadata = parseActionMetadata(entity.metadata);
    db.prepare(
      'UPDATE entities SET assigned_to = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(
      canonicalPersonId,
      JSON.stringify({ ...metadata, owner_source: 'user' }),
      id,
    );
    const source =
      typeof metadata.source_meeting_id === 'string'
        ? metadata.source_meeting_id
        : getEntityMeetings(id)[0]?.id;
    if (source && getMeeting(source))
      identityStore.enqueue(String(source), getCommitmentQueueRevision());
    return getEntity(id)!;
  });

export const commitCommitmentAliases = (
  expectedRevision: string,
  aliases: CommitmentAliasInput[],
): void => {
  db.transaction(() => {
    if (getCommitmentQueueRevision() !== expectedRevision)
      throw new Error('commitment_reconciliation_stale');
    for (const alias of aliases) {
      const target = resolveCommitmentIdentity(alias.canonicalId);
      const original = getEntity(alias.extractionId);
      if (
        !target ||
        target.type !== 'action_item' ||
        target.id === alias.extractionId ||
        !alias.reason.trim() ||
        !alias.description.trim()
      )
        throw new Error('commitment_alias_invalid');
      if (wasCommitmentRestored(alias.extractionId))
        throw new Error('commitment_alias_restored');
      if (original) {
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(original.metadata || '{}');
        } catch {
          /* Cannot prove extraction ownership. */
        }
        if (
          original.type !== 'action_item' ||
          getCommitmentState(original.metadata) !== 'possible' ||
          metadata.origin !== 'extraction' ||
          original.status === 'completed'
        )
          throw new Error('commitment_alias_reviewed');
      }
      const existing = db
        .prepare(
          'SELECT canonical_id FROM commitment_aliases WHERE extraction_id = ? AND active = 1',
        )
        .get(alias.extractionId) as { canonical_id: string } | undefined;
      if (
        existing &&
        resolveCommitmentIdentity(existing.canonical_id)?.id !== target.id
      )
        throw new Error('commitment_alias_conflict');
      const associationInserted = ensureMeetingEntity({
        meeting_id: alias.meetingId,
        entity_id: target.id,
        context: alias.description,
      });
      db.prepare(`INSERT INTO commitment_aliases (extraction_id, canonical_id, meeting_id, description, reason, original_json, association_inserted)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(extraction_id) DO NOTHING`).run(
        alias.extractionId,
        target.id,
        alias.meetingId,
        alias.description,
        alias.reason,
        alias.original ? JSON.stringify(alias.original) : null,
        associationInserted ? 1 : 0,
      );
    }
  })();
};

export const restoreCommitmentAlias = (extractionId: string): void => {
  // Original rows and source associations were never removed. Restoration is
  // durable and excludes this record from subsequent automatic cleanup.
  db.transaction(() => {
    const alias = db
      .prepare(
        'SELECT * FROM commitment_aliases WHERE extraction_id = ? AND active = 1',
      )
      .get(extractionId) as
      | {
          canonical_id: string;
          meeting_id: string;
          description: string;
          original_json: string | null;
          association_inserted: number;
        }
      | undefined;
    if (!alias) return;
    if (!getEntity(extractionId)) {
      if (!alias.original_json)
        throw new Error('commitment_alias_original_missing');
      const original = JSON.parse(alias.original_json) as NonNullable<
        CommitmentAliasInput['original']
      >;
      upsertEntity({
        id: extractionId,
        type: 'action_item',
        name: alias.description.slice(0, 100),
        status: 'active',
        due_date: original.normalizedDue ?? null,
        dedupe_by_name: false,
        metadata: {
          commitment_state: 'possible',
          origin: 'extraction',
          source_meeting_id: alias.meeting_id,
          full_description: alias.description,
          assignee_name: original.owner,
          source_due_date: original.due,
          source_evidence: original.sourceEvidence ?? original.evidence,
        },
      });
      ensureMeetingEntity({
        meeting_id: alias.meeting_id,
        entity_id: extractionId,
        context: alias.description,
      });
    }
    db.prepare(
      'UPDATE commitment_aliases SET active = 0, restored_at = CURRENT_TIMESTAMP WHERE extraction_id = ?',
    ).run(extractionId);
    const next = db
      .prepare(
        'SELECT extraction_id FROM commitment_aliases WHERE canonical_id = ? AND meeting_id = ? AND active = 1 LIMIT 1',
      )
      .get(alias.canonical_id, alias.meeting_id) as
      | { extraction_id: string }
      | undefined;
    if (alias.association_inserted && next) {
      // Transfer responsibility so restoring the last alias can undo the link.
      db.prepare(
        'UPDATE commitment_aliases SET association_inserted = 1 WHERE extraction_id = ?',
      ).run(next.extraction_id);
    } else if (alias.association_inserted) {
      db.prepare(`DELETE FROM meeting_entities WHERE entity_id = ? AND meeting_id = ? AND mention_count = 1
        AND context IN (SELECT description FROM commitment_aliases WHERE canonical_id = ? AND meeting_id = ? AND association_inserted = 1)`).run(
        alias.canonical_id,
        alias.meeting_id,
        alias.canonical_id,
        alias.meeting_id,
      );
    }
  })();
};

/**
 * Get all entities of a specific type
 */
export const resolveProjectIdentityId = (projectId: string): string => {
  let current = projectId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const alias = db
      .prepare(
        'SELECT canonical_id FROM project_aliases WHERE project_id = ? AND active = 1',
      )
      .get(current) as { canonical_id: string } | undefined;
    if (!alias) return current;
    current = alias.canonical_id;
  }
  throw new Error('project_alias_cycle');
};

export const updateProjectDisplayTitle = (
  projectId: string,
  title: string,
): Entity => {
  const canonicalId = resolveProjectIdentityId(projectId);
  const project = getEntity(canonicalId);
  const trimmed = title.trim();
  if (!project || project.type !== 'project' || !trimmed)
    throw new Error('project_title_invalid');
  db.prepare(
    'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(withProjectDisplayTitle(project.metadata, trimmed), canonicalId);
  return getEntity(canonicalId)!;
};

export const setProjectPortfolioDisposition = (
  projectId: string,
  disposition: ProjectPortfolioDisposition,
): Entity => {
  const canonicalId = resolveProjectIdentityId(projectId);
  const project = getEntity(canonicalId);
  if (!project || project.type !== 'project')
    throw new Error('project_disposition_invalid');
  db.prepare(
    'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(
    withProjectPortfolioDisposition(project.metadata, disposition),
    canonicalId,
  );
  return getEntity(canonicalId)!;
};

export const saveProjectMilestone = (
  projectId: string,
  input: UserProjectMilestoneInput,
): UserProjectMilestone =>
  db.transaction(() => {
    const canonicalId = resolveProjectIdentityId(projectId);
    const project = getEntity(canonicalId);
    if (!project || project.type !== 'project')
      throw new Error('project_milestone_project_invalid');
    const saved = withSavedUserProjectMilestone(project.metadata, input, {
      id: randomUUID(),
      now: new Date().toISOString(),
    });
    db.prepare(
      'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(saved.metadata, canonicalId);
    return saved.milestone;
  })();

export const deleteProjectMilestone = (
  projectId: string,
  milestoneId: string,
): UserProjectMilestone =>
  db.transaction(() => {
    const canonicalId = resolveProjectIdentityId(projectId);
    const project = getEntity(canonicalId);
    if (!project || project.type !== 'project')
      throw new Error('project_milestone_project_invalid');
    const deleted = withoutProjectMilestone(project.metadata, milestoneId);
    if (!deleted.removed) throw new Error('project_milestone_not_found');
    db.prepare(
      'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(deleted.metadata, canonicalId);
    if (
      deleted.removed.source === 'dreaming' &&
      deleted.removed.dreamingProposalId
    ) {
      const proposal = db
        .prepare(
          'SELECT fingerprint FROM entity_dreaming_proposals WHERE id = ?',
        )
        .get(deleted.removed.dreamingProposalId) as
        | { fingerprint: string }
        | undefined;
      if (!proposal) throw new Error('dreaming_milestone_proposal_missing');
      recordEntityCorrection({
        entityId: canonicalId,
        itemType: 'dreaming:project_milestone',
        fingerprint: proposal.fingerprint,
        reason: 'removed_by_user',
      });
    }
    return deleted.removed;
  })();

export const restoreProjectMilestone = (
  projectId: string,
  milestone: UserProjectMilestone,
): UserProjectMilestone =>
  db.transaction(() => {
    const canonicalId = resolveProjectIdentityId(projectId);
    const project = getEntity(canonicalId);
    if (!project || project.type !== 'project')
      throw new Error('project_milestone_project_invalid');
    const restored = restoreUserProjectMilestone(
      project.metadata,
      milestone,
      new Date().toISOString(),
    );
    db.prepare(
      'UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(restored.metadata, canonicalId);
    return restored.milestone;
  })();

export const mergeProject = (
  projectId: string,
  destinationProjectId: string,
): void => {
  const source = getEntity(projectId);
  const destinationId = resolveProjectIdentityId(destinationProjectId);
  const destination = getEntity(destinationId);
  if (
    !source ||
    !destination ||
    source.type !== 'project' ||
    destination.type !== 'project' ||
    source.id === destination.id ||
    resolveProjectIdentityId(source.id) === destinationId
  )
    throw new Error('project_merge_invalid');
  db.transaction(() => {
    const movedAliases = (
      db
        .prepare(
          'SELECT project_id FROM project_aliases WHERE canonical_id = ? AND active = 1',
        )
        .all(source.id) as Array<{ project_id: string }>
    ).map((alias) => alias.project_id);
    db.prepare(
      `INSERT INTO project_aliases(project_id, canonical_id, moved_aliases_json, active, restored_at)
       VALUES (?, ?, ?, 1, NULL)
       ON CONFLICT(project_id) DO UPDATE SET canonical_id = excluded.canonical_id,
         moved_aliases_json = excluded.moved_aliases_json, active = 1,
         restored_at = NULL, created_at = CURRENT_TIMESTAMP`,
    ).run(source.id, destinationId, JSON.stringify(movedAliases));
    db.prepare(
      'UPDATE project_aliases SET canonical_id = ? WHERE canonical_id = ? AND active = 1',
    ).run(destinationId, source.id);
  })();
};

export const addProjectAlias = (projectId: string, aliasName: string): void => {
  const canonicalId = resolveProjectIdentityId(projectId);
  const project = getEntity(canonicalId);
  const trimmed = aliasName.trim().replace(/\s+/g, ' ');
  if (!project || project.type !== 'project' || !trimmed) {
    throw new Error('project_alias_invalid');
  }
  const normalizedName = normalizeEntityName(trimmed);
  if (normalizedName === project.normalized_name) {
    return;
  }
  db.transaction(() => {
    let aliasEntity = db
      .prepare('SELECT * FROM entities WHERE type = ? AND normalized_name = ?')
      .get('project', normalizedName) as Entity | undefined;
    if (!aliasEntity) {
      const aliasId = `proj_${createHash('sha256')
        .update(`alias:${canonicalId}:${normalizedName}`)
        .digest('hex')
        .slice(0, 12)}`;
      aliasEntity = upsertEntity({
        id: aliasId,
        type: 'project',
        name: trimmed,
        status: 'active',
        dedupe_by_name: false,
      });
    }
    if (
      aliasEntity.id !== canonicalId &&
      resolveProjectIdentityId(aliasEntity.id) !== canonicalId
    ) {
      mergeProject(aliasEntity.id, canonicalId);
    }
  })();
};

export const restoreProjectMerge = (projectId: string): void => {
  db.transaction(() => {
    const alias = db
      .prepare(
        `SELECT moved_aliases_json FROM project_aliases
         WHERE project_id = ? AND active = 1`,
      )
      .get(projectId) as { moved_aliases_json: string | null } | undefined;
    if (!alias) return;
    let movedAliases: string[] = [];
    try {
      const parsed = JSON.parse(alias.moved_aliases_json || '[]');
      if (Array.isArray(parsed))
        movedAliases = parsed.filter(
          (value): value is string => typeof value === 'string',
        );
    } catch {
      movedAliases = [];
    }
    if (movedAliases.length > 0) {
      const placeholders = movedAliases.map(() => '?').join(', ');
      db.prepare(
        `UPDATE project_aliases SET canonical_id = ?
         WHERE project_id IN (${placeholders}) AND active = 1`,
      ).run(projectId, ...movedAliases);
    }
    db.prepare(
      `UPDATE project_aliases SET active = 0, restored_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND active = 1`,
    ).run(projectId);
  })();
};

const parseMeetingParticipants = (
  midJson: string | null | undefined,
): ProjectBriefingMeeting['participants'] => {
  if (!midJson) return [];
  try {
    const parsed = JSON.parse(midJson) as {
      participants?: Array<{
        entity_id?: unknown;
        name?: unknown;
        role?: unknown;
      }>;
    };
    return (parsed.participants ?? []).flatMap((participant) => {
      if (
        typeof participant.entity_id !== 'string' ||
        typeof participant.name !== 'string' ||
        !participant.name.trim()
      ) {
        return [];
      }
      const role =
        typeof participant.role === 'string' &&
        participant.role.trim() &&
        !/^(?:undefined|null|n\/a|none|nobody|unknown)$/i.test(
          participant.role.trim(),
        )
          ? participant.role.trim()
          : undefined;
      return [
        {
          entity_id: participant.entity_id.trim(),
          name: participant.name.trim(),
          ...(role ? { role } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
};

export const getProjectBrief = (projectId: string): ProjectBrief | null => {
  const canonicalId = resolveProjectIdentityId(projectId);
  const project = getEntity(canonicalId);
  if (!project || project.type !== 'project') return null;
  const meetings = db
    .prepare(
      `WITH family(id) AS (
         SELECT ? UNION SELECT project_id FROM project_aliases
         WHERE canonical_id = ? AND active = 1
       )
       SELECT m.*, SUM(me.mention_count) AS mention_count,
         GROUP_CONCAT(DISTINCT me.context) AS context
       FROM meetings m
       JOIN meeting_entities me ON me.meeting_id = m.id
       WHERE me.entity_id IN (SELECT id FROM family)
       GROUP BY m.id
       ORDER BY datetime(COALESCE(m.started_at, m.created_at)) DESC, m.id DESC`,
    )
    .all(canonicalId, canonicalId) as Array<
    PersistedMeeting & { mention_count: number; context: string | null }
  >;
  const briefingMeetings = meetings.map((meeting) => ({
    id: String(meeting.id),
    title: meeting.title,
    started_at: meeting.started_at ?? null,
    created_at: meeting.created_at ?? null,
    meeting_type: meeting.meeting_type ?? null,
    duration_seconds: meeting.duration_seconds ?? null,
    mention_count: meeting.mention_count,
    context: meeting.context,
    participants: parseMeetingParticipants(meeting.mid_json),
  }));
  const tasks = db
    .prepare(
      `WITH family(id) AS (
         SELECT ? UNION SELECT project_id FROM project_aliases
         WHERE canonical_id = ? AND active = 1
       )
       SELECT DISTINCT e.* FROM entities e
       JOIN entity_links l ON l.source_entity_id = e.id
       WHERE e.type = 'action_item'
         AND json_type(CASE WHEN json_valid(e.metadata) THEN e.metadata ELSE '{}' END,
           '$.meeting_regeneration_retired_at') IS NULL
         AND l.relationship = 'belongs_to'
         AND l.state = 'confirmed'
         AND l.target_entity_id IN (SELECT id FROM family)
       ORDER BY CASE e.status WHEN 'overdue' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         datetime(e.due_date) ASC, datetime(e.updated_at) DESC`,
    )
    .all(canonicalId, canonicalId) as Entity[];
  const snapshot = getWorkingMemorySnapshot('project', canonicalId);
  const mergedProjects = db
    .prepare(
      `SELECT e.id, e.name, pa.created_at AS mergedAt
       FROM project_aliases pa JOIN entities e ON e.id = pa.project_id
       WHERE pa.canonical_id = ? AND pa.active = 1
       ORDER BY pa.created_at DESC`,
    )
    .all(canonicalId) as Array<{
    id: string;
    name: string;
    mergedAt: string;
  }>;
  return {
    project: {
      id: project.id,
      displayTitle: readProjectDisplayTitle(project.metadata, project.name),
      detectedTitle: project.name,
      metadata: project.metadata,
      status: project.status,
    },
    theme: readProjectThemeSynthesis(project.metadata),
    meetingStats: buildProjectMeetingStats(briefingMeetings),
    momentum: buildProjectMomentum(briefingMeetings, tasks),
    health: buildProjectHealth(tasks, snapshot),
    milestones: sortProjectMilestones([
      ...buildUserProjectMilestones(project.metadata),
      ...buildProjectMilestones(tasks),
    ]),
    meetings: briefingMeetings,
    tasks,
    mergedProjects,
  };
};

/** Source summaries are independent of task membership and project qualification. */
export const getProjectPortfolio = (): ProjectPortfolioEntry[] => {
  const rows = db
    .prepare(`
    WITH project_identity AS (
      SELECT e.id AS source_id, COALESCE(pa.canonical_id, e.id) AS canonical_id
      FROM entities e LEFT JOIN project_aliases pa
        ON pa.project_id = e.id AND pa.active = 1
      WHERE e.type = 'project'
    ), raw_sources AS (
      SELECT pi.canonical_id AS entity_id, me.meeting_id,
        GROUP_CONCAT(DISTINCT me.context) AS context,
        COALESCE(m.started_at, m.created_at, me.created_at) AS activity_at,
        m.id AS source_sort_id
      FROM project_identity pi JOIN meeting_entities me ON me.entity_id = pi.source_id
      JOIN meetings m ON m.id = me.meeting_id
      GROUP BY pi.canonical_id, me.meeting_id
    ), sources AS (
      SELECT entity_id, meeting_id, context, activity_at,
        COUNT(*) OVER (PARTITION BY entity_id) AS meeting_count,
        ROW_NUMBER() OVER (PARTITION BY pi.entity_id ORDER BY
          datetime(activity_at) DESC, source_sort_id DESC) AS position
      FROM raw_sources pi
    )
    SELECT e.*, COALESCE(s.meeting_count, 0) AS meeting_count,
      s.activity_at AS last_mentioned_at, s.context AS latest_context
    FROM entities e LEFT JOIN sources s ON s.entity_id = e.id AND s.position = 1
    WHERE e.type = 'project' AND NOT EXISTS (
      SELECT 1 FROM project_aliases pa WHERE pa.project_id = e.id AND pa.active = 1
    )
    ORDER BY datetime(COALESCE(s.activity_at, e.updated_at)) DESC, e.name
  `)
    .all() as ProjectPortfolioEntry[];
  return rows.map((row) => {
    if (readProjectQualification(row.metadata)?.state !== 'qualified')
      return {
        ...row,
        display_title: readProjectDisplayTitle(row.metadata, row.name),
      };
    const brief = getProjectBrief(row.id);
    return brief
      ? {
          ...row,
          display_title: brief.project.displayTitle,
          health_state: brief.health.state,
          health_headline: brief.health.headline,
          health_summary: brief.health.summary,
          typical_participant_count: brief.meetingStats.typicalParticipantCount,
          participant_coverage: brief.meetingStats.participantCoverage,
          recurring_cadence:
            brief.meetingStats.recurringSeries[0]?.cadence ?? null,
          next_milestone:
            brief.milestones.find(
              (milestone) => milestone.status !== 'complete',
            )?.title ?? null,
          current_focus: brief.theme?.currentFocus ?? null,
          recent_change: brief.theme?.recentChanges[0]?.summary ?? null,
          open_thread_count: brief.theme?.openThreads.length ?? 0,
        }
      : row;
  });
};

/** Validated conversations that already contain extracted project material. */
export const getProjectInitiativeDiscoverySources = (): Array<
  PersistedMeeting & { project_count: number }
> => {
  return db
    .prepare(`
      SELECT m.*, COUNT(DISTINCT me.entity_id) AS project_count
      FROM meetings m
      JOIN meeting_entities me ON me.meeting_id = m.id
      JOIN entities e ON e.id = me.entity_id AND e.type = 'project'
      WHERE m.transcript_status = 'validated'
      GROUP BY m.id
      ORDER BY project_count DESC,
        datetime(COALESCE(m.started_at, m.created_at)) DESC,
        m.id
    `)
    .all() as Array<PersistedMeeting & { project_count: number }>;
};

export const getEntitiesByType = (type: EntityType): Entity[] => {
  return db
    .prepare(`SELECT * FROM entities WHERE type = ? AND NOT EXISTS
      (SELECT 1 FROM commitment_aliases a WHERE a.extraction_id = entities.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
      AND NOT EXISTS
      (SELECT 1 FROM person_aliases a WHERE a.person_id = entities.id AND a.active = 1)
      ORDER BY updated_at DESC`)
    .all(type) as Entity[];
};

/**
 * Get all entities
 */
export const getAllEntities = (): Entity[] => {
  return db
    .prepare(`SELECT * FROM entities WHERE NOT EXISTS
      (SELECT 1 FROM commitment_aliases a WHERE a.extraction_id = entities.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
      AND NOT EXISTS
      (SELECT 1 FROM person_aliases a WHERE a.person_id = entities.id AND a.active = 1)
      ORDER BY type, updated_at DESC`)
    .all() as Entity[];
};

/**
 * Search entities by name
 */
export const searchEntities = (query: string): Entity[] => {
  const sanitized = query.trim().replace(/[^\p{L}\p{N}\s]/gu, '');
  if (!sanitized) return [];
  return db
    .prepare(`
    SELECT entities.* FROM entities
    JOIN entities_fts ON entities.id = entities_fts.entity_id
    WHERE entities_fts MATCH ?
      AND NOT EXISTS (SELECT 1 FROM commitment_aliases a
        WHERE a.extraction_id = entities.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(entities.metadata) THEN entities.metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
      AND NOT EXISTS (SELECT 1 FROM person_aliases a
        WHERE a.person_id = entities.id AND a.active = 1)
    ORDER BY rank
  `)
    .all(`${sanitized}*`) as Entity[];
};

/**
 * Find entity by normalized name and type
 */
export const findEntity = (
  type: EntityType,
  name: string,
): Entity | undefined => {
  const normalizedName = normalizeEntityName(name);
  const direct = db
    .prepare(`
    SELECT * FROM entities WHERE type = ? AND normalized_name = ?
  `)
    .get(type, normalizedName) as Entity | undefined;
  if (direct?.type === 'person') {
    return getEntity(resolvePersonIdentityId(direct.id));
  }
  if (direct) return direct;
  const dreamingAliasMatches = db
    .prepare(
      `SELECT DISTINCT entity_id FROM entity_dreaming_aliases
       WHERE entity_type = ? AND active = 1 AND normalized_name = ?`,
    )
    .all(type, normalizedName) as Array<{ entity_id: string }>;
  if (dreamingAliasMatches.length === 1) {
    const aliasEntityId = dreamingAliasMatches[0].entity_id;
    return getEntity(
      type === 'person'
        ? resolvePersonIdentityId(aliasEntityId)
        : type === 'project'
          ? resolveProjectIdentityId(aliasEntityId)
          : aliasEntityId,
    );
  }
  if (dreamingAliasMatches.length > 1 || type === 'project') return undefined;
  if (type !== 'person') return undefined;
  const matches = db
    .prepare(
      `SELECT DISTINCT COALESCE(pa.canonical_id, person.id) AS canonical_id
       FROM person_name_aliases name_alias
       JOIN entities person ON person.id = name_alias.person_id
       LEFT JOIN person_aliases pa
         ON pa.person_id = person.id AND pa.active = 1
       WHERE name_alias.normalized_name = ?`,
    )
    .all(normalizedName) as Array<{ canonical_id: string }>;
  return matches.length === 1 ? getEntity(matches[0].canonical_id) : undefined;
};

/**
 * Update entity status (for action items)
 */
export const updateEntityStatus = (id: string, status: EntityStatus): void => {
  db.prepare(`
    UPDATE entities SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
};

/**
 * Record a human review of an extracted action commitment without changing
 * completion status or replacing extraction metadata.
 */
export const updateActionCommitmentState = (
  id: string,
  commitmentState: 'confirmed' | 'rejected',
  reviewedAt = new Date().toISOString(),
): Entity => {
  if (commitmentState !== 'confirmed' && commitmentState !== 'rejected') {
    throw new Error(`Invalid commitment state: ${String(commitmentState)}`);
  }

  return db.transaction(() => {
    const entity = getEntity(id);
    if (!entity) throw new Error(`Entity not found: ${id}`);
    if (entity.type !== 'action_item') {
      throw new Error(`Entity is not an action item: ${id}`);
    }
    if (isRetiredCommitment(id)) throw new Error('commitment_superseded');

    const currentState = getCommitmentState(entity.metadata);
    if (currentState === commitmentState) return entity;
    if (currentState !== 'possible') {
      throw new Error(
        `Cannot transition action commitment from ${currentState} to ${commitmentState}`,
      );
    }

    const metadata = mergeCommitmentReview(
      entity.metadata,
      commitmentState,
      reviewedAt,
    );
    db.prepare(`
      UPDATE entities SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(metadata), id);

    return getEntity(id) as Entity;
  })();
};

/**
 * Delete an entity and all its links
 */
export const deleteEntity = (id: string): void => {
  db.prepare('DELETE FROM entities WHERE id = ?').run(id);

  // Delete from FTS
  try {
    db.prepare('DELETE FROM entities_fts WHERE entity_id = ?').run(id);
  } catch (e) {
    dbLog.warn('Failed to delete entity from FTS', e);
  }

  // CASCADE will handle entity_links and meeting_entities
  dbLog.debug(`Deleted entity: ${id}`);
};

/**
 * Link two entities with a relationship
 */
export const linkEntities = (link: {
  source_entity_id: string;
  target_entity_id: string;
  relationship: RelationshipType;
  meeting_id?: string;
  confidence?: number;
  state?: RelationshipState;
  evidence_meeting_id?: string | null;
  evidence_quote?: string | null;
  source?: LinkSource;
}): EntityLink => {
  // Check if link already exists
  const existing = db
    .prepare(`
    SELECT * FROM entity_links 
    WHERE source_entity_id = ? AND target_entity_id = ? AND relationship = ?
  `)
    .get(link.source_entity_id, link.target_entity_id, link.relationship) as
    | EntityLink
    | undefined;

  if (existing) {
    const nextConfidence = Math.max(
      link.confidence ?? existing.confidence,
      existing.confidence,
    );
    const proposedState = link.state ?? existing.state;
    const nextState =
      existing.state === 'confirmed' && proposedState === 'suggested'
        ? existing.state
        : existing.state === 'rejected' &&
            (link.source || existing.source) === 'synthesis'
          ? existing.state
          : proposedState;
    const nextSource = link.source ?? existing.source;
    db.prepare(`
      UPDATE entity_links SET
        confidence = ?,
        meeting_id = COALESCE(?, meeting_id),
        state = ?,
        evidence_meeting_id = COALESCE(?, evidence_meeting_id),
        evidence_quote = COALESCE(?, evidence_quote),
        source = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextConfidence,
      link.meeting_id || null,
      nextState,
      link.evidence_meeting_id || null,
      link.evidence_quote || null,
      nextSource,
      existing.id,
    );
    return db
      .prepare('SELECT * FROM entity_links WHERE id = ?')
      .get(existing.id) as EntityLink;
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO entity_links (
      id,
      source_entity_id,
      target_entity_id,
      relationship,
      meeting_id,
      state,
      evidence_meeting_id,
      evidence_quote,
      source,
      confidence,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    link.source_entity_id,
    link.target_entity_id,
    link.relationship,
    link.meeting_id || null,
    link.state || 'confirmed',
    link.evidence_meeting_id || link.meeting_id || null,
    link.evidence_quote || null,
    link.source || 'pipeline',
    link.confidence ?? 1.0,
  );

  dbLog.debug(
    `Linked entities: ${link.source_entity_id} -[${link.relationship}]-> ${link.target_entity_id}`,
  );
  return db
    .prepare('SELECT * FROM entity_links WHERE id = ?')
    .get(id) as EntityLink;
};

function upsertCanonicalDreamingProjectCommitment(input: {
  projectId: string;
  task: string;
  proposalId: string;
  runId: string;
  fingerprint: string;
  evidence: Array<{ meetingId: string; excerpt: string }>;
  timestamp: string;
}): void {
  const normalizedTask = normalizeEntityName(input.task);
  const matchingRows = db
    .prepare(
      `SELECT id FROM entities
       WHERE type = 'action_item' AND normalized_name = ? ORDER BY id`,
    )
    .all(normalizedTask) as Array<{ id: string }>;
  const canonicalMatches = new Map<string, Entity>();
  for (const row of matchingRows) {
    const resolved = resolveCommitmentIdentity(row.id);
    if (resolved?.type === 'action_item')
      canonicalMatches.set(resolved.id, resolved);
  }
  if (canonicalMatches.size > 1)
    throw new Error('dreaming_commitment_conflict');
  const action =
    canonicalMatches.values().next().value ??
    upsertEntity({
      type: 'action_item',
      name: input.task.trim().replace(/\s+/g, ' '),
      status: 'active',
      assigned_to: null,
      dedupe_by_name: true,
    });
  if (action.type !== 'action_item' || action.assigned_to !== null) {
    throw new Error('dreaming_commitment_conflict');
  }
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(action.metadata || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }
  const existingSources = Array.isArray(metadata.dreamingSources)
    ? metadata.dreamingSources.filter(
        (source): source is Record<string, unknown> =>
          Boolean(source) &&
          typeof source === 'object' &&
          !Array.isArray(source),
      )
    : [];
  const dreamingSources = existingSources.some(
    (source) => source.proposalId === input.proposalId,
  )
    ? existingSources
    : [
        ...existingSources,
        {
          proposalId: input.proposalId,
          runId: input.runId,
          fingerprint: input.fingerprint,
          meetingIds: input.evidence.map((item) => item.meetingId),
          excerpts: input.evidence.map((item) => item.excerpt),
        },
      ];
  db.prepare(
    'UPDATE entities SET metadata = ?, updated_at = ? WHERE id = ?',
  ).run(
    JSON.stringify({ ...metadata, dreamingSources }),
    input.timestamp,
    action.id,
  );
  const primaryEvidence = input.evidence[0];
  const link = linkEntities({
    source_entity_id: action.id,
    target_entity_id: resolveProjectIdentityId(input.projectId),
    relationship: 'belongs_to',
    meeting_id: primaryEvidence.meetingId,
    state: 'confirmed',
    evidence_meeting_id: primaryEvidence.meetingId,
    evidence_quote: primaryEvidence.excerpt,
    source: 'synthesis',
    confidence: 1,
  });
  if (link.state !== 'confirmed')
    throw new Error('dreaming_commitment_conflict');
}

/**
 * Get all links for an entity (both directions)
 */
export const getEntityLinks = (
  entityId: string,
  options?: { includeRejected?: boolean },
): EntityLink[] => {
  const includeRejected = options?.includeRejected ?? false;
  const resolvedEntity = resolveCommitmentIdentity(entityId);
  const canonicalId =
    resolvedEntity?.type === 'person'
      ? resolvePersonIdentityId(resolvedEntity.id)
      : resolvedEntity?.type === 'project'
        ? resolveProjectIdentityId(resolvedEntity.id)
        : (resolvedEntity?.id ?? entityId);
  const aliasTable =
    resolvedEntity?.type === 'person'
      ? 'person_aliases'
      : resolvedEntity?.type === 'project'
        ? 'project_aliases'
        : 'commitment_aliases';
  const aliasIdColumn =
    resolvedEntity?.type === 'person'
      ? 'person_id'
      : resolvedEntity?.type === 'project'
        ? 'project_id'
        : 'extraction_id';
  const links = db
    .prepare(`
    WITH RECURSIVE family(id) AS (
      SELECT ? UNION
      SELECT a.${aliasIdColumn} FROM ${aliasTable} a
      JOIN family f ON a.canonical_id = f.id WHERE a.active = 1
    )
    SELECT * FROM entity_links
    WHERE (source_entity_id IN (SELECT id FROM family)
      OR target_entity_id IN (SELECT id FROM family))
      ${includeRejected ? '' : "AND state != 'rejected'"}
    ORDER BY updated_at DESC, created_at DESC
  `)
    .all(canonicalId) as EntityLink[];
  // Keep original edges intact for restoration, but expose their current identity.
  const visibleId = (id: string) => {
    const resolved = resolveCommitmentIdentity(id) ?? getEntity(id);
    return resolved?.type === 'person'
      ? resolvePersonIdentityId(resolved.id)
      : resolved?.type === 'project'
        ? resolveProjectIdentityId(resolved.id)
        : (resolved?.id ?? id);
  };
  return links
    .map((link) => ({
      ...link,
      source_entity_id: visibleId(link.source_entity_id),
      target_entity_id: visibleId(link.target_entity_id),
    }))
    .filter((link) => link.source_entity_id !== link.target_entity_id);
};

/**
 * Get entities related to a specific entity
 */
export const getRelatedEntities = (
  entityId: string,
  options?: { includeRejected?: boolean },
): (Entity & {
  link_id: string;
  relationship: string;
  direction: 'outgoing' | 'incoming';
  state: RelationshipState;
  confidence: number;
  evidence_quote: string | null;
})[] => {
  const resolved = resolveCommitmentIdentity(entityId) ?? getEntity(entityId);
  const canonicalId =
    resolved?.type === 'person'
      ? resolvePersonIdentityId(resolved.id)
      : resolved?.type === 'project'
        ? resolveProjectIdentityId(resolved.id)
        : (resolved?.id ?? entityId);
  const links = getEntityLinks(canonicalId, options);
  const results: (Entity & {
    link_id: string;
    relationship: string;
    direction: 'outgoing' | 'incoming';
    state: RelationshipState;
    confidence: number;
    evidence_quote: string | null;
  })[] = [];

  for (const link of links) {
    if (link.source_entity_id === canonicalId) {
      const entity = getEntity(link.target_entity_id);
      if (entity && !isRetiredCommitment(entity.id)) {
        results.push({
          ...entity,
          link_id: link.id,
          relationship: link.relationship,
          direction: 'outgoing',
          state: link.state,
          confidence: link.confidence,
          evidence_quote: link.evidence_quote,
        });
      }
    } else {
      const entity = getEntity(link.source_entity_id);
      if (entity && !isRetiredCommitment(entity.id)) {
        results.push({
          ...entity,
          link_id: link.id,
          relationship: link.relationship,
          direction: 'incoming',
          state: link.state,
          confidence: link.confidence,
          evidence_quote: link.evidence_quote,
        });
      }
    }
  }

  return results;
};

/**
 * Associate an entity with a meeting
 */
export const addMeetingEntity = (meetingEntity: {
  meeting_id: string;
  entity_id: string;
  mention_count?: number;
  first_mentioned_at?: number;
  context?: string;
}): MeetingEntity => {
  // Check if association already exists
  const existing = db
    .prepare(`
    SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?
  `)
    .get(meetingEntity.meeting_id, meetingEntity.entity_id) as
    | MeetingEntity
    | undefined;

  if (existing) {
    // Update mention count and context
    db.prepare(`
      UPDATE meeting_entities SET
        mention_count = mention_count + COALESCE(?, 1),
        context = COALESCE(?, context)
      WHERE meeting_id = ? AND entity_id = ?
    `).run(
      meetingEntity.mention_count || 1,
      meetingEntity.context,
      meetingEntity.meeting_id,
      meetingEntity.entity_id,
    );
    return db
      .prepare(
        'SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
      )
      .get(meetingEntity.meeting_id, meetingEntity.entity_id) as MeetingEntity;
  }

  db.prepare(`
    INSERT INTO meeting_entities (meeting_id, entity_id, mention_count, first_mentioned_at, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    meetingEntity.meeting_id,
    meetingEntity.entity_id,
    meetingEntity.mention_count || 1,
    meetingEntity.first_mentioned_at || null,
    meetingEntity.context || null,
  );

  return db
    .prepare(
      'SELECT * FROM meeting_entities WHERE meeting_id = ? AND entity_id = ?',
    )
    .get(meetingEntity.meeting_id, meetingEntity.entity_id) as MeetingEntity;
};

/**
 * Insert a meeting association once without treating pipeline replay as a new
 * mention or replacing the original evidence context.
 */
export const ensureMeetingEntity = (meetingEntity: {
  meeting_id: string;
  entity_id: string;
  mention_count?: number;
  first_mentioned_at?: number;
  context?: string;
}): boolean => {
  const result = db
    .prepare(`
      INSERT INTO meeting_entities (meeting_id, entity_id, mention_count, first_mentioned_at, context)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(meeting_id, entity_id) DO NOTHING
    `)
    .run(
      meetingEntity.meeting_id,
      meetingEntity.entity_id,
      meetingEntity.mention_count || 1,
      meetingEntity.first_mentioned_at || null,
      meetingEntity.context || null,
    );
  return result.changes === 1;
};

/**
 * Get all entities mentioned in a meeting
 */
export const getMeetingEntities = (
  meetingId: string,
): (Entity & { mention_count: number; context: string | null })[] => {
  const rows = db
    .prepare(`
    SELECT e.*, me.mention_count, me.context
    FROM entities e
    JOIN meeting_entities me ON e.id = me.entity_id
    WHERE me.meeting_id = ?
    ORDER BY me.mention_count DESC
  `)
    .all(meetingId) as (Entity & {
    mention_count: number;
    context: string | null;
  })[];
  const canonicalRows = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const canonical =
      row.type === 'action_item'
        ? resolveCommitmentIdentity(row.id)
        : row.type === 'person'
          ? getEntity(resolvePersonIdentityId(row.id))
          : row;
    if (canonical && !canonicalRows.has(canonical.id))
      canonicalRows.set(canonical.id, {
        ...canonical,
        mention_count: row.mention_count,
        context: row.context,
      });
  }
  return [...canonicalRows.values()];
};

/**
 * Get all meetings where an entity was mentioned
 */
export const getEntityMeetings = (
  entityId: string,
): (PersistedMeeting & {
  mention_count: number;
  context: string | null;
})[] => {
  const entity = getEntity(entityId);
  const canonicalId =
    entity?.type === 'person'
      ? resolvePersonIdentityId(entityId)
      : entity?.type === 'project'
        ? resolveProjectIdentityId(entityId)
        : entity?.type === 'action_item'
          ? resolveCommitmentIdentity(entityId)?.id || entityId
          : entityId;
  const aliasTable =
    entity?.type === 'person'
      ? 'person_aliases'
      : entity?.type === 'project'
        ? 'project_aliases'
        : 'commitment_aliases';
  const aliasIdColumn =
    entity?.type === 'person'
      ? 'person_id'
      : entity?.type === 'project'
        ? 'project_id'
        : 'extraction_id';
  return db
    .prepare(`
    WITH RECURSIVE family(id) AS (
      SELECT ? UNION SELECT a.${aliasIdColumn} FROM ${aliasTable} a
      JOIN family f ON a.canonical_id = f.id WHERE a.active = 1
    )
    SELECT m.*, SUM(me.mention_count) AS mention_count, GROUP_CONCAT(DISTINCT me.context) AS context
    FROM meetings m
    JOIN meeting_entities me ON m.id = me.meeting_id
    JOIN family f ON f.id = me.entity_id
    GROUP BY m.id
    ORDER BY m.started_at DESC
  `)
    .all(canonicalId) as (PersistedMeeting & {
    mention_count: number;
    context: string | null;
  })[];
};

export interface DreamingEntityNoteSource {
  id: string;
  title: string;
  started_at: string | null;
  created_at: string | null;
  user_notes: string | null;
  enhanced_notes: string | null;
}

const dreamingEntityNotesQuery = (
  aliasTable: 'person_aliases' | 'project_aliases',
  aliasIdColumn: 'person_id' | 'project_id',
): string => `
  WITH family(id) AS (
    SELECT ? UNION SELECT a.${aliasIdColumn} FROM ${aliasTable} a
    WHERE a.canonical_id = ? AND a.active = 1
  )
  SELECT
    m.id,
    m.title,
    m.started_at,
    m.created_at,
    m.user_notes,
    m.enhanced_notes
  FROM meeting_entities me INDEXED BY idx_meeting_entities_entity_meeting
  JOIN meetings m ON m.id = me.meeting_id
  WHERE me.entity_id IN (SELECT id FROM family)
    AND (
      TRIM(COALESCE(m.user_notes, '')) != ''
      OR TRIM(COALESCE(m.enhanced_notes, '')) != ''
    )
  GROUP BY m.id
  ORDER BY datetime(COALESCE(m.started_at, m.created_at)) DESC, m.id DESC
  LIMIT ?
`;

const getDreamingEntityQueryContext = (entityId: string) => {
  const entity = getEntity(entityId);
  if (!entity || (entity.type !== 'person' && entity.type !== 'project')) {
    return null;
  }
  return entity.type === 'person'
    ? {
        canonicalId: resolvePersonIdentityId(entity.id),
        aliasTable: 'person_aliases' as const,
        aliasIdColumn: 'person_id' as const,
      }
    : {
        canonicalId: resolveProjectIdentityId(entity.id),
        aliasTable: 'project_aliases' as const,
        aliasIdColumn: 'project_id' as const,
      };
};

/**
 * Return the bounded, notes-only meeting projection used by idle dreaming.
 * Keep this projection explicit: transcripts, audio paths, and analysis payloads
 * are intentionally unavailable to the packager.
 */
export const getDreamingEntityNotes = (
  entityId: string,
  limit = 8,
): DreamingEntityNoteSource[] => {
  const context = getDreamingEntityQueryContext(entityId);
  if (!context) return [];
  const boundedLimit = Math.max(1, Math.min(8, Math.trunc(limit)));

  return db
    .prepare(
      dreamingEntityNotesQuery(context.aliasTable, context.aliasIdColumn),
    )
    .all(
      context.canonicalId,
      context.canonicalId,
      boundedLimit,
    ) as DreamingEntityNoteSource[];
};

export const getDreamingEntityNotesQueryPlan = (entityId: string): string[] => {
  const context = getDreamingEntityQueryContext(entityId);
  if (!context) return [];
  const rows = db
    .prepare(
      `EXPLAIN QUERY PLAN ${dreamingEntityNotesQuery(
        context.aliasTable,
        context.aliasIdColumn,
      )}`,
    )
    .all(context.canonicalId, context.canonicalId, 8) as Array<{
    detail: string;
  }>;
  return rows.map((row) => row.detail);
};

interface AcceptedDreamingPersonClaim {
  proposalId: string;
  runId: string;
  kind: 'person_headline' | 'person_focus' | 'person_collaborator';
  value: string;
  sourceMeetingIds: string[];
  excerpts: string[];
  createdAt: string;
}

const getAcceptedDreamingPersonClaims = (
  canonicalId: string,
): AcceptedDreamingPersonClaim[] => {
  const rows = db
    .prepare(`WITH family(id) AS (
      SELECT ? UNION SELECT person_id FROM person_aliases
      WHERE canonical_id = ? AND active = 1
    )
    SELECT claim.proposal_id, proposal.run_id, claim.kind, claim.value,
      claim.evidence_json, claim.created_at
    FROM entity_dreaming_person_claims claim
    JOIN entity_dreaming_proposals proposal ON proposal.id = claim.proposal_id
    WHERE claim.entity_id IN (SELECT id FROM family)
    ORDER BY claim.created_at, claim.proposal_id`)
    .all(canonicalId, canonicalId) as Array<{
    proposal_id: string;
    run_id: string;
    kind: AcceptedDreamingPersonClaim['kind'];
    value: string;
    evidence_json: string;
    created_at: string;
  }>;
  return rows.map((row) => {
    let evidence: Array<{ meetingId: string; excerpt: string }> = [];
    try {
      const parsed = JSON.parse(row.evidence_json) as unknown;
      if (Array.isArray(parsed)) {
        evidence = parsed.filter(
          (item): item is { meetingId: string; excerpt: string } =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as { meetingId?: unknown }).meetingId === 'string' &&
            typeof (item as { excerpt?: unknown }).excerpt === 'string',
        );
      }
    } catch {
      evidence = [];
    }
    return {
      proposalId: row.proposal_id,
      runId: row.run_id,
      kind: row.kind,
      value: row.value,
      sourceMeetingIds: evidence.map((item) => item.meetingId),
      excerpts: evidence.map((item) => item.excerpt),
      createdAt: row.created_at,
    };
  });
};

const acceptedPersonRead = (
  claims: AcceptedDreamingPersonClaim[],
  fallbackHeadline: string,
  fallbackBullets: string[],
) => {
  const acceptedHeadline = claims
    .filter((claim) => claim.kind === 'person_headline')
    .at(-1)?.value;
  const acceptedBullets = claims
    .filter((claim) => claim.kind !== 'person_headline')
    .map((claim) => claim.value);
  return {
    headline: acceptedHeadline ?? fallbackHeadline,
    supportingBullets: [...new Set([...fallbackBullets, ...acceptedBullets])],
  };
};

const overlayAcceptedClaimsOnKnowledgeDoc = (
  doc: KnowledgeDoc | null,
  claims: AcceptedDreamingPersonClaim[],
): KnowledgeDoc | null => {
  if (!doc || claims.length === 0) return doc;
  let structured: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(doc.structured_json || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>;
    }
  } catch {
    structured = {};
  }
  const current =
    structured.current_read &&
    typeof structured.current_read === 'object' &&
    !Array.isArray(structured.current_read)
      ? (structured.current_read as Record<string, unknown>)
      : {};
  const read = acceptedPersonRead(
    claims,
    typeof current.headline === 'string' ? current.headline : '',
    Array.isArray(current.supporting_bullets)
      ? current.supporting_bullets.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
  );
  const acceptedEvidence = claims.flatMap((claim) =>
    claim.sourceMeetingIds.map((meetingId, index) => ({
      id: `dreaming-${claim.proposalId}-${index}`,
      meeting_id: meetingId,
      meeting_title: '',
      captured_at: claim.createdAt,
      quote: claim.excerpts[index] ?? '',
      stream_ids: [],
      item_ids: [claim.proposalId],
      mode: 'direct',
      confidence: 1,
    })),
  );
  const existingEvidence = Array.isArray(structured.evidence_index)
    ? structured.evidence_index
    : [];
  const meetingCount = new Set(
    acceptedEvidence.map((entry) => entry.meeting_id).filter(Boolean),
  ).size;
  return {
    ...doc,
    structured_json: JSON.stringify({
      ...structured,
      current_read: {
        ...current,
        headline: read.headline,
        supporting_bullets: read.supportingBullets,
        source_count: Math.max(
          typeof current.source_count === 'number' ? current.source_count : 0,
          meetingCount,
        ),
        cited_item_count: Math.max(
          typeof current.cited_item_count === 'number'
            ? current.cited_item_count
            : 0,
          claims.length,
        ),
        cited_meeting_count: Math.max(
          typeof current.cited_meeting_count === 'number'
            ? current.cited_meeting_count
            : 0,
          meetingCount,
        ),
      },
      evidence_index: [...existingEvidence, ...acceptedEvidence],
    }),
  };
};

const overlayAcceptedClaimsOnSnapshot = (
  snapshot: WorkingMemorySnapshot | null,
  claims: AcceptedDreamingPersonClaim[],
): WorkingMemorySnapshot | null => {
  if (!snapshot || claims.length === 0) return snapshot;
  const read = acceptedPersonRead(
    claims,
    snapshot.payload.current_read.headline,
    snapshot.payload.current_read.supporting_bullets,
  );
  const acceptedEvidence = claims.flatMap((claim) =>
    claim.sourceMeetingIds.map((meetingId, index) => ({
      id: `dreaming-${claim.proposalId}-${index}`,
      meeting_id: meetingId,
      meeting_title: '',
      captured_at: claim.createdAt,
      quote: claim.excerpts[index] ?? '',
      stream_ids: [],
      item_ids: [claim.proposalId],
      mode: 'direct' as const,
      confidence: 1,
    })),
  );
  const meetingCount = new Set(
    acceptedEvidence.map((entry) => entry.meeting_id).filter(Boolean),
  ).size;
  return {
    ...snapshot,
    payload: {
      ...snapshot.payload,
      current_read: {
        ...snapshot.payload.current_read,
        headline: read.headline,
        supporting_bullets: read.supportingBullets,
        source_count: Math.max(
          snapshot.payload.current_read.source_count,
          meetingCount,
        ),
        cited_item_count: Math.max(
          snapshot.payload.current_read.cited_item_count,
          claims.length,
        ),
        cited_meeting_count: Math.max(
          snapshot.payload.current_read.cited_meeting_count,
          meetingCount,
        ),
      },
      evidence_index: [...snapshot.payload.evidence_index, ...acceptedEvidence],
    },
  };
};

/** Compact accepted state supplied to dreaming so proposals do not repeat it. */
export const getDreamingEntityBaseline = (
  entityId: string,
): Record<string, unknown> => {
  const entity = getEntity(entityId);
  if (!entity || (entity.type !== 'person' && entity.type !== 'project')) {
    return {};
  }
  const canonicalId =
    entity.type === 'person'
      ? resolvePersonIdentityId(entity.id)
      : resolveProjectIdentityId(entity.id);
  const canonical = getEntity(canonicalId);
  if (!canonical) return {};
  const aliasTable =
    canonical.type === 'person' ? 'person_aliases' : 'project_aliases';
  const aliasIdColumn =
    canonical.type === 'person' ? 'person_id' : 'project_id';
  const identityAliases = db
    .prepare(`
      SELECT alias.id, alias.name
      FROM ${aliasTable} identity
      JOIN entities alias ON alias.id = identity.${aliasIdColumn}
      WHERE identity.canonical_id = ? AND identity.active = 1
      ORDER BY alias.id
      LIMIT 24
    `)
    .all(canonicalId) as Array<{ id: string; name: string }>;
  const dreamingAliases = db
    .prepare(
      `WITH family(id) AS (
         SELECT ? UNION SELECT ${aliasIdColumn} FROM ${aliasTable}
         WHERE canonical_id = ? AND active = 1
       )
       SELECT normalized_name AS id, MIN(display_name) AS name
       FROM entity_dreaming_aliases
       WHERE entity_type = ? AND entity_id IN (SELECT id FROM family)
         AND active = 1
       GROUP BY normalized_name
       ORDER BY normalized_name LIMIT 24`,
    )
    .all(canonicalId, canonicalId, canonical.type) as Array<{
    id: string;
    name: string;
  }>;
  const userNameAliases =
    canonical.type === 'person'
      ? (db
          .prepare(`SELECT normalized_name AS id, display_name AS name
            FROM person_name_aliases WHERE person_id = ?
            ORDER BY normalized_name LIMIT 24`)
          .all(canonicalId) as Array<{ id: string; name: string }>)
      : [];
  const aliases = [
    ...identityAliases,
    ...userNameAliases,
    ...dreamingAliases,
  ].slice(0, 24);
  const commitments =
    canonical.type === 'project'
      ? (db
          .prepare(`
            WITH family(id) AS (
              SELECT ? UNION SELECT project_id FROM project_aliases
              WHERE canonical_id = ? AND active = 1
            )
            SELECT DISTINCT action.id, action.name, action.status, action.due_date
            FROM entities action
            JOIN entity_links link ON link.source_entity_id = action.id
            WHERE action.type = 'action_item'
              AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
                '$.meeting_regeneration_retired_at') IS NULL
              AND link.relationship = 'belongs_to'
              AND link.state = 'confirmed'
              AND link.target_entity_id IN (SELECT id FROM family)
            ORDER BY action.id
            LIMIT 24
          `)
          .all(canonicalId, canonicalId) as Array<{
          id: string;
          name: string;
          status: EntityStatus;
          due_date: string | null;
        }>)
      : (db
          .prepare(`
            WITH family(id) AS (
              SELECT ? UNION SELECT person_id FROM person_aliases
              WHERE canonical_id = ? AND active = 1
            )
            SELECT id, name, status, due_date
            FROM entities
            WHERE type = 'action_item' AND assigned_to IN (SELECT id FROM family)
              AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                '$.meeting_regeneration_retired_at') IS NULL
            ORDER BY id
            LIMIT 24
          `)
          .all(canonicalId, canonicalId) as Array<{
          id: string;
          name: string;
          status: EntityStatus;
          due_date: string | null;
        }>);
  const scopeType = canonical.type === 'person' ? 'person_context' : 'project';
  const snapshot = getWorkingMemorySnapshot(scopeType, canonicalId);
  let acceptedPersonCurrentRead: {
    headline: string;
    supportingBullets: string[];
  } | null = null;
  const acceptedPersonClaims =
    canonical.type === 'person'
      ? getAcceptedDreamingPersonClaims(canonicalId)
      : [];
  if (canonical.type === 'person') {
    const personDoc = getKnowledgeDocByScope('person_context', canonicalId);
    try {
      const structured = JSON.parse(personDoc?.structured_json || '{}') as {
        current_read?: {
          headline?: unknown;
          supporting_bullets?: unknown;
        };
      };
      if (
        typeof structured.current_read?.headline === 'string' &&
        Array.isArray(structured.current_read.supporting_bullets)
      ) {
        acceptedPersonCurrentRead = {
          headline: structured.current_read.headline,
          supportingBullets: structured.current_read.supporting_bullets.filter(
            (item): item is string => typeof item === 'string',
          ),
        };
      }
    } catch {
      acceptedPersonCurrentRead = null;
    }
    if (acceptedPersonClaims.length > 0) {
      acceptedPersonCurrentRead = acceptedPersonRead(
        acceptedPersonClaims,
        acceptedPersonCurrentRead?.headline ??
          snapshot?.payload.current_read.headline ??
          '',
        acceptedPersonCurrentRead?.supportingBullets ??
          snapshot?.payload.current_read.supporting_bullets ??
          [],
      );
    }
  }

  const common = {
    status: canonical.status,
    aliases,
    commitments,
    ...(canonical.type === 'person' ? { acceptedPersonClaims } : {}),
    currentRead:
      acceptedPersonCurrentRead ??
      (snapshot
        ? {
            headline: snapshot.payload.current_read.headline,
            supportingBullets: snapshot.payload.current_read.supporting_bullets,
          }
        : null),
  };
  if (canonical.type === 'person') {
    return {
      ...common,
      role: parsePersonRole(canonical.metadata),
    };
  }
  const theme = readProjectThemeSynthesis(canonical.metadata);
  return {
    ...common,
    displayTitle: readProjectDisplayTitle(canonical.metadata, canonical.name),
    theme: theme
      ? { outcome: theme.outcome, currentFocus: theme.currentFocus }
      : null,
    milestones: buildUserProjectMilestones(canonical.metadata)
      .slice(0, 24)
      .map(({ title, status, targetDate, note }) => ({
        title,
        status,
        targetDate,
        note,
      })),
  };
};

type PeopleBriefingSummaryRow = {
  id: string;
  name: string;
  metadata: string | null;
  meeting_count: number;
  mention_count: number;
  latest_meeting_id: string | null;
  latest_meeting_title: string | null;
  latest_meeting_at: string | null;
  latest_context: string | null;
  open_commitment_count: number;
  verified_open_commitment_count?: number;
  candidate_commitment_count: number;
  brief_headline: string | null;
  brief_status: string | null;
  brief_updated_at: string | null;
  possible_duplicate_count: number;
};

/**
 * Build the People list in one bounded query. This read model intentionally
 * selects no transcript, notes, or analysis payloads; full evidence is loaded
 * only for the person the user opens.
 */
export const getPeopleBriefingSummaries = (): PersonBriefingSummary[] => {
  const rows = db
    .prepare(`
      WITH person_identity AS (
        SELECT
          person.id AS source_id,
          COALESCE(alias.canonical_id, person.id) AS canonical_id
        FROM entities person
        LEFT JOIN person_aliases alias
          ON alias.person_id = person.id AND alias.active = 1
        WHERE person.type = 'person'
      ), person_meeting_evidence AS (
        SELECT
          identity.canonical_id AS person_id,
          me.meeting_id,
          me.mention_count,
          me.context
        FROM meeting_entities me
        JOIN person_identity identity ON identity.source_id = me.entity_id
        UNION ALL
        SELECT
          identity.canonical_id AS person_id,
          binding.meeting_id,
          0 AS mention_count,
          NULL AS context
        FROM identity_bindings binding
        JOIN person_identity identity
          ON identity.source_id = json_extract(binding.payload, '$.personId')
        WHERE json_valid(binding.payload)
          AND json_extract(binding.payload, '$.individual') = 1
          AND json_type(binding.payload, '$.personId') = 'text'
      ), person_meetings AS (
        SELECT
          evidence.person_id,
          m.id AS meeting_id,
          m.title AS meeting_title,
          COALESCE(m.started_at, m.created_at) AS meeting_at,
          SUM(evidence.mention_count) AS mention_count,
          GROUP_CONCAT(DISTINCT evidence.context) AS context
        FROM person_meeting_evidence evidence
        JOIN meetings m ON m.id = evidence.meeting_id
        GROUP BY evidence.person_id, m.id
      ), ranked_meetings AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY person_id
          ORDER BY datetime(meeting_at) DESC, meeting_id DESC
        ) AS recency_rank
        FROM person_meetings
      ), meeting_stats AS (
        SELECT
          person_id,
          COUNT(*) AS meeting_count,
          COALESCE(SUM(mention_count), 0) AS mention_count
        FROM person_meetings
        GROUP BY person_id
      ), open_commitments AS (
        SELECT identity.canonical_id AS person_id,
          COUNT(*) AS open_commitment_count,
          COUNT(CASE WHEN json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.owner_source'
          ) = 'user' THEN 1 END) AS verified_open_commitment_count
        FROM entities action
        JOIN person_identity identity ON identity.source_id = action.assigned_to
        WHERE action.type = 'action_item'
          AND action.status IN ('active', 'overdue')
          AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.meeting_regeneration_retired_at') IS NULL
          AND COALESCE(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.commitment_state'
          ), '') != 'rejected'
          AND json_type(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.source_meeting_id'
          ) = 'text'
        GROUP BY identity.canonical_id
      ), person_names AS (
        SELECT identity.canonical_id AS person_id, person.normalized_name
        FROM entities person
        JOIN person_identity identity ON identity.source_id = person.id
        WHERE person.type = 'person'
        UNION
        SELECT identity.canonical_id AS person_id, name_alias.normalized_name
        FROM person_name_aliases name_alias
        JOIN person_identity identity ON identity.source_id = name_alias.person_id
      ), bound_action_candidates AS (
        SELECT
          identity.canonical_id AS person_id,
          action.id AS action_id
        FROM identity_bindings binding
        JOIN person_identity identity
          ON identity.source_id = json_extract(binding.payload, '$.personId')
        JOIN entities action
          ON action.type = 'action_item'
          AND action.assigned_to IS NULL
          AND json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.source_meeting_id'
          ) = binding.meeting_id
          AND (
            LOWER(TRIM(binding.speaker)) = LOWER(TRIM(json_extract(
              CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
              '$.assignee_name'
            )))
            OR (
              binding.speaker LIKE 'Remote Speaker %'
              AND 'Speaker ' || SUBSTR(binding.speaker, 16) = json_extract(
                CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
                '$.assignee_name'
              )
            )
            OR (
              json_extract(
                CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
                '$.assignee_name'
              ) LIKE 'Remote Speaker %'
              AND 'Speaker ' || SUBSTR(json_extract(
                CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
                '$.assignee_name'
              ), 16) = binding.speaker
            )
          )
        WHERE json_valid(binding.payload)
          AND json_extract(binding.payload, '$.individual') = 1
          AND json_type(binding.payload, '$.personId') = 'text'
          AND action.status IN ('active', 'overdue')
          AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.meeting_regeneration_retired_at') IS NULL
          AND COALESCE(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.owner_source'
          ), '') != 'user'
          AND COALESCE(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.commitment_state'
          ), '') != 'rejected'
          AND json_type(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.source_meeting_id'
          ) = 'text'
      ), named_action_candidates AS (
        SELECT
          names.person_id,
          action.id AS action_id
        FROM person_names names
        JOIN entities action
          ON action.type = 'action_item'
          AND action.assigned_to IS NULL
          AND LOWER(TRIM(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.assignee_name'
          ))) = names.normalized_name
        WHERE action.status IN ('active', 'overdue')
          AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.meeting_regeneration_retired_at') IS NULL
          AND COALESCE(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.owner_source'
          ), '') != 'user'
          AND COALESCE(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.commitment_state'
          ), '') != 'rejected'
          AND json_type(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.source_meeting_id'
          ) = 'text'
      ), candidate_commitments AS (
        SELECT person_id, COUNT(DISTINCT action_id) AS candidate_commitment_count
        FROM (
          SELECT person_id, action_id FROM named_action_candidates
          UNION
          SELECT person_id, action_id FROM bound_action_candidates
        )
        GROUP BY person_id
      )
      SELECT
        person.id,
        person.name,
        person.metadata,
        COALESCE(stats.meeting_count, 0) AS meeting_count,
        COALESCE(stats.mention_count, 0) AS mention_count,
        latest.meeting_id AS latest_meeting_id,
        latest.meeting_title AS latest_meeting_title,
        latest.meeting_at AS latest_meeting_at,
        latest.context AS latest_context,
        COALESCE(commitments.open_commitment_count, 0) AS open_commitment_count,
        COALESCE(commitments.verified_open_commitment_count, 0) AS verified_open_commitment_count,
        COALESCE(candidates.candidate_commitment_count, 0) AS candidate_commitment_count,
        CASE
          WHEN json_valid(brief.structured_json)
            AND json_type(brief.structured_json, '$.current_read.headline') = 'text'
          THEN json_extract(brief.structured_json, '$.current_read.headline')
          ELSE NULL
        END AS brief_headline,
        brief.status AS brief_status,
        COALESCE(brief.last_synthesized_at, brief.updated_at) AS brief_updated_at,
        (
          SELECT COUNT(*) FROM entities possible
          WHERE possible.type = 'person'
            AND possible.id != person.id
            AND possible.normalized_name = person.normalized_name
            AND NOT EXISTS (
              SELECT 1 FROM person_aliases hidden
              WHERE hidden.person_id = possible.id AND hidden.active = 1
            )
        ) AS possible_duplicate_count
      FROM entities person
      LEFT JOIN meeting_stats stats ON stats.person_id = person.id
      LEFT JOIN ranked_meetings latest
        ON latest.person_id = person.id AND latest.recency_rank = 1
      LEFT JOIN open_commitments commitments ON commitments.person_id = person.id
      LEFT JOIN candidate_commitments candidates ON candidates.person_id = person.id
      LEFT JOIN knowledge_docs brief
        ON brief.scope_type = 'person_context' AND brief.scope_key = person.id
      WHERE person.type = 'person'
        AND NOT EXISTS (SELECT 1 FROM person_aliases alias
          WHERE alias.person_id = person.id AND alias.active = 1)
      ORDER BY
        COALESCE(commitments.open_commitment_count, 0) DESC,
        datetime(latest.meeting_at) DESC,
        person.name ASC
    `)
    .all() as PeopleBriefingSummaryRow[];

  const selfPersonId = identityStore.getSelfPersonId();
  const canonicalSelfPersonId = selfPersonId
    ? resolvePersonIdentityId(selfPersonId)
    : null;

  return rows
    .filter((row) => isUsablePersonName(row.name))
    .map((row) => {
      const isSelf =
        canonicalSelfPersonId !== null && row.id === canonicalSelfPersonId;
      const verifiedOpenCount = Number(
        row.verified_open_commitment_count ?? row.open_commitment_count,
      );
      const allAssignedOpenCount = Number(row.open_commitment_count);
      const candidateCount = Number(row.candidate_commitment_count);
      return {
        id: row.id,
        name: row.name,
        role: parsePersonRole(row.metadata),
        meetingCount: Number(row.meeting_count),
        mentionCount: Number(row.mention_count),
        latestMeetingId: row.latest_meeting_id,
        latestMeetingTitle: row.latest_meeting_title,
        latestMeetingAt: row.latest_meeting_at,
        context: row.latest_context,
        openCommitmentCount: isSelf
          ? verifiedOpenCount
          : allAssignedOpenCount + candidateCount,
        candidateCommitmentCount: isSelf ? candidateCount : 0,
        briefHeadline: row.brief_headline,
        briefStatus: row.brief_status,
        briefUpdatedAt: row.brief_updated_at,
        possibleDuplicateCount: Number(row.possible_duplicate_count),
      };
    })
    .sort(
      (a, b) =>
        b.openCommitmentCount - a.openCommitmentCount ||
        b.candidateCommitmentCount - a.candidateCommitmentCount ||
        (Date.parse(b.latestMeetingAt || '') || 0) -
          (Date.parse(a.latestMeetingAt || '') || 0) ||
        a.name.localeCompare(b.name),
    );
};

export interface PersonBriefingDetail {
  person: Entity;
  meetings: PersonBriefingMeeting[];
  commitments: {
    open: PersonBriefingCommitment[];
    delivered: PersonBriefingCommitment[];
    candidates: PersonBriefingCommitmentCandidate[];
  };
  isSelf: boolean;
  knowledgeDoc: KnowledgeDoc | null;
  workingMemorySnapshot: WorkingMemorySnapshot | null;
  mergedPeople: Array<{ id: string; name: string; mergedAt: string }>;
}

const toPersonMeetingRecord = (
  meeting: Pick<
    PersistedMeeting,
    'id' | 'title' | 'started_at' | 'created_at' | 'duration_seconds'
  >,
  context: string | null = null,
): PersonMeetingRecord => ({
  id: String(meeting.id),
  title: meeting.title || 'Untitled meeting',
  started_at: meeting.started_at || null,
  created_at: meeting.created_at || null,
  duration_seconds: meeting.duration_seconds ?? null,
  context,
});

const getPersonMeetingRecord = (
  meetingId: string,
): PersonMeetingRecord | undefined => {
  const meeting = db
    .prepare(`
      SELECT id, title, started_at, created_at, duration_seconds
      FROM meetings
      WHERE id = ?
    `)
    .get(meetingId) as
    | Pick<
        PersistedMeeting,
        'id' | 'title' | 'started_at' | 'created_at' | 'duration_seconds'
      >
    | undefined;
  return meeting ? toPersonMeetingRecord(meeting) : undefined;
};

/**
 * Build the People dossier from evidence-bearing identity, calendar, entity,
 * and explicit commitment-owner records. Display names never grant authority.
 */
export const getPersonBriefing = (
  personId: string,
): PersonBriefingDetail | undefined => {
  const canonicalId = resolvePersonIdentityId(personId);
  const person = getEntity(canonicalId);
  if (!person || person.type !== 'person' || !isUsablePersonName(person.name))
    return undefined;

  const mentionedMeetings = (
    db
      .prepare(`
        WITH family(id) AS (
          SELECT ? UNION SELECT person_id FROM person_aliases
          WHERE canonical_id = ? AND active = 1
        )
        SELECT
          m.id,
          m.title,
          m.started_at,
          m.created_at,
          m.duration_seconds,
          GROUP_CONCAT(DISTINCT me.context) AS context
        FROM meetings m
        JOIN meeting_entities me ON me.meeting_id = m.id
        WHERE me.entity_id IN (SELECT id FROM family)
        GROUP BY m.id
        ORDER BY datetime(COALESCE(m.started_at, m.created_at)) DESC
      `)
      .all(canonicalId, canonicalId) as Array<
      Pick<
        PersistedMeeting,
        'id' | 'title' | 'started_at' | 'created_at' | 'duration_seconds'
      > & { context: string | null }
    >
  ).map((meeting) => toPersonMeetingRecord(meeting, meeting.context));
  const mentionedById = new Map(
    mentionedMeetings.map((meeting) => [meeting.id, meeting]),
  );

  const confirmedIds = new Set<string>();
  const bindingRows = db
    .prepare(`
      SELECT meeting_id
      FROM identity_bindings
      WHERE json_valid(payload)
        AND json_extract(payload, '$.individual') = 1
        AND json_extract(payload, '$.personId') IN (
          SELECT ? UNION SELECT person_id FROM person_aliases
          WHERE canonical_id = ? AND active = 1
        )
    `)
    .all(canonicalId, canonicalId) as Array<{ meeting_id: string }>;
  for (const row of bindingRows) confirmedIds.add(row.meeting_id);
  const capturedRows = db
    .prepare(
      `SELECT meeting_id FROM identity_captures
       WHERE origin = 'local' AND self_person_id IN (
         SELECT ? UNION SELECT person_id FROM person_aliases
         WHERE canonical_id = ? AND active = 1
       )`,
    )
    .all(canonicalId, canonicalId) as Array<{ meeting_id: string }>;
  for (const row of capturedRows) confirmedIds.add(row.meeting_id);

  const confirmed = [...confirmedIds].flatMap((meetingId) => {
    const meeting = getPersonMeetingRecord(meetingId);
    return meeting
      ? [{ ...meeting, context: mentionedById.get(meetingId)?.context ?? null }]
      : [];
  });

  const sameNameCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM entities
         WHERE type = 'person' AND normalized_name = ?
           AND NOT EXISTS (SELECT 1 FROM person_aliases alias
             WHERE alias.person_id = entities.id AND alias.active = 1)`,
      )
      .get(person.normalized_name) as { count: number }
  ).count;
  const scheduled: PersonMeetingRecord[] = [];
  if (sameNameCount === 1) {
    const calendarRows = db
      .prepare('SELECT meeting_id, event_json FROM meeting_calendar_context')
      .all() as Array<{ meeting_id: string; event_json: string }>;
    for (const row of calendarRows) {
      try {
        const event = JSON.parse(row.event_json) as CalendarEvent;
        if (event.isCancelled) continue;
        const people = [event.organizer, ...event.attendees].filter(Boolean);
        if (
          !people.some(
            (candidate) =>
              candidate?.name &&
              normalizeEntityName(candidate.name) === person.normalized_name,
          )
        ) {
          continue;
        }
        const meeting = getPersonMeetingRecord(row.meeting_id);
        if (meeting) {
          scheduled.push({
            ...meeting,
            context: mentionedById.get(row.meeting_id)?.context ?? null,
          });
        }
      } catch {
        // Malformed calendar cache cannot establish expected participation.
      }
    }
  }

  const actionCandidates = db
    .prepare(`
      SELECT
        action.id,
        action.name,
        action.status,
        action.due_date,
        ? AS assigned_to,
        action.metadata,
        action.updated_at,
        source.title AS sourceMeetingTitle
      FROM entities action
      LEFT JOIN meetings source ON source.id = json_extract(
        CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
        '$.source_meeting_id'
      )
      WHERE action.type = 'action_item'
        AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
          '$.meeting_regeneration_retired_at') IS NULL
        AND action.assigned_to IN (
          SELECT ? UNION SELECT person_id FROM person_aliases
          WHERE canonical_id = ? AND active = 1
        )
    `)
    .all(canonicalId, canonicalId, canonicalId) as PersonCommitmentCandidate[];

  const candidateOwnerActions = db
    .prepare(`
      WITH family(id) AS (
        SELECT ? UNION SELECT person_id FROM person_aliases
        WHERE canonical_id = ? AND active = 1
      ), names(normalized_name) AS (
        SELECT normalized_name FROM entities WHERE id IN (SELECT id FROM family)
        UNION
        SELECT normalized_name FROM person_name_aliases
        WHERE person_id IN (SELECT id FROM family)
      ), bound_speakers AS (
        SELECT binding.meeting_id, binding.speaker
        FROM identity_bindings binding
        WHERE json_valid(binding.payload)
          AND json_extract(binding.payload, '$.individual') = 1
          AND json_extract(binding.payload, '$.personId') IN (SELECT id FROM family)
      )
      SELECT DISTINCT
        action.id,
        action.name,
        action.status,
        action.due_date,
        action.assigned_to,
        action.metadata,
        action.updated_at,
        source.title AS sourceMeetingTitle,
        CASE
          WHEN bs.speaker IS NOT NULL THEN ?
          ELSE json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.assignee_name'
          )
        END AS suggested_owner_name
      FROM entities action
      LEFT JOIN meetings source ON source.id = json_extract(
        CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
        '$.source_meeting_id'
      )
      LEFT JOIN bound_speakers bs
        ON bs.meeting_id = json_extract(
          CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
          '$.source_meeting_id'
        )
        AND (
          LOWER(TRIM(bs.speaker)) = LOWER(TRIM(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.assignee_name'
          )))
          OR (
            bs.speaker LIKE 'Remote Speaker %'
            AND 'Speaker ' || SUBSTR(bs.speaker, 16) = json_extract(
              CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
              '$.assignee_name'
            )
          )
          OR (
            json_extract(
              CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
              '$.assignee_name'
            ) LIKE 'Remote Speaker %'
            AND 'Speaker ' || SUBSTR(json_extract(
              CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
              '$.assignee_name'
            ), 16) = bs.speaker
          )
        )
      WHERE action.type = 'action_item'
        AND json_type(CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
          '$.meeting_regeneration_retired_at') IS NULL
        AND action.assigned_to IS NULL
        AND (
          LOWER(TRIM(json_extract(
            CASE WHEN json_valid(action.metadata) THEN action.metadata ELSE '{}' END,
            '$.assignee_name'
          ))) IN (SELECT normalized_name FROM names)
          OR bs.speaker IS NOT NULL
        )
    `)
    .all(canonicalId, canonicalId, person.name) as PersonCommitmentCandidate[];

  const personNames = db
    .prepare(`
      WITH family(id) AS (
        SELECT ? UNION SELECT person_id FROM person_aliases
        WHERE canonical_id = ? AND active = 1
      )
      SELECT name FROM entities WHERE id IN (SELECT id FROM family)
      UNION SELECT display_name AS name FROM person_name_aliases
      WHERE person_id IN (SELECT id FROM family)
    `)
    .all(canonicalId, canonicalId) as Array<{ name: string }>;

  const mergedPeople = db
    .prepare(
      `SELECT person.id, person.name, alias.created_at AS mergedAt
       FROM person_aliases alias
       JOIN entities person ON person.id = alias.person_id
       WHERE alias.canonical_id = ? AND alias.active = 1
       ORDER BY alias.created_at DESC, person.name`,
    )
    .all(canonicalId) as Array<{
    id: string;
    name: string;
    mergedAt: string;
  }>;
  const selfPersonId = identityStore.getSelfPersonId();
  const acceptedClaims = getAcceptedDreamingPersonClaims(canonicalId);
  const knowledgeDoc = overlayAcceptedClaimsOnKnowledgeDoc(
    getKnowledgeDocByScope('person_context', canonicalId) ?? null,
    acceptedClaims,
  );
  const workingMemorySnapshot = overlayAcceptedClaimsOnSnapshot(
    getWorkingMemorySnapshot('person_context', canonicalId) ?? null,
    acceptedClaims,
  );

  const isSelf =
    selfPersonId !== null &&
    resolvePersonIdentityId(selfPersonId) === canonicalId;

  return {
    person,
    meetings: mergePersonMeetingEvidence({
      confirmed,
      scheduled,
      mentioned: mentionedMeetings,
    }),
    commitments: selectPersonCommitments({
      personId: canonicalId,
      personNames: personNames.map((row) => row.name),
      actions: actionCandidates.map((action) => ({
        ...action,
        assigned_to: action.assigned_to
          ? resolvePersonIdentityId(action.assigned_to)
          : null,
      })),
      candidateActions: candidateOwnerActions,
      isSelf,
    }),
    isSelf,
    knowledgeDoc,
    workingMemorySnapshot,
    mergedPeople,
  };
};

export const getCanonicalPersonCommitments = (personId: string) => {
  const briefing = getPersonBriefing(personId);
  return briefing?.commitments;
};

/**
 * Get summary rows used by the Knowledge page feed.
 */
export const getKnowledgeFeedSummary = (
  params: KnowledgeFeedQueryParams = {},
): KnowledgeFeedItemSummary[] => {
  const typeFilter =
    params.type === 'topic' || params.type === 'decision' ? params.type : 'all';
  const sort = params.sort === 'most_mentioned' ? 'most_mentioned' : 'recent';
  const trimmedSearch =
    typeof params.search === 'string' ? params.search.trim().toLowerCase() : '';

  const conditions = [`e.type IN ('topic', 'decision')`];
  const values: unknown[] = [];

  if (typeFilter !== 'all') {
    conditions.push('e.type = ?');
    values.push(typeFilter);
  }

  if (trimmedSearch) {
    conditions.push('LOWER(e.name) LIKE ?');
    values.push(`%${trimmedSearch}%`);
  }

  const orderBy =
    sort === 'most_mentioned'
      ? 'mention_count DESC, COALESCE(last_mentioned_at, e.updated_at) DESC, e.name ASC'
      : 'COALESCE(last_mentioned_at, e.updated_at) DESC, mention_count DESC, e.name ASC';

  const query = `
    SELECT
      e.id AS entity_id,
      e.type AS type,
      e.name AS name,
      e.updated_at AS updated_at,
      COUNT(DISTINCT me.meeting_id) AS meeting_count,
      COALESCE(SUM(me.mention_count), 0) AS mention_count,
      MAX(COALESCE(m.started_at, m.created_at, me.created_at)) AS last_mentioned_at,
      (
        SELECT me2.context
        FROM meeting_entities me2
        LEFT JOIN meetings m2 ON m2.id = me2.meeting_id
        WHERE me2.entity_id = e.id
          AND me2.context IS NOT NULL
          AND TRIM(me2.context) != ''
        ORDER BY COALESCE(m2.started_at, m2.created_at, me2.created_at) DESC
        LIMIT 1
      ) AS latest_context
    FROM entities e
    LEFT JOIN meeting_entities me ON me.entity_id = e.id
    LEFT JOIN meetings m ON m.id = me.meeting_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY e.id, e.type, e.name, e.updated_at
    ORDER BY ${orderBy}
  `;

  return db.prepare(query).all(...values) as KnowledgeFeedItemSummary[];
};

/**
 * Get action items with a specific status
 */
export const getActionItemsByStatus = (status: EntityStatus): Entity[] => {
  return db
    .prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' AND status = ?
      AND NOT EXISTS (SELECT 1 FROM commitment_aliases a WHERE a.extraction_id = entities.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
    ORDER BY due_date ASC, created_at DESC
  `)
    .all(status) as Entity[];
};

/**
 * Get overdue action items
 */
export const getOverdueActionItems = (): Entity[] => {
  return db
    .prepare(`
    SELECT * FROM entities 
    WHERE type = 'action_item' 
      AND status = 'active' 
      AND due_date IS NOT NULL 
      AND due_date < datetime('now')
      AND NOT EXISTS (SELECT 1 FROM commitment_aliases a WHERE a.extraction_id = entities.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
    ORDER BY due_date ASC
  `)
    .all() as Entity[];
};

/**
 * Get active action items that are currently blocked by another linked entity.
 */
export const getBlockedActionItems = (): BlockedActionItem[] => {
  const links = db
    .prepare(`
    SELECT * FROM entity_links
    WHERE relationship = 'blocked_by' AND state != 'rejected'
    ORDER BY updated_at DESC, created_at DESC
  `)
    .all() as EntityLink[];
  // Resolve both endpoints before checking lifecycle state. Keep the stored
  // edge unchanged so restoring either alias restores its original dependency.
  return links.flatMap((link) => {
    const action = resolveCommitmentIdentity(link.source_entity_id);
    const blocker = resolveCommitmentIdentity(link.target_entity_id);
    if (
      !action ||
      action.type !== 'action_item' ||
      action.status !== 'active' ||
      !blocker ||
      blocker.status === 'completed' ||
      action.id === blocker.id
    )
      return [];
    return [
      {
        ...action,
        blocker_entity_id: blocker.id,
        blocker_name: blocker.name,
        blocker_meeting_id: link.evidence_meeting_id,
        blocker_evidence_quote: link.evidence_quote,
        blocker_updated_at: link.updated_at,
        blocker_relationship_state: link.state,
      },
    ];
  });
};

/**
 * Get stale action items (not mentioned in last N days)
 */
export const getStaleActionItems = (staleDays = 7): Entity[] => {
  return db
    .prepare(`
    SELECT e.* FROM entities e
    WHERE e.type = 'action_item' 
      AND NOT EXISTS (SELECT 1 FROM commitment_aliases a WHERE a.extraction_id = e.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(e.metadata) THEN e.metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
      AND e.status = 'active'
      AND e.updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY e.updated_at ASC
  `)
    .all(staleDays) as Entity[];
};

/**
 * Get knowledge graph statistics
 */
export const getKnowledgeGraphStats = (): {
  total_entities: number;
  by_type: Record<EntityType, number>;
  total_links: number;
  total_meeting_connections: number;
} => {
  const totalEntities = (
    db
      .prepare(`SELECT COUNT(*) as count FROM entities
        WHERE json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
          '$.meeting_regeneration_retired_at') IS NULL`)
      .get() as {
      count: number;
    }
  ).count;
  const totalLinks = (
    db
      .prepare(`SELECT COUNT(*) as count FROM entity_links link
        JOIN entities source ON source.id = link.source_entity_id
        JOIN entities target ON target.id = link.target_entity_id
        WHERE json_type(CASE WHEN json_valid(source.metadata) THEN source.metadata ELSE '{}' END,
          '$.meeting_regeneration_retired_at') IS NULL
          AND json_type(CASE WHEN json_valid(target.metadata) THEN target.metadata ELSE '{}' END,
            '$.meeting_regeneration_retired_at') IS NULL`)
      .get() as {
      count: number;
    }
  ).count;
  const totalMeetingConnections = (
    db
      .prepare(`SELECT COUNT(*) as count FROM meeting_entities link
        JOIN entities entity ON entity.id = link.entity_id
        WHERE json_type(CASE WHEN json_valid(entity.metadata) THEN entity.metadata ELSE '{}' END,
          '$.meeting_regeneration_retired_at') IS NULL`)
      .get() as {
      count: number;
    }
  ).count;

  const typeCounts = db
    .prepare(`
    SELECT type, COUNT(*) as count FROM entities
    WHERE json_type(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
      '$.meeting_regeneration_retired_at') IS NULL
    GROUP BY type
  `)
    .all() as { type: EntityType; count: number }[];

  const byType: Record<EntityType, number> = {
    person: 0,
    topic: 0,
    action_item: 0,
    decision: 0,
    project: 0,
  };

  for (const row of typeCounts) {
    byType[row.type] = row.count;
  }

  return {
    total_entities: totalEntities,
    by_type: byType,
    total_links: totalLinks,
    total_meeting_connections: totalMeetingConnections,
  };
};

// =============================================
// AUTO-END LOG OPERATIONS
// =============================================

export const logAutoEndEvent = (event: {
  meeting_id?: string;
  reason_code: string;
  app_name?: string;
  grace_seconds?: number;
}) => {
  const id = generateId();
  db.prepare(`
    INSERT INTO auto_end_log (id, meeting_id, reason_code, app_name, grace_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    event.meeting_id || null,
    event.reason_code,
    event.app_name || null,
    event.grace_seconds ?? null,
  );
  dbLog.debug(
    `[AutoEnd] Logged event: ${event.reason_code} (app=${event.app_name || 'n/a'}, grace=${event.grace_seconds ?? 'n/a'}s)`,
  );
  return id;
};

/**
 * Reset all knowledge (meetings, entities, etc) but KEEP settings
 */
export const resetKnowledge = () => {
  dbLog.info('Resetting knowledge base');

  // 1. Delete all audio files
  const allMeetings = db.prepare('SELECT audio_path FROM meetings').all() as {
    audio_path: string;
  }[];
  for (const m of allMeetings) {
    if (m.audio_path && fs.existsSync(m.audio_path)) {
      try {
        fs.unlinkSync(m.audio_path);
        dbLog.debug(`Deleted audio file: ${m.audio_path}`);
      } catch (e) {
        dbLog.warn(`Failed to delete audio file: ${m.audio_path}`, e);
      }
    }
  }

  // 2. Clear tables within a transaction
  const tables = [
    'speaker_voice_rejections',
    'speaker_voice_profile_settings',
    'speaker_voice_enrollments',
    'meeting_speaker_candidates',
    'identity_captures',
    'identity_resolutions',
    'identity_resolution_history',
    'identity_binding_suppressions',
    'identity_bindings',
    'identity_jobs',
    'auto_end_log',
    'attention_items',
    'knowledge_backlinks',
    'knowledge_doc_notes',
    'knowledge_doc_user_edits',
    'knowledge_doc_versions',
    'knowledge_doc_sources',
    'knowledge_docs',
    'meeting_context_events',
    'meeting_context_snapshots',
    'meeting_entities',
    'entity_links',
    'entity_dreaming_person_claims',
    'entity_dreaming_aliases',
    'entity_dreaming_proposals',
    'entity_dreaming_runs',
    'entity_alias_suggestions',
    'entity_corrections',
    'person_chat_messages',
    'person_chat_threads',
    'person_name_aliases',
    'person_aliases',
    'project_aliases',
    'commitment_aliases',
    'entities',
    'entities_fts',
    'meetings',
    'meetings_fts',
    'meeting_notes_fts',
    'meeting_context_sections_fts',
    'meeting_context_sections',
  ];

  const deleteTransaction = db.transaction(() => {
    identityStore.setSelfPersonId(null);
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  deleteTransaction();

  // 3. Vacuum to reclaim space
  db.exec('VACUUM');

  dbLog.info('Knowledge base reset complete');
  // Re-init FTS table if needed implies ensuring it's empty, which DELETE FROM does.
  return true;
};

// =============================================
// MID (Meeting Intelligence Document) Operations
// =============================================

/**
 * Save MID JSON for a meeting and update FTS with flattened fields.
 */
export const saveMeetingMid = (
  meetingId: string,
  mid: MidFrontmatter,
): void => {
  const midJson = JSON.stringify(mid);

  db.prepare('UPDATE meetings SET mid_json = ? WHERE id = ?').run(
    midJson,
    meetingId,
  );

  try {
    const meeting = db
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(meetingId) as PersistedMeeting | undefined;
    if (meeting) refreshMeetingFts(meeting);
  } catch (e) {
    dbLog.warn('Failed to update MID FTS fields:', e);
  }

  dbLog.debug(`Saved MID for meeting: ${meetingId}`);
};

/**
 * Retrieve and parse MID for a meeting. Returns null if not present.
 */
export const getMeetingMid = (meetingId: string): MidFrontmatter | null => {
  const row = db
    .prepare('SELECT mid_json FROM meetings WHERE id = ?')
    .get(meetingId) as { mid_json: string | null } | undefined;

  if (!row?.mid_json) return null;

  try {
    return JSON.parse(row.mid_json) as MidFrontmatter;
  } catch {
    dbLog.warn(`Failed to parse mid_json for meeting: ${meetingId}`);
    return null;
  }
};

/**
 * ==========================================
 * PHASE 2: INTELLIGENCE ENGINE QUERIES
 * ==========================================
 */

export interface SearchFtsOptions {
  limit?: number;
}

export interface MeetingContextSectionSearchResult {
  section: MeetingContextSectionRow;
  meeting: PersistedMeeting;
  snippet: string;
}

export const searchMeetingsFts = (
  query: string,
  options: SearchFtsOptions = {},
) => {
  const limit = options.limit || 50;
  return db
    .prepare(`
    SELECT 
      m.*,
      snippet(meetings_fts, -1, '', '', '...', 64) as snippet
    FROM meetings_fts f
    JOIN meetings m ON f.meeting_id = m.id
    WHERE meetings_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `)
    .all(query, limit) as (PersistedMeeting & { snippet: string })[];
};

export const searchMeetingNotesFts = (
  query: string,
  options: SearchFtsOptions = {},
) => {
  const limit = options.limit || 50;
  return db
    .prepare(`
    SELECT
      m.*,
      snippet(meeting_notes_fts, -1, '', '', '...', 64) as snippet
    FROM meeting_notes_fts f
    JOIN meetings m ON f.meeting_id = m.id
    WHERE meeting_notes_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `)
    .all(query, limit) as (PersistedMeeting & { snippet: string })[];
};

export const searchMeetingContextSectionsFts = (
  query: string,
  options: SearchFtsOptions & { meetingIds?: string[] } = {},
): MeetingContextSectionSearchResult[] => {
  const limit = Math.min(60, Math.max(1, options.limit || 24));
  const meetingIds = [...new Set(options.meetingIds || [])].slice(0, 24);
  const scopeSql = meetingIds.length
    ? `AND section.meeting_id IN (${meetingIds.map(() => '?').join(', ')})`
    : '';
  const rows = db
    .prepare(`
      SELECT section.*,
             snippet(meeting_context_sections_fts, -1, '', '', '...', 48) AS snippet
      FROM meeting_context_sections_fts search
      JOIN meeting_context_sections section
        ON section.meeting_id = search.meeting_id
       AND section.section_id = search.section_id
      WHERE meeting_context_sections_fts MATCH ?
        ${scopeSql}
      ORDER BY rank
      LIMIT ?
    `)
    .all(query, ...meetingIds, limit) as Array<
    MeetingContextSectionRow & { snippet: string }
  >;
  return rows.flatMap((row) => {
    const meeting = getMeeting(row.meeting_id) as PersistedMeeting | undefined;
    if (!meeting) return [];
    const { snippet, ...section } = row;
    return [{ section, meeting, snippet }];
  });
};

export const searchEntitiesWithMeetingContext = (query: string) => {
  return db
    .prepare(`
    SELECT e.*, c.mention_count, c.context, c.meeting_id
    FROM entities_fts f
    JOIN entities e ON f.entity_id = e.id
    LEFT JOIN meeting_entities c ON c.entity_id = e.id
    WHERE entities_fts MATCH ?
      AND NOT EXISTS (SELECT 1 FROM commitment_aliases a
        WHERE a.extraction_id = e.id AND a.active = 1)
      AND json_type(CASE WHEN json_valid(e.metadata) THEN e.metadata ELSE '{}' END,
        '$.meeting_regeneration_retired_at') IS NULL
    ORDER BY rank
    LIMIT 20
  `)
    .all(query) as (Entity & {
    mention_count: number;
    context: string | null;
    meeting_id: string;
  })[];
};

export const walkEntityGraph = (
  entityId: string,
  depth: number,
  filters?: { state?: string },
) => {
  // BFS graph walk with visited set, confirmed-only default limit, 50-node cap
  const cap = 50;
  const results: Entity[] = [];
  const queue: { id: string; level: number }[] = [{ id: entityId, level: 0 }];
  const localVisited = new Set<string>();
  localVisited.add(entityId);
  const stateFilter = filters?.state || 'confirmed';

  while (queue.length > 0 && results.length < cap) {
    const next = queue.shift();
    if (!next) break;
    const { id, level } = next;
    if (level > depth) continue;

    if (level > 0) {
      const e = getEntity(id);
      if (e) results.push(e);
    }
    if (level === depth) continue;

    const links = db
      .prepare(`
      SELECT source_entity_id, target_entity_id 
      FROM entity_links 
      WHERE state = ? AND (source_entity_id = ? OR target_entity_id = ?)
    `)
      .all(stateFilter, id, id) as Array<{
      source_entity_id: string;
      target_entity_id: string;
    }>;

    for (const link of links) {
      const neighborId =
        link.source_entity_id === id
          ? link.target_entity_id
          : link.source_entity_id;
      if (!localVisited.has(neighborId)) {
        localVisited.add(neighborId);
        queue.push({ id: neighborId, level: level + 1 });
      }
    }
  }
  return results;
};

export const getTemporalMeetings = (range: { from?: string; to?: string }) => {
  if (range.from && range.to) {
    return db
      .prepare(
        `SELECT * FROM meetings
         WHERE COALESCE(started_at, created_at) >= ?
           AND COALESCE(started_at, created_at) < ?
         ORDER BY COALESCE(started_at, created_at) DESC, id DESC`,
      )
      .all(range.from, range.to) as PersistedMeeting[];
  }
  if (range.from) {
    return db
      .prepare(
        `SELECT * FROM meetings
         WHERE COALESCE(started_at, created_at) >= ?
         ORDER BY COALESCE(started_at, created_at) DESC, id DESC`,
      )
      .all(range.from) as PersistedMeeting[];
  }
  if (range.to) {
    return db
      .prepare(
        `SELECT * FROM meetings
         WHERE COALESCE(started_at, created_at) < ?
         ORDER BY COALESCE(started_at, created_at) DESC, id DESC`,
      )
      .all(range.to) as PersistedMeeting[];
  }
  return getMeetings();
};
export const getMeetingsForEntity = (entityId: string) => {
  return db
    .prepare(`
      SELECT me.meeting_id, me.mention_count, me.context
      FROM meeting_entities me
      WHERE me.entity_id = ?
    `)
    .all(entityId) as Array<{
    meeting_id: string;
    mention_count: number;
    context: string | null;
  }>;
};

export interface EntityCorrectionRecord {
  id: string;
  entity_id: string;
  item_type: string;
  fingerprint: string;
  reason?: string | null;
  created_at: string;
}

export const recordEntityCorrection = (input: {
  entityId: string;
  itemType: string;
  fingerprint: string;
  reason?: string;
}): EntityCorrectionRecord => {
  const normalizedId = String(input.entityId).trim();
  const normalizedType = String(input.itemType).trim();
  const normalizedFingerprint = generateItemFingerprint(
    String(input.fingerprint),
  );
  const id = `corr_${createHash('sha256')
    .update(`${normalizedId}:${normalizedType}:${normalizedFingerprint}`)
    .digest('hex')
    .slice(0, 16)}`;

  db.prepare(`
    INSERT INTO entity_corrections (id, entity_id, item_type, fingerprint, reason)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entity_id, item_type, fingerprint) DO UPDATE SET
      reason = excluded.reason,
      created_at = CURRENT_TIMESTAMP
  `).run(
    id,
    normalizedId,
    normalizedType,
    normalizedFingerprint,
    input.reason ?? null,
  );

  return db
    .prepare('SELECT * FROM entity_corrections WHERE id = ?')
    .get(id) as EntityCorrectionRecord;
};

export const getEntityCorrections = (
  entityId: string,
): EntityCorrectionRecord[] => {
  return db
    .prepare(
      'SELECT * FROM entity_corrections WHERE entity_id = ? ORDER BY datetime(created_at) DESC',
    )
    .all(String(entityId)) as EntityCorrectionRecord[];
};

/** Include corrections recorded on the canonical entity or any active alias. */
export const getDreamingEntityCorrections = (
  entityId: string,
): Array<{ fingerprint: string }> => {
  const entity = getEntity(entityId);
  if (!entity || (entity.type !== 'person' && entity.type !== 'project')) {
    return [];
  }
  const canonicalId =
    entity.type === 'person'
      ? resolvePersonIdentityId(entity.id)
      : resolveProjectIdentityId(entity.id);
  const aliasTable =
    entity.type === 'person' ? 'person_aliases' : 'project_aliases';
  const aliasIdColumn = entity.type === 'person' ? 'person_id' : 'project_id';
  return db
    .prepare(`
      WITH family(id) AS (
        SELECT ? UNION SELECT ${aliasIdColumn} FROM ${aliasTable}
        WHERE canonical_id = ? AND active = 1
      )
      SELECT DISTINCT correction.fingerprint
      FROM entity_corrections correction
      WHERE correction.entity_id IN (SELECT id FROM family)
      ORDER BY correction.fingerprint COLLATE BINARY
      LIMIT 64
    `)
    .all(canonicalId, canonicalId) as Array<{ fingerprint: string }>;
};

export const isItemDismissed = (
  entityId: string,
  itemType: string,
  fingerprint: string,
): boolean => {
  const row = db
    .prepare(`
      SELECT 1 FROM entity_corrections
      WHERE entity_id = ? AND item_type = ? AND fingerprint = ?
      LIMIT 1
    `)
    .get(
      String(entityId),
      String(itemType),
      generateItemFingerprint(String(fingerprint)),
    );
  return Boolean(row);
};

export { generateItemFingerprint };

export interface EntityAliasSuggestion {
  id: string;
  entity_id: string;
  suggested_name: string;
  source_meeting_ids_json: string;
  evidence_snippet?: string | null;
  status: 'pending' | 'merged' | 'dismissed';
  created_at: string;
  updated_at: string;
}

export const saveEntityAliasSuggestion = (input: {
  entityId: string;
  suggestedName: string;
  sourceMeetingIds?: string[];
  evidenceSnippet?: string;
}): void => {
  const entityId = String(input.entityId).trim();
  const suggestedName = String(input.suggestedName).trim();
  if (!entityId || !suggestedName) return;

  const id = `alias_sug_${createHash('sha256')
    .update(`${entityId}:${suggestedName.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16)}`;

  const sourceMeetingIdsJson = JSON.stringify(input.sourceMeetingIds ?? []);

  db.prepare(`
    INSERT INTO entity_alias_suggestions (id, entity_id, suggested_name, source_meeting_ids_json, evidence_snippet, status, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    ON CONFLICT(entity_id, suggested_name) DO UPDATE SET
      source_meeting_ids_json = excluded.source_meeting_ids_json,
      evidence_snippet = COALESCE(excluded.evidence_snippet, entity_alias_suggestions.evidence_snippet),
      updated_at = CURRENT_TIMESTAMP
    WHERE status != 'dismissed'
  `).run(
    id,
    entityId,
    suggestedName,
    sourceMeetingIdsJson,
    input.evidenceSnippet ?? null,
  );
};

export const getEntityAliasSuggestions = (
  entityId: string,
): EntityAliasSuggestion[] => {
  return db
    .prepare(
      "SELECT * FROM entity_alias_suggestions WHERE entity_id = ? AND status = 'pending' ORDER BY datetime(created_at) DESC",
    )
    .all(String(entityId)) as EntityAliasSuggestion[];
};

export const updateEntityAliasSuggestionStatus = (
  id: string,
  status: 'pending' | 'merged' | 'dismissed',
): void => {
  db.prepare(`
    UPDATE entity_alias_suggestions
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, id);
};
