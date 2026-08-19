import type { TranscriptLifecycleStatus } from './utils/transcriptIntegrity';

export interface TranscriptSegment {
  text: string;
  speaker?: string | number;
  start?: number;
  end?: number;
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
  | 'invalid_json'
  | 'repair_succeeded'
  | 'repair_failed'
  | 'empty_topics'
  | 'low_topic_coverage'
  | 'conflicting_rollups'
  | 'unsupported_decision'
  | 'unsupported_action_item'
  | 'unsupported_action_item_owner'
  | 'unsupported_action_item_due';

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
}

export interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;
  topics: TopicSection[];
  all_action_items: ActionItemV3[];
  all_decisions: DecisionV3[];
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
}
