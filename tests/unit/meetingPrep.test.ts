import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import {
  createMeetingPrepStore,
  prepStartBlocker,
} from '../../electron/meetingPrep';
import type { PreMeetingBrief } from '../../electron/preMeetingBrief';
const event: CalendarEvent = {
  occurrenceKey: 'calendar|event|start',
  eventIdentifier: 'event',
  calendarIdentifier: 'calendar',
  title: 'Launch planning',
  start: '2026-09-28T10:00:00Z',
  end: '2026-09-28T11:00:00Z',
  isAllDay: false,
  isCancelled: false,
  availability: null,
  organizer: null,
  attendees: [],
  lastModified: null,
};
const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((sql) => sql.close()));
function setup() {
  const sql = new Database(':memory:');
  databases.push(sql);
  sql.exec(fs.readFileSync('drizzle/0014_meeting_prep.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0015_prep_past_meetings.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0016_prep_briefing.sql', 'utf8'));
  let cached: CalendarEvent | null = event;
  let meeting:
    | import('../../electron/meetingPrep').PrepMeetingReference
    | null = {
    id: 'past',
    title: 'Last launch review',
    date: '2026-09-20',
    participants: 'Sam',
    preview: 'Old meeting notes',
    context: 'Old meeting notes',
    capturedAt: '2026-09-27',
  };
  const deps = {
    event: () => cached,
    meeting: () => meeting,
    meetings: () => (meeting ? [meeting] : []),
  };
  return {
    sql,
    store: createMeetingPrepStore(sql, deps),
    reopen: () => createMeetingPrepStore(sql, deps),
    cache: (value: CalendarEvent | null) => {
      cached = value;
    },
    changeMeeting: (value: typeof meeting) => {
      meeting = value;
    },
  };
}
it('preserves drafts on reopening and isolates calendar occurrences', () => {
  const { store, reopen, cache } = setup();
  let prep = store.open(event);
  prep = store.save(prep.occurrenceKey, prep.revision, {
    notes: 'Ask about launch blockers',
  });
  expect(reopen().open(event).notes).toBe(prep.notes);
  cache(null);
  expect(store.open({ ...event, occurrenceKey: 'other' }).notes).toBe('');
  expect(store.get(event.occurrenceKey)?.notes).toBe(prep.notes);
});
it('preserves legacy topic snapshots when saving current prep notes', () => {
  const { sql, store } = setup();
  let prep = store.open(event);
  const topic = {
    id: 'topic',
    name: 'Launch',
    context: 'Old context',
    sources: [
      { meetingId: 'old', title: 'Previous review', date: '2026-09-20' },
    ],
    capturedAt: '2026-09-27',
  };
  sql
    .prepare('UPDATE meeting_prep SET topics_json = ? WHERE occurrence_key = ?')
    .run(JSON.stringify([topic]), prep.occurrenceKey);
  prep = store.save(prep.occurrenceKey, prep.revision, { notes: 'New notes' });
  expect(prep.topics).toEqual([topic]);
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, { addTopicId: 'topic' }),
  ).toThrow('Invalid prep update');
});
it('rejects stale revisions and malformed updates without losing notes', () => {
  const { store } = setup();
  const prep = store.open(event);
  store.save(prep.occurrenceKey, 0, { notes: 'Keep me' });
  expect(() =>
    store.save(prep.occurrenceKey, 0, { notes: 'Overwrite' }),
  ).toThrow('changed elsewhere');
  expect(() =>
    store.save(prep.occurrenceKey, 1, { notes: 'x', addMeetingId: 'past' }),
  ).toThrow('Invalid');
  expect(store.get(prep.occurrenceKey)?.notes).toBe('Keep me');
});
it('enforces exactly five minutes before start through strictly before scheduled end', () => {
  expect(
    prepStartBlocker(event, Date.parse(event.start) - 300001),
  ).not.toBeNull();
  expect(prepStartBlocker(event, Date.parse(event.start) - 300000)).toBeNull();
  expect(prepStartBlocker(event, Date.parse(event.end) - 1)).toBeNull();
  expect(prepStartBlocker(event, Date.parse(event.end))).not.toBeNull();
  expect(
    prepStartBlocker({ ...event, isCancelled: true }, Date.parse(event.start)),
  ).toContain('cancelled');
});
it('claims the selected occurrence, rejects duplicate starts, and allows failed-start retry', () => {
  const { store } = setup();
  store.open(event);
  const now = Date.parse(event.start);
  const claimed = store.claimStart(event.occurrenceKey, 'recording-1', now);
  expect(claimed.meetingId).toBe('recording-1');
  expect(store.forMeeting('recording-1')?.event.title).toBe(event.title);
  expect(() =>
    store.claimStart(event.occurrenceKey, 'recording-2', now),
  ).toThrow('already has');
  store.abortStart('recording-1');
  expect(store.get(event.occurrenceKey)?.notes).toBe('');
  store.claimStart(event.occurrenceKey, 'recording-2', now);
  store.markStarted('recording-2');
  store.abortStart('recording-2');
  expect(store.get(event.occurrenceKey)?.meetingId).toBe('recording-2');
});
it('uses authoritative calendar cancellation/time instead of the renderer snapshot', () => {
  const { store, cache } = setup();
  store.open(event);
  cache({ ...event, isCancelled: true });
  expect(() =>
    store.claimStart(event.occurrenceKey, 'recording', Date.parse(event.start)),
  ).toThrow('cancelled');
  cache(null);
  expect(() =>
    store.claimStart(event.occurrenceKey, 'recording', Date.parse(event.start)),
  ).toThrow('Refresh');
});
it('clears abandoned startup reservations but preserves recoverable recordings and draft content', () => {
  const { store } = setup();
  let prep = store.open(event);
  prep = store.save(prep.occurrenceKey, prep.revision, { notes: 'Draft' });
  store.claimStart(event.occurrenceKey, 'recording', Date.parse(event.start));
  store.recoverUnstarted(() => true);
  expect(store.get(event.occurrenceKey)?.meetingId).toBe('recording');
  store.recoverUnstarted();
  expect(store.get(event.occurrenceKey)?.meetingId).toBeNull();
  expect(store.get(event.occurrenceKey)?.notes).toBe('Draft');
});

