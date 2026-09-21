PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `local_artifacts_dg_tmp` (
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
	CONSTRAINT "local_artifacts_type_check" CHECK("type" IN ('markdown', 'text', 'pdf', 'docx', 'pages')),
	CONSTRAINT "local_artifacts_quality_check" CHECK("source_quality" IN ('usable', 'limited', 'noisy')),
	CONSTRAINT "local_artifacts_status_check" CHECK("status" IN ('active', 'noisy', 'excluded'))
);
--> statement-breakpoint
INSERT INTO `local_artifacts_dg_tmp` SELECT `id`, `type`, `title`, `captured_at`, `imported_at`, `original_path`, `content_hash`, `extracted_text`, `metadata_json`, `source_quality`, `trust_status`, `status`, `created_at`, `updated_at` FROM `local_artifacts`;
--> statement-breakpoint
DROP TABLE `local_artifacts`;
--> statement-breakpoint
ALTER TABLE `local_artifacts_dg_tmp` RENAME TO `local_artifacts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_local_artifacts_content_hash` ON `local_artifacts` (`content_hash`);
--> statement-breakpoint
CREATE INDEX `idx_local_artifacts_status_imported` ON `local_artifacts` (`status`,"imported_at" desc);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
