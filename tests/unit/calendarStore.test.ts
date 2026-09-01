import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCalendarStore } from '../../electron/calendar/store';
import type { CalendarEvent } from '../../electron/calendar/types';
import {
  type DatabaseRuntime,
  createDatabaseRuntime,
} from '../../electron/database/runtime';

const calendar = {
  identifier: 'calendar-a',
  title: 'Work',
  sourceTitle: 'iCloud',
  sourceType: 'icloud',
  colorHex: '#7367D9',
};

const calendarEvent: CalendarEvent = {
  occurrenceKey: 'calendar-a|event-a|2026-08-30T17:30:00.000Z',
  eventIdentifier: 'event-a',
  calendarIdentifier: 'calendar-a',
  title: 'Product review',
  start: '2026-08-30T17:30:00.000Z',
  end: '2026-08-30T18:30:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: { name: 'Alex', email: 'alex@example.com' },
  attendees: [{ name: 'Sam', email: 'sam@example.com' }],
  lastModified: null,
};

describe('calendar store', () => {
  let sql: Database.Database;
  let runtime: DatabaseRuntime;
  beforeEach(() => {
    runtime = createDatabaseRuntime({
      databasePath: ':memory:',
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });
    sql = runtime.initialize();
  });
  afterEach(() => runtime.close());

  it('persists one selected calendar and transactionally replaces its window', () => {
    const store = createCalendarStore(sql);
    store.selectCalendar(calendar);
    expect(store.getState()).toMatchObject({
      enabled: true,
      selectedCalendar: calendar,
      cacheRevision: 0,
    });

    expect(
      store.replaceEvents({
        calendarIdentifier: calendar.identifier,
        revision: 1,
        cacheStart: '2026-08-16T00:00:00.000Z',
        cacheEnd: '2026-09-30T00:00:00.000Z',
        readAt: '2026-08-30T16:00:00.000Z',
        events: [calendarEvent, calendarEvent],
      }),
    ).toBe(true);
    expect(
      store.listEvents('2026-08-30T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
    ).toEqual([calendarEvent]);
  });

  it('rejects stale or old-selection refreshes', () => {
    const store = createCalendarStore(sql);
    store.selectCalendar(calendar);
    const input = {
      calendarIdentifier: calendar.identifier,
      revision: 2,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent],
    };
    expect(store.replaceEvents(input)).toBe(true);
    expect(store.replaceEvents({ ...input, revision: 1, events: [] })).toBe(
      false,
    );
    expect(
      store.replaceEvents({ ...input, calendarIdentifier: 'calendar-old' }),
    ).toBe(false);
    expect(store.listEvents(input.cacheStart, input.cacheEnd)).toHaveLength(1);
  });

  it('associates a strong time match without overwriting a user choice', () => {
    const store = createCalendarStore(sql);
    store.selectCalendar(calendar);
    store.replaceEvents({
      calendarIdentifier: calendar.identifier,
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent],
    });
    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('meeting-a', 'Meeting');
    expect(
      store.associateMeeting(
        'meeting-a',
        '2026-08-30T17:31:00.000Z',
        '2026-08-30T18:15:00.000Z',
      ),
    ).toMatchObject({ sourceKind: 'macos_calendar', matchOrigin: 'automatic' });

    store.setMeetingContext('meeting-a', calendarEvent.occurrenceKey, 'user');
    expect(
      store.associateMeeting(
        'meeting-a',
        '2026-08-30T20:00:00.000Z',
        '2026-08-30T20:30:00.000Z',
      ),
    ).toMatchObject({ matchOrigin: 'user' });
  });

  it('purges selection, cached attendees, and meeting links on disconnect', () => {
    const store = createCalendarStore(sql);
    store.selectCalendar(calendar);
    store.replaceEvents({
      calendarIdentifier: calendar.identifier,
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent],
    });
    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('meeting-a', 'Meeting');
    store.setMeetingContext('meeting-a', calendarEvent.occurrenceKey, 'user');

    store.disconnect();

    expect(store.getState()).toMatchObject({
      enabled: false,
      selectedCalendar: null,
    });
    expect(store.listEvents('2026-08-01', '2026-10-01')).toEqual([]);
    expect(store.getMeetingContext('meeting-a')).toBeNull();
  });
});
