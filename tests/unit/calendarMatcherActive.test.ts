import { describe, expect, it } from 'vitest';

import { matchActiveCalendarEvent } from '../../electron/calendar/matcher';
import type { CalendarEvent } from '../../electron/calendar/types';

const makeEvent = (
  occurrenceKey: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  occurrenceKey,
  eventIdentifier: occurrenceKey,
  calendarIdentifier: 'calendar-a',
  title: occurrenceKey,
  start,
  end,
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [
    { name: 'Alice Smith', email: 'alice@example.com' },
    { name: 'Bob Jones', email: 'bob@example.com' },
  ],
  lastModified: null,
  ...overrides,
});

describe('proactive active calendar event matcher', () => {
  it('selects an ongoing event that is actively in progress', () => {
    // Current time is 17:35; event is 17:30 - 18:00
    const now = '2026-09-04T17:35:00.000Z';
    const active = makeEvent(
      'sprint-planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      { title: 'Sprint Planning' },
    );
    const later = makeEvent(
      'team-sync',
      '2026-09-04T19:00:00.000Z',
      '2026-09-04T19:30:00.000Z',
      { title: 'Team Sync' },
    );

    const match = matchActiveCalendarEvent(now, [active, later]);
    expect(match).toEqual({
      kind: 'matched',
      occurrenceKey: 'sprint-planning',
      evidence: 'time_overlap',
    });
  });

  it('selects an upcoming event starting within 15 minutes', () => {
    // Current time is 17:25; event starts at 17:30 (5 minutes away)
    const now = '2026-09-04T17:25:00.000Z';
    const upcoming = makeEvent(
      'design-critique',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      { title: 'Design Critique' },
    );

    const match = matchActiveCalendarEvent(now, [upcoming]);
    expect(match).toEqual({
      kind: 'matched',
      occurrenceKey: 'design-critique',
      evidence: 'time_overlap',
    });
  });

  it('selects an event that ended within the past 15 minutes if user started recording slightly late', () => {
    // Event was 17:00 - 17:30; current time is 17:35 (5 minutes after scheduled end)
    const now = '2026-09-04T17:35:00.000Z';
    const recent = makeEvent(
      'quick-debrief',
      '2026-09-04T17:00:00.000Z',
      '2026-09-04T17:30:00.000Z',
      { title: 'Quick Debrief' },
    );

    const match = matchActiveCalendarEvent(now, [recent]);
    expect(match).toEqual({
      kind: 'matched',
      occurrenceKey: 'quick-debrief',
      evidence: 'time_overlap',
    });
  });

  it('prioritizes an actively ongoing event over an upcoming one', () => {
    // Current time is 17:45. Event A is 17:30 - 18:00. Event B is 17:50 - 18:30.
    const now = '2026-09-04T17:45:00.000Z';
    const ongoing = makeEvent(
      'ongoing-meeting',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
    );
    const upcoming = makeEvent(
      'upcoming-meeting',
      '2026-09-04T17:50:00.000Z',
      '2026-09-04T18:30:00.000Z',
    );

    const match = matchActiveCalendarEvent(now, [ongoing, upcoming]);
    expect(match).toEqual({
      kind: 'matched',
      occurrenceKey: 'ongoing-meeting',
      evidence: 'time_overlap',
    });
  });

  it('returns ambiguous when two events start at the same time and are in progress', () => {
    const now = '2026-09-04T17:35:00.000Z';
    const eventA = makeEvent(
      'meeting-a',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
    );
    const eventB = makeEvent(
      'meeting-b',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
    );

    const match = matchActiveCalendarEvent(now, [eventA, eventB]);
    expect(match).toEqual({
      kind: 'ambiguous',
      occurrenceKeys: ['meeting-a', 'meeting-b'],
    });
  });

  it('excludes all-day and cancelled events', () => {
    const now = '2026-09-04T17:35:00.000Z';
    const allDay = makeEvent(
      'all-day-event',
      '2026-09-04T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
      { isAllDay: true },
    );
    const cancelled = makeEvent(
      'cancelled-meeting',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      { isCancelled: true },
    );

    const match = matchActiveCalendarEvent(now, [allDay, cancelled]);
    expect(match).toEqual({ kind: 'none' });
  });

  it('returns none when no events are within the ±15 minute threshold', () => {
    // Current time is 17:00; event starts at 18:00 (60 minutes away)
    const now = '2026-09-04T17:00:00.000Z';
    const distant = makeEvent(
      'distant-event',
      '2026-09-04T18:00:00.000Z',
      '2026-09-04T18:30:00.000Z',
    );

    const match = matchActiveCalendarEvent(now, [distant]);
    expect(match).toEqual({ kind: 'none' });
  });
});
