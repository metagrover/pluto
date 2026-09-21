CREATE TABLE `meeting_local_artifacts` (
	`meeting_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`meeting_id`, `artifact_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `local_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_local_artifacts_meeting` ON `meeting_local_artifacts` (`meeting_id`);
--> statement-breakpoint
CREATE INDEX `idx_meeting_local_artifacts_artifact` ON `meeting_local_artifacts` (`artifact_id`);
