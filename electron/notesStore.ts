import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Note,
  NoteAgendaItem,
  NoteType,
  SaveNoteInput,
} from '../src/types/notes';

export interface NotesStore {
  listNotes: () => Note[];
  getNote: (id: string) => Note | null;
  saveNote: (input: SaveNoteInput) => Note;
  deleteNote: (id: string) => boolean;
  getNotesForAttendees: (emails: string[], names: string[]) => NoteAgendaItem[];
  searchNotes: (query: string, limit?: number) => Note[];
  getNotesForEntity: (entityId: string) => Note[];
}

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

    // Also check person aliases or links
    for (const email of normalizedEmails) {
      const aliases = db
        .prepare(`
        SELECT person_id as id FROM person_aliases WHERE lower(alias) = ?
      `)
        .all(email) as Array<{ id: string }>;
      for (const a of aliases) matchedPersonIds.add(a.id);
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
          });
        }
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

  return {
    listNotes,
    getNote,
    saveNote,
    deleteNote,
    getNotesForAttendees,
    searchNotes,
    getNotesForEntity,
  };
}