it('persists past meeting snapshots independently, refreshes explicitly and removes only the reference', () => {
  const { store, reopen, changeMeeting } = setup();
  let prep = store.open(event);
  prep = store.save(prep.occurrenceKey, prep.revision, {
    notes: 'My questions',
  });
  prep = store.save(prep.occurrenceKey, prep.revision, {
    addMeetingId: 'past',
  });
  expect(
    store.save(prep.occurrenceKey, prep.revision, { addMeetingId: 'past' })
      .meetings,
  ).toHaveLength(1);
  changeMeeting({ ...prep.meetings![0], context: 'Edited meeting notes' });
  expect(reopen().open(event).meetings![0].context).toBe('Old meeting notes');
  prep = store.save(prep.occurrenceKey, prep.revision, {
    refreshMeetingId: 'past',
  });
  expect(prep.meetings![0].context).toBe('Edited meeting notes');
  changeMeeting(null);
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, { refreshMeetingId: 'past' }),
  ).toThrow('no longer available');
  expect(reopen().get(prep.occurrenceKey)?.meetings).toHaveLength(1);
  prep = store.save(prep.occurrenceKey, prep.revision, {
    removeMeetingId: 'past',
  });
  expect(prep.meetings).toEqual([]);
  expect(prep.notes).toBe('My questions');
});
it('rejects missing, future and self references and invalid meeting searches', () => {
  const { store, changeMeeting } = setup();
  let prep = store.open(event);
  expect(store.listMeetings('', event.occurrenceKey)).toHaveLength(1);
  expect(() => store.listMeetings({})).toThrow('Invalid meeting search');
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, { refreshMeetingId: 'past' }),
  ).toThrow('not linked');
  changeMeeting({
    id: 'future',
    title: 'Future',
    date: '2099-01-01',
    participants: '',
    preview: '',
    context: '',
    capturedAt: '2026-09-27',
  });
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, { addMeetingId: 'future' }),
  ).toThrow('no longer available');
  prep = store.claimStart(event.occurrenceKey, 'past', Date.parse(event.start));
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, { addMeetingId: 'past' }),
  ).toThrow('different past meeting');
});
it('adds meeting references without changing existing preparation or topic snapshots during migration', () => {
  const sql = new Database(':memory:');
  databases.push(sql);
  sql.exec(fs.readFileSync('drizzle/0014_meeting_prep.sql', 'utf8'));
  sql
    .prepare(
      'INSERT INTO meeting_prep(occurrence_key,event_json,notes,topics_json) VALUES (?,?,?,?)',
    )
    .run(
      'legacy',
      JSON.stringify(event),
      'Saved questions',
      '[{"id":"topic","context":"Saved context"}]',
    );
  sql.exec(fs.readFileSync('drizzle/0015_prep_past_meetings.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0016_prep_briefing.sql', 'utf8'));
  const row = sql.prepare('SELECT * FROM meeting_prep').get() as any;
  expect(row.notes).toBe('Saved questions');
  expect(JSON.parse(row.topics_json)[0].context).toBe('Saved context');
  expect(JSON.parse(row.meetings_json)).toEqual([]);
});

