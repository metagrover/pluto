import type Database from 'better-sqlite3';
import type { CalendarEvent, CalendarPerson } from './calendar/types';

export interface PrepPerson {
  id: string;
  name: string;
  aliases: string[];
}
export interface PrepAttendee {
  key: string;
  name: string | null;
  email: string | null;
  personId: string | null;
  personName: string | null;
  status: 'identified' | 'unresolved' | 'unlinked';
  basis: 'email' | 'name' | 'user' | 'none';
  suggestions: Array<{ id: string; name: string }>;
}
export const normalizePrepName = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const normalizePrepEmail = (value: string | null) =>
  value?.trim().toLowerCase() || null;

export function prepRoster(
  event: CalendarEvent,
): Array<CalendarPerson & { key: string }> {
  const roster = new Map<string, CalendarPerson & { key: string }>();
  [...event.attendees, ...(event.organizer ? [event.organizer] : [])].forEach(
    (p, index) => {
      const email = normalizePrepEmail(p.email);
      const key = email
        ? `email:${email}`
        : `event:${event.occurrenceKey}:${normalizePrepName(p.name || '') || index}`;
      const previous = roster.get(key);
      roster.set(key, {
        ...p,
        name:
          previous?.name && previous.name !== email
            ? previous.name
            : p.name || previous?.name || null,
        email,
        key,
        ...(previous?.isCurrentUser || p.isCurrentUser
          ? { isCurrentUser: true }
          : {}),
      });
    },
  );
  return [...roster.values()];
}

export function createPrepAttendeeStore(
  sql: Database.Database,
  deps: {
    people: () => PrepPerson[];
    canonical: (id: string) => string;
    createPerson: (name: string) => string;
    selfId: () => string | null;
  },
) {
  const read = (key: string) =>
    sql
      .prepare(
        'SELECT person_id, source FROM prep_attendee_links WHERE attendee_key = ?',
      )
      .get(key) as
      | { person_id: string | null; source: 'automatic' | 'user' }
      | undefined;
  const save = (
    key: string,
    personId: string | null,
    source: 'automatic' | 'user',
  ) =>
    sql
      .prepare(`INSERT INTO prep_attendee_links(attendee_key, person_id, source) VALUES (?, ?, ?)
    ON CONFLICT(attendee_key) DO UPDATE SET person_id = excluded.person_id, source = excluded.source, updated_at = CURRENT_TIMESTAMP`)
      .run(key, personId, source);
  const resolve = (event: CalendarEvent): PrepAttendee[] =>
    sql.transaction(() => {
      const people = deps.people();
      const self = deps.selfId();
      return prepRoster(event).flatMap((p) => {
        const link = read(p.key);
        // Calendar identifies its account holder directly, even without a display name.
        // Explicit user corrections still take precedence over this provider hint.
        if (p.isCurrentUser && link?.source !== 'user') {
          if (
            self &&
            people.some((person) => person.id === deps.canonical(self))
          )
            save(p.key, self, 'automatic');
          return [];
        }
        const linked = link?.person_id
          ? people.find(
              (person) => person.id === deps.canonical(link.person_id!),
            )
          : undefined;
        const rejected = (
          sql
            .prepare(
              'SELECT person_id FROM prep_attendee_rejections WHERE attendee_key = ?',
            )
            .all(p.key) as Array<{ person_id: string }>
        ).map((r) => deps.canonical(r.person_id));
        const suggestions = people.filter(
          (person) =>
            !rejected.includes(person.id) &&
            [person.name, ...person.aliases].some(
              (name) =>
                normalizePrepName(name) === normalizePrepName(p.name || ''),
            ),
        );
        let match = linked;
        let basis: PrepAttendee['basis'] = linked
          ? link?.source === 'user'
            ? 'user'
            : 'email'
          : 'none';
        if (!link && suggestions.length === 1) {
          const candidate = suggestions[0];
          const emailLinks = sql
            .prepare(
              "SELECT attendee_key, person_id FROM prep_attendee_links WHERE person_id IS NOT NULL AND attendee_key LIKE 'email:%'",
            )
            .all() as Array<{ attendee_key: string; person_id: string }>;
          const conflict =
            !!p.email &&
            emailLinks.some(
              (row) =>
                deps.canonical(row.person_id) === candidate.id &&
                row.attendee_key !== p.key,
            );
          if (!conflict) {
            match = candidate;
            basis = 'name';
            save(p.key, candidate.id, 'automatic');
          }
        }
        if (match && self && match.id === deps.canonical(self)) return [];
        return [
          {
            ...p,
            personId: match?.id ?? null,
            personName: match?.name ?? null,
            status: match
              ? ('identified' as const)
              : link?.source === 'user' && !link.person_id
                ? ('unlinked' as const)
                : ('unresolved' as const),
            basis,
            suggestions: suggestions.map(({ id, name }) => ({ id, name })),
          },
        ];
      });
    })();
  const change = (
    event: CalendarEvent,
    key: string,
    selection: { personId?: string | null; newName?: string },
  ) =>
    sql.transaction(() => {
      if (!prepRoster(event).some((p) => p.key === key))
        throw new Error('Unknown prep attendee');
      if (
        Object.hasOwn(selection, 'personId') ===
        Object.hasOwn(selection, 'newName')
      )
        throw new Error('Choose a person or new name');
      let id = selection.personId ?? null;
      if (selection.newName !== undefined) {
        const name = selection.newName.trim();
        if (!name || name.length > 200 || /[\p{Cc}]/u.test(name))
          throw new Error('Invalid person name');
        id = deps.createPerson(name);
      }
      if (id && !deps.people().some((p) => p.id === deps.canonical(id!)))
        throw new Error('Unknown person');
      const previous = read(key);
      if (
        previous?.person_id &&
        (!id || deps.canonical(previous.person_id) !== deps.canonical(id))
      ) {
        sql
          .prepare(
            'INSERT OR IGNORE INTO prep_attendee_rejections(attendee_key, person_id) VALUES (?, ?)',
          )
          .run(key, previous.person_id);
      }
      if (id)
        sql
          .prepare(
            'DELETE FROM prep_attendee_rejections WHERE attendee_key = ? AND person_id = ?',
          )
          .run(key, id);
      save(key, id, 'user');
    })();
  const emails = (personId: string): string[] =>
    (
      sql
        .prepare(
          "SELECT attendee_key, person_id FROM prep_attendee_links WHERE person_id IS NOT NULL AND attendee_key LIKE 'email:%'",
        )
        .all() as Array<{ attendee_key: string; person_id: string }>
    )
      .filter(
        (row) => deps.canonical(row.person_id) === deps.canonical(personId),
      )
      .map((row) => row.attendee_key.slice(6));
  return { resolve, change, people: deps.people, emails };
}
