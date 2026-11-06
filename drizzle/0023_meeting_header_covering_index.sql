CREATE INDEX IF NOT EXISTS idx_meetings_headers ON meetings(COALESCE(started_at, created_at), id, title, started_at, created_at, finalization_status, downstream_processing_json);
