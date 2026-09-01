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

export const createCalendarStore = (sql: SqlDatabase) => {
  const readIntegration = () =>
    sql
      .prepare('SELECT * FROM calendar_integration WHERE singleton = 1')
      .get() as IntegrationRow;

  const getState = () => {
    const row = readIntegration();
    return {
      enabled: row.enabled === 1,
      selectedCalendar: row.selected_calendar_json
        ? (JSON.parse(row.selected_calendar_json) as CalendarDescriptor)
        : null,
      cacheRevision: row.cache_revision,
      lastAttemptAt: row.last_attempt_at,
      lastReadAt: row.last_read_at,
      cacheStart: row.cache_start,
      cacheEnd: row.cache_end,
      errorCode: row.error_code,
    };
  };

  const selectCalendar = (calendar: CalendarDescriptor) => {
    sql.transaction(() => {
      sql.prepare('DELETE FROM calendar_events').run();
      sql.prepare('DELETE FROM meeting_calendar_context').run();
      sql
        .prepare(`
          UPDATE calendar_integration
          SET enabled = 1,
              selected_calendar_json = ?,
              cache_revision = 0,
              last_attempt_at = NULL,
              last_read_at = NULL,
              cache_start = NULL,
              cache_end = NULL,
              error_code = NULL
          WHERE singleton = 1
        `)
        .run(JSON.stringify(calendar));
    })();
    return getState();
  };

  const replaceEvents = (input: {
    calendarIdentifier: string;
    revision: number;
    cacheStart: string;
    cacheEnd: string;
    readAt: string;
    events: CalendarEvent[];
  }): boolean =>
    sql.transaction(() => {
      const state = getState();
      if (
        !state.enabled ||
        state.selectedCalendar?.identifier !== input.calendarIdentifier ||
        input.revision <= state.cacheRevision
      ) {
        return false;
      }
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
        if (event.calendarIdentifier !== input.calendarIdentifier) continue;
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
    if (!eventRow || !state.selectedCalendar) return null;
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
        state.selectedCalendar.title,
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
          SET enabled = 0, selected_calendar_json = NULL,
              cache_revision = 0, last_attempt_at = NULL,
              last_read_at = NULL, cache_start = NULL, cache_end = NULL,
              error_code = NULL
          WHERE singleton = 1
        `)
        .run();
    })();
  };

  return {
    getState,
    selectCalendar,
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
