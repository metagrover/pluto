import { normalizeReminderDeadline } from './commitmentReminderPolicy';

const weekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
// shortcut: Full English month names only; extend when other source forms need scheduling.
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const namedPrefix = `^(?:(?:by|on)\\s+)?(?:(${weekdays.join('|')})(?:,\\s*|\\s+))?`;
const namedSuffix = '(?:(?:,\\s*|\\s+)(\\d{4}))?$';
const monthFirstDate = new RegExp(
  `${namedPrefix}(${months.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?${namedSuffix}`,
);
const dayFirstDate = new RegExp(
  `${namedPrefix}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months.join('|')})${namedSuffix}`,
);

/** Normalize supported dates using the source meeting calendar, never extraction time. */
export function parseDueDate(
  dueDate: string,
  meetingStartedAt?: string | null,
  timeZone?: string,
): string | null {
  if (!dueDate || typeof dueDate !== 'string') return null;
  const text = dueDate.trim();
  const explicit = normalizeReminderDeadline(text);
  if (explicit)
    return explicit.kind === 'date'
      ? text
      : new Date(explicit.instant).toISOString();
  const lower = text.toLowerCase();
  const monthFirst = monthFirstDate.exec(lower);
  const named = monthFirst ?? dayFirstDate.exec(lower);
  const namedCalendarDate = (year: string): string | null => {
    if (!named) return null;
    const month = months.indexOf(named[monthFirst ? 2 : 3]!) + 1;
    const day = named[monthFirst ? 3 : 2]!;
    const result = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
    const valid = normalizeReminderDeadline(result);
    if (valid?.kind !== 'date') return null;
    if (
      named[1] &&
      weekdays.indexOf(named[1]) !== new Date(valid.day).getUTCDay()
    )
      return null;
    return result;
  };
  if (named?.[4]) return namedCalendarDate(named[4]);
  if (!meetingStartedAt) return null;
  const meeting = normalizeReminderDeadline(meetingStartedAt);
  if (!meeting) return null;
  let calendarDate = meetingStartedAt.slice(0, 10);
  if (timeZone && meeting.kind === 'timestamp') {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(meeting.instant);
      const part = (type: string) =>
        parts.find((entry) => entry.type === type)?.value;
      calendarDate = `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      return null;
    }
  }
  const base = normalizeReminderDeadline(calendarDate);
  if (base?.kind !== 'date') return null;
  // An omitted year belongs to the meeting calendar, not the next matching year.
  if (named) return namedCalendarDate(calendarDate.slice(0, 4));
  let days: number;
  if (lower === 'today') days = 0;
  else if (lower === 'tomorrow') days = 1;
  else {
    const weekday =
      /^(?:(?:by|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(
        lower,
      );
    const target = weekday
      ? weekdays.indexOf(weekday[1])
      : lower === 'end of week' || lower === 'eow'
        ? 5
        : -1;
    if (target < 0) return null; // A week, locale-dependent date or vague phrase is not a deadline.
    days = (target - new Date(base.day).getUTCDay() + 7) % 7;
  }
  return new Date(base.day + days * 86_400_000).toISOString().slice(0, 10);
}
