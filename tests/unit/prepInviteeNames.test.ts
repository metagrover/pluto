import { expect, it } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import {
  findCalendarInviteeName,
  resolvePrepInviteeNames,
} from '../../electron/meetingPrep';
const event = {
  attendees: [
    { name: 'sam@example.com', email: ' SAM@example.com ' },
    { name: 'Alex Chen', email: 'alex@example.com' },
    { name: null, email: 'unknown@example.com' },
    { name: 'No email', email: null },
  ],
  organizer: { name: null, email: 'organizer@example.com' },
} as CalendarEvent;
it('uses known email associations for attendee and organizer names without rewriting the source event', () => {
  const result = resolvePrepInviteeNames(event, (email) =>
    email === 'sam@example.com'
      ? 'Sam Smith'
      : email === 'organizer@example.com'
        ? 'Taylor'
        : null,
  );
  expect(result.attendees.map((p) => p.name)).toEqual([
    'Sam Smith',
    'Alex Chen',
    null,
    'No email',
  ]);
  expect(result.organizer?.name).toBe('Taylor');
  expect(result.attendees[0].email).toBe(' SAM@example.com ');
  expect(event.attendees[0].name).toBe('sam@example.com');
});
it('retains provider names and email fallbacks when no name association exists', () => {
  const result = resolvePrepInviteeNames(event, () => null);
  expect(result.attendees).toEqual(event.attendees);
  expect(result.organizer).toEqual(event.organizer);
});

it('recovers a unique calendar name by exact normalized email, including organizers', () => {
  const cached = [
    { ...event, organizer: { name: 'Sam Smith', email: 'sam@example.com' } },
  ];
  expect(findCalendarInviteeName(' SAM@example.com ', cached)).toBe(
    'Sam Smith',
  );
  expect(findCalendarInviteeName('missing@example.com', cached)).toBeNull();
});
it('does not infer names from emails or choose between conflicting calendar names', () => {
  expect(findCalendarInviteeName('sam@example.com', [event])).toBeNull();
  const one = {
    ...event,
    organizer: { name: 'Sam Smith', email: 'sam@example.com' },
  };
  const two = {
    ...event,
    organizer: { name: 'Sam Jones', email: 'sam@example.com' },
  };
  expect(findCalendarInviteeName('sam@example.com', [one, two])).toBeNull();
});
