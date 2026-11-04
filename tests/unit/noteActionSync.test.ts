import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  syncActionCompletionToNotes,
  syncActionTitleToNotes,
} from '../../electron/database/noteActionSync';

// The notes tables exactly as the app creates them at startup.
const notesMigration = readFileSync(
  path.resolve(__dirname, '../../drizzle/0020_notes.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .join('\n');

describe('noteActionSync', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT,
        status TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec(notesMigration);
  });

  it('synchronizes task completion status to Notion-style task blocks in notes', () => {
    // Insert an action_item entity
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('task-1', 'action_item', 'Ship v1.0 release', 'active', '{"source_note_id":"note-1"}')
    `).run();

    // Insert a note containing [task: Ship v1.0 release]
    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-1', 'Release Plan', 'Priorities:\n\n[task: Ship v1.0 release]\n- [ ] Unrelated checklist item', 'general')
    `).run();

    // Mark task completed
    const result1 = syncActionCompletionToNotes(db, 'task-1', true);
    expect(result1.notesUpdated).toBe(1);

    const note1 = db
      .prepare('SELECT content FROM notes WHERE id = ?')
      .get('note-1') as { content: string };
    expect(note1.content).toContain('[task:done: Ship v1.0 release]');
    // Checklist item should remain untouched!
    expect(note1.content).toContain('- [ ] Unrelated checklist item');

    // Mark task active again (uncheck)
    const result2 = syncActionCompletionToNotes(db, 'task-1', false);
    expect(result2.notesUpdated).toBe(1);

    const note2 = db
      .prepare('SELECT content FROM notes WHERE id = ?')
      .get('note-1') as { content: string };
    expect(note2.content).toContain('[task: Ship v1.0 release]');
    expect(note2.content).not.toContain('[task:done:');
    expect(note2.content).toContain('- [ ] Unrelated checklist item');
  });

  it('synchronizes task completion to checklist-style tasks with [task] tag', () => {
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('task-2', 'action_item', 'Prepare slides for demo', 'active', '{"source_note_id":"note-2"}')
    `).run();

    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-2', 'Demo Notes', '- [ ] [task] Prepare slides for demo\n- [ ] Plain checklist', 'general')
    `).run();

    const result = syncActionCompletionToNotes(db, 'task-2', true);
    expect(result.notesUpdated).toBe(1);

    const note = db
      .prepare('SELECT content FROM notes WHERE id = ?')
      .get('note-2') as { content: string };
    expect(note.content).toContain('- [x] [task] Prepare slides for demo');
    expect(note.content).toContain('- [ ] Plain checklist');
  });

  it('synchronizes task title rename across notes', () => {
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('task-3', 'action_item', 'Send feedback to design team', 'active', '{"source_note_id":"note-3"}')
    `).run();

    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-3', 'Design Review', '[task: Send feedback to design team]\n[task:done: Send feedback to design team]', 'general')
    `).run();

    const result = syncActionTitleToNotes(
      db,
      'task-3',
      'Send feedback to design team',
      'Send consolidated feedback to design team',
    );
    expect(result.notesUpdated).toBe(1);

    const note = db
      .prepare('SELECT content FROM notes WHERE id = ?')
      .get('note-3') as { content: string };
    expect(note.content).toContain(
      '[task: Send consolidated feedback to design team]',
    );
    expect(note.content).toContain(
      '[task:done: Send consolidated feedback to design team]',
    );
  });

  it('ignores notes that do not reference the task', () => {
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('task-4', 'action_item', 'Fix edge case bug', 'active', '{"source_note_id":"note-4"}')
    `).run();

    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-4', 'Scratchpad', '- [ ] Plain todo item\n- [ ] Another item', 'scratchpad')
    `).run();

    const result = syncActionCompletionToNotes(db, 'task-4', true);
    expect(result.notesUpdated).toBe(0);

    const note = db
      .prepare('SELECT content FROM notes WHERE id = ?')
      .get('note-4') as { content: string };
    expect(note.content).toBe('- [ ] Plain todo item\n- [ ] Another item');
  });

  it('only updates the note a task came from', () => {
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('note-task', 'action_item', 'Send deck', 'active', '{"source_note_id":"note-a"}')
    `).run();
    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-a', 'A', '[task: Send deck]', 'general'),
             ('note-b', 'B', '[task: Send deck]', 'general')
    `).run();

    expect(
      syncActionCompletionToNotes(db, 'note-task', true).notesUpdated,
    ).toBe(1);
    const content = (id: string) =>
      (
        db.prepare('SELECT content FROM notes WHERE id = ?').get(id) as {
          content: string;
        }
      ).content;
    expect(content('note-a')).toBe('[task:done: Send deck]');
    expect(content('note-b')).toBe('[task: Send deck]');

    syncActionTitleToNotes(db, 'note-task', 'Send deck', 'Send the deck');
    expect(content('note-a')).toBe('[task:done: Send the deck]');
    expect(content('note-b')).toBe('[task: Send deck]');
  });

  it('never changes notes for a meeting action item with the same wording', () => {
    db.prepare(`
      INSERT INTO entities (id, type, name, status, metadata)
      VALUES ('meeting-task', 'action_item', 'Send deck', 'active', '{"source_meeting_id":"m1"}')
    `).run();
    db.prepare(`
      INSERT INTO notes (id, title, content, note_type)
      VALUES ('note-c', 'C', '[task: Send deck]', 'general')
    `).run();

    expect(
      syncActionCompletionToNotes(db, 'meeting-task', true).notesUpdated,
    ).toBe(0);
    expect(
      syncActionTitleToNotes(db, 'meeting-task', 'Send deck', 'Other')
        .notesUpdated,
    ).toBe(0);
  });
});
