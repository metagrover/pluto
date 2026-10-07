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

const ACTIVE_MATCH_THRESHOLD_MS = 15 * 60 * 1000;

const rankActiveCalendarCandidates = (
  atTimeValue: string,
  events: CalendarEvent[],
): Array<{ event: CalendarEvent; score: number }> => {
  const atTime = toMillis(atTimeValue);
  if (atTime === null) return [];

  const ranked = events
    .filter((event) => !event.isAllDay && !event.isCancelled)
    .map((event) => {
      const start = toMillis(event.start);
      const end = toMillis(event.end);
      if (start === null || end === null || end <= start) return null;

      if (
        atTime < start - ACTIVE_MATCH_THRESHOLD_MS ||
        atTime > end + ACTIVE_MATCH_THRESHOLD_MS
      ) {
        return null;
      }

      let score = 0;
      if (atTime >= start && atTime <= end) {
        const duration = Math.max(1, end - start);
        const progressBonus = 0.1 * (1 - Math.abs(atTime - start) / duration);
        score = 0.9 + progressBonus;
      } else if (atTime < start) {
        const timeUntilStart = start - atTime;
        score = 0.85 - 0.25 * (timeUntilStart / ACTIVE_MATCH_THRESHOLD_MS);
      } else {
        const timeSinceEnd = atTime - end;
        score = 0.75 - 0.17 * (timeSinceEnd / ACTIVE_MATCH_THRESHOLD_MS);
      }

      return { event, score };
    })
    .filter(
      (candidate): candidate is { event: CalendarEvent; score: number } =>
        candidate !== null && candidate.score >= 0.55,
    )
    .sort((left, right) => right.score - left.score);

  return ranked;
};

export const listActiveCalendarCandidates = (
  atTimeValue: string,
  events: CalendarEvent[],
): CalendarEvent[] =>
  rankActiveCalendarCandidates(atTimeValue, events).map(({ event }) => event);

export const matchActiveCalendarEvent = (
  atTimeValue: string,
  events: CalendarEvent[],
): CalendarMatch => {
  const ranked = rankActiveCalendarCandidates(atTimeValue, events);
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
