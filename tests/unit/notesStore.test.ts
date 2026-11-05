import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNotesStore } from '../../electron/notesStore';

// The notes tables exactly as the app creates them at startup.
const notesMigration = readFileSync(
  path.resolve(__dirname, '../../drizzle/0020_notes.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .join('\n');

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
        person_id TEXT PRIMARY KEY NOT NULL,
        canonical_id TEXT NOT NULL,
        moved_aliases_json TEXT,
        active INTEGER DEFAULT 1 NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        restored_at TEXT
      );
    `);
    // Attendee email links exactly as the app creates them.
    db.exec(
      readFileSync(
        path.resolve(__dirname, '../../drizzle/0013_prep_attendee_links.sql'),
        'utf8',
      )
        .split('--> statement-breakpoint')
        .join('\n'),
    );
    db.exec(notesMigration);
  });

  it('lists an empty workspace without inserting a note', () => {
    const store = createNotesStore(db);
    expect(store.listNotes()).toEqual([]);
    expect(db.prepare('SELECT id FROM notes').all()).toEqual([]);
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

  it('deletes general notes and the last pinned scratchpad', () => {
    const store = createNotesStore(db);
    const general = store.saveNote({
      title: 'Temporary Note',
      content: 'Some thoughts',
      noteType: 'general',
    });

    expect(store.deleteNote(general.id)).toBe(true);
    expect(store.getNote(general.id)).toBeNull();

    const scratchpad = store.saveNote({
      title: 'Daily Scratchpad',
      content: 'Scratchpad text',
      noteType: 'scratchpad',
      pinned: true,
    });
    expect(store.deleteNote(scratchpad.id)).toBe(true);
    expect(store.getNote(scratchpad.id)).toBeNull();
    expect(store.deleteNote(scratchpad.id)).toBe(false);
    expect(createNotesStore(db).listNotes()).toEqual([]);
  });

  it('finds open agenda items from notes for matching meeting attendees', () => {
    const store = createNotesStore(db);
    db.prepare(
      'INSERT INTO entities (id, type, name, normalized_name) VALUES (?, ?, ?, ?)',
    ).run('sarah-id', 'person', 'Sarah Connor', 'sarah connor');
    db.prepare(
      "INSERT INTO prep_attendee_links (attendee_key, person_id, source) VALUES (?, ?, 'automatic')",
    ).run('email:sarah@sky.net', 'sarah-id');

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
    expect(items.map((item) => item.lineIndex)).toEqual([0, 1, 2]);
    // The email alone finds the same note.
    expect(store.getNotesForAttendees(['Sarah@Sky.net'], [])).toHaveLength(3);
  });

  it('finds attendee notes linked to a person who was merged into them', () => {
    const store = createNotesStore(db);
    db.prepare(
      'INSERT INTO entities (id, type, name, normalized_name) VALUES (?, ?, ?, ?)',
    ).run('sam', 'person', 'Sam Rivera', 'sam rivera');
    db.prepare(
      'INSERT INTO entities (id, type, name, normalized_name) VALUES (?, ?, ?, ?)',
    ).run('sam-old', 'person', 'Sammy', 'sammy');
    db.prepare(
      'INSERT INTO person_aliases (person_id, canonical_id) VALUES (?, ?)',
    ).run('sam-old', 'sam');
    db.prepare(
      "INSERT INTO prep_attendee_links (attendee_key, person_id, source) VALUES ('email:sam@example.com', 'sam', 'user')",
    ).run();
    store.saveNote({
      title: 'Old note',
      content: '- [ ] Ask about pricing',
      noteType: 'person',
      targetId: 'sam-old',
    });
    expect(
      store
        .getNotesForAttendees(['sam@example.com'], [])
        .map((item) => item.text),
    ).toEqual(['Ask about pricing']);
  });

  it('ticks a prep checklist item in its note, even after the line moved', () => {
    const store = createNotesStore(db);
    const note = store.saveNote({
      title: 'Notes with Sarah',
      content: '- [ ] Review billing contract\n- [ ] Align on Q4 hire',
      noteType: 'general',
    });

    expect(
      store.setChecklistItem({
        noteId: note.id,
        lineIndex: 1,
        text: 'Align on Q4 hire',
        checked: true,
      }),
    ).toMatchObject({ checked: true, lineIndex: 1 });
    expect(store.getNote(note.id)?.content).toBe(
      '- [ ] Review billing contract\n- [x] Align on Q4 hire',
    );

    // A line was added above; the item is found by its unique text.
    store.saveNote({
      id: note.id,
      title: 'Notes with Sarah',
      content: 'Agenda\n- [ ] Review billing contract\n- [x] Align on Q4 hire',
    });
    store.setChecklistItem({
      noteId: note.id,
      lineIndex: 0,
      text: 'Review billing contract',
      checked: true,
    });
    expect(store.getNote(note.id)?.content).toBe(
      'Agenda\n- [x] Review billing contract\n- [x] Align on Q4 hire',
    );
  });

  it('refuses to guess when a prep checklist item changed in its note', () => {
    const store = createNotesStore(db);
    const note = store.saveNote({
      title: 'Twice',
      content: '- [ ] Follow up\n- [ ] Follow up',
      noteType: 'general',
    });
    expect(() =>
      store.setChecklistItem({
        noteId: note.id,
        lineIndex: 5,
        text: 'Follow up',
        checked: true,
      }),
    ).toThrow('This item changed in its note');
    expect(() =>
      store.setChecklistItem({
        noteId: note.id,
        lineIndex: 0,
        text: 'Renamed item',
        checked: true,
      }),
    ).toThrow('This item changed in its note');
    expect(store.getNote(note.id)?.content).toBe(
      '- [ ] Follow up\n- [ ] Follow up',
    );
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

  it('finds notes by their linked person or project as the link changes', () => {
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

    expect(store.getNotesForEntity('person-john').length).toBe(0);
    expect(store.getNotesForEntity('project-pluto').length).toBe(1);

    // Clear targetId
    store.saveNote({
      id: note.id,
      targetId: null,
    });

    expect(store.getNotesForEntity('project-pluto').length).toBe(0);
    expect(store.getNote(note.id)?.targetId).toBeNull();
  });

  it('keeps existing notes when the migration runs over tables made earlier', () => {
    const store = createNotesStore(db);
    const note = store.saveNote({
      title: 'Before upgrade',
      content: 'Remember the roadmap',
      noteType: 'general',
    });
    db.exec('DELETE FROM notes_fts');

    db.exec(notesMigration);

    expect(store.getNote(note.id)?.content).toBe('Remember the roadmap');
    expect(store.searchNotes('roadmap').map((n) => n.id)).toEqual([note.id]);
  });
  it('lists "Priya: …" lines from other notes as Priya\'s, in prep too', () => {
    const store = createNotesStore(db);
    const person = db.prepare(
      'INSERT INTO entities (id, type, name, normalized_name) VALUES (?, ?, ?, ?)',
    );
    person.run('priya', 'person', 'Priya Shah', 'priya shah');
    person.run('sam', 'person', 'Sam Rivera', 'sam rivera');
    person.run('sam2', 'person', 'Sam Lee', 'sam lee');
    const group = store.saveNote({
      title: 'Acme sync',
      content: [
        '- [ ] Priya: send deck',
        '- [ ] @Priya Shah: confirm budget',
        '- [x] Priya: book room',
        '- [ ] Ask Priya about pricing',
        '- [ ] Sam: share notes',
        '- [ ] Sam Lee: draft brief',
      ].join('\n'),
      noteType: 'general',
    });
    store.saveNote({
      title: '1:1 with Priya',
      content: '- [ ] Priya: already hers',
      noteType: 'person',
      targetId: 'priya',
    });

    const owned = store.getOwnedNoteItems('priya');
    expect(owned.map((item) => [item.text, item.checked])).toEqual([
      ['Priya: send deck', false],
      ['@Priya Shah: confirm budget', false],
      ['Priya: book room', true],
    ]);
    expect(owned[0]).toMatchObject({
      noteId: group.id,
      noteTitle: 'Acme sync',
      lineIndex: 0,
    });
    // "Sam" is two people, so only a full name counts.
    expect(store.getOwnedNoteItems('sam').map((item) => item.text)).toEqual([]);
    expect(store.getOwnedNoteItems('sam2').map((item) => item.text)).toEqual([
      'Sam Lee: draft brief',
    ]);
    // Prep for a meeting with Priya lists her own note and her lines elsewhere.
    expect(
      store.getNotesForAttendees([], ['Priya Shah']).map((item) => item.text),
    ).toEqual([
      'Priya: already hers',
      'Priya: send deck',
      '@Priya Shah: confirm budget',
      'Priya: book room',
    ]);
  });

  it('lists notes that "@Name" a person, apart from their own notes', () => {
    const addPerson = db.prepare(
      'INSERT INTO entities (id, type, name) VALUES (?, ?, ?)',
    );
    addPerson.run('priya', 'person', 'Priya Shah');
    addPerson.run('sam', 'person', 'Sam');
    addPerson.run('sam-rivera', 'person', 'Sam Rivera');
    const store = createNotesStore(db);
    const oneOnOne = store.saveNote({
      title: '1:1 with Priya',
      content: '@Sam Rivera mentioned the increment',
      noteType: 'person',
      targetId: 'priya',
    });
    store.saveNote({
      title: 'Sam Rivera notes',
      content: 'Own note, @Sam Rivera',
      noteType: 'person',
      targetId: 'sam-rivera',
    });
    const loose = store.saveNote({
      title: 'Standup',
      content: 'Ask @sam about it. Email sam@rivera.com',
      noteType: 'general',
    });

    expect(
      store.getNotesMentioningPerson('sam-rivera').map((n) => n.id),
    ).toEqual([oneOnOne.id]);
    // "@Sam Rivera" is Sam Rivera's, not Sam's.
    expect(store.getNotesMentioningPerson('sam').map((n) => n.id)).toEqual([
      loose.id,
    ]);
    expect(store.getNotesMentioningPerson('priya')).toEqual([]);
    // Their own notes stay as they were.
    expect(store.getNotesForEntity('sam-rivera').map((n) => n.title)).toEqual([
      'Sam Rivera notes',
    ]);
  });
});
