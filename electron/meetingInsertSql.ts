export const MEETING_INSERT_SQL = `
  INSERT OR REPLACE INTO meetings (
    id, title, meeting_type, started_at, ended_at, duration_seconds, 
    audio_path, transcript_json, user_notes, enhanced_notes, analysis_json, analysis_schema_version,
    analysis_format_pass, analysis_retry_count, analysis_fallback_used, analysis_provider, analysis_model,
    analysis_generation_path, analysis_prompt_version, analysis_generated_at, analysis_error_categories_json,
    value_signals_json, follow_up_drafts_json, folder_id, is_favorite, end_reason, user_edits_json,
    transcript_status, transcript_integrity_json, system_audio_path, mixed_audio_path, transcript_validated_at,
    finalization_status, finalization_error_category, downstream_processing_json, capture_journal_generation,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
`;
