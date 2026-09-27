import Database from 'better-sqlite3';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPrepAttendeeStore,
  type PrepPerson,
  prepRoster,
} from '../../electron/prepAttendees';
import type { CalendarEvent } from '../../electron/calendar/types';

const event = (
  name: string | null = 'Sam',
  email: string | null = 'sam@example.com',
): CalendarEvent => ({
  occurrenceKey: 'event',
  eventIdentifier: 'event',
  calendarIdentifier: 'work',
  title: 'Check in',
  start: '2026-09-28T10:00:00Z',
  end: '2026-09-28T11:00:00Z',
  isAllDay: false,
  isCancelled: false,
  availability: null,
  organizer: null,
  attendees: [{ name, email }],
  lastModified: null,
});
const open: Database.Database[] = [];
afterEach(() => open.splice(0).forEach((db) => db.close()));
function setup(
  initial: PrepPerson[] = [{ id: 'sam', name: 'Sam', aliases: ['Samuel'] }],
  selfId: string | null = null,
) {
  const sql = new Database(':memory:');
  open.push(sql);
  sql.pragma('foreign_keys = ON');
  sql.exec('CREATE TABLE entities(id TEXT PRIMARY KEY, name TEXT);');
  sql.exec(fs.readFileSync('drizzle/0013_prep_attendee_links.sql', 'utf8'));
  let people = initial;
  for (const person of people)
    sql
      .prepare('INSERT INTO entities VALUES (?, ?)')
      .run(person.id, person.name);
  const merged = new Map<string, string>();
  const store = createPrepAttendeeStore(sql, {
    people: () => people.filter((p) => !merged.has(p.id)),
    canonical: (id) => merged.get(id) || id,
    selfId: () => selfId,
    createPerson: (name) => {
      const id = `new-${people.length}`;
      people.push({ id, name, aliases: [] });
      sql.prepare('INSERT INTO entities VALUES (?, ?)').run(id, name);
      return id;
    },
  });
  return {
    store,
    sql,
    merged,
    setPeople: (next: PrepPerson[]) => {
      people = next;
    },
  };
}
describe('prep attendee associations', () => {
  it('automatically resolves unique aliases, then prefers saved emails over changed names', () => {
    const { store } = setup();
    expect(store.resolve(event('Samuel'))[0]).toMatchObject({
      personId: 'sam',
      basis: 'name',
    });
    expect(store.resolve(event('Different name'))[0]).toMatchObject({
      personId: 'sam',
      basis: 'email',
    });
  });
  it('asks for ambiguous names and does not auto-attach a second email', () => {
    const { store } = setup();
    store.resolve(event());
    expect(store.resolve(event('Sam', 'other@example.com'))[0].status).toBe(
      'unresolved',
    );
    const other = setup([
      { id: 'one', name: 'Sam', aliases: [] },
      { id: 'two', name: 'Sam', aliases: [] },
    ]);
    expect(other.store.resolve(event())[0]).toMatchObject({
      status: 'unresolved',
      personId: null,
    });
  });
  it('remembers corrections, allows multiple emails, and suppresses rejected matches', () => {
    const { store, setPeople, sql } = setup();
    store.resolve(event());
    const selection = event();
    store.change(selection, 'email:sam@example.com', { newName: 'Sam' });
    expect(store.resolve(selection)[0]).toMatchObject({
      personId: 'new-1',
      basis: 'user',
    });
    store.change(
      event('Sam', 'second@example.com'),
      'email:second@example.com',
      { personId: 'new-1' },
    );
    expect(store.resolve(event('Sam', 'second@example.com'))[0].personId).toBe(
      'new-1',
    );
    sql.prepare('DELETE FROM entities WHERE id = ?').run('new-1');
    setPeople([{ id: 'sam', name: 'Sam', aliases: [] }]);
    expect(store.resolve(selection)[0]).toMatchObject({
      status: 'unlinked',
      personId: null,
      suggestions: [],
    });
  });
  it('keeps original person IDs across reversible merges', () => {
    const { store, merged } = setup([
      { id: 'one', name: 'Sam', aliases: [] },
      { id: 'two', name: 'Sam', aliases: [] },
    ]);
    store.change(event(), 'email:sam@example.com', { personId: 'one' });
    merged.set('one', 'two');
    expect(store.resolve(event())[0].personId).toBe('two');
    merged.delete('one');
    expect(store.resolve(event())[0].personId).toBe('one');
  });
  it('supports missing email, rejects invalid selections, and persists leave-unlinked', () => {
    const { store } = setup();
    const attendee = store.resolve(event('Sam', null))[0];
    expect(attendee.personId).toBe('sam');
    store.change(event('Sam', null), attendee.key, { personId: null });
    expect(store.resolve(event('Sam', null))[0].status).toBe('unlinked');
    expect(() =>
      store.change(event(), 'foreign', { personId: 'sam' }),
    ).toThrow();
    expect(() =>
      store.change(event(), 'email:sam@example.com', { personId: 'missing' }),
    ).toThrow();
    expect(store.resolve(event(null, null))[0].status).toBe('unresolved');
  });
});

it('recognizes the calendar account holder with only an email and remembers self association', () => {
  const { store } = setup(undefined, 'sam');
  const mine = event(null);
  mine.attendees[0].isCurrentUser = true;
  expect(store.resolve(mine)).toEqual([]);
  expect(store.emails('sam')).toEqual(['sam@example.com']);
  expect(store.resolve(event(null))).toEqual([]);
  store.change(mine, 'email:sam@example.com', { newName: 'Other person' });
  expect(store.resolve(mine)[0].personName).toBe('Other person');
});
it('excludes provider-confirmed self without a saved self person and preserves duplicate organizer hints', () => {
  const { store } = setup();
  const mine = event(null);
  mine.organizer = {
    name: 'Sam',
    email: 'sam@example.com',
    isCurrentUser: true,
  };
  expect(prepRoster(mine)[0]).toMatchObject({
    name: 'Sam',
    isCurrentUser: true,
  });
  expect(store.resolve(mine)).toEqual([]);
  expect(store.resolve(event(null))[0].status).toBe('unresolved');
});
