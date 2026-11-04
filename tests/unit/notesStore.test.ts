import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNotesStore, ensureNotesTable } from '../../electron/notesStore';

describe('notesStore', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Create base tables needed for target relations
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
      CREATE TABLE IF NOT EXISTS person_aliases (
        person_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        PRIMARY KEY (person_id, alias)
      );
    `);
    ensureNotesTable(db);
  });

  it('initializes default Daily Scratchpad if no notes exist', () => {
    const store = createNotesStore(db);
    const notes = store.listNotes();
    expect(notes.length).toBe(1);
    expect(notes[0].noteType).toBe('scratchpad');
    expect(notes[0].title).toBe('Daily Scratchpad');
    expect(notes[0].pinned).toBe(true);
  });

  it('creates and retrieves a new note with target entity', () => {
    const store = createNotesStore(db);
    db.prepare('INSERT INTO entities (id, type, name) VALUES (?, ?, ?)').run(
      'person-1',
      'person',
      'Sarah Connor',
    );

    const created = store.saveNote({
      title: '1:1 with Sarah',
      content: '- [ ] Review Q3 goals\n- [ ] Discuss project timeline',
      noteType: 'person',
      targetId: 'person-1',
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe('1:1 with Sarah');
    expect(created.targetName).toBe('Sarah Connor');
    expect(created.content).toContain('Review Q3 goals');

    const fetched = store.getNote(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.targetName).toBe('Sarah Connor');
  });

  it('updates an existing note and derives title from first non-empty line if omitted', () => {
    const store = createNotesStore(db);
    const initial = store.saveNote({
      content: '## Architectural Decision\nWe decided on SQLite local-first.',
      noteType: 'general',
    });

    expect(initial.title).toBe('Architectural Decision');

    // Pass title: '' to re-derive from new content
    const updated = store.saveNote({
      id: initial.id,
      title: '',
      content:
        '## Revised Architecture\nWe moved to local-first SQLite + Drizzle.',
    });

    expect(updated.title).toBe('Revised Architecture');
    expect(updated.content).toContain('Drizzle');
  });

  it('deletes general notes, and clears scratchpad without destroying it', () => {
    const store = createNotesStore(db);
    const general = store.saveNote({
      title: 'Temporary Note',
      content: 'Some thoughts',
      noteType: 'general',
    });

    expect(store.deleteNote(general.id)).toBe(true);
    expect(store.getNote(general.id)).toBeNull();

    // Now test scratchpad
    const scratchpad = store
      .listNotes()
      .find((n) => n.noteType === 'scratchpad')!;
    expect(store.deleteNote(scratchpad.id)).toBe(true);
    const reloaded = store.getNote(scratchpad.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.content).toBe('');
  });

  it('finds open agenda items from notes for matching meeting attendees', () => {
    const store = createNotesStore(db);
    db.prepare(
      'INSERT INTO entities (id, type, name, normalized_name) VALUES (?, ?, ?, ?)',
    ).run('sarah-id', 'person', 'Sarah Connor', 'sarah connor');
    db.prepare(
      'INSERT INTO person_aliases (person_id, alias) VALUES (?, ?)',
    ).run('sarah-id', 'sarah@sky.net');

    store.saveNote({
      title: 'Notes with Sarah',
      content:
        '- [ ] Review billing contract\n- [x] Check lunch spot\n- [ ] Align on Q4 hire',
      noteType: 'person',
      targetId: 'sarah-id',
    });

    const items = store.getNotesForAttendees(
      ['sarah@sky.net'],
      ['Sarah Connor'],
    );
    expect(items.length).toBe(3);
    expect(items[0].text).toBe('Review billing contract');
    expect(items[0].checked).toBe(false);
    expect(items[1].text).toBe('Check lunch spot');
    expect(items[1].checked).toBe(true);
    expect(items[2].text).toBe('Align on Q4 hire');
    expect(items[2].checked).toBe(false);
  });

  it('keeps notes_fts in sync via triggers and searches notes', () => {
    const store = createNotesStore(db);
    const note = store.saveNote({
      title: 'PostgreSQL Migration Plan',
      content: 'We need to migrate our database to SQLite and leverage FTS5.',
      noteType: 'general',
    });

    // Verify it is in notes_fts
    const ftsRow = db
      .prepare('SELECT * FROM notes_fts WHERE id = ?')
      .get(note.id) as { title: string; content: string } | undefined;
    expect(ftsRow).toBeDefined();
    expect(ftsRow?.title).toBe('PostgreSQL Migration Plan');

    // Search via searchNotes
    const searchResults = store.searchNotes('SQLite');
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults.some((n) => n.id === note.id)).toBe(true);

    // Update note and verify notes_fts is updated
    store.saveNote({
      id: note.id,
      title: 'PostgreSQL Migration Plan',
      content: 'Migration completed using LibSQL embedded database.',
    });

    expect(store.searchNotes('LibSQL').some((n) => n.id === note.id)).toBe(
      true,
    );
    expect(store.searchNotes('FTS5').some((n) => n.id === note.id)).toBe(false);

    // Delete note and verify removed from notes_fts
    store.deleteNote(note.id);
    expect(store.searchNotes('LibSQL').some((n) => n.id === note.id)).toBe(
      false,
    );
    const afterDelete = db
      .prepare('SELECT * FROM notes_fts WHERE id = ?')
      .get(note.id);
    expect(afterDelete).toBeUndefined();
  });

  it('maintains entity_links and supports getNotesForEntity', () => {
    const store = createNotesStore(db);
    db.prepare('INSERT INTO entities (id, type, name) VALUES (?, ?, ?)').run(
      'person-john',
      'person',
      'John Doe',
    );
    db.prepare('INSERT INTO entities (id, type, name) VALUES (?, ?, ?)').run(
      'project-pluto',
      'project',
      'Project Pluto',
    );

    const note = store.saveNote({
      title: '1:1 with John',
      content: 'Discuss quarterly feedback and salary.',
      noteType: 'person',
      targetId: 'person-john',
    });

    // Check entity_links
    const link = db
      .prepare(
        "SELECT * FROM entity_links WHERE source_id = ? AND relationship = 'context_note'",
      )
      .get(note.id) as
      | {
          id: string;
          source_id: string;
          target_id: string;
          relationship: string;
          source_type: string;
          target_type: string;
        }
      | undefined;

    expect(link).toBeDefined();
    expect(link?.source_id).toBe(note.id);
    expect(link?.target_id).toBe('person-john');
    expect(link?.relationship).toBe('context_note');
    expect(link?.source_type).toBe('note');
    expect(link?.target_type).toBe('person');

    // getNotesForEntity
    const johnNotes = store.getNotesForEntity('person-john');
    expect(johnNotes.length).toBe(1);
    expect(johnNotes[0].id).toBe(note.id);

    // Change targetId to project-pluto
    store.saveNote({
      id: note.id,
      targetId: 'project-pluto',
      noteType: 'project',
    });

    const oldLink = db
      .prepare(
        "SELECT * FROM entity_links WHERE source_id = ? AND target_id = 'person-john'",
      )
      .get(note.id);
    expect(oldLink).toBeUndefined();

    const newLink = db
      .prepare(
        "SELECT * FROM entity_links WHERE source_id = ? AND target_id = 'project-pluto'",
      )
      .get(note.id) as any;
    expect(newLink).toBeDefined();
    expect(newLink.target_type).toBe('project');

    expect(store.getNotesForEntity('person-john').length).toBe(0);
    expect(store.getNotesForEntity('project-pluto').length).toBe(1);

    // Clear targetId
    store.saveNote({
      id: note.id,
      targetId: null,
    });

    expect(store.getNotesForEntity('project-pluto').length).toBe(0);
    const clearedLink = db
      .prepare('SELECT * FROM entity_links WHERE source_id = ?')
      .get(note.id);
    expect(clearedLink).toBeUndefined();
  });
});
