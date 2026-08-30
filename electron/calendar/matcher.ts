import type { CalendarEvent } from './types';

export type CalendarMatch =
  | { kind: 'none' }
  | { kind: 'ambiguous'; occurrenceKeys: string[] }
  | {
      kind: 'matched';
      occurrenceKey: string;
      evidence: 'time_overlap';
    };

const toMillis = (value: string): number | null => {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export const matchCalendarEvent = (
  recordingStartValue: string,
  recordingEndValue: string,
  events: CalendarEvent[],
): CalendarMatch => {
  const recordingStart = toMillis(recordingStartValue);
  const recordingEnd = toMillis(recordingEndValue);
  if (
    recordingStart === null ||
    recordingEnd === null ||
    recordingEnd <= recordingStart
  ) {
    return { kind: 'none' };
  }
  const recordingDuration = recordingEnd - recordingStart;
  const ranked = events
    .filter((event) => !event.isAllDay && !event.isCancelled)
    .map((event) => {
      const start = toMillis(event.start);
      const end = toMillis(event.end);
      if (start === null || end === null || end <= start) return null;
      const overlap = Math.max(
        0,
        Math.min(recordingEnd, end) - Math.max(recordingStart, start),
      );
      const overlapRatio = overlap / Math.min(recordingDuration, end - start);
      const startDistance = Math.abs(recordingStart - start);
      const startScore = Math.max(0, 1 - startDistance / (15 * 60 * 1000));
      return { event, score: overlapRatio * 0.8 + startScore * 0.2 };
    })
    .filter(
      (candidate): candidate is { event: CalendarEvent; score: number } =>
        candidate !== null && candidate.score >= 0.55,
    )
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return { kind: 'none' };
  const best = ranked[0];
  const ties = ranked.filter(
    (candidate) => Math.abs(candidate.score - best.score) < 0.08,
  );
  if (ties.length > 1) {
    return {
      kind: 'ambiguous',
      occurrenceKeys: ties.map(({ event }) => event.occurrenceKey).sort(),
    };
  }
  return {
    kind: 'matched',
    occurrenceKey: best.event.occurrenceKey,
    evidence: 'time_overlap',
  };
};
