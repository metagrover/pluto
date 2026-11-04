// Structured reading of an Ask Pluto question: who it is about, which of
// their meetings it points at, and whether it asks for a count.
//
// The local path previously matched meeting scope only by exact title text,
// so "my last 1:1 with Ayush" or "how many calls with Adam in September"
// found nothing. These functions resolve such references from the people and
// meeting records Pluto already holds. They are deterministic, so the same
// question always selects the same meetings, and they never assert identity:
// they only choose which saved meetings to read.

export interface FramePerson {
  id: string;
  name: string;
}

export interface FrameMeeting {
  id: string | number;
  title?: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

export interface MeetingReference {
  position: 'last' | 'previous' | 'first' | 'all';
  oneOnOne: boolean;
  matchedText: string;
}

// Words that are also common first names or are too generic to identify a
// person from a single token.
const AMBIGUOUS_NAME_TOKENS = new Set([
  'will',
  'may',
  'june',
  'april',
  'august',
  'mark',
  'bill',
  'grace',
  'hope',
  'joy',
  'faith',
  'max',
  'art',
  'sky',
  'rose',
  'dawn',
  'remote',
  'speaker',
  'unknown',
  'team',
  'user',
  'project',
  'client',
]);

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsPhrase = (haystack: string, phrase: string): boolean =>
  Boolean(phrase) && ` ${haystack} `.includes(` ${phrase} `);

// People named in the question: full names first, then first names that
// identify exactly one known person.
export const matchPeopleInQuestion = (
  query: string,
  people: readonly FramePerson[],
): FramePerson[] => {
  const text = normalize(query).replace(/'s\b/g, '');
  const matched = new Map<string, FramePerson>();
  const usable = people.filter((person) => normalize(person.name).length >= 3);
  const byLength = [...usable].sort(
    (left, right) => right.name.length - left.name.length,
  );
  let remaining = text;
  for (const person of byLength) {
    const name = normalize(person.name);
    if (!name.includes(' ') || !containsPhrase(remaining, name)) continue;
    matched.set(person.id, person);
    remaining = ` ${remaining} `.replace(` ${name} `, ' ').trim();
  }
  const firstNameOwners = new Map<string, FramePerson[]>();
  for (const person of usable) {
    const first = normalize(person.name).split(' ')[0];
    if (first.length < 3 || AMBIGUOUS_NAME_TOKENS.has(first)) continue;
    firstNameOwners.set(first, [...(firstNameOwners.get(first) ?? []), person]);
  }
  for (const [first, owners] of firstNameOwners) {
    if (!containsPhrase(remaining, first)) continue;
    // A bare first name shared by several people is ambiguous; prefer the
    // single-token record (e.g. "Ayush") when one exists.
    const exact = owners.filter((owner) => normalize(owner.name) === first);
    const chosen =
      owners.length === 1 ? owners[0] : exact.length === 1 ? exact[0] : null;
    if (chosen && ![...matched.values()].some((p) => p.id === chosen.id))
      matched.set(chosen.id, chosen);
  }
  return [...matched.values()];
};

const ONE_ON_ONE =
  /\b(?:1\s*[:\-/]\s*1s?|1\s*-?\s*on\s*-?\s*1s?|one\s*-?\s*on\s*-?\s*ones?)\b/i;

export const isOneOnOneTitle = (title: string | null | undefined): boolean =>
  Boolean(title) &&
  (ONE_ON_ONE.test(title ?? '') ||
    // "Ayush / Deepak - weekly sync" style titles name exactly two people.
    /^[\p{L}.'-]+(?:\s[\p{L}.'-]+)?\s*\/\s*[\p{L}.'-]+(?:\s[\p{L}.'-]+)?(?:\s*[-:–]|$)/u.test(
      (title ?? '').trim(),
    ));

export const parseMeetingReference = (
  query: string,
): MeetingReference | null => {
  const match = query.match(
    /\b(?:(last|latest|most\s+recent|previous|recent|first|earliest)\s+)?(1\s*[:\-/]\s*1s?|1\s*-?\s*on\s*-?\s*1s?|one\s*-?\s*on\s*-?\s*ones?|meetings?|calls?|syncs?|chats?|check-?ins?|conversations?|catch-?ups?)(?:\s+(?:did|do|does|have|has|had|i|we|you|been|held|scheduled)){0,4}\s+(?:with|between)\b/i,
  );
  if (!match) return null;
  const qualifier = match[1]?.toLowerCase().replace(/\s+/g, ' ');
  const noun = match[2].toLowerCase();
  const plural = /s$/.test(noun);
  return {
    position:
      qualifier === 'first' || qualifier === 'earliest'
        ? 'first'
        : qualifier
          ? 'last'
          : plural || isCountQuestion(query)
            ? 'all'
            : 'last',
    oneOnOne: ONE_ON_ONE.test(noun),
    matchedText: match[0],
  };
};

export const isCountQuestion = (query: string): boolean =>
  /\b(?:how\s+many|how\s+often|number\s+of|count\s+(?:of\s+)?(?:my\s+)?)\b/i.test(
    query,
  );

