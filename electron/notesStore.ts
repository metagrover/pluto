import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Note,
  NoteAgendaItem,
  NoteType,
  SaveNoteInput,
  SetNoteChecklistItemInput,
} from '../src/types/notes';
import { lineOwnedBy, ownerLabelsFor } from '../src/utils/noteOwner';

export interface NotesStore {
  listNotes: () => Note[];
  getNote: (id: string) => Note | null;
  saveNote: (input: SaveNoteInput) => Note;
  deleteNote: (id: string) => boolean;
  getNotesForAttendees: (emails: string[], names: string[]) => NoteAgendaItem[];
  searchNotes: (query: string, limit?: number) => Note[];
  getNotesForEntity: (entityId: string) => Note[];
  setChecklistItem: (input: SetNoteChecklistItemInput) => NoteAgendaItem;
  /** Checklist lines like "Priya: send deck" in notes not linked to them. */
  getOwnedNoteItems: (personId: string) => NoteAgendaItem[];
}

const CHECKLIST_LINE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+?)\s*$/;

function deriveNoteTitle(
  content: string,
  noteType: NoteType,
  targetName?: string | null,
): string {
  const trimmed = content.trim();
  if (trimmed) {
    const firstLine = trimmed
      .split('\n')[0]
      .replace(/^[#\-\*\s\[\]xX]+/, '')
      .trim();
    if (firstLine) {
      return firstLine.slice(0, 80);
    }
  }

  if (noteType === 'scratchpad') return 'Daily Scratchpad';
  if (noteType === 'person' && targetName) return `Notes with ${targetName}`;
  if (noteType === 'project' && targetName) return `${targetName} Notes`;
  return 'Untitled Note';
}

// Tables come from the 0020_notes migration, applied at database startup.
export function createNotesStore(db: Database.Database): NotesStore {
  const mapNoteRow = (r: {
    id: string;
    title: string;
    content: string;
    noteType: NoteType;
    targetId: string | null;
    targetName: string | null;
    pinned: number;
    createdAt: string;
    updatedAt: string;
  }): Note => ({
    id: r.id,
    title: r.title,
    content: r.content,
    noteType: r.noteType,
    targetId: r.targetId,
    targetName: r.targetName,
    pinned: Boolean(r.pinned),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  const listNotes = (): Note[] => {
    const rows = db
      .prepare(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.note_type as noteType,
        n.target_id as targetId,
        e.name as targetName,
        n.pinned,
        n.created_at as createdAt,
        n.updated_at as updatedAt
      FROM notes n
      LEFT JOIN entities e ON n.target_id = e.id
      ORDER BY n.pinned DESC, datetime(n.updated_at) DESC
    `)
      .all() as Array<{
      id: string;
      title: string;
      content: string;
      noteType: NoteType;
      targetId: string | null;
      targetName: string | null;
      pinned: number;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(mapNoteRow);
  };

  const getNote = (id: string): Note | null => {
    const row = db
      .prepare(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.note_type as noteType,
        n.target_id as targetId,
        e.name as targetName,
        n.pinned,
        n.created_at as createdAt,
        n.updated_at as updatedAt
      FROM notes n
      LEFT JOIN entities e ON n.target_id = e.id
      WHERE n.id = ?
    `)
      .get(id) as
      | {
          id: string;
          title: string;
          content: string;
          noteType: NoteType;
          targetId: string | null;
          targetName: string | null;
          pinned: number;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) return null;

    return mapNoteRow(row);
  };

  const saveNote = (input: SaveNoteInput): Note => {
    const noteId = input.id || randomUUID();
    const existing = getNote(noteId);

    const noteType: NoteType =
      input.noteType ?? existing?.noteType ?? 'general';
    const targetId =
      input.targetId !== undefined
        ? input.targetId
        : (existing?.targetId ?? null);
    const content = input.content ?? existing?.content ?? '';
    const pinned =
      input.pinned !== undefined
        ? input.pinned
          ? 1
          : 0
        : existing?.pinned
          ? 1
          : 0;

    let targetName: string | null = null;
    if (targetId) {
      const entity = db
        .prepare('SELECT name FROM entities WHERE id = ?')
        .get(targetId) as { name: string } | undefined;
      targetName = entity?.name ?? null;
    }

    let title: string;
    if (input.title !== undefined) {
      title = input.title.trim()
        ? input.title.trim()
        : deriveNoteTitle(content, noteType, targetName);
    } else {
      title = existing?.title?.trim()
        ? existing.title
        : deriveNoteTitle(content, noteType, targetName);
    }

    if (existing) {
      db.prepare(`
        UPDATE notes 
        SET title = ?, content = ?, note_type = ?, target_id = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title, content, noteType, targetId, pinned, noteId);
    } else {
      db.prepare(`
        INSERT INTO notes (id, title, content, note_type, target_id, pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(noteId, title, content, noteType, targetId, pinned);
    }

    // The person/project link lives in notes.target_id.
    return getNote(noteId)!;
  };

  const deleteNote = (id: string): boolean => {
    const res = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return res.changes > 0;
  };

  const getOwnedNoteItems = (personId: string): NoteAgendaItem[] => {
    if (!personId) return [];
    const people = db
      .prepare(`SELECT id, name FROM entities WHERE type = 'person'`)
      .all() as Array<{ id: string; name: string }>;
    const person = people.find((entry) => entry.id === personId);
    if (!person) return [];
    const labels = ownerLabelsFor(person, people);
    if (!labels.length) return [];
    const notes = db
      .prepare(`
      SELECT n.id, n.title, n.content, e.name as targetName
      FROM notes n
      LEFT JOIN entities e ON n.target_id = e.id
      WHERE n.target_id IS NULL OR n.target_id != ?
      ORDER BY datetime(n.updated_at) DESC
    `)
      .all(personId) as Array<{
      id: string;
      title: string;
      content: string;
      targetName: string | null;
    }>;
    const items: NoteAgendaItem[] = [];
    for (const note of notes) {
      const lowered = note.content.toLowerCase();
      if (!labels.some((label) => lowered.includes(label))) continue;
      note.content.split('\n').forEach((raw, lineIndex) => {
        const match = raw.trim().match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (!match) return;
        const text = match[2].trim();
        if (lineOwnedBy(text, labels) === null) return;
        items.push({
          id: `${note.id}-line-${lineIndex}`,
          noteId: note.id,
          noteTitle: note.title,
          targetName: note.targetName,
          text,
          checked: match[1].toLowerCase() === 'x',
          lineIndex,
        });
      });
    }
    return items;
  };

  const getNotesForAttendees = (
    emails: string[],
    names: string[],
  ): NoteAgendaItem[] => {
    const normalizedNames = names
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    const normalizedEmails = emails
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedNames.length === 0 && normalizedEmails.length === 0) {
      return [];
    }

    // Match person entities
    const matchedPersonIds = new Set<string>();

    for (const name of normalizedNames) {
      const entities = db
        .prepare(`
        SELECT id FROM entities 
        WHERE type = 'person' AND (lower(name) = ? OR lower(normalized_name) = ?)
      `)
        .all(name, name) as Array<{ id: string }>;
      for (const e of entities) matchedPersonIds.add(e.id);
    }

    // Attendee emails map to people through the links meeting prep keeps
    // (`email:<address>`), the same source the pre-meeting brief uses.
    const optionalRows = <T>(query: string, ...args: unknown[]): T[] => {
      try {
        return db.prepare(query).all(...args) as T[];
      } catch {
        return []; // Older or partial databases may not have this table.
      }
    };
    for (const email of normalizedEmails) {
      for (const row of optionalRows<{ id: string }>(
        'SELECT person_id AS id FROM prep_attendee_links WHERE attendee_key = ? AND person_id IS NOT NULL',
        `email:${email}`,
      ))
        matchedPersonIds.add(row.id);
    }
    // Notes linked to a person who was later merged into a matched person.
    for (const id of [...matchedPersonIds]) {
      for (const row of optionalRows<{ id: string }>(
        'SELECT person_id AS id FROM person_aliases WHERE canonical_id = ? AND active = 1',
        id,
      ))
        matchedPersonIds.add(row.id);
    }

    if (matchedPersonIds.size === 0) return [];

    const placeholders = Array.from(matchedPersonIds)
      .map(() => '?')
      .join(',');
    const notes = db
      .prepare(`
      SELECT 
        n.id,
        n.title,
        n.content,
        e.name as targetName
      FROM notes n
      LEFT JOIN entities e ON n.target_id = e.id
      WHERE n.target_id IN (${placeholders})
    `)
      .all(...Array.from(matchedPersonIds)) as Array<{
      id: string;
      title: string;
      content: string;
      targetName: string | null;
    }>;

    const items: NoteAgendaItem[] = [];

    for (const note of notes) {
      const lines = note.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Check for markdown task or bullet
        const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (taskMatch) {
          items.push({
            id: `${note.id}-line-${i}`,
            noteId: note.id,
            noteTitle: note.title,
            targetName: note.targetName,
            text: taskMatch[2].trim(),
            checked: taskMatch[1].toLowerCase() === 'x',
            lineIndex: i,
          });
        }
      }
    }

    // Lines like "Priya: send deck" in other notes are Priya's too.
    const seen = new Set(items.map((item) => item.id));
    for (const personId of matchedPersonIds) {
      for (const item of getOwnedNoteItems(personId)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }

    return items;
  };

  const searchNotes = (query: string, limit = 20): Note[] => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const ftsSql = `
      SELECT 
        n.id,
        n.title,
        n.content,
        n.note_type as noteType,
        n.target_id as targetId,
        e.name as targetName,
        n.pinned,
        n.created_at as createdAt,
        n.updated_at as updatedAt
      FROM notes_fts f
      JOIN notes n ON n.id = f.id
      LEFT JOIN entities e ON n.target_id = e.id
      WHERE notes_fts MATCH ?
      ORDER BY bm25(notes_fts)
      LIMIT ?
    `;

    try {
      const rows = db
        .prepare(ftsSql)
        .all(trimmed, Math.max(1, Math.min(limit, 50))) as Array<{
        id: string;
        title: string;
        content: string;
        noteType: NoteType;
        targetId: string | null;
        targetName: string | null;
        pinned: number;
        createdAt: string;
        updatedAt: string;
      }>;
      return rows.map(mapNoteRow);
    } catch {
      try {
        const cleanTerms = trimmed
          .replace(/["*()\[\]{}^:~?!,.\-]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length > 0);
        if (cleanTerms.length > 0) {
          const ftsQuery = cleanTerms.map((term) => `"${term}"*`).join(' OR ');
          const rows = db
            .prepare(ftsSql)
            .all(ftsQuery, Math.max(1, Math.min(limit, 50))) as Array<{
            id: string;
            title: string;
            content: string;
            noteType: NoteType;
            targetId: string | null;
            targetName: string | null;
            pinned: number;
            createdAt: string;
            updatedAt: string;
          }>;
          return rows.map(mapNoteRow);
        }
      } catch {
        // Fallback to LIKE
      }

      const likePattern = `%${trimmed.replace(/[%_]/g, '')}%`;
      const fallbackRows = db
        .prepare(`
        SELECT 
          n.id,
          n.title,
          n.content,
          n.note_type as noteType,
          n.target_id as targetId,
          e.name as targetName,
          n.pinned,
          n.created_at as createdAt,
          n.updated_at as updatedAt
        FROM notes n
        LEFT JOIN entities e ON n.target_id = e.id
        WHERE n.title LIKE ? OR n.content LIKE ?
        ORDER BY n.pinned DESC, datetime(n.updated_at) DESC
        LIMIT ?
      `)
        .all(
          likePattern,
          likePattern,
          Math.max(1, Math.min(limit, 50)),
        ) as Array<{
        id: string;
        title: string;
        content: string;
        noteType: NoteType;
        targetId: string | null;
        targetName: string | null;
        pinned: number;
        createdAt: string;
        updatedAt: string;
      }>;
      return fallbackRows.map(mapNoteRow);
    }
  };

  const getNotesForEntity = (entityId: string): Note[] => {
    if (!entityId) return [];

    const rows = db
      .prepare(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.note_type as noteType,
        n.target_id as targetId,
        e.name as targetName,
        n.pinned,
        n.created_at as createdAt,
        n.updated_at as updatedAt
      FROM notes n
      LEFT JOIN entities e ON n.target_id = e.id
      WHERE n.target_id = ?
      ORDER BY n.pinned DESC, datetime(n.updated_at) DESC
    `)
      .all(entityId) as Array<{
      id: string;
      title: string;
      content: string;
      noteType: NoteType;
      targetId: string | null;
      targetName: string | null;
      pinned: number;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(mapNoteRow);
  };

  // Ticks one checklist line in a note, in place, so the item shown in meeting
  // prep and the line in the note stay one item. If the note was edited and the
  // line moved, the item is found by its text when that text is unique.
  const setChecklistItem = (
    input: SetNoteChecklistItemInput,
  ): NoteAgendaItem => {
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (
      !input ||
      typeof input.noteId !== 'string' ||
      !Number.isInteger(input.lineIndex) ||
      !text ||
      typeof input.checked !== 'boolean'
    ) {
      throw new Error('Invalid checklist item');
    }
    return db.transaction(() => {
      const row = db
        .prepare(
          `SELECT n.id, n.title, n.content, e.name AS targetName
           FROM notes n LEFT JOIN entities e ON n.target_id = e.id
           WHERE n.id = ?`,
        )
        .get(input.noteId) as
        | { id: string; title: string; content: string; targetName: string }
        | undefined;
      if (!row) throw new Error('This note no longer exists.');
      const lines = row.content.split('\n');
      const matches = (index: number) =>
        lines[index]?.match(CHECKLIST_LINE)?.[4].trim() === text;
      let index = matches(input.lineIndex) ? input.lineIndex : -1;
      if (index < 0) {
        const found = lines.map((_, i) => i).filter((i) => matches(i));
        if (found.length !== 1) {
          throw new Error(
            'This item changed in its note. Open the note to update it.',
          );
        }
        index = found[0];
      }
      const match = lines[index].match(CHECKLIST_LINE)!;
      lines[index] =
        `${match[1]}${input.checked ? 'x' : ' '}${match[3]}${match[4]}`;
      db.prepare(
        'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(lines.join('\n'), row.id);
      return {
        id: `${row.id}-line-${index}`,
        noteId: row.id,
        noteTitle: row.title,
        targetName: row.targetName ?? null,
        text,
        checked: input.checked,
        lineIndex: index,
      };
    })();
  };

  return {
    listNotes,
    getNote,
    saveNote,
    deleteNote,
    getNotesForAttendees,
    searchNotes,
    getNotesForEntity,
    setChecklistItem,
    getOwnedNoteItems,
  };
}
