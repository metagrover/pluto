const REMOTE_SPEAKER_PATTERN = /^Remote Speaker (\d+)$/u;
const GENERIC_SPEAKER_PATTERN =
  /^(?:(?:remote|local)\s+)?speaker(?:\s+\d+)?$/iu;
const GENERIC_PARTICIPANT_PATTERN = /^(?:participant|voice)(?:\s+\d+)?$/iu;
const UNKNOWN_SPEAKER_PATTERN =
  /^(?:unknown|unidentified)\s+speaker(?:\s+\d+)?$/iu;
const CHANNEL_SPEAKER_PATTERN = /^(?:me|them|you|unknown)$/iu;

const SAMPLE_MIN_SECONDS = 2;
const SAMPLE_PREFERRED_SECONDS = 5;
const SAMPLE_MAX_SECONDS = 8;
const SAMPLE_JOIN_GAP_SECONDS = 0.75;
const SAMPLE_LIMIT = 2;

type SpeakerSegment = {
  speaker?: unknown;
  text?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

type TimedSpeakerSegment = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export interface SpeakerSampleInterval {
  startSec: number;
  endSec: number;
  excerpt: string;
}

const finiteTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timedSegment = (segment: SpeakerSegment): TimedSpeakerSegment | null => {
  const start = finiteTime(segment.startTime) ?? finiteTime(segment.start);
  const end = finiteTime(segment.endTime) ?? finiteTime(segment.end);
  if (start === null || end === null || start < 0 || end <= start) return null;
  return {
    speaker: typeof segment.speaker === 'string' ? segment.speaker.trim() : '',
    text: typeof segment.text === 'string' ? segment.text.trim() : '',
    start,
    end,
  };
};

const overlaps = (left: TimedSpeakerSegment, right: TimedSpeakerSegment) =>
  Math.min(left.end, right.end) > Math.max(left.start, right.start);

export const getAnonymousSpeakerDisplayLabel = (speaker: string): string => {
  const match = REMOTE_SPEAKER_PATTERN.exec(speaker.trim());
  return match ? `Speaker ${match[1]}` : speaker;
};

export const isGenericSpeakerLabel = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const label = value.trim();
  return (
    GENERIC_SPEAKER_PATTERN.test(label) ||
    GENERIC_PARTICIPANT_PATTERN.test(label) ||
    UNKNOWN_SPEAKER_PATTERN.test(label) ||
    CHANNEL_SPEAKER_PATTERN.test(label)
  );
};

export const selectSpeakerSampleIntervals = (
  segments: SpeakerSegment[],
  speaker: string,
  limit = SAMPLE_LIMIT,
): SpeakerSampleInterval[] => {
  if (!REMOTE_SPEAKER_PATTERN.test(speaker) || limit <= 0) return [];
  const timed = segments
    .map(timedSegment)
    .filter((segment): segment is TimedSpeakerSegment => segment !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const otherSpeakers = timed.filter((segment) => segment.speaker !== speaker);
  const clean = timed.filter(
    (segment) =>
      segment.speaker === speaker &&
      !otherSpeakers.some((other) => overlaps(segment, other)),
  );

  const groups: TimedSpeakerSegment[][] = [];
  for (const segment of clean) {
    const current = groups.at(-1);
    if (
      current &&
      segment.start - (current.at(-1)?.end ?? segment.start) <=
        SAMPLE_JOIN_GAP_SECONDS
    ) {
      current.push(segment);
    } else {
      groups.push([segment]);
    }
  }

  return groups
    .map((group) => {
      const startSec = group[0]?.start ?? 0;
      const groupEnd = group.at(-1)?.end ?? startSec;
      const endSec = Math.min(groupEnd, startSec + SAMPLE_MAX_SECONDS);
      return {
        startSec,
        endSec,
        excerpt: group
          .filter((segment) => segment.start < endSec)
          .map((segment) => segment.text)
          .filter(Boolean)
          .join(' '),
      };
    })
    .filter(
      (interval) =>
        interval.endSec - interval.startSec >= SAMPLE_MIN_SECONDS &&
        interval.excerpt.length > 0,
    )
    .sort((left, right) => {
      const leftPreferred =
        left.endSec - left.startSec >= SAMPLE_PREFERRED_SECONDS;
      const rightPreferred =
        right.endSec - right.startSec >= SAMPLE_PREFERRED_SECONDS;
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      const durationDifference =
        right.endSec - right.startSec - (left.endSec - left.startSec);
      return durationDifference || left.startSec - right.startSec;
    })
    .slice(0, Math.min(SAMPLE_LIMIT, Math.floor(limit)));
};
