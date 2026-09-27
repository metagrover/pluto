import fs from 'node:fs';
import { afterAll, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-prep-meetings-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
const event: CalendarEvent = {
  occurrenceKey: 'prep-meetings',
  eventIdentifier: 'event',
  calendarIdentifier: 'work',
  title: 'Review',
  start: '2026-09-28T10:00:00Z',
  end: '2026-09-28T11:00:00Z',
  isAllDay: false,
  isCancelled: false,
  availability: null,
  organizer: null,
  attendees: [],
  lastModified: null,
};
it('searches actual saved meeting titles and notes and snapshots refreshed notes', () => {
  db.saveMeeting({
    id: 'old',
    title: 'Launch review',
    started_at: '2026-09-20T10:00:00Z',
    user_notes: 'Review the budget and customer pricing',
  });
  db.saveMeeting({
    id: 'future',
    title: 'Future review',
    started_at: '2099-01-01T10:00:00Z',
    user_notes: 'Future budget',
  });
  expect(db.meetingPrepStore.listMeetings('Launch').map((m) => m.id)).toEqual([
    'old',
  ]);
  expect(db.meetingPrepStore.listMeetings('budget').map((m) => m.id)).toEqual([
    'old',
  ]);
  let prep = db.meetingPrepStore.open(event);
  prep = db.meetingPrepStore.save(prep.occurrenceKey, prep.revision, {
    addMeetingId: 'old',
  });
  expect(prep.meetings![0].context).toContain('budget');
  db.saveMeeting({
    id: 'old',
    title: 'Launch review',
    started_at: '2026-09-20T10:00:00Z',
    user_notes: 'Updated launch decision',
  });
  expect(
    db.meetingPrepStore.get(event.occurrenceKey)?.meetings![0].context,
  ).toContain('budget');
  prep = db.meetingPrepStore.save(prep.occurrenceKey, prep.revision, {
    refreshMeetingId: 'old',
  });
  expect(prep.meetings![0].context).toContain('Updated launch decision');
  db.deleteMeeting('old');
  expect(db.meetingPrepStore.get(event.occurrenceKey)?.meetings).toHaveLength(
    1,
  );
  expect(() =>
    db.meetingPrepStore.save(prep.occurrenceKey, prep.revision, {
      refreshMeetingId: 'old',
    }),
  ).toThrow('no longer available');
  prep = db.meetingPrepStore.save(prep.occurrenceKey, prep.revision, {
    removeMeetingId: 'old',
  });
  expect(prep.meetings).toEqual([]);
});
