CREATE TABLE `live_meeting_context_checkpoints` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`last_segment_id` text,
	`last_segment_timestamp_ms` integer,
	`generated_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_live_context_updated_at` ON `live_meeting_context_checkpoints` (`updated_at`);