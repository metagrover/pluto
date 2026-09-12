CREATE TABLE `meeting_audio_retention` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`retained_bytes` integer DEFAULT 0 NOT NULL,
	`last_failure_code` text,
	`updated_at` datetime NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
