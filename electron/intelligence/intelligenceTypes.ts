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
}

// =============================================
// Query Engine Types
// =============================================

export interface ParsedQuery {
  keywords: string[];
  expanded_keywords: string[];
  entity_mentions: string[];
  temporal_range: { from?: string; to?: string } | null;
  intent: 'factual' | 'temporal' | 'comparative' | 'exploratory';
}

export interface ScoreBreakdown {
  fts_rank: number;
  graph_proximity: number;
  recency_decay: number;
  mention_weight: number;
}

export interface RetrievalResult {
  meeting_id: string;
  mid: MidFrontmatter | null;
  evidence_text: string;
  score: number;
  score_breakdown: ScoreBreakdown;
}

// =============================================
// Proactive Intelligence Types
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
