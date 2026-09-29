CREATE TABLE `workspace_chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`memory_json` text DEFAULT '{}' NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` datetime
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_chat_threads_updated` ON `workspace_chat_threads` ("updated_at" desc);
--> statement-breakpoint
CREATE TABLE `workspace_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `workspace_chat_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_chat_messages_role_check" CHECK("workspace_chat_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_chat_messages_thread_created` ON `workspace_chat_messages` (`thread_id`,`created_at`);
