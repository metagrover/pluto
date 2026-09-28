CREATE TABLE prep_attendee_links (
  attendee_key TEXT PRIMARY KEY NOT NULL,
  person_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('automatic', 'user')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_prep_attendee_person ON prep_attendee_links(person_id);
--> statement-breakpoint
CREATE TABLE prep_attendee_rejections (
  attendee_key TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (attendee_key, person_id)
);
