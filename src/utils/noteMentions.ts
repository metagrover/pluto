/**
 * People mentions in notes: "@Sam Rivera" names a known person. Notes keep
 * mentions as plain "@Name" text; this finds them for the editor (to draw them
 * as tags), the notes store (to list the note on that person's page) and the
 * picker (to see what is being typed after "@").
 */

export interface MentionCandidate {
  id: string;
  name: string;
}

export interface NoteMention<T extends MentionCandidate = MentionCandidate> {
  /** Index of the "@". */
  start: number;
  /** Index just past the name. */
  end: number;
  person: T;
}

const isWordChar = (char: string | undefined): boolean =>
  !!char && /[\p{L}\p{N}_]/u.test(char);

/**
 * Mentions of known people in `text`, in order. The "@" must start a word (so
 * "sam@example.com" is not one) and the name must end at a word boundary.
 * When names overlap ("Sam" and "Sam Rivera"), the longest one wins.
 */
export const findMentions = <T extends MentionCandidate>(
  text: string,
  people: readonly T[],
): NoteMention<T>[] => {
  if (!text.includes('@') || !people.length) return [];
  const byLength = people
    .filter((person) => person.name.trim().length > 0)
    .map((person) => ({ person, name: person.name.trim().toLowerCase() }))
    .sort((a, b) => b.name.length - a.name.length);
  const lowered = text.toLowerCase();
  const found: NoteMention<T>[] = [];
  let index = lowered.indexOf('@');
  while (index !== -1) {
    let next = index + 1;
    if (!isWordChar(text[index - 1])) {
      const match = byLength.find(
        ({ name }) =>
          lowered.startsWith(name, index + 1) &&
          !isWordChar(text[index + 1 + name.length]),
      );
      if (match) {
        const end = index + 1 + match.name.length;
        found.push({ start: index, end, person: match.person });
        next = end;
      }
    }
    index = lowered.indexOf('@', next);
  }
  return found;
};

/** Longest query that can still be the start of a person's name. */
const MAX_QUERY = 60;

/**
 * The "@query" being typed just before the caret, if any: the "@" starts a
 * word and nothing between it and the caret breaks the line.
 */
export const activeMentionQuery = (
  text: string,
  caret: number,
): { start: number; query: string } | null => {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start === -1 || isWordChar(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY || /[\n@]/.test(query) || /^\s/.test(query))
    return null;
  return { start, query };
};

/** People whose name contains the query, best matches (name starts) first. */
export const matchPeople = <T extends MentionCandidate>(
  people: readonly T[],
  query: string,
): T[] => {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [...people];
  const starts: T[] = [];
  const wordStarts: T[] = [];
  const contains: T[] = [];
  for (const person of people) {
    const name = person.name.toLowerCase().replace(/\s+/g, ' ');
    if (name.startsWith(q)) starts.push(person);
    else if (name.split(' ').some((word) => word.startsWith(q)))
      wordStarts.push(person);
    else if (name.includes(q)) contains.push(person);
  }
  return [...starts, ...wordStarts, ...contains];
};
