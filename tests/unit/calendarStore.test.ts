import path from 'node:path';
import Database from 'better-sqlite3';
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

const calendarB = {
  identifier: 'calendar-b',
  title: 'Personal',
  sourceTitle: 'Google',
  sourceType: 'caldav',
  colorHex: '#34A853',
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

const calendarEventB: CalendarEvent = {
  occurrenceKey: 'calendar-b|event-b|2026-08-30T19:00:00.000Z',
  eventIdentifier: 'event-b',
  calendarIdentifier: 'calendar-b',
  title: 'Family dinner',
  start: '2026-08-30T19:00:00.000Z',
  end: '2026-08-30T20:00:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
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
      selectedCalendars: [],
    });
    expect(store.listEvents('2026-08-01', '2026-10-01')).toEqual([]);
    expect(store.getMeetingContext('meeting-a')).toBeNull();
  });

  it('migrates legacy single calendar row to selectedCalendars while preserving rollback compatibility', () => {
    const rawDb = new Database(':memory:');
    rawDb.exec(`
      CREATE TABLE calendar_integration (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        selected_calendar_json TEXT,
        selected_calendars_json TEXT,
        cache_revision INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_read_at TEXT,
        cache_start TEXT,
        cache_end TEXT,
        error_code TEXT
      );
      INSERT INTO calendar_integration (singleton, enabled, selected_calendar_json)
      VALUES (1, 1, '${JSON.stringify(calendar)}');
    `);

    const store = createCalendarStore(rawDb);
    const state = store.getState();
    expect(state.enabled).toBe(true);
    expect(state.selectedCalendars).toEqual([calendar]);
    expect(state.selectedCalendar).toEqual(calendar);

    // Verify rollback compatibility: selected_calendar_json remains a single descriptor object
    const rawRow = rawDb
      .prepare(
        'SELECT selected_calendar_json FROM calendar_integration WHERE singleton = 1',
      )
      .get() as { selected_calendar_json: string };
    const parsed = JSON.parse(rawRow.selected_calendar_json);
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.identifier).toBe(calendar.identifier);
    rawDb.close();
  });

  it('persists multiple selected calendars and replaces combined events atomically', () => {
    const store = createCalendarStore(sql);
    store.selectCalendars([calendar, calendarB]);
    expect(store.getState()).toMatchObject({
      enabled: true,
      selectedCalendars: [calendar, calendarB],
      selectedCalendar: calendar,
      cacheRevision: 0,
    });

    // Rollback compatibility check on the table row
    const rawRow = sql
      .prepare(
        'SELECT selected_calendar_json, selected_calendars_json FROM calendar_integration WHERE singleton = 1',
      )
      .get() as {
      selected_calendar_json: string;
      selected_calendars_json: string;
    };
    const parsedPrimary = JSON.parse(rawRow.selected_calendar_json);
    expect(Array.isArray(parsedPrimary)).toBe(false);
    expect(parsedPrimary.identifier).toBe(calendar.identifier);
    expect(JSON.parse(rawRow.selected_calendars_json)).toEqual([
      calendar,
      calendarB,
    ]);

    // Atomic combined cache replacement
    const ok = store.replaceEvents({
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent, calendarEventB],
    });
    expect(ok).toBe(true);

    const listed = store.listEvents(
      '2026-08-30T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z',
    );
    expect(listed).toHaveLength(2);
    expect(listed.map((e) => e.calendarIdentifier)).toEqual([
      'calendar-a',
      'calendar-b',
    ]);
  });

  it('persists the matched event actual calendar title rather than assuming a global calendar', () => {
    const store = createCalendarStore(sql);
    store.selectCalendars([calendar, calendarB]);
    store.replaceEvents({
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent, calendarEventB],
    });

    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('meeting-b', 'Meeting B');
    const matched = store.associateMeeting(
      'meeting-b',
      '2026-08-30T19:01:00.000Z',
      '2026-08-30T19:45:00.000Z',
    );
    expect(matched).not.toBeNull();
    expect(matched?.occurrenceKey).toBe(calendarEventB.occurrenceKey);
    // Should persist calendarB's title ("Personal"), NOT calendarA's title ("Work")!
    expect(matched?.calendarTitle).toBe('Personal');
  });

  it('preserves historical context for retained calendars and purges removed calendars', () => {
    const store = createCalendarStore(sql);
    store.selectCalendars([calendar, calendarB]);
    store.replaceEvents({
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent, calendarEventB],
    });
    sql
      .prepare(
        'INSERT INTO meetings (id, title, started_at) VALUES (?, ?, ?), (?, ?, ?)',
      )
      .run(
        'meeting-a',
        'Product review',
        calendarEvent.start,
        'meeting-b',
        'Family dinner',
        calendarEventB.start,
      );
    store.setMeetingContext('meeting-a', calendarEvent.occurrenceKey, 'user');
    store.setMeetingContext('meeting-b', calendarEventB.occurrenceKey, 'user');

    store.selectCalendars([calendar]);

    expect(store.getMeetingContext('meeting-a')).not.toBeNull();
    expect(store.getMeetingContext('meeting-b')).toBeNull();
    expect(
      store.listPriorMeetingContexts('2026-09-01T00:00:00.000Z'),
    ).toMatchObject([
      { meetingId: 'meeting-a', meetingTitle: 'Product review' },
    ]);
  });

  it('matches active calendar event at start time and associates context immediately', () => {
    const store = createCalendarStore(sql);
    store.selectCalendars([calendar, calendarB]);
    store.replaceEvents({
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent, calendarEventB],
    });

    // Recording begins at 17:31 during calendarEvent (17:30 - 18:30)
    const activeResult = store.matchActiveEvent('2026-08-30T17:31:00.000Z');
    expect(activeResult.match.kind).toBe('matched');
    expect(activeResult.event?.title).toBe('Product review');
    expect(activeResult.event?.attendees).toHaveLength(1);

    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('meeting-proactive-1', 'Proactive Meeting');
    const association = store.associateMeetingAtStart(
      'meeting-proactive-1',
      '2026-08-30T17:31:00.000Z',
    );
    expect(association.context).not.toBeNull();
    expect(association.context?.occurrenceKey).toBe(
      calendarEvent.occurrenceKey,
    );
    expect(association.context?.matchOrigin).toBe('automatic');
    expect(association.event?.title).toBe('Product review');

    // Context should already be queryable via getMeetingContext
    const retrieved = store.getMeetingContext('meeting-proactive-1');
    expect(retrieved?.occurrenceKey).toBe(calendarEvent.occurrenceKey);
  });

  it('keeps general recordings unlinked until a selected invite is saved', () => {
    const store = createCalendarStore(sql);
    store.selectCalendars([calendar, calendarB]);
    const overlapping = {
      ...calendarEventB,
      start: calendarEvent.start,
      end: calendarEvent.end,
    };
    store.replaceEvents({
      revision: 1,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T16:00:00.000Z',
      events: [calendarEvent, overlapping],
    });
    const candidates = store.listActiveCandidates('2026-08-30T17:31:00.000Z');
    expect(candidates.map((event) => event.occurrenceKey)).toEqual([
      calendarEvent.occurrenceKey,
      overlapping.occurrenceKey,
    ]);

    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('unanswered-recording', 'Untitled meeting');
    expect(store.applyRecordingSelection('unanswered-recording')).toBeNull();
    expect(store.getMeetingContext('unanswered-recording')).toBeNull();

    store.confirmRecordingSelection(
      'confirmed-recording',
      overlapping.occurrenceKey,
    );
    store.replaceEvents({
      revision: 2,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T17:45:00.000Z',
      events: [],
    });
    // Recreate the store to simulate a renderer/app restart before recovery saves the meeting.
    const recoveredStore = createCalendarStore(sql);
    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('confirmed-recording', 'My custom title');
    const linked = recoveredStore.applyRecordingSelection(
      'confirmed-recording',
    );
    expect(linked).toMatchObject({
      occurrenceKey: overlapping.occurrenceKey,
      matchOrigin: 'user',
      matchEvidence: 'user_selected',
      event: { title: 'Family dinner' },
    });
    expect(
      recoveredStore.applyRecordingSelection('confirmed-recording'),
    ).toBeNull();
    expect(recoveredStore.getMeetingContext('unanswered-recording')).toBeNull();
    recoveredStore.replaceEvents({
      revision: 3,
      cacheStart: '2026-08-16T00:00:00.000Z',
      cacheEnd: '2026-09-30T00:00:00.000Z',
      readAt: '2026-08-30T17:50:00.000Z',
      events: [calendarEvent],
    });
    recoveredStore.confirmRecordingSelection(
      'saved-before-link',
      calendarEvent.occurrenceKey,
    );
    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('saved-before-link', 'Saved before the app stopped');
    expect(recoveredStore.reconcileRecordingSelections()).toBe(1);
    expect(recoveredStore.getMeetingContext('saved-before-link')).toMatchObject(
      {
        matchOrigin: 'user',
        occurrenceKey: calendarEvent.occurrenceKey,
      },
    );
    recoveredStore.confirmRecordingSelection(
      'disconnected-recording',
      calendarEvent.occurrenceKey,
    );
    recoveredStore.disconnect();
    sql
      .prepare('INSERT INTO meetings (id, title) VALUES (?, ?)')
      .run('disconnected-recording', 'Unlinked after disconnect');
    expect(
      recoveredStore.applyRecordingSelection('disconnected-recording'),
    ).toBeNull();
  });
  it('filters email history before applying the candidate limit', () => {
    const store = createCalendarStore(sql);
    const meetingInsert = sql.prepare(
      'INSERT INTO meetings(id,title,started_at) VALUES (?,?,?)',
    );
    const contextInsert = sql.prepare(
      "INSERT INTO meeting_calendar_context(meeting_id,occurrence_key,calendar_title,event_json,match_origin,match_evidence,cache_revision) VALUES (?,?,'Work',?,'automatic','time_overlap',1)",
    );
    for (let index = 0; index < 205; index++) {
      const id = `candidate-${index}`;
      const matching = index === 0;
      meetingInsert.run(
        id,
        'Review',
        matching ? '2026-08-01T10:00:00Z' : '2026-09-01T10:00:00Z',
      );
      contextInsert.run(
        id,
        id,
        JSON.stringify({
          ...calendarEvent,
          occurrenceKey: id,
          organizer: null,
          attendees: [
            {
              name: 'Sam',
              email: matching ? 'sam@example.com' : 'someone-else@example.com',
            },
          ],
        }),
      );
    }
    expect(
      store
        .listPriorMeetingContexts('2026-09-28T10:00:00Z', 200)
        .map((c) => c.meetingId),
    ).not.toContain('candidate-0');
    expect(
      store
        .listPriorMeetingContexts('2026-09-28T10:00:00Z', 200, {
          event: calendarEvent,
          emails: ['sam@example.com'],
        })
        .map((c) => c.meetingId),
    ).toEqual(['candidate-0']);
  });
});
