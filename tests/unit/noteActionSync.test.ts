import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  syncActionCompletionToNotes,
  syncActionTitleToNotes,
} from '../../electron/database/noteActionSync';
import { ensureNotesTable } from '../../electron/notesStore';

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
    ensureNotesTable(db);
  });

  it('synchronizes task completion status to Notion-style task blocks in notes', () => {
    // Insert an action_item entity
    db.prepare(`
      INSERT INTO entities (id, type, name, status)
      VALUES ('task-1', 'action_item', 'Ship v1.0 release', 'active')
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
      INSERT INTO entities (id, type, name, status)
      VALUES ('task-2', 'action_item', 'Prepare slides for demo', 'active')
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
      INSERT INTO entities (id, type, name, status)
      VALUES ('task-3', 'action_item', 'Send feedback to design team', 'active')
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
      INSERT INTO entities (id, type, name, status)
      VALUES ('task-4', 'action_item', 'Fix edge case bug', 'active')
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
});
