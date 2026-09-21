const MAX_AGENDA_CHARACTERS = 8_000;

const CONFERENCE_URL =
  /https?:\/\/(?:[^\s/]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|gotomeeting\.com)\S*/gi;
const CONFERENCE_BOILERPLATE =
  /^(?:join (?:zoom|google meet|microsoft teams|webex)(?: meeting)?|meeting id|passcode|password|one tap mobile|dial by your location|join by phone|video call details)\s*[:：]?\s*.*$/i;

const decodeBasicHtml = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const sanitizeCalendarAgenda = (
  notes: string | null | undefined,
): string | null => {
  if (!notes?.trim()) return null;
  const lines = decodeBasicHtml(notes)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(CONFERENCE_URL, '').trimEnd())
    .filter((line) => !CONFERENCE_BOILERPLATE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return lines ? lines.slice(0, MAX_AGENDA_CHARACTERS) : null;
};

export const calendarSeriesKey = (event: {
  calendarIdentifier: string;
  calendarItemExternalIdentifier?: string | null;
  hasRecurrenceRules?: boolean;
}): string | null => {
  const externalId = event.calendarItemExternalIdentifier?.trim();
  if (!event.hasRecurrenceRules || !externalId) return null;
  return `${event.calendarIdentifier}|${externalId}`;
};