// Assignee phrases that mean "everyone", not a person called that.
export const isQuantifiedSubject = (value: string): boolean =>
  /^(?:each|every|all|any)\b|^(?:everyone|everybody|anyone|anybody|people|they|them|the\s+team|each\s+person|each\s+of\s+them|who)$/i.test(
    value.trim(),
  );

const occurredAt = (meeting: FrameMeeting): string =>
  meeting.started_at || meeting.created_at || '';

export const selectPersonMeetings = ({
  people,
  meetings,
  meetingIdsByPerson,
  reference,
  range,
}: {
  people: readonly FramePerson[];
  meetings: readonly FrameMeeting[];
  meetingIdsByPerson: ReadonlyMap<string, ReadonlySet<string>>;
  reference: Pick<MeetingReference, 'position' | 'oneOnOne'>;
  range?: { fromInclusive: string; toExclusive: string } | null;
}): FrameMeeting[] => {
  if (!people.length) return [];
  const selected = meetings
    .filter((meeting) => {
      const id = String(meeting.id);
      const title = normalize(meeting.title ?? '');
      // Linked as a participant, or named in the title.
      const involvesAll = people.every(
        (person) =>
          meetingIdsByPerson.get(person.id)?.has(id) ||
          containsPhrase(title, normalize(person.name)) ||
          containsPhrase(title, normalize(person.name).split(' ')[0]),
      );
      if (!involvesAll) return false;
      // A 1:1 names its other participant; a participant link alone may come
      // from a mis-attributed speaker in someone else's 1:1.
      if (
        reference.oneOnOne &&
        (!isOneOnOneTitle(meeting.title) ||
          !people.every(
            (person) =>
              containsPhrase(title, normalize(person.name)) ||
              containsPhrase(title, normalize(person.name).split(' ')[0]),
          ))
      )
        return false;
      if (range) {
        const at = occurredAt(meeting);
        if (!(at >= range.fromInclusive && at < range.toExclusive))
          return false;
      }
      return true;
    })
    .sort((left, right) => occurredAt(right).localeCompare(occurredAt(left)));
  if (reference.position === 'last') return selected.slice(0, 1);
  if (reference.position === 'previous') return selected.slice(1, 2);
  if (reference.position === 'first') return selected.slice(-1);
  return selected;
};

const formatMeetingDay = (meeting: FrameMeeting): string => {
  const at = occurredAt(meeting);
  if (!at) return 'undated';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(at));
};

export const describeMeetingReference = ({
  people,
  reference,
  rangeLabel,
}: {
  people: readonly FramePerson[];
  reference: Pick<MeetingReference, 'position' | 'oneOnOne'>;
  rangeLabel?: string;
}): string => {
  const names = people.map((person) => person.name).join(' and ');
  const kind = reference.oneOnOne ? '1:1' : 'meeting';
  const base =
    reference.position === 'last'
      ? `your last ${kind} with ${names}`
      : reference.position === 'previous'
        ? `your second most recent ${kind} with ${names}`
        : reference.position === 'first'
          ? `your first ${kind} with ${names}`
          : `your ${kind}s with ${names}`;
  return rangeLabel ? `${base} (${rangeLabel})` : base;
};

// A count is answered from the meeting records themselves, not generated.
export const buildMeetingCountAnswer = ({
  meetings,
  label,
}: {
  meetings: readonly FrameMeeting[];
  label: string;
}): string => {
  if (!meetings.length)
    return `I couldn't find any recorded meetings matching ${label}.`;
  const lines = meetings
    .slice(0, 12)
    .map(
      (meeting) =>
        `- ${formatMeetingDay(meeting)}: ${meeting.title || 'Untitled meeting'}`,
    );
  const more =
    meetings.length > 12 ? `\n- …and ${meetings.length - 12} more` : '';
  return `Pluto has ${meetings.length} recorded ${meetings.length === 1 ? 'meeting' : 'meetings'} for ${label}:\n${lines.join('\n')}${more}\n\nThis counts meetings saved in Pluto; unrecorded meetings are not included.`;
};

// Meetings on specific days, optionally narrowed by words shared with their
// titles ("the NCT check-ins on 9/16 versus 9/22").
export const selectMeetingsOnDays = ({
  query,
  meetings,
  days,
}: {
  query: string;
  meetings: readonly FrameMeeting[];
  days: readonly { from: Date; toExclusive: Date }[];
}): FrameMeeting[] => {
  const onDays = meetings.filter((meeting) => {
    const at = occurredAt(meeting);
    if (!at) return false;
    const time = new Date(at).getTime();
    return days.some(
      (day) => time >= day.from.getTime() && time < day.toExclusive.getTime(),
    );
  });
  const queryWords = new Set(
    normalize(query)
      .split(' ')
      .filter((word) => word.length >= 3),
  );
  const titled = onDays.filter((meeting) =>
    normalize(meeting.title ?? '')
      .split(' ')
      .some(
        (word) =>
          word.length >= 3 &&
          queryWords.has(word) &&
          !['the', 'and', 'meeting', 'meetings', 'with'].includes(word),
      ),
  );
  return (titled.length ? titled : onDays).sort((left, right) =>
    occurredAt(left).localeCompare(occurredAt(right)),
  );
};
