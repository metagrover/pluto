import type Database from 'better-sqlite3';

import { matchCalendarEvent } from './matcher';
import type {
  CalendarCapabilityState,
  CalendarDescriptor,
  CalendarEvent,
  MeetingCalendarContext,
} from './types';

type SqlDatabase = Database.Database;

interface IntegrationRow {
  enabled: number;
  selected_calendar_json: string | null;
  selected_calendars_json: string | null;
  cache_revision: number;
  last_attempt_at: string | null;
  last_read_at: string | null;
  cache_start: string | null;
  cache_end: string | null;
  error_code: CalendarCapabilityState | null;
}

interface EventRow {
  event_json: string;
}

interface ContextRow {
  event_json: string;
  calendar_title: string;
  occurrence_key: string;
  match_origin: 'automatic' | 'user';
  match_evidence: 'time_overlap' | 'user_selected';
}

export const ensureCalendarSchema = (sql: SqlDatabase) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS calendar_integration (
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
    INSERT OR IGNORE INTO calendar_integration(singleton) VALUES (1);

    CREATE TABLE IF NOT EXISTS calendar_events (
      occurrence_key TEXT PRIMARY KEY,
      calendar_identifier TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      is_all_day INTEGER NOT NULL,
      is_cancelled INTEGER NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_window
      ON calendar_events(starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS meeting_calendar_context (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
      occurrence_key TEXT NOT NULL,
      calendar_title TEXT NOT NULL,
      event_json TEXT NOT NULL,
      match_origin TEXT NOT NULL CHECK(match_origin IN ('automatic', 'user')),
      match_evidence TEXT NOT NULL CHECK(match_evidence IN ('time_overlap', 'user_selected')),
      cache_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = sql
    .prepare('PRAGMA table_info(calendar_integration)')
    .all() as Array<{
    name: string;
  }>;
  if (!columns.some((col) => col.name === 'selected_calendars_json')) {
    sql.exec(
      'ALTER TABLE calendar_integration ADD COLUMN selected_calendars_json TEXT;',
    );
  }

  const row = sql
    .prepare(
      'SELECT selected_calendar_json, selected_calendars_json FROM calendar_integration WHERE singleton = 1',
    )
    .get() as
    | {
        selected_calendar_json: string | null;
        selected_calendars_json: string | null;
      }
    | undefined;
  if (row && !row.selected_calendars_json && row.selected_calendar_json) {
    try {
      const parsed = JSON.parse(row.selected_calendar_json);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        parsed.identifier
      ) {
        sql
          .prepare(
            'UPDATE calendar_integration SET selected_calendars_json = ? WHERE singleton = 1',
          )
          .run(JSON.stringify([parsed]));
      }
    } catch {
      // ignore malformed legacy json
    }
  }
};

export const createCalendarStore = (sql: SqlDatabase) => {
  const readIntegration = () =>
    sql
      .prepare('SELECT * FROM calendar_integration WHERE singleton = 1')
      .get() as IntegrationRow;

  const getState = () => {
    const row = readIntegration();
    let selectedCalendars: CalendarDescriptor[] = [];
    if (row.selected_calendars_json) {
      try {
        const parsed = JSON.parse(row.selected_calendars_json);
        if (Array.isArray(parsed)) {
          selectedCalendars = parsed as CalendarDescriptor[];
        }
      } catch {
        selectedCalendars = [];
      }
    } else if (row.selected_calendar_json) {
      try {
        const parsed = JSON.parse(row.selected_calendar_json);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          parsed.identifier
        ) {
          selectedCalendars = [parsed as CalendarDescriptor];
        }
      } catch {
        selectedCalendars = [];
      }
    }

    const selectedCalendar =
      selectedCalendars[0] ??
      (row.selected_calendar_json
        ? (JSON.parse(row.selected_calendar_json) as CalendarDescriptor)
        : null);

    return {
      enabled: row.enabled === 1,
      selectedCalendar,
      selectedCalendars,
      cacheRevision: row.cache_revision,
      lastAttemptAt: row.last_attempt_at,
      lastReadAt: row.last_read_at,
      cacheStart: row.cache_start,
      cacheEnd: row.cache_end,
      errorCode: row.error_code,
    };
  };

  const selectCalendars = (calendars: CalendarDescriptor[]) => {
    sql.transaction(() => {
      sql.prepare('DELETE FROM calendar_events').run();
      sql.prepare('DELETE FROM meeting_calendar_context').run();
      const primaryCalendar = calendars[0] ?? null;
      sql
        .prepare(`
          UPDATE calendar_integration
          SET enabled = 1,
              selected_calendar_json = ?,
              selected_calendars_json = ?,
              cache_revision = 0,
              last_attempt_at = NULL,
              last_read_at = NULL,
              cache_start = NULL,
              cache_end = NULL,
              error_code = NULL
          WHERE singleton = 1
        `)
        .run(
          primaryCalendar ? JSON.stringify(primaryCalendar) : null,
          JSON.stringify(calendars),
        );
    })();
    return getState();
  };

  const selectCalendar = (calendar: CalendarDescriptor) =>
    selectCalendars([calendar]);

  const replaceEvents = (input: {
    calendarIdentifier?: string;
    revision: number;
    cacheStart: string;
    cacheEnd: string;
    readAt: string;
    events: CalendarEvent[];
  }): boolean =>
    sql.transaction(() => {
      const state = getState();
      if (!state.enabled || input.revision <= state.cacheRevision) {
        return false;
      }
      if (
        input.calendarIdentifier &&
        state.selectedCalendars.length > 0 &&
        !state.selectedCalendars.some(
          (c) => c.identifier === input.calendarIdentifier,
        )
      ) {
        return false;
      }
      const allowedCalendarIds = new Set(
        state.selectedCalendars.map((c) => c.identifier),
      );
      sql.prepare('DELETE FROM calendar_events').run();
      const insert = sql.prepare(`
        INSERT INTO calendar_events(
          occurrence_key, calendar_identifier, starts_at, ends_at,
          is_all_day, is_cancelled, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(occurrence_key) DO UPDATE SET
          calendar_identifier = excluded.calendar_identifier,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          is_all_day = excluded.is_all_day,
          is_cancelled = excluded.is_cancelled,
          event_json = excluded.event_json
      `);
      for (const event of input.events) {
        if (
          allowedCalendarIds.size > 0 &&
          !allowedCalendarIds.has(event.calendarIdentifier)
        ) {
          continue;
        }
        insert.run(
          event.occurrenceKey,
          event.calendarIdentifier,
          event.start,
          event.end,
          event.isAllDay ? 1 : 0,
          event.isCancelled ? 1 : 0,
          JSON.stringify(event),
        );
      }
      sql
        .prepare(`
          UPDATE calendar_integration
          SET cache_revision = ?, last_attempt_at = ?, last_read_at = ?,
              cache_start = ?, cache_end = ?, error_code = NULL
          WHERE singleton = 1
        `)
        .run(
          input.revision,
          input.readAt,
          input.readAt,
          input.cacheStart,
          input.cacheEnd,
        );
      return true;
    })();

  const listEvents = (start: string, end: string): CalendarEvent[] =>
    (
      sql
        .prepare(`
          SELECT event_json FROM calendar_events
          WHERE starts_at < ? AND ends_at > ?
          ORDER BY starts_at ASC, occurrence_key ASC
        `)
        .all(end, start) as EventRow[]
    ).map((row) => JSON.parse(row.event_json) as CalendarEvent);

  const getMeetingContext = (
    meetingId: string,
  ): MeetingCalendarContext | null => {
    const row = sql
      .prepare('SELECT * FROM meeting_calendar_context WHERE meeting_id = ?')
      .get(meetingId) as ContextRow | undefined;
    if (!row) return null;
    return {
      sourceKind: 'macos_calendar',
      occurrenceKey: row.occurrence_key,
      calendarTitle: row.calendar_title,
      event: JSON.parse(row.event_json) as CalendarEvent,
      matchOrigin: row.match_origin,
      matchEvidence: row.match_evidence,
    };
  };

  const setMeetingContext = (
    meetingId: string,
    occurrenceKey: string,
    origin: 'automatic' | 'user',
  ): MeetingCalendarContext | null => {
    const existing = getMeetingContext(meetingId);
    if (existing?.matchOrigin === 'user' && origin === 'automatic')
      return existing;
    const eventRow = sql
      .prepare(
        'SELECT event_json FROM calendar_events WHERE occurrence_key = ?',
      )
      .get(occurrenceKey) as EventRow | undefined;
    const state = getState();
    if (
      !eventRow ||
      (!state.selectedCalendar && state.selectedCalendars.length === 0)
    ) {
      return null;
    }
    const event = JSON.parse(eventRow.event_json) as CalendarEvent;
    const matchedCalendar = state.selectedCalendars.find(
      (c) => c.identifier === event.calendarIdentifier,
    );
    const calendarTitle =
      matchedCalendar?.title ?? state.selectedCalendar?.title ?? 'Calendar';

    sql
      .prepare(`
        INSERT INTO meeting_calendar_context(
          meeting_id, occurrence_key, calendar_title, event_json,
          match_origin, match_evidence, cache_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id) DO UPDATE SET
          occurrence_key = excluded.occurrence_key,
          calendar_title = excluded.calendar_title,
          event_json = excluded.event_json,
          match_origin = excluded.match_origin,
          match_evidence = excluded.match_evidence,
          cache_revision = excluded.cache_revision,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        meetingId,
        occurrenceKey,
        calendarTitle,
        eventRow.event_json,
        origin,
        origin === 'user' ? 'user_selected' : 'time_overlap',
        state.cacheRevision,
      );
    return getMeetingContext(meetingId);
  };

  const associateMeeting = (
    meetingId: string,
    start: string,
    end: string,
  ): MeetingCalendarContext | null => {
    const existing = getMeetingContext(meetingId);
    if (existing?.matchOrigin === 'user') return existing;
    const state = getState();
    if (!state.cacheStart || !state.cacheEnd) return existing;
    const match = matchCalendarEvent(
      start,
      end,
      listEvents(state.cacheStart, state.cacheEnd),
    );
    return match.kind === 'matched'
      ? setMeetingContext(meetingId, match.occurrenceKey, 'automatic')
      : existing;
  };

  const recordFailure = (errorCode: CalendarCapabilityState, at: string) => {
    sql
      .prepare(`
        UPDATE calendar_integration
        SET last_attempt_at = ?, error_code = ?
        WHERE singleton = 1
      `)
      .run(at, errorCode);
  };

  const disconnect = () => {
    sql.transaction(() => {
      sql.prepare('DELETE FROM meeting_calendar_context').run();
      sql.prepare('DELETE FROM calendar_events').run();
      sql
        .prepare(`
          UPDATE calendar_integration
          SET enabled = 0,
              selected_calendar_json = NULL,
              selected_calendars_json = NULL,
              cache_revision = 0,
              last_attempt_at = NULL,
              last_read_at = NULL,
              cache_start = NULL,
              cache_end = NULL,
              error_code = NULL
          WHERE singleton = 1
        `)
        .run();
    })();
  };

  return {
    getState,
    selectCalendar,
    selectCalendars,
    replaceEvents,
    listEvents,
    associateMeeting,
    setMeetingContext,
    getMeetingContext,
    recordFailure,
    disconnect,
  };
};

export type CalendarStore = ReturnType<typeof createCalendarStore>;
