CREATE TABLE `meeting_calendar_pending_selection` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`occurrence_key` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
