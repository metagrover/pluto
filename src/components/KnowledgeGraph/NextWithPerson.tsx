import { Mic, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type NextTimeDiscussedMark,
  getNextTimeDiscussed,
  getNotesForEntity,
  saveNote,
  setNoteChecklistItem,
} from '../../api/notes';
import type { Note } from '../../types/notes';

export interface NextItem {
  key: string;
  noteId: string;
  lineIndex: number;
  text: string;
  checked: boolean;
}

const HIDDEN_MARKS_KEY = 'pluto.next-time-hidden-marks';
const readHiddenMarks = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_MARKS_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
};
const markId = (item: { noteId: string; text: string }, meetingId: string) =>
  `${item.noteId}\u0000${item.text}\u0000${meetingId}`;
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const CHECKLIST_LINE = /^[-*]\s+\[([ xX])\]\s+(.+)$/;

/** Open checklist items in the notes linked to a person, newest note first. */
export const openItemsFromNotes = (notes: Note[]): NextItem[] =>
  [...notes]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .flatMap((note) =>
      note.content.split('\n').flatMap((line, lineIndex) => {
        const match = line.trim().match(CHECKLIST_LINE);
        if (!match || match[1].toLowerCase() === 'x') return [];
        const text = match[2].trim();
        // A task line belongs to Tasks; it is listed there.
        if (/^\[task\]/i.test(text)) return [];
        return [
          {
            key: `${note.id}:${lineIndex}`,
            noteId: note.id,
            lineIndex,
            text,
            checked: false,
          },
        ];
      }),
    );

/**
 * Adds an item to "Next time with …": a checklist line at the end of the
 * person's latest note, or a new "1:1 with …" note when they have none.
 */
export const addToNextTime = async (
  person: { id: string; name: string },
  text: string,
  knownNotes?: Note[],
): Promise<void> => {
  const item = text.replace(/\s+/g, ' ').trim();
  if (!item) return;
  const notes = knownNotes ?? (await getNotesForEntity(person.id)) ?? [];
  const target = [...notes].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0];
  if (target) {
    await saveNote({
      id: target.id,
      title: target.title,
      content: `${target.content.trimEnd()}${target.content.trim() ? '\n' : ''}- [ ] ${item}`,
      noteType: target.noteType,
      targetId: target.targetId,
      pinned: target.pinned,
    });
    return;
  }
  await saveNote({
    title: `1:1 with ${person.name}`,
    content: `- [ ] ${item}`,
    noteType: 'person',
    targetId: person.id,
  });
};

/**
 * "Next time with …": what to raise with this person, kept in the notes linked
 * to them. The same items appear in the prep for a calendar meeting with them,
 * so there is one list whether or not a calendar is connected.
 */
export const NextWithPerson = ({
  person,
  notes,
  onStartMeeting,
  onOpenMeeting,
}: {
  person: { id: string; name: string };
  notes: Note[];
  onStartMeeting?: () => void;
  onOpenMeeting?: (meetingId: string) => void;
}) => {
  const open = useMemo(() => openItemsFromNotes(notes), [notes]);
  const [marks, setMarks] = useState<NextTimeDiscussedMark[]>([]);
  const [hiddenMarks, setHiddenMarks] = useState<string[]>(readHiddenMarks);
  const openKey = open.map((item) => `${item.key}:${item.text}`).join('\n');
  // `openKey` stands in for `open`, which is a new array when notes reload.
  useEffect(() => {
    let current = true;
    if (!open.length) {
      setMarks([]);
      return;
    }
    void getNextTimeDiscussed(
      person.id,
      open.map(({ key, noteId, text }) => ({ key, noteId, text })),
    )
      .then((next) => {
        if (current) setMarks(next);
      })
      .catch(() => {
        if (current) setMarks([]);
      });
    return () => {
      current = false;
    };
  }, [person.id, openKey]);
  const hideMark = (item: NextItem, mark: NextTimeDiscussedMark) => {
    const next = [...hiddenMarks, markId(item, mark.meetingId)];
    setHiddenMarks(next);
    try {
      localStorage.setItem(HIDDEN_MARKS_KEY, JSON.stringify(next.slice(-500)));
    } catch {
      // Hidden for this visit only.
    }
  };
  // Items ticked here stay visible, struck through, until the page changes.
  const [ticked, setTicked] = useState<NextItem[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTicked([]), [person.id]);

  const items = [
    ...open.filter(
      (item) =>
        !ticked.some(
          (done) => done.noteId === item.noteId && done.text === item.text,
        ),
    ),
    ...ticked,
  ];

  const toggle = async (item: NextItem) => {
    setBusy(item.key);
    setError(null);
    try {
      await setNoteChecklistItem({
        noteId: item.noteId,
        lineIndex: item.lineIndex,
        text: item.text,
        checked: !item.checked,
      });
      setTicked((current) =>
        item.checked
          ? current.filter((done) => done.key !== item.key)
          : [...current, { ...item, checked: true }],
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update the note.',
      );
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy('add');
    setError(null);
    try {
      await addToNextTime(person, text, notes);
      setDraft('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save the item.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="person-dossier__next border-b border-pro-border/60 py-8"
      aria-labelledby="person-next-heading"
    >
      <div className="person-dossier__major-heading mb-3">
        <div>
          <h2 id="person-next-heading">Next time with {person.name}</h2>
        </div>
        {onStartMeeting ? (
          <button
            type="button"
            onClick={onStartMeeting}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-pro-accent/10 hover:bg-pro-accent/20 text-pro-accent text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
          >
            <Mic size={13} aria-hidden="true" />
            <span>Start 1:1</span>
          </button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const mark = item.checked
              ? undefined
              : marks.find(
                  (entry) =>
                    entry.key === item.key &&
                    !hiddenMarks.includes(markId(item, entry.meetingId)),
                );
            return (
              <li key={item.key}>
                <label className="flex items-start gap-2.5 text-[15px] leading-6 text-pro-text-main">
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    checked={item.checked}
                    disabled={busy === item.key}
                    onChange={() => void toggle(item)}
                  />
                  <span
                    className={item.checked ? 'line-through opacity-60' : ''}
                  >
                    {item.text}
                  </span>
                </label>
                {mark ? (
                  <p className="next-discussed">
                    <span>Came up in</span>
                    {onOpenMeeting ? (
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(mark.meetingId)}
                      >
                        {mark.meetingTitle}
                        {shortDate(mark.startedAt)
                          ? ` · ${shortDate(mark.startedAt)}`
                          : ''}
                      </button>
                    ) : (
                      <span>{mark.meetingTitle}</span>
                    )}
                    <button
                      type="button"
                      className="next-discussed__hide"
                      aria-label={`Hide “came up” for ${item.text}`}
                      title="It didn’t come up"
                      onClick={() => hideMark(item, mark)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <form
        className="mt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void add();
          }}
          disabled={busy === 'add'}
          placeholder={`Add something to bring up with ${person.name}…`}
          aria-label={`Add something to bring up with ${person.name}`}
          className="w-full bg-transparent py-1.5 text-[15px] text-pro-text-main placeholder:text-pro-text-muted/70 outline-none border-b border-transparent focus:border-pro-border"
        />
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-pro-warning">
          {error}
        </p>
      ) : null}
    </section>
  );
};
