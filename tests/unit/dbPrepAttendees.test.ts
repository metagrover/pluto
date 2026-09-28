import fs from 'node:fs';
import { afterAll, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-prep-attendees-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));
const event: CalendarEvent = {
  occurrenceKey: 'prep',
  eventIdentifier: 'prep',
  calendarIdentifier: 'work',
  title: 'Review',
  start: '2026-09-28T10:00:00Z',
  end: '2026-09-28T11:00:00Z',
  isAllDay: false,
  isCancelled: false,
  availability: null,
  organizer: null,
  attendees: [{ name: 'Sam', email: 'sam@example.com' }],
  lastModified: null,
};
it('preserves email ownership through actual person merge/restore, deletion, and reset', () => {
  const first = db.upsertEntity({
    type: 'person',
    name: 'Sam',
    dedupe_by_name: false,
  });
  const second = db.upsertEntity({
    type: 'person',
    name: 'Samuel',
    dedupe_by_name: false,
  });
  db.prepAttendeeStore.change(event, 'email:sam@example.com', {
    personId: first.id,
  });
  db.mergePerson(first.id, second.id);
  expect(db.prepAttendeeStore.resolve(event)[0].personId).toBe(second.id);
  db.restorePersonMerge(first.id);
  expect(db.prepAttendeeStore.resolve(event)[0].personId).toBe(first.id);
  db.deleteEntity(first.id);
  expect(db.prepAttendeeStore.resolve(event)[0]).toMatchObject({
    personId: null,
    status: 'unlinked',
  });
  db.resetKnowledge();
  expect(db.prepAttendeeStore.resolve(event)[0].status).toBe('unresolved');
});
