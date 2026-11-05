/**
 * A checklist line that starts with someone's name, like "Priya: send deck",
 * is theirs. Shared by the notes store (to list it on Priya's page and in prep)
 * and the editor (to say so next to the line).
 */

export interface OwnerCandidate {
  id: string;
  name: string;
}

const normalize = (value: string) =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const firstName = (name: string) => normalize(name).split(' ')[0] || '';

/**
 * The names a line may start with for this person: the full name always, the
 * first name only when no one else among `people` shares it.
 */
export const ownerLabelsFor = (
  person: OwnerCandidate,
  people: readonly OwnerCandidate[],
): string[] => {
  const full = normalize(person.name);
  if (!full) return [];
  const first = firstName(person.name);
  const firstIsUnique =
    first.length > 1 &&
    first !== full &&
    !people.some(
      (other) => other.id !== person.id && firstName(other.name) === first,
    );
  return firstIsUnique ? [full, first] : [full];
};

const OWNER_PREFIX = /^@?([^:\n]{2,60}?)\s*:\s+(\S.*)$/u;

/** Splits "Priya: send deck" into the name and the rest, or null. */
export const splitOwnerPrefix = (
  text: string,
): { label: string; rest: string } | null => {
  const match = text.trim().match(OWNER_PREFIX);
  if (!match) return null;
  return { label: normalize(match[1]), rest: match[2].trim() };
};

/** Whether the line belongs to this person; returns the text after the name. */
export const lineOwnedBy = (
  text: string,
  labels: readonly string[],
): string | null => {
  const split = splitOwnerPrefix(text);
  if (!split) return null;
  return labels.includes(split.label) ? split.rest : null;
};

/** The person a line belongs to, if it starts with exactly one person's name. */
export const ownerOfLine = <T extends OwnerCandidate>(
  text: string,
  people: readonly T[],
): T | null => {
  const split = splitOwnerPrefix(text);
  if (!split) return null;
  const owners = people.filter((person) =>
    ownerLabelsFor(person, people).includes(split.label),
  );
  return owners.length === 1 ? owners[0] : null;
};
