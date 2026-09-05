import type { CalendarEvent } from '../../electron/calendar/types';
import { hasConferenceLink } from './conferenceUrl';

export type CalendarPromptInput = {
  nowMs: number;
  events: CalendarEvent[];
  dismissedKeys: Set<string>;
  isRecording: boolean;
  promptEnabled: boolean;
};

const PROMPT_WINDOW_PAST_MS = 5 * 60 * 1000; // 5 min past scheduled start
const PROMPT_WINDOW_FUTURE_MS = 15 * 60 * 1000; // 15 min before scheduled start

/**
 * Evaluates candidate events for surfacing a meeting start prompt.
 * Selects an upcoming or active meeting starting within [-5m, +15m],
 * prioritizing meetings with conference links.
 */
export const getEligibleCalendarPrompt = ({
  nowMs,
  events,
  dismissedKeys,
  isRecording,
  promptEnabled,
}: CalendarPromptInput): CalendarEvent | null => {
  if (
    !promptEnabled ||
    isRecording ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    return null;
  }

  const candidates = events
    .filter((event) => {
      if (!event || event.isAllDay || event.isCancelled) return false;
      if (dismissedKeys.has(event.occurrenceKey)) return false;

      const startMs = new Date(event.start).getTime();
      const endMs = new Date(event.end).getTime();

      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= nowMs) {
        return false;
      }

      // Must start within [-5m, +15m] of now
      return (
        startMs >= nowMs - PROMPT_WINDOW_PAST_MS &&
        startMs <= nowMs + PROMPT_WINDOW_FUTURE_MS
      );
    })
    .map((event) => {
      const startMs = new Date(event.start).getTime();
      const hasLink = hasConferenceLink(event);
      const distanceMs = Math.abs(startMs - nowMs);
      return { event, hasLink, distanceMs };
    })
    .sort((a, b) => {
      // Prioritize events with conference links
      if (a.hasLink && !b.hasLink) return -1;
      if (!a.hasLink && b.hasLink) return 1;
      // Then prioritize closest to now
      return a.distanceMs - b.distanceMs;
    });

  return candidates[0]?.event ?? null;
};
