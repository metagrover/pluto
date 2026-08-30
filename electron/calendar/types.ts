export type CalendarAuthorizationStatus =
  | 'not_determined'
  | 'denied'
  | 'restricted'
  | 'full_access';

export type CalendarCapabilityState =
  | 'unsupported_platform'
  | 'runtime_missing'
  | 'not_determined'
  | 'denied'
  | 'restricted'
  | 'needs_selection'
  | 'no_calendars'
  | 'selected_calendar_missing'
  | 'read_failed'
  | 'ready';

export interface CalendarPerson {
  name: string | null;
  email: string | null;
}

export interface CalendarDescriptor {
  identifier: string;
  title: string;
  sourceTitle: string;
  sourceType: string;
  colorHex: string | null;
}

export interface CalendarEvent {
  occurrenceKey: string;
  eventIdentifier: string;
  calendarIdentifier: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  isCancelled: boolean;
  availability: string | null;
  organizer: CalendarPerson | null;
  attendees: CalendarPerson[];
  lastModified: string | null;
}

export interface CalendarIntegrationSnapshot {
  state: CalendarCapabilityState;
  authorization: CalendarAuthorizationStatus;
  enabled: boolean;
  selectedCalendar: CalendarDescriptor | null;
  calendars: CalendarDescriptor[];
  lastAttemptAt: string | null;
  lastReadAt: string | null;
  cacheStart: string | null;
  cacheEnd: string | null;
  stale: boolean;
}

export interface MeetingCalendarContext {
  sourceKind: 'macos_calendar';
  occurrenceKey: string;
  calendarTitle: string;
  event: CalendarEvent;
  matchOrigin: 'automatic' | 'user';
  matchEvidence: 'time_overlap' | 'user_selected';
}
