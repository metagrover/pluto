CREATE TABLE `meeting_audio_migrations` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`migrated_bytes` integer DEFAULT 0 NOT NULL,
	`last_failure_code` text,
	`started_at` datetime,
	`completed_at` datetime,
	`updated_at` datetime NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
