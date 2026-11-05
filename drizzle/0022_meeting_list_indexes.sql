CREATE INDEX IF NOT EXISTS idx_meetings_effective_start ON meetings(COALESCE(started_at, created_at), id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_meetings_transcript_status ON meetings(transcript_status);
