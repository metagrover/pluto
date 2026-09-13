CREATE TABLE `speaker_voice_candidate_attempts` (
	`meeting_id` text NOT NULL,
	`speaker` text NOT NULL,
	`source_revision` text NOT NULL,
	`extraction_version` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`retry_after` integer,
	`attempted_at` integer NOT NULL,
	PRIMARY KEY(`meeting_id`, `speaker`, `source_revision`, `extraction_version`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_speaker_voice_candidate_attempts_meeting` ON `speaker_voice_candidate_attempts` (`meeting_id`);