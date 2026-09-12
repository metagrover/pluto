CREATE TABLE `identity_binding_suppressions` (
	`meeting_id` text NOT NULL,
	`speaker` text NOT NULL,
	`assignment` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`meeting_id`, `speaker`, `assignment`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
