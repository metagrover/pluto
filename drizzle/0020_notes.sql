-- Standalone notes, optionally linked to a person or project (target_id).
-- IF NOT EXISTS: development builds created these tables before this
-- migration existed, and must upgrade without losing notes.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  note_type TEXT NOT NULL DEFAULT 'scratchpad',
  target_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(id, title, content) VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE id = old.id;
  INSERT INTO notes_fts(id, title, content) VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
INSERT INTO notes_fts(id, title, content)
SELECT id, title, content FROM notes WHERE id NOT IN (SELECT id FROM notes_fts);
