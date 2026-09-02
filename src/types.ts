import type { TranscriptLifecycleStatus } from './utils/transcriptIntegrity';

export interface TranscriptSegment {
  text: string;
  speaker?: string | number;
  start?: number;
  end?: number;
  startTime?: number;
  endTime?: number;
}

export interface InternalSignalTag {
  tag: string;
  confidence: number;
}

export interface InternalSignalDocument {
  analysis_schema_version: number;
  continuity: string[];
  accountability_risks: string[];
  decision_impacts: string[];
  extra_tags: InternalSignalTag[];
}

export interface AnalysisQuality {
  format_pass: boolean;
  retry_count: number;
  fallback_used: boolean;
  issues: string[];
}

export interface AnalysisDocument {
  analysis_schema_version: number;
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
  quality: AnalysisQuality;
}

// === v3 Analysis Schema ===

export type MeetingType =
  | 'one_on_one'
  | 'team_sync'
  | 'brainstorm'
  | 'presentation'
  | 'general';

export type AnalysisProvider = 'ollama' | 'gemini' | 'openai' | 'claude';

export type AnalysisGenerationPath = 'single_pass' | 'multi_pass';

export type AnalysisErrorCategory =
  | 'notes_quality_warning'
  | 'invalid_json'
  | 'repair_succeeded'
  | 'repair_failed'
  | 'empty_topics'
  | 'low_topic_coverage'
  | 'conflicting_rollups'
  | 'unsupported_decision'
  | 'unsupported_action_item'
  | 'unsupported_action_item_owner'
  | 'unsupported_action_item_due'
  | 'unsupported_recent_win'
  | 'unsupported_decision_decider'
  | 'unsupported_decision_rationale'
  | 'unsupported_key_point_speaker'
  | 'editorial_invalid_json'
  | 'editorial_input_too_large'
  | 'editorial_dropped_settled_item'
  | 'editorial_failed'
  | 'terminology_invalid_json'
  | 'terminology_failed';

export interface TopicPoint {
  text: string;
  speaker?: string;
  from_user_notes?: boolean;
}

export interface DecisionV3 {
  text: string;
  decided_by?: string;
  rationale?: string;
  evidence?: string;
}

export interface ActionItemV3 {
  text: string;
  assignee?: string;
  due?: string;
  topic?: string;
  evidence?: string;
}

export interface RecentWinV3 {
  win: string;
  why_it_counts: string;
  evidence: string;
}

export interface TopicSection {
  title: string;
  summary: string;
  key_points: TopicPoint[];
  decisions: DecisionV3[];
  action_items: ActionItemV3[];
  open_questions: string[];
  transcript_range?: [number, number];
}

export interface AnalysisGenerationMetadata {
  provider: AnalysisProvider;
  model: string;
  generation_path: AnalysisGenerationPath;
  prompt_version: string;
  generated_at: string;
  error_categories: AnalysisErrorCategory[];
  generation_options?: {
    structured_thinking?: boolean;
    seed?: number;
  };
  terminology?: {
    schemaVersion: 1;
    generatedAt: string;
    provider: string;
    model: string;
    policyVersion: string;
    proposals: Array<{
      rawForms: string[];
      preferredTerm: string | null;
      segmentIndexes: number[];
      confidence: 'high' | 'medium' | 'low';
      signals: Array<
        | 'repeated_context'
        | 'known_person'
        | 'known_entity'
        | 'spoken_definition'
        | 'variant_consistency'
      >;
      status: 'applied' | 'proposed' | 'confirmed' | 'rejected' | 'preserved';
    }>;
  };
  pipeline_version?: 'writer-audit-v1' | 'writer-editor-v1';
  mode?: 'direct' | 'hierarchical';
  audit_status?: 'complete' | 'complete_with_warnings';
  audit_change_count?: number;
  source_provenance?: {
    schema_version: 1;
    source_revision: string;
    blocks: Record<
      string,
      {
        id: string;
        sources: Array<{ segment: number; start: number; end: number }>;
      }
    >;
  };
}

export interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;
  topics: TopicSection[];
  all_action_items: ActionItemV3[];
  all_decisions: DecisionV3[];
  recent_win?: RecentWinV3;
  meeting_type: MeetingType;
  quality: AnalysisQuality;
  generation_metadata?: AnalysisGenerationMetadata;
}

export interface UserEdit {
  original: string;
  edited: string;
  edited_at: string;
}

export interface UserEditsMap {
  [path: string]: UserEdit;
}

export type MeetingFinalizationStatus = 'finalized' | 'recovery_required';

export interface Meeting {
  id: string | number;
  title: string;
  created_at: string;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number;
  audio_path?: string;
  meeting_type?: string;
  enhanced_notes?: string;
  transcript_json?: string;
  user_notes?: string;
  value_signals_json?: string;
  follow_up_drafts_json?: string;
  analysis_json?: string;
  analysis_schema_version?: number;
  analysis_format_pass?: number | boolean;
  analysis_retry_count?: number;
  analysis_fallback_used?: number | boolean;
  analysis_provider?: string;
  analysis_model?: string;
  analysis_generation_path?: string;
  analysis_prompt_version?: string;
  analysis_generated_at?: string;
  analysis_error_categories_json?: string;
  user_edits_json?: string;
  analysis_edit_conflicts_json?: string;
  analysis_run_json?: string | null;
  transcript_status?: TranscriptLifecycleStatus;
  transcript_integrity_json?: string;
  system_audio_path?: string;
  mixed_audio_path?: string;
  transcript_validated_at?: string;
  finalization_status?: MeetingFinalizationStatus;
  finalization_error_category?:
    | 'journal_seal_failed'
    | 'capture_journal_write_failed'
    | null;
  downstream_processing_json?: string | null;
  capture_journal_generation?: string | null;
  has_transcript?: boolean;
  has_transcript_text?: boolean;
  has_audio?: boolean;
  has_analysis?: boolean;
  has_capture_gap?: boolean;
  final_transcription_policy?: string | null;
  final_transcription_state?: string | null;
  final_transcription_engine?: string | null;
  automatic_attempts_exhausted?: boolean;
  dashboard_detail?: string | null;
  recent_win_title?: string | null;
  recent_win_why?: string | null;
  recent_win_evidence?: string | null;
  recent_win_source?: string | null;
}

export interface MeetingSummary
  extends Pick<
    Meeting,
    | 'id'
    | 'title'
    | 'created_at'
    | 'started_at'
    | 'duration_seconds'
    | 'meeting_type'
    | 'transcript_status'
    | 'transcript_validated_at'
    | 'finalization_status'
    | 'finalization_error_category'
    | 'downstream_processing_json'
    | 'capture_journal_generation'
    | 'analysis_run_json'
    | 'has_transcript'
    | 'has_transcript_text'
    | 'has_audio'
    | 'has_analysis'
    | 'has_capture_gap'
    | 'final_transcription_policy'
    | 'final_transcription_state'
    | 'final_transcription_engine'
    | 'automatic_attempts_exhausted'
  > {
  ended_at?: string | null;
  folder_id?: string | null;
  is_favorite?: number | boolean | null;
  end_reason?: string | null;
}
