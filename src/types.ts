export interface TranscriptSegment {
    text: string;
    speaker?: string | number;
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

export interface Meeting {
    id: string | number;
    title: string;
    created_at: string;
    started_at: string;
    duration_seconds?: number;
    meeting_type?: string;
    enhanced_notes?: string;
    transcript_json?: string;
    user_notes?: string;
    value_signals_json?: string;
    analysis_json?: string;
    analysis_schema_version?: number;
    analysis_format_pass?: number | boolean;
    analysis_retry_count?: number;
    analysis_fallback_used?: number | boolean;
}
