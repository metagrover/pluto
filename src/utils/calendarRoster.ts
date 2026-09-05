import type { CalendarEvent } from '../../electron/calendar/types';

const normalizeRosterName = (
  value: string | null | undefined,
): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const getCalendarRosterNames = (event: CalendarEvent): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const person of [event.organizer, ...event.attendees]) {
    if (!person) continue;
    const name = normalizeRosterName(person.name ?? person.email);
    if (!name) continue;
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
};

export const isMatchedActiveCalendarResult = (value: {
  match?: { kind?: string } | null;
  event?: CalendarEvent | null;
}): value is {
  match: { kind: 'matched'; occurrenceKey?: string };
  event: CalendarEvent;
} => value.match?.kind === 'matched' && Boolean(value.event);
