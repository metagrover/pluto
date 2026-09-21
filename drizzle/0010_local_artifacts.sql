CREATE TABLE `local_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`captured_at` datetime NOT NULL,
	`imported_at` datetime NOT NULL,
	`original_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`extracted_text` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`source_quality` text NOT NULL,
	`trust_status` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "local_artifacts_type_check" CHECK("local_artifacts"."type" IN ('markdown', 'text', 'pdf')),
	CONSTRAINT "local_artifacts_quality_check" CHECK("local_artifacts"."source_quality" IN ('usable', 'limited', 'noisy')),
	CONSTRAINT "local_artifacts_status_check" CHECK("local_artifacts"."status" IN ('active', 'noisy', 'excluded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_local_artifacts_content_hash` ON `local_artifacts` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_local_artifacts_status_imported` ON `local_artifacts` (`status`,"imported_at" desc);--> statement-breakpoint
CREATE VIRTUAL TABLE `local_artifacts_fts` USING fts5(
	title,
	extracted_text,
	artifact_id UNINDEXED
);
