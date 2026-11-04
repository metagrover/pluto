import type Database from 'better-sqlite3';

interface PersistedEntityRow {
  id: string;
  type: string;
  name: string;
  status: string | null;
  metadata: string | null;
}

interface PersistedNoteRow {
  id: string;
  content: string;
}

export interface NoteActionSyncResult {
  notesUpdated: number;
}

/**
 * The note a task was written in. Only that note is updated, so a meeting
 * action item or a task from another note with the same wording never changes
 * this note's lines.
 */
const sourceNoteId = (metadata: string | null): string | null => {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { source_note_id?: unknown };
    return typeof parsed.source_note_id === 'string'
      ? parsed.source_note_id
      : null;
  } catch {
    return null;
  }
};

const loadSourceNotes = (
  sqlite: Database.Database,
  entity: PersistedEntityRow,
): PersistedNoteRow[] => {
  const noteId = sourceNoteId(entity.metadata);
  if (!noteId) return [];
  return sqlite
    .prepare('SELECT id, content FROM notes WHERE id = ?')
    .all(noteId) as PersistedNoteRow[];
};

/**
 * Synchronize task completion status from an action_item entity to all notes
 * containing references to this task (e.g., [task: ...] or - [ ] [task] ...).
 */
export const syncActionCompletionToNotes = (
  sqlite: Database.Database,
  entityId: string,
  completed: boolean,
): NoteActionSyncResult => {
  const entity = sqlite
    .prepare(
      'SELECT id, type, name, status, metadata FROM entities WHERE id = ?',
    )
    .get(entityId) as PersistedEntityRow | undefined;

  if (!entity || entity.type !== 'action_item') {
    return { notesUpdated: 0 };
  }

  const targetTitle = entity.name.trim();
  if (!targetTitle) {
    return { notesUpdated: 0 };
  }

  const normalizedTarget = targetTitle.toLowerCase();

  const notes = loadSourceNotes(sqlite, entity);

  let notesUpdated = 0;

  for (const note of notes) {
    if (!note.content) continue;
    const lines = note.content.split('\n');
    let noteChanged = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Format 1: Notion-style [task: Title] or [task:done: Title] or [task:x: Title]
      const bracketMatch = line.match(
        /^(\s*\[task)(?::(done|x))?(:\s*)(.+?)(\]\s*)$/i,
      );
      if (bracketMatch) {
        const isDone = Boolean(bracketMatch[2]);
        const lineTitle = bracketMatch[4].trim();

        if (lineTitle.toLowerCase() === normalizedTarget) {
          if (completed && !isDone) {
            lines[i] =
              `${bracketMatch[1]}:done${bracketMatch[3]}${bracketMatch[4]}${bracketMatch[5]}`;
            noteChanged = true;
          } else if (!completed && isDone) {
            lines[i] =
              `${bracketMatch[1]}${bracketMatch[3]}${bracketMatch[4]}${bracketMatch[5]}`;
            noteChanged = true;
          }
        }
        continue;
      }

      // Format 2: Markdown task item with [task] tag: - [ ] [task] Title or - [x] [task] Title
      const listMatch = line.match(
        /^(\s*[-*]\s*\[)([ xX])(\]\s+\[task\]\s+)(.+)$/i,
      );
      if (listMatch) {
        const isDone = listMatch[2].toLowerCase() === 'x';
        const lineTitle = listMatch[4].trim();

        if (lineTitle.toLowerCase() === normalizedTarget) {
          if (completed && !isDone) {
            lines[i] = `${listMatch[1]}x${listMatch[3]}${listMatch[4]}`;
            noteChanged = true;
          } else if (!completed && isDone) {
            lines[i] = `${listMatch[1]} ${listMatch[3]}${listMatch[4]}`;
            noteChanged = true;
          }
        }
      }
    }

    if (noteChanged) {
      sqlite
        .prepare(
          'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        )
        .run(lines.join('\n'), note.id);
      notesUpdated++;
    }
  }

  return { notesUpdated };
};

/**
 * Synchronize task title rename across all notes containing references to the old task title.
 */
export const syncActionTitleToNotes = (
  sqlite: Database.Database,
  entityId: string,
  oldTitle: string,
  newTitle: string,
): NoteActionSyncResult => {
  const trimmedOld = oldTitle.trim();
  const trimmedNew = newTitle.trim();

  if (
    !trimmedOld ||
    !trimmedNew ||
    trimmedOld.toLowerCase() === trimmedNew.toLowerCase()
  ) {
    return { notesUpdated: 0 };
  }

  const normalizedOld = trimmedOld.toLowerCase();

  const entity = sqlite
    .prepare(
      'SELECT id, type, name, status, metadata FROM entities WHERE id = ?',
    )
    .get(entityId) as PersistedEntityRow | undefined;
  if (!entity || entity.type !== 'action_item') {
    return { notesUpdated: 0 };
  }
  const notes = loadSourceNotes(sqlite, entity);

  let notesUpdated = 0;

  for (const note of notes) {
    if (!note.content) continue;
    const lines = note.content.split('\n');
    let noteChanged = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const bracketMatch = line.match(
        /^(\s*\[task(?::(?:done|x))?:\s*)(.+?)(\]\s*)$/i,
      );
      if (bracketMatch) {
        const lineTitle = bracketMatch[2].trim();
        if (lineTitle.toLowerCase() === normalizedOld) {
          lines[i] = `${bracketMatch[1]}${trimmedNew}${bracketMatch[3]}`;
          noteChanged = true;
        }
        continue;
      }

      const listMatch = line.match(
        /^(\s*[-*]\s*\[[ xX]\]\s+\[task\]\s+)(.+)$/i,
      );
      if (listMatch) {
        const lineTitle = listMatch[2].trim();
        if (lineTitle.toLowerCase() === normalizedOld) {
          lines[i] = `${listMatch[1]}${trimmedNew}`;
          noteChanged = true;
        }
      }
    }

    if (noteChanged) {
      sqlite
        .prepare(
          'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        )
        .run(lines.join('\n'), note.id);
      notesUpdated++;
    }
  }

  return { notesUpdated };
};
