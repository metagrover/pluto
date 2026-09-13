CREATE TABLE `person_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `person_chat_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_chat_messages_role_check" CHECK("person_chat_messages"."role" IN ('user', 'assistant')),
	CONSTRAINT "person_chat_messages_status_check" CHECK("person_chat_messages"."status" IN ('complete', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX `idx_person_chat_messages_thread_created` ON `person_chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `person_chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` datetime,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_person_chat_threads_person_updated` ON `person_chat_threads` (`person_id`,"updated_at" desc);