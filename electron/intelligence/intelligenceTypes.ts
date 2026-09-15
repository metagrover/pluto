import type { TrustStatus } from '../../src/utils/trustStatus';

/**
 * Intelligence Types
 *
 * Shared type definitions for the Pluto Intelligence System.
 * Used across MID generation, query engine, citation engine, and proactive engine.
 */

// =============================================
// MID (Meeting Intelligence Document) Types
// =============================================

export interface MidParticipant {
  entity_id: string;
  name: string;
  role?: string;
}

export interface MidProject {
  entity_id: string;
  name: string;
}

export interface MidTopic {
  entity_id: string;
  name: string;
  importance: 'high' | 'medium' | 'low';
}

export interface MidActionItem {
  entity_id: string;
  description: string;
  assignee?: string;
  due_date?: string;
  status: 'active' | 'completed';
}

export interface MidDecision {
  entity_id: string;
  description: string;
  rationale?: string;
}

export interface MidSignals {
  continuity: string[];
  accountability_risks: string[];
  decision_impacts: string[];
}

export interface MidEvidenceSpan {
  span_id: string;
  claim_type: 'summary' | 'decision' | 'action_item' | 'key_point';
  transcript_range: [number, number]; // segment indices [start, end]
  quote: string;
}

export interface MidFrontmatter {
  mid_version: 1;
  meeting_id: string;
  title: string;
  occurred_at: string | null;
  duration_seconds: number;
  participants: MidParticipant[];
  projects: MidProject[];
  topics: MidTopic[];
  action_items: MidActionItem[];
  decisions: MidDecision[];
  signals: MidSignals;
  evidence_spans: MidEvidenceSpan[];
}

// =============================================
// Citation Types
// =============================================

export interface CitationChain {
  claim: string;
  meeting_id: string;
  meeting_title: string;
  entity_id?: string;
  evidence_span?: string;
  evidence_valid: boolean;
  trust_status: TrustStatus;
  evidence_kind?:
    | 'overview'
    | 'section'
    | 'commitment'
    | 'note'
    | 'transcript'
    | 'live';
  section_id?: string;
  section_heading?: string;
  timestamp_ms?: number;
  timestamp_end_ms?: number;
  source_revision?: string;
}

// =============================================
// Query Engine Types
// =============================================

export interface ParsedQuery {
  keywords: string[];
  expanded_keywords: string[];
  entity_mentions: string[];
  temporal_range: { from?: string; to?: string; label?: string } | null;
  intent:
    | 'factual'
    | 'temporal'
    | 'comparative'
    | 'exploratory'
    | 'conversational';
  cannedResponse?: string;
}

export interface ScoreBreakdown {
  fts_rank: number;
  graph_proximity: number;
  recency_decay: number;
  mention_weight: number;
}

export interface RetrievalResult {
  meeting_id: string;
  meeting_title?: string;
  mid: MidFrontmatter | null;
  evidence_text: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  evidence_kind?: CitationChain['evidence_kind'];
  retrieved_sections?: Array<{
    section_id: string;
    heading: string;
    kind: string;
    summary: string;
    trust_status: TrustStatus;
    source_revision: string;
    transcript_range?: [number, number];
  }>;
  transcript_passages?: Array<{
    quote: string;
    speaker: string;
    start_ms?: number;
    end_ms?: number;
    start_segment_index: number;
    end_segment_index: number;
    source_revision: string;
    trust_status: TrustStatus;
  }>;
  source_revision?: string;
  trust_status?: TrustStatus;
}

// =============================================
// Attention Queue Types
// =============================================

export type AttentionItemKind =
  | 'follow_up'
  | 'blocker'
  | 'risk'
  | 'dependency'
  | 'open_question'
  | 'stale_context'
  | 'repeated_pattern'
  | 'decision_conflict'
  | 'duplicate_commitment'
  | 'reference_context'
  | 'source_quality';

export type AttentionItemSeverity = 'critical' | 'watch' | 'steady';

export type AttentionItemStatus =
  | 'active'
  | 'snoozed'
  | 'dismissed'
  | 'resolved'
  | 'pinned'
  | 'stale'
  | 'superseded';

export type AttentionItemSource =
  | 'proactive_engine'
  | 'knowledge_v2'
  | 'dashboard'
  | 'action_tracker'
  | 'manual';

export interface AttentionScoreBreakdown {
  urgency: number;
  recency: number;
  repetition: number;
  commitment: number;
  blocker: number;
  project_relevance: number;
  evidence: number;
  feedback: number;
  stale_penalty: number;
  weak_evidence_penalty: number;
  total: number;
}

export interface AttentionScoreInput {
  kind: AttentionItemKind;
  status?: AttentionItemStatus;
  confidence?: number;
  evidence_mode?: 'direct' | 'inferred' | 'unknown';
  freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
  due_at?: string | null;
  updated_at?: string | null;
  last_reinforced_at?: string | null;
  cited_meeting_count?: number;
  source_count?: number;
  related_stream_count?: number;
  is_explicit_commitment?: boolean;
  now?: string;
}

export interface AttentionScoreResult {
  score: number;
  severity: AttentionItemSeverity;
  score_breakdown: AttentionScoreBreakdown;
}

export interface AttentionEvidenceReference {
  meeting_id: string;
  quote: string;
  entity_id?: string | null;
  source_kind?: string | null;
}

export interface AttentionItem {
  id: string;
  dedupe_key: string;
  kind: AttentionItemKind;
  severity: AttentionItemSeverity;
  score: number;
  status: AttentionItemStatus;
  title: string;
  reason: string;
  source: AttentionItemSource;
  score_breakdown?: AttentionScoreBreakdown | null;
  evidence: AttentionEvidenceReference[];
  related_entity_ids: string[];
  related_stream_ids: string[];
  related_meeting_ids: string[];
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface AttentionItemUpsert {
  dedupe_key: string;
  kind: AttentionItemKind;
  severity: AttentionItemSeverity;
  score: number;
  status: AttentionItemStatus;
  title: string;
  reason: string;
  source: AttentionItemSource;
  score_breakdown?: AttentionScoreBreakdown | null;
  evidence: AttentionEvidenceReference[];
  related_entity_ids: string[];
  related_stream_ids: string[];
  related_meeting_ids: string[];
  resolved_at?: string | null;
  preserve_status?: boolean;
}

// =============================================
// Legacy Proactive Trigger Types
// =============================================

export type IntelligenceAlertType =
  | 'cross_reference'
  | 'duplicate_action'
  | 'decision_conflict'
  | 'stale_entity';

export interface IntelligenceAlert {
  id: string;
  type: IntelligenceAlertType;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
  related_meeting_ids: string[];
  related_entity_ids: string[];
  created_at: string;
}
