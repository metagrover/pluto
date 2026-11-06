CREATE TABLE pluto_action_batches (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  batch_json TEXT NOT NULL,
  undo_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE person_chat_messages ADD COLUMN action_batch_id TEXT;
