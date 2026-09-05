import type {
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
  MeetingCalendarContext,
} from '../../electron/calendar/types';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  window.ipcRenderer.invoke(channel, ...args) as Promise<T>;

export const getCalendarState = () =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_GET_STATE');

export const connectCalendar = () =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_CONNECT');

export const selectCalendars = (calendars: CalendarDescriptor[]) =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_SELECT', calendars);

export const selectCalendar = (calendar: CalendarDescriptor) =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_SELECT', calendar);

export const refreshCalendar = () =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_REFRESH');

export const listCalendarDay = (start: string, end: string) =>
  invoke<CalendarEvent[]>('CALENDAR_LIST_DAY', { start, end });

export const disconnectCalendar = () =>
  invoke<CalendarIntegrationSnapshot>('CALENDAR_DISCONNECT');

export const getMeetingCalendarContext = (meetingId: string) =>
  invoke<MeetingCalendarContext | null>(
    'CALENDAR_GET_MEETING_CONTEXT',
    meetingId,
  );

export const openCalendarSystemSettings = (
  target: 'privacy' | 'accounts' = 'privacy',
) => invoke<boolean>('OPEN_CALENDAR_SYSTEM_SETTINGS', target);

export const matchActiveCalendarEvent = (atTime?: string) =>
  invoke<{
    match: { kind: string; occurrenceKey?: string };
    event: CalendarEvent | null;
  }>('CALENDAR_MATCH_ACTIVE', { atTime });

export const associateMeetingAtStart = (meetingId: string, atTime?: string) =>
  invoke<{
    context: MeetingCalendarContext | null;
    event: CalendarEvent | null;
  }>('CALENDAR_ASSOCIATE_START', { meetingId, atTime });
