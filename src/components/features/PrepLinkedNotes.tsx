import { FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getNote,
  openNoteInApp,
  setNoteChecklistItem,
  subscribeNotesChanged,
} from '../../api/notes';
import type { Note } from '../../types/notes';

/** Loads the notes a meeting's prep links to, and follows their edits. */
export const useLinkedNotes = (noteIds: readonly string[] = []): Note[] => {
  const [notes, setNotes] = useState<Note[]>([]);
  const key = noteIds.join('\u0000');
  // `key` stands in for the id list, which is a new array each render.
  useEffect(() => {
    let current = true;
    const ids = key ? key.split('\u0000') : [];
    if (!ids.length) {
      setNotes([]);
      return;
    }
    const load = () => {
      void Promise.all(ids.map((id) => getNote(id).catch(() => null))).then(
        (loaded) => {
          if (current)
            setNotes(loaded.filter((note): note is Note => Boolean(note)));
        },
      );
    };
    load();
    const unsubscribe = subscribeNotesChanged(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [key]);
  return notes;
};

/**
 * Notes used as a meeting's prep. They are shown from the note itself, so
 * edits made in Notes appear here; nothing is copied.
 */
export function PrepLinkedNotes({
  noteIds,
  onRemove,
  disabled = false,
}: {
  noteIds?: readonly string[];
  onRemove?: (noteId: string) => void;
  disabled?: boolean;
}) {
  const notes = useLinkedNotes(noteIds);
  if (!notes.length) return null;
  return (
    <section aria-label="Notes for this meeting" className="space-y-3">
      {notes.map((note) => (
        <article
          key={note.id}
          className="rounded-lg border border-pro-border/70 bg-pro-surface/25 p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <FileText
              size={14}
              aria-hidden="true"
              className="shrink-0 text-pro-text-muted"
            />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-pro-text-main hover:text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
              onClick={() => openNoteInApp(note.id)}
              title="Open in Notes"
            >
              {note.title.trim() || 'Untitled note'}
            </button>
            {onRemove ? (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Stop using ${note.title.trim() || 'this note'} for this meeting`}
                title="Stop using this note for this meeting"
                onClick={() => onRemove(note.id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          {note.content.trim() ? (
            <LinkedNoteBody note={note} />
          ) : (
            <p className="mt-2 text-xs text-pro-text-muted">
              This note is empty.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

const CHECKLIST = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
const TASK = /^\s*\[task:\s*(.+?)\]\s*$/i;

/** A note's text as a document: checklists tick the note itself. */
function LinkedNoteBody({ note }: { note: Note }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = note.content.split('\n');
  return (
    <div className="mt-2 max-h-60 space-y-0.5 overflow-y-auto text-[13px] leading-6 text-pro-text-main">
      {lines.map((line, index) => {
        const key = `${index}:${line}`;
        const check = line.match(CHECKLIST);
        if (check) {
          const checked = check[1].toLowerCase() === 'x';
          return (
            <label key={key} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={checked}
                disabled={busy === index}
                onChange={() => {
                  setBusy(index);
                  setError(null);
                  void setNoteChecklistItem({
                    noteId: note.id,
                    lineIndex: index,
                    text: check[2],
                    checked: !checked,
                  })
                    .catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Could not update the note.',
                      ),
                    )
                    .finally(() => setBusy(null));
                }}
              />
              <span className={checked ? 'line-through opacity-60' : ''}>
                {check[2]}
              </span>
            </label>
          );
        }
        const task = line.match(TASK);
        if (task)
          return (
            <p key={key}>
              <span className="prep-linked-note__task">To-do: </span>
              {task[1]}
            </p>
          );
        return line.trim() ? (
          <p key={key} className="whitespace-pre-wrap">
            {line}
          </p>
        ) : (
          <div key={key} className="h-2" aria-hidden="true" />
        );
      })}
      {error ? (
        <p role="alert" className="text-xs text-pro-warning">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Adds a note's text after existing notes, once. */
export const prepNotesWith = (existing: string, noteText: string): string => {
  const addition = noteText.trim();
  if (!addition || existing.includes(addition)) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n\n${addition}` : addition;
};

/** Text of a prep's own notes followed by the notes it links to. */
export const prepNotesText = (
  prepNotes: string,
  linked: ReadonlyArray<Pick<Note, 'content'>>,
): string =>
  linked.reduce((text, note) => prepNotesWith(text, note.content), prepNotes);
