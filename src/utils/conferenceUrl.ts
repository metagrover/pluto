import type { CalendarEvent } from '../../electron/calendar/types';

// Patterns matching common conferencing provider URLs
const CONFERENCE_PATTERNS: RegExp[] = [
  // Zoom: zoom.us/j/..., zoom.us/my/..., *.zoom.us/wc/...
  /https?:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j\/\d+|my\/[\w.-]+|wc\/(?:join\/)?\d+)[^\s"'>]*/i,

  // Google Meet: meet.google.com/xxx-yyyy-zzz
  /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s"'>]*/i,

  // Microsoft Teams: teams.microsoft.com/l/meetup-join/..., teams.live.com/meet/...
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'>]*/i,
  /https?:\/\/teams\.live\.com\/meet\/\d+[^\s"'>]*/i,

  // Webex: *.webex.com/meet/..., *.webex.com/join/...
  /https?:\/\/[\w-]+\.webex\.com\/(?:meet|join)\/[^\s"'>]*/i,

  // Slack huddles & calls
  /https?:\/\/app\.slack\.com\/(?:huddle|call)\/[^\s"'>]*/i,
];

/**
 * Extracts the first matching conference URL from an arbitrary text string.
 */
export const extractConferenceUrl = (
  text: string | null | undefined,
): string | null => {
  if (!text || typeof text !== 'string') return null;

  for (const pattern of CONFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      // Clean trailing punctuation commonly attached in freeform text
      return match[0].replace(/[.,;:)]+$/, '');
    }
  }

  return null;
};

/**
 * Checks whether a CalendarEvent contains a conference link in any of its
 * standard fields (title, location, notes, url).
 */
export const hasConferenceLink = (event: CalendarEvent): boolean => {
  if (!event) return false;

  const anyEvent = event as unknown as {
    location?: string | null;
    notes?: string | null;
    url?: string | null;
  };

  const fieldsToCheck = [
    event.title,
    anyEvent.url,
    anyEvent.location,
    anyEvent.notes,
  ];

  for (const field of fieldsToCheck) {
    if (extractConferenceUrl(field) !== null) {
      return true;
    }
  }

  return false;
};
