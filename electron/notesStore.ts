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

export function ensureNotesTable(db: Database.Database): void {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(id, title, content) VALUES (new.id, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
      DELETE FROM notes_fts WHERE id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
      DELETE FROM notes_fts WHERE id = old.id;
      INSERT INTO notes_fts(id, title, content) VALUES (new.id, new.title, new.content);
    END;

    CREATE TABLE IF NOT EXISTS entity_links (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT,
      target_id TEXT,
      relationship TEXT NOT NULL,
      source_type TEXT,
      target_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_id);
    CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_id);
  `);

  try {
    const cols = db.pragma('table_info(entity_links)') as Array<{
      name: string;
    }>;
    if (cols.length > 0) {
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('source_id')) {
        db.exec('ALTER TABLE entity_links ADD COLUMN source_id TEXT');
      }
      if (!colNames.has('target_id')) {
        db.exec('ALTER TABLE entity_links ADD COLUMN target_id TEXT');
      }
      if (!colNames.has('source_type')) {
        db.exec('ALTER TABLE entity_links ADD COLUMN source_type TEXT');
      }
      if (!colNames.has('target_type')) {
        db.exec('ALTER TABLE entity_links ADD COLUMN target_type TEXT');
      }
    }
  } catch {
    // Ignore schema inspection error if any
  }

  try {
    db.exec(`
      INSERT INTO notes_fts(id, title, content)
      SELECT id, title, content FROM notes WHERE id NOT IN (SELECT id FROM notes_fts);
    `);
  } catch {
    // Ignore backfill errors
  }
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

export function createNotesStore(db: Database.Database): NotesStore {
  ensureNotesTable(db);

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

    if (rows.length === 0) {
      // Initialize an empty scratchpad so the user has an immediate surface
      const initialId = randomUUID();
      const initialTitle = 'Daily Scratchpad';
      const initialContent =
        'Jot down thoughts, agendas, and ideas.\n\n- [ ] Review upcoming priorities\n- [ ] Type `@` to link people or `#` for projects\n';
      db.prepare(`
        INSERT INTO notes (id, title, content, note_type, pinned, created_at, updated_at)
        VALUES (?, ?, ?, 'scratchpad', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(initialId, initialTitle, initialContent);

      return [
        {
          id: initialId,
          title: initialTitle,
          content: initialContent,
          noteType: 'scratchpad',
          targetId: null,
          targetName: null,
          pinned: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    }

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

    // Maintain entity_links
    if (existing?.targetId && existing.targetId !== targetId) {
      try {
        db.prepare(`
          DELETE FROM entity_links 
          WHERE source_id = ? AND relationship = 'context_note'
        `).run(noteId);
      } catch (err) {
        console.error('[notesStore] Failed to remove old entity_link:', err);
      }
    }

    if (targetId) {
      try {
        const existingLink = db
          .prepare(`
          SELECT id FROM entity_links 
          WHERE source_id = ? AND target_id = ? AND relationship = 'context_note'
        `)
          .get(noteId, targetId) as { id: string } | undefined;

        if (!existingLink) {
          db.prepare(`
            DELETE FROM entity_links 
            WHERE source_id = ? AND relationship = 'context_note'
          `).run(noteId);

          const linkId = randomUUID();
          db.prepare(`
            INSERT INTO entity_links (id, source_id, target_id, relationship, source_type, target_type, created_at)
            VALUES (?, ?, ?, 'context_note', 'note', ?, CURRENT_TIMESTAMP)
          `).run(linkId, noteId, targetId, noteType);
        } else {
          db.prepare(`
            UPDATE entity_links
            SET target_type = ?
            WHERE id = ?
          `).run(noteType, existingLink.id);
        }
      } catch (err) {
        console.error('[notesStore] Failed to maintain entity_links:', err);
      }
    } else if (existing?.targetId && !targetId) {
      try {
        db.prepare(`
          DELETE FROM entity_links 
          WHERE source_id = ? AND relationship = 'context_note'
        `).run(noteId);
      } catch (err) {
        console.error('[notesStore] Failed to clear entity_links:', err);
      }
    }

    return getNote(noteId)!;
  };

  const deleteNote = (id: string): boolean => {
    const existing = getNote(id);
    if (!existing) return false;

    // Preserve primary scratchpad anchor if it's the only scratchpad
    if (existing.noteType === 'scratchpad' && existing.pinned) {
      db.prepare(`
        UPDATE notes 
        SET content = '', title = 'Daily Scratchpad', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id);
      return true;
    }

    try {
      db.prepare(`
        DELETE FROM entity_links 
        WHERE source_id = ? AND relationship = 'context_note'
      `).run(id);
    } catch {
      // Ignore
    }

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
         OR n.id IN (
           SELECT source_id FROM entity_links 
           WHERE target_id = ? AND relationship = 'context_note'
         )
      ORDER BY n.pinned DESC, datetime(n.updated_at) DESC
    `)
      .all(entityId, entityId) as Array<{
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
