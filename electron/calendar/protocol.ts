import { calendarSeriesKey, sanitizeCalendarAgenda } from './agenda';
import type {
  CalendarAuthorizationStatus,
  CalendarDescriptor,
  CalendarEvent,
  CalendarPerson,
  CalendarRecurrenceRule,
} from './types';

export type CalendarMethod =
  | 'authorization_status'
  | 'request_access'
  | 'list_calendars'
  | 'list_events';

export type CalendarHelperResult =
  | { status: CalendarAuthorizationStatus }
  | { calendars: CalendarDescriptor[] }
  | { events: CalendarEvent[] };

export type CalendarHelperMessage =
  | { kind: 'response'; id: string; result: CalendarHelperResult }
  | { kind: 'error'; id: string | null; code: string; message: string }
  | { kind: 'event'; event: 'event_store_changed' };

const MAX_MESSAGE_BYTES = 1_048_576;
const statuses = new Set<CalendarAuthorizationStatus>([
  'not_determined',
  'denied',
  'restricted',
  'full_access',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringOrNull = (value: unknown): value is string | null =>
  typeof value === 'string' || value === null;

const normalizePerson = (value: unknown): CalendarPerson | null => {
  if (!isRecord(value)) return null;
  if (
    (value.name !== undefined && !isStringOrNull(value.name)) ||
    (value.email !== undefined && !isStringOrNull(value.email)) ||
    (value.isCurrentUser !== undefined &&
      typeof value.isCurrentUser !== 'boolean')
  ) {
    return null;
  }
  return {
    name: value.name ?? null,
    email: value.email ?? null,
    ...(value.isCurrentUser !== undefined
      ? { isCurrentUser: value.isCurrentUser }
      : {}),
  };
};

const isCalendar = (value: unknown): value is CalendarDescriptor =>
  isRecord(value) &&
  typeof value.identifier === 'string' &&
  typeof value.title === 'string' &&
  typeof value.sourceTitle === 'string' &&
  typeof value.sourceType === 'string' &&
  isStringOrNull(value.colorHex);

export const normalizeEvent = (value: unknown): CalendarEvent | null => {
  if (
    !isRecord(value) ||
    typeof value.occurrenceKey !== 'string' ||
    typeof value.eventIdentifier !== 'string' ||
    typeof value.calendarIdentifier !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.start !== 'string' ||
    typeof value.end !== 'string' ||
    typeof value.isAllDay !== 'boolean' ||
    typeof value.isCancelled !== 'boolean' ||
    !Array.isArray(value.attendees) ||
    (value.availability !== undefined && !isStringOrNull(value.availability)) ||
    (value.lastModified !== undefined && !isStringOrNull(value.lastModified)) ||
    (value.calendarItemIdentifier !== undefined &&
      !isStringOrNull(value.calendarItemIdentifier)) ||
    (value.calendarItemExternalIdentifier !== undefined &&
      !isStringOrNull(value.calendarItemExternalIdentifier)) ||
    (value.notes !== undefined && !isStringOrNull(value.notes)) ||
    (value.hasRecurrenceRules !== undefined &&
      typeof value.hasRecurrenceRules !== 'boolean') ||
    (value.recurrenceRules !== undefined &&
      !Array.isArray(value.recurrenceRules))
  ) {
    return null;
  }
  const attendees = value.attendees.map(normalizePerson);
  if (attendees.some((person) => person === null)) return null;
  const organizer =
    value.organizer === undefined || value.organizer === null
      ? null
      : normalizePerson(value.organizer);
  if (value.organizer !== undefined && value.organizer !== null && !organizer) {
    return null;
  }
  const recurrenceRules: CalendarRecurrenceRule[] = Array.isArray(
    value.recurrenceRules,
  )
    ? value.recurrenceRules.flatMap((rule) => {
        if (!isRecord(rule)) return [];
        const frequency =
          rule.frequency === 'daily' ||
          rule.frequency === 'weekly' ||
          rule.frequency === 'monthly' ||
          rule.frequency === 'yearly'
            ? rule.frequency
            : 'unknown';
        const interval =
          typeof rule.interval === 'number' && rule.interval > 0
            ? Math.floor(rule.interval)
            : 1;
        const daysOfWeek = Array.isArray(rule.daysOfWeek)
          ? rule.daysOfWeek.filter(
              (day): day is number =>
                typeof day === 'number' && day >= 1 && day <= 7,
            )
          : [];
        return [
          {
            frequency,
            interval,
            daysOfWeek,
            endDate: isStringOrNull(rule.endDate) ? rule.endDate : null,
            occurrenceCount:
              typeof rule.occurrenceCount === 'number'
                ? rule.occurrenceCount
                : null,
          },
        ];
      })
    : [];
  const event: CalendarEvent = {
    occurrenceKey: value.occurrenceKey,
    eventIdentifier: value.eventIdentifier,
    calendarIdentifier: value.calendarIdentifier,
    title: value.title,
    start: value.start,
    end: value.end,
    isAllDay: value.isAllDay,
    isCancelled: value.isCancelled,
    availability: value.availability ?? null,
    organizer,
    attendees: attendees as CalendarPerson[],
    lastModified: value.lastModified ?? null,
    calendarItemIdentifier: value.calendarItemIdentifier ?? null,
    calendarItemExternalIdentifier:
      value.calendarItemExternalIdentifier ?? null,
    notes: value.notes ?? null,
    agenda: sanitizeCalendarAgenda(value.notes ?? null),
    hasRecurrenceRules: value.hasRecurrenceRules ?? recurrenceRules.length > 0,
    recurrenceRules,
    seriesKey: null,
  };
  event.seriesKey = calendarSeriesKey(event);
  return event;
};

const parseResult = (value: unknown): CalendarHelperResult => {
  if (!isRecord(value)) throw new Error('Unexpected calendar helper result');
  if (
    typeof value.status === 'string' &&
    statuses.has(value.status as CalendarAuthorizationStatus)
  ) {
    return { status: value.status as CalendarAuthorizationStatus };
  }
  if (Array.isArray(value.calendars) && value.calendars.every(isCalendar)) {
    return { calendars: value.calendars };
  }
  if (Array.isArray(value.events)) {
    const events = value.events.map(normalizeEvent);
    if (events.every((event) => event !== null)) {
      return { events: events as CalendarEvent[] };
    }
  }
  throw new Error('Unexpected calendar helper result');
};

export const parseCalendarMessage = (line: string): CalendarHelperMessage => {
  if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('Calendar helper message is too large');
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Malformed calendar helper message');
  }
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Unexpected calendar helper message');
  }
  if (value.event === 'event_store_changed') {
    return { kind: 'event', event: value.event };
  }
  if (isRecord(value.error)) {
    if (
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string' ||
      (value.id !== undefined &&
        value.id !== null &&
        typeof value.id !== 'string')
    ) {
      throw new Error('Unexpected calendar helper message');
    }
    return {
      kind: 'error',
      id: typeof value.id === 'string' ? value.id : null,
      code: value.error.code,
      message: value.error.message,
    };
  }
  if (typeof value.id !== 'string') {
    throw new Error('Unexpected calendar helper message');
  }
  return { kind: 'response', id: value.id, result: parseResult(value.result) };
};

export const buildCalendarRequest = (
  method: CalendarMethod,
  id: string,
  params?: Record<string, string>,
) => {
  if (method === 'list_events') {
    const start = params?.start ? new Date(params.start) : null;
    const end = params?.end ? new Date(params.end) : null;
    if (
      !params?.calendarIdentifier?.trim() ||
      !start ||
      !end ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end
    ) {
      throw new Error('Calendar request needs one calendar and a valid window');
    }
    if (end.getTime() - start.getTime() > 60 * 24 * 60 * 60 * 1000) {
      throw new Error('Calendar window cannot exceed 60 days');
    }
  }
  return {
    version: 1 as const,
    id,
    method,
    ...(params ? { params } : {}),
  };
};
