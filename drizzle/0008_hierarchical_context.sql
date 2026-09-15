CREATE TABLE `meeting_context_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`section_id` text NOT NULL,
	`heading` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`content` text NOT NULL,
	`entities_text` text DEFAULT '' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`transcript_start_index` integer,
	`transcript_end_index` integer,
	`source_revision` text NOT NULL,
	`trust_status` text NOT NULL,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meeting_context_sections_meeting_section` ON `meeting_context_sections` (`meeting_id`,`section_id`);--> statement-breakpoint
CREATE INDEX `idx_meeting_context_sections_meeting` ON `meeting_context_sections` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `idx_meeting_context_sections_revision` ON `meeting_context_sections` (`source_revision`);--> statement-breakpoint
CREATE VIRTUAL TABLE `meeting_context_sections_fts` USING fts5(
	heading,
	summary,
	content,
	entities_text,
	meeting_id UNINDEXED,
	section_id UNINDEXED
);
