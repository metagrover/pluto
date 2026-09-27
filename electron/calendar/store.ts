import type Database from 'better-sqlite3';

import {
  type CalendarMatch,
  matchActiveCalendarEvent,
  matchCalendarEvent,
} from './matcher';
import type {
  CalendarCapabilityState,
  CalendarDescriptor,
  CalendarEvent,
  MeetingCalendarContext,
  PriorMeetingCalendarContext,
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

interface PriorContextRow extends ContextRow {
  meeting_id: string;
  meeting_title: string;
  meeting_started_at: string;
}
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
      if (calendars.length === 0) {
        sql.prepare('DELETE FROM meeting_calendar_context').run();
      } else {
        const placeholders = calendars.map(() => '?').join(', ');
        sql
          .prepare(`
            DELETE FROM meeting_calendar_context
            WHERE COALESCE(json_extract(event_json, '$.calendarIdentifier'), '')
              NOT IN (${placeholders})
          `)
          .run(...calendars.map((calendar) => calendar.identifier));
      }
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

  const listPriorMeetingContexts = (
    before: string,
    requestedLimit = 80,
    matching?: { event: CalendarEvent; emails: string[] },
  ): PriorMeetingCalendarContext[] => {
    const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit)));
    const rows = sql
      .prepare(`
        SELECT context.*, meeting.title AS meeting_title,
               COALESCE(meeting.started_at, meeting.created_at, '') AS meeting_started_at
        FROM meeting_calendar_context AS context
        JOIN meetings AS meeting ON meeting.id = context.meeting_id
        WHERE COALESCE(meeting.started_at, meeting.created_at, '') < ?
          AND (? = 0 OR (
            json_extract(context.event_json, '$.seriesKey') = ? AND
            json_extract(context.event_json, '$.calendarIdentifier') = ?
          ) OR EXISTS (
            SELECT 1 FROM json_each(context.event_json, '$.attendees') attendee
            WHERE LOWER(TRIM(json_extract(attendee.value, '$.email'))) IN (SELECT value FROM json_each(?))
          ) OR LOWER(TRIM(json_extract(context.event_json, '$.organizer.email'))) IN (SELECT value FROM json_each(?)))
        ORDER BY COALESCE(meeting.started_at, meeting.created_at) DESC
        LIMIT ?
      `)
      .all(
        before,
        matching ? 1 : 0,
        matching?.event.seriesKey ?? null,
        matching?.event.calendarIdentifier ?? null,
        JSON.stringify(matching?.emails ?? []),
        JSON.stringify(matching?.emails ?? []),
        limit,
      ) as PriorContextRow[];
    return rows.map((row) => ({
      sourceKind: 'macos_calendar',
      occurrenceKey: row.occurrence_key,
      calendarTitle: row.calendar_title,
      event: JSON.parse(row.event_json) as CalendarEvent,
      matchOrigin: row.match_origin,
      matchEvidence: row.match_evidence,
      meetingId: row.meeting_id,
      meetingTitle: row.meeting_title,
      meetingStartedAt: row.meeting_started_at,
    }));
  };

  const setMeetingContext = (
    meetingId: string,
    occurrenceKey: string,
    origin: 'automatic' | 'user',
    snapshot?: CalendarEvent,
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
    const storedEvent =
      eventRow || (snapshot ? { event_json: JSON.stringify(snapshot) } : null);
    if (
      !storedEvent ||
      (!snapshot &&
        !state.selectedCalendar &&
        state.selectedCalendars.length === 0)
    ) {
      return null;
    }
    const event = JSON.parse(storedEvent.event_json) as CalendarEvent;
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
        storedEvent.event_json,
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

  const matchActiveEvent = (
    atTime: string,
  ): { match: CalendarMatch; event: CalendarEvent | null } => {
    const state = getState();
    if (!state.enabled || !state.cacheStart || !state.cacheEnd) {
      return { match: { kind: 'none' }, event: null };
    }
    const events = listEvents(state.cacheStart, state.cacheEnd);
    const match = matchActiveCalendarEvent(atTime, events);
    if (match.kind === 'matched') {
      const found =
        events.find((e) => e.occurrenceKey === match.occurrenceKey) ?? null;
      return { match, event: found };
    }
    return { match, event: null };
  };

  const associateMeetingAtStart = (
    meetingId: string,
    atTime: string,
  ): {
    context: MeetingCalendarContext | null;
    event: CalendarEvent | null;
  } => {
    const { match, event } = matchActiveEvent(atTime);
    if (match.kind === 'matched' && event) {
      const context = setMeetingContext(
        meetingId,
        match.occurrenceKey,
        'automatic',
      );
      return { context, event };
    }
    return { context: null, event: null };
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
    associateMeetingAtStart,
    matchActiveEvent,
    setMeetingContext,
    getMeetingContext,
    listPriorMeetingContexts,
    recordFailure,
    disconnect,
  };
};

export type CalendarStore = ReturnType<typeof createCalendarStore>;
