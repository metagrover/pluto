import type Database from 'better-sqlite3';
import { normalizeEvent } from './calendar/protocol';
import type { CalendarEvent } from './calendar/types';

export interface PrepTopic {
  id: string;
  name: string;
  context: string;
  sources: Array<{ meetingId: string; title: string; date: string | null }>;
  capturedAt: string;
}
export interface PrepMeetingOption {
  id: string;
  title: string;
  date: string | null;
  participants: string;
  preview: string;
}
export interface PrepMeetingReference extends PrepMeetingOption {
  context: string;
  trustStatus?: 'grounded' | 'needs_review';
  capturedAt: string;
}
export interface MeetingPrep {
  occurrenceKey: string;
  event: CalendarEvent;
  notes: string;
  topics: PrepTopic[];
  meetings?: PrepMeetingReference[];
  briefing?: import('./preMeetingBrief').PreMeetingBrief | null;
  meetingId: string | null;
  recordingStarted: boolean;
  revision: number;
  updatedAt: string;
}
// Display-only lookup: an exact calendar email does not establish attendance or speaker identity.
export function findCalendarInviteeName(
  email: string,
  events: CalendarEvent[],
): string | null {
  const key = email.trim().toLowerCase();
  if (!key) return null;
  const names = new Map<string, string>();
  for (const event of events) {
    for (const person of [
      ...event.attendees,
      ...(event.organizer ? [event.organizer] : []),
    ]) {
      const name = person.name?.trim();
      if (
        person.email?.trim().toLowerCase() !== key ||
        !name ||
        name.includes('@')
      )
        continue;
      names.set(name.toLowerCase().replace(/\s+/g, ' '), name);
    }
  }
  return names.size === 1 ? [...names.values()][0] : null;
}
export function resolvePrepInviteeNames(
  event: CalendarEvent,
  knownName: (email: string) => string | null,
): CalendarEvent {
  const resolve = (person: import('./calendar/types').CalendarPerson) => {
    const name = person.email
      ? knownName(person.email.trim().toLowerCase())?.trim()
      : null;
    return name ? { ...person, name } : person;
  };
  return {
    ...event,
    attendees: event.attendees.map(resolve),
    organizer: event.organizer ? resolve(event.organizer) : null,
  };
}
export function prepStartBlocker(
  event: CalendarEvent,
  now = Date.now(),
): string | null {
  if (event.isCancelled) return 'This calendar event was cancelled.';
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return 'This event has no valid recording window.';
  if (now < start - 5 * 60_000)
    return 'You can start five minutes before the scheduled meeting.';
  if (now >= end) return 'This calendar event has ended.';
  return null;
}
export function createMeetingPrepStore(
  sql: Database.Database,
  deps: {
    event: (key: string) => CalendarEvent | null;
    personName?: (email: string) => string | null;
    meeting?: (id: string) => PrepMeetingReference | null;
    meetings?: (query: string) => PrepMeetingOption[];
  },
) {
  const key = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000)
      throw new Error('Invalid calendar occurrence');
    return value;
  };
  const get = (value: unknown): MeetingPrep | null => {
    const row = sql
      .prepare('SELECT * FROM meeting_prep WHERE occurrence_key = ?')
      .get(key(value)) as any;
    return row
      ? {
          occurrenceKey: row.occurrence_key,
          event: resolvePrepInviteeNames(
            JSON.parse(row.event_json),
            deps.personName || (() => null),
          ),
          notes: row.notes,
          topics: JSON.parse(row.topics_json),
          meetings: JSON.parse(row.meetings_json),
          briefing: row.briefing_json ? JSON.parse(row.briefing_json) : null,
          meetingId: row.meeting_id,
          recordingStarted: !!row.recording_started,
          revision: row.revision,
          updatedAt: row.updated_at,
        }
      : null;
  };
  const open = (value: unknown): MeetingPrep => {
    const event = normalizeEvent(value);
    if (!event) throw new Error('Invalid calendar event');
    const current = deps.event(event.occurrenceKey) || event;
    sql
      .prepare(
        'INSERT INTO meeting_prep(occurrence_key, event_json) VALUES (?, ?) ON CONFLICT(occurrence_key) DO UPDATE SET event_json = excluded.event_json',
      )
      .run(current.occurrenceKey, JSON.stringify(current));
    return get(current.occurrenceKey)!;
  };
  const save = (
    value: unknown,
    revision: unknown,
    patch: unknown,
  ): MeetingPrep =>
    sql.transaction(() => {
      const current = get(value);
      if (!current || revision !== current.revision)
        throw new Error('Prep changed elsewhere. Reload before saving.');
      if (!patch || typeof patch !== 'object' || Array.isArray(patch))
        throw new Error('Invalid prep update');
      const input = patch as Record<string, unknown>;
      if (
        Object.keys(input).some(
          (k) =>
            ![
              'notes',
              'addMeetingId',
              'removeMeetingId',
              'refreshMeetingId',
              'meetingIds',
            ].includes(k),
        ) ||
        Object.keys(input).length !== 1
      )
        throw new Error('Invalid prep update');
      let notes = current.notes;
      let meetings = current.meetings || [];
      if ('notes' in input) {
        if (typeof input.notes !== 'string' || input.notes.length > 100_000)
          throw new Error('Preparation is too long');
        notes = input.notes;
      } else if ('meetingIds' in input) {
        if (!Array.isArray(input.meetingIds) || input.meetingIds.length > 20)
          throw new Error('Include up to 20 meetings');
        const ids = [...new Set(input.meetingIds.map(key))];
        meetings = ids.map((id) => {
          if (id === current.meetingId)
            throw new Error('Choose a different past meeting');
          const saved = meetings.find((m) => m.id === id);
          if (saved) return saved;
          const meeting = deps.meeting?.(id);
          if (
            !meeting ||
            (meeting.date && Date.parse(meeting.date) > Date.now())
          )
            throw new Error('This past meeting is no longer available');
          return meeting;
        });
      } else if (
        'addMeetingId' in input ||
        'removeMeetingId' in input ||
        'refreshMeetingId' in input
      ) {
        const id = key(
          input.addMeetingId ?? input.removeMeetingId ?? input.refreshMeetingId,
        );
        if ('removeMeetingId' in input)
          meetings = meetings.filter((m) => m.id !== id);
        else {
          if (id === current.meetingId)
            throw new Error('Choose a different past meeting');
          if ('refreshMeetingId' in input && !meetings.some((m) => m.id === id))
            throw new Error('Meeting is not linked');
          if ('addMeetingId' in input && meetings.some((m) => m.id === id))
            return current;
          if ('addMeetingId' in input && meetings.length >= 20)
            throw new Error('Include up to 20 meetings');
          const meeting = deps.meeting?.(id);
          if (
            !meeting ||
            (meeting.date && Date.parse(meeting.date) > Date.now())
          )
            throw new Error('This past meeting is no longer available');
          meetings =
            'refreshMeetingId' in input
              ? meetings.map((m) => (m.id === id ? meeting : m))
              : [...meetings, meeting];
        }
      }
      sql
        .prepare(
          'UPDATE meeting_prep SET notes = ?, topics_json = ?, meetings_json = ?, briefing_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE occurrence_key = ?',
        )
        .run(
          notes,
          JSON.stringify(current.topics),
          JSON.stringify(meetings),
          JSON.stringify(meetings) === JSON.stringify(current.meetings || [])
            ? current.briefing
              ? JSON.stringify(current.briefing)
              : null
            : null,
          current.occurrenceKey,
        );
      return get(current.occurrenceKey)!;
    })();
  const forMeeting = (meetingId: string) => {
    const row = sql
      .prepare('SELECT occurrence_key FROM meeting_prep WHERE meeting_id = ?')
      .get(meetingId) as { occurrence_key: string } | undefined;
    return row ? get(row.occurrence_key) : null;
  };
  const claimStart = (value: unknown, meetingId: string, now = Date.now()) =>
    sql.transaction(() => {
      const prep = get(value);
      if (!prep) throw new Error('Open meeting prep before starting');
      const event = deps.event(prep.occurrenceKey);
      if (!event)
        throw new Error('Refresh the calendar before starting this meeting');
      const blocker = prepStartBlocker(event, now);
      if (blocker) throw new Error(blocker);
      if (prep.meetingId)
        throw new Error('This calendar event already has a recording');
      if (
        typeof meetingId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(meetingId)
      )
        throw new Error('Invalid meeting ID');
      sql
        .prepare(
          'UPDATE meeting_prep SET meeting_id = ?, event_json = ?, revision = revision + 1 WHERE occurrence_key = ?',
        )
        .run(meetingId, JSON.stringify(event), prep.occurrenceKey);
      return get(prep.occurrenceKey)!;
    })();
  const markStarted = (meetingId: string) =>
    sql
      .prepare(
        'UPDATE meeting_prep SET recording_started = 1 WHERE meeting_id = ?',
      )
      .run(meetingId);
  const abortStart = (meetingId: string) =>
    sql
      .prepare(
        'UPDATE meeting_prep SET meeting_id = NULL, revision = revision + 1 WHERE meeting_id = ? AND recording_started = 0',
      )
      .run(meetingId);
  const recoverUnstarted = (
    hasCapture: (id: string) => boolean = () => false,
  ) => {
    const rows = sql
      .prepare(
        'SELECT meeting_id FROM meeting_prep WHERE recording_started = 0 AND meeting_id IS NOT NULL',
      )
      .all() as Array<{ meeting_id: string }>;
    for (const row of rows)
      if (!hasCapture(row.meeting_id)) abortStart(row.meeting_id);
  };
  return {
    get,
    open,
    save,
    forMeeting,
    claimStart,
    markStarted,
    abortStart,
    recoverUnstarted,
    saveBrief: (
      value: unknown,
      references: string,
      brief: import('./preMeetingBrief').PreMeetingBrief,
    ) => {
      const current = get(value);
      if (!current || JSON.stringify(current.meetings || []) !== references)
        return false;
      sql
        .prepare(
          'UPDATE meeting_prep SET briefing_json = ? WHERE occurrence_key = ?',
        )
        .run(JSON.stringify(brief), current.occurrenceKey);
      return true;
    },
    listMeetings: (query: unknown = '', occurrenceKey?: unknown) => {
      if (typeof query !== 'string' || query.length > 200)
        throw new Error('Invalid meeting search');
      const current = occurrenceKey === undefined ? null : get(occurrenceKey);
      return (deps.meetings?.(query) || []).filter(
        (m) => m.id !== current?.meetingId,
      );
    },
  };
}
