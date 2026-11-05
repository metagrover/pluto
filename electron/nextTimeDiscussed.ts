import { parseStoredTime } from '../src/utils/storedTime';

/**
 * Finds "Next time with …" items that came up in the latest meeting with that
 * person, so the list can say so softly. Matching is by words, not by a
 * model, and errs toward saying nothing.
 */

export interface NextTimeItem {
  key: string;
  noteId: string;
  text: string;
}

export interface DiscussedMeeting {
  id: string;
  title: string;
  startedAt: string;
  segments: Array<{ text: string; start?: number }>;
}

export interface DiscussedMark {
  key: string;
  meetingId: string;
  meetingTitle: string;
  startedAt: string;
  /** Seconds into the recording where it came up. */
  atSeconds: number | null;
}

const STOPWORDS = new Set(
  `about above after again against also although among another anything
  around because been before being below between both could does doing down
  during each either even every from further have having here into itself just
  last maybe more most much must myself next once only other ought ourselves
  over really same should some such than that their theirs them themselves
  then there these they this those through time today tomorrow under until
  very want week were what when where which while will with within without
  would your yours ask check talk discuss follow raise bring mention update
  make sure need`
    .split(/\s+/)
    .filter(Boolean),
);

const stem = (word: string) =>
  word.length > 5 ? word.replace(/(ing|ed|es|s)$/u, '') : word;

/** Distinctive words of an item: lowercased, stemmed, no filler. */
export const itemKeywords = (text: string): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
      .map(stem),
  ),
];

const segmentWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4)
      .map(stem),
  );

/** Consecutive segments read together, since a topic spans a few turns. */
const WINDOW = 3;

export const findDiscussedItems = ({
  items,
  noteUpdatedAt,
  meeting,
}: {
  items: readonly NextTimeItem[];
  /** When each note was last edited. */
  noteUpdatedAt: Readonly<Record<string, string>>;
  meeting: DiscussedMeeting | null;
}): DiscussedMark[] => {
  if (!meeting || !meeting.segments.length) return [];
  const started = parseStoredTime(meeting.startedAt);
  if (!Number.isFinite(started)) return [];
  const words = meeting.segments.map((segment) => segmentWords(segment.text));
  const marks: DiscussedMark[] = [];
  for (const item of items) {
    // An item may have been written after the meeting, about what was said
    // in it. Only notes untouched since the meeting began can be checked.
    const updated = parseStoredTime(noteUpdatedAt[item.noteId]);
    if (!Number.isFinite(updated) || updated >= started) continue;
    const keywords = itemKeywords(item.text);
    if (keywords.length < 2) continue;
    const needed =
      keywords.length <= 3 ? keywords.length : Math.ceil(keywords.length * 0.6);
    for (let index = 0; index < words.length; index += 1) {
      const window = words.slice(index, index + WINDOW);
      const found = keywords.filter((keyword) =>
        window.some((set) => set.has(keyword)),
      ).length;
      if (found >= needed) {
        // The moment is the first turn in the window that touches the item.
        const first = window.findIndex((set) =>
          keywords.some((keyword) => set.has(keyword)),
        );
        const at = meeting.segments[index + Math.max(first, 0)]?.start;
        marks.push({
          key: item.key,
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          startedAt: meeting.startedAt,
          atSeconds: typeof at === 'number' && Number.isFinite(at) ? at : null,
        });
        break;
      }
    }
  }
  return marks;
};

/** Transcript segments from a stored meeting, whatever shape it was saved in. */
export const transcriptSegments = (
  transcriptJson: string | null | undefined,
): DiscussedMeeting['segments'] => {
  if (!transcriptJson) return [];
  try {
    const parsed = JSON.parse(transcriptJson) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as { segments?: unknown }).segments
        : null;
    if (!Array.isArray(list)) return [];
    return list.flatMap((segment) => {
      if (!segment || typeof segment !== 'object') return [];
      const record = segment as { text?: unknown; start?: unknown };
      return typeof record.text === 'string' && record.text.trim()
        ? [
            {
              text: record.text,
              start:
                typeof record.start === 'number' ? record.start : undefined,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
};
