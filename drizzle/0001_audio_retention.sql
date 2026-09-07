ALTER TABLE `meetings` ADD `audio_retention_status` text DEFAULT 'retained';--> statement-breakpoint
ALTER TABLE `meetings` ADD `audio_deleted_at` datetime;--> statement-breakpoint
ALTER TABLE `meetings` ADD `audio_retention_error` text;