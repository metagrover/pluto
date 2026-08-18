/**
 * Analysis Document V3 Schema Types
 *
 * Topic-structured, speaker-attributed meeting analysis.
 * Replaces the flat v2 schema (summary, key_points, action_items, decisions).
 */

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
  | 'unsupported_decision_decider'
  | 'unsupported_decision_rationale'
  | 'unsupported_key_point_speaker'
  | 'unsupported_action_item'
  | 'unsupported_action_item_owner'
  | 'unsupported_action_item_due'
  | 'editorial_invalid_json'
  | 'editorial_input_too_large'
  | 'editorial_dropped_settled_item'
  | 'editorial_failed';

export interface AnalysisQualityV3 {
  format_pass: boolean;
  retry_count: number;
  fallback_used: boolean;
  issues: string[];
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
}

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

export interface AnalysisDocumentV3 {
  analysis_schema_version: 3;
  overview: string;
  topics: TopicSection[];
  all_action_items: ActionItemV3[];
  all_decisions: DecisionV3[];
  meeting_type: MeetingType;
  quality: AnalysisQualityV3;
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