it('saves multiple meetings atomically, preserves snapshots and rejects a partly invalid selection', () => {
  const { store, changeMeeting } = setup();
  let prep = store.open(event);
  prep = store.save(prep.occurrenceKey, prep.revision, {
    meetingIds: ['past', 'past'],
  });
  expect(prep.meetings).toHaveLength(1);
  changeMeeting(null);
  expect(() =>
    store.save(prep.occurrenceKey, prep.revision, {
      meetingIds: ['past', 'missing'],
    }),
  ).toThrow('no longer available');
  expect(store.get(prep.occurrenceKey)?.revision).toBe(prep.revision);
  expect(store.get(prep.occurrenceKey)?.meetings).toHaveLength(1);
  expect(
    store.save(prep.occurrenceKey, prep.revision, { meetingIds: ['past'] })
      .meetings![0].context,
  ).toBe('Old meeting notes');
});
it('persists briefings without changing personal notes, rejects stale generation and clears after references change', () => {
  const { store, reopen } = setup();
  let prep = store.open(event);
  prep = store.save(prep.occurrenceKey, prep.revision, {
    meetingIds: ['past'],
  });
  const fingerprint = JSON.stringify(prep.meetings);
  const brief = {
    title: 'Generated prep',
    synthesisStatus: 'ready',
  } as PreMeetingBrief;
  expect(store.saveBrief(prep.occurrenceKey, fingerprint, brief)).toBe(true);
  expect(
    store.saveBrief(prep.occurrenceKey, fingerprint, {
      ...brief,
      title: 'Fallback excerpts',
      synthesisStatus: 'fallback',
    }),
  ).toBe(false);
  expect(reopen().get(prep.occurrenceKey)?.briefing?.title).toBe(
    'Generated prep',
  );
  prep = store.save(prep.occurrenceKey, prep.revision, {
    notes: 'My own question',
  });
  expect(prep.briefing?.title).toBe('Generated prep');
  prep = store.save(prep.occurrenceKey, prep.revision, { meetingIds: [] });
  expect(prep.briefing).toBeNull();
  expect(store.saveBrief(prep.occurrenceKey, fingerprint, brief)).toBe(false);
  expect(store.get(prep.occurrenceKey)?.notes).toBe('My own question');
});
