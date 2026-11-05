import type { Note } from '../types/notes';
import { parseStoredTime } from './storedTime';

/** How recently a note must have been edited to be offered for a meeting. */
export const NOTE_SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const normalize = (value: string | null | undefined): string =>
  (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentions = (text: string, name: string): boolean =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])@?${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`,
    'iu',
  ).test(text);

/**
 * The note to offer when a meeting starts: edited in the last day and either
 * titled like the meeting or about someone in it. Running notes for a person
 * are left out; their open items already show in the Prep tab.
 */
export const suggestNoteForMeeting = ({
  notes,
  title,
  people,
  currentNotes,
  now = Date.now(),
}: {
  notes: readonly Note[];
  title: string;
  people: readonly string[];
  currentNotes: string;
  now?: number;
}): Note | null => {
  const meetingTitle = normalize(title);
  const names = people
    .map((name) => name.trim())
    .filter((name) => name.length > 1);
  const used = normalize(currentNotes);
  const candidates = notes.filter((note) => {
    if (note.noteType === 'person') return false;
    const content = note.content.trim();
    if (!content) return false;
    const updated = parseStoredTime(note.updatedAt);
    if (!Number.isFinite(updated) || now - updated > NOTE_SUGGESTION_WINDOW_MS)
      return false;
    // Already in the meeting's notes, for example when started from it.
    if (used?.includes(normalize(content))) return false;
    const sameTitle =
      meetingTitle.length > 2 && normalize(note.title) === meetingTitle;
    const samePerson = names.some(
      (name) =>
        normalize(note.targetName) === normalize(name) ||
        mentions(`${note.title}\n${content}`, name),
    );
    return sameTitle || samePerson;
  });
  return (
    [...candidates].sort(
      (a, b) => parseStoredTime(b.updatedAt) - parseStoredTime(a.updatedAt),
    )[0] ?? null
  );
};
