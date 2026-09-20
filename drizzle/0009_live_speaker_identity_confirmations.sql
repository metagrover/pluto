CREATE TABLE `live_speaker_identity_confirmations` (
	`suggestion_id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`person_id` text NOT NULL,
	`generation` integer NOT NULL,
	`hint_revision` integer NOT NULL,
	`ranges_json` text NOT NULL,
	`state` text NOT NULL DEFAULT 'pending',
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `live_speaker_identity_confirmations_state_check` CHECK("live_speaker_identity_confirmations"."state" IN ('pending', 'bound', 'needs_review')),
	CONSTRAINT `live_speaker_identity_confirmations_generation_check` CHECK("live_speaker_identity_confirmations"."generation" > 0),
	CONSTRAINT `live_speaker_identity_confirmations_revision_check` CHECK("live_speaker_identity_confirmations"."hint_revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_live_speaker_identity_confirmations_meeting` ON `live_speaker_identity_confirmations` (`meeting_id`,`state`);
