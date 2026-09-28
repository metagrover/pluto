import { describe, expect, it } from 'vitest';

import {
  buildCalendarRequest,
  parseCalendarMessage,
} from '../../electron/calendar/protocol';

describe('calendar helper protocol', () => {
  it('builds only allowlisted bounded requests', () => {
    expect(buildCalendarRequest('authorization_status', 'one')).toEqual({
      version: 1,
      id: 'one',
      method: 'authorization_status',
    });
    expect(() =>
      buildCalendarRequest('list_events', 'two', {
        calendarIdentifier: 'calendar-a',
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-11-01T00:00:00.000Z',
      }),
    ).toThrow('Calendar window cannot exceed 60 days');
  });

  it('parses a finite authorization response', () => {
    expect(
      parseCalendarMessage(
        JSON.stringify({
          version: 1,
          id: 'one',
          result: { status: 'denied' },
        }),
      ),
    ).toEqual({
      kind: 'response',
      id: 'one',
      result: { status: 'denied' },
    });
  });

  it('normalizes optional fields omitted by the native encoder', () => {
    const message = parseCalendarMessage(
      JSON.stringify({
        version: 1,
        id: 'events',
        result: {
          events: [
            {
              occurrenceKey: 'calendar-a|event-a|2026-08-31T18:30:00.000Z',
              eventIdentifier: 'event-a',
              calendarIdentifier: 'calendar-a',
              title: 'Product review',
              start: '2026-08-31T18:30:00Z',
              end: '2026-08-31T19:00:00Z',
              isAllDay: false,
              isCancelled: false,
              attendees: [{ name: 'Ada', isCurrentUser: true }],
            },
          ],
        },
      }),
    );

    expect(message).toEqual({
      kind: 'response',
      id: 'events',
      result: {
        events: [
          expect.objectContaining({
            availability: null,
            organizer: null,
            attendees: [{ name: 'Ada', email: null, isCurrentUser: true }],
            lastModified: null,
          }),
        ],
      },
    });
  });

  it('normalizes recurrence identity and a safe authored agenda', () => {
    const message = parseCalendarMessage(
      JSON.stringify({
        version: 1,
        id: 'events',
        result: {
          events: [
            {
              occurrenceKey: 'calendar-a|event-a|2026-08-31T18:30:00.000Z',
              eventIdentifier: 'event-a',
              calendarIdentifier: 'calendar-a',
              title: 'Product review',
              start: '2026-08-31T18:30:00Z',
              end: '2026-08-31T19:00:00Z',
              isAllDay: false,
              isCancelled: false,
              attendees: [],
              calendarItemExternalIdentifier: 'series-1',
              hasRecurrenceRules: true,
              recurrenceRules: [
                {
                  frequency: 'weekly',
                  interval: 1,
                  daysOfWeek: [2],
                  endDate: null,
                  occurrenceCount: null,
                },
              ],
              notes:
                'Review risks\nJoin Zoom Meeting: https://acme.zoom.us/j/1',
            },
          ],
        },
      }),
    );

    expect(message).toMatchObject({
      kind: 'response',
      result: {
        events: [
          {
            agenda: 'Review risks',
            seriesKey: 'calendar-a|series-1',
            recurrenceRules: [{ frequency: 'weekly', interval: 1 }],
          },
        ],
      },
    });
  });

  it.each([
    ['a missing required event field', { title: undefined }],
    ['a non-array attendee list', { attendees: null }],
    ['a malformed attendee', { attendees: [{ name: 42 }] }],
    [
      'an invalid current-user flag',
      { attendees: [{ isCurrentUser: 'true' }] },
    ],
    ['a malformed organizer', { organizer: { email: 42 } }],
    ['a malformed availability', { availability: 42 }],
    ['a malformed last-modified value', { lastModified: 42 }],
  ])('rejects %s', (_description, overrides) => {
    const event = {
      occurrenceKey: 'calendar-a|event-a|2026-08-31T18:30:00.000Z',
      eventIdentifier: 'event-a',
      calendarIdentifier: 'calendar-a',
      title: 'Product review',
      start: '2026-08-31T18:30:00Z',
      end: '2026-08-31T19:00:00Z',
      isAllDay: false,
      isCancelled: false,
      attendees: [],
      ...overrides,
    };

    expect(() =>
      parseCalendarMessage(
        JSON.stringify({
          version: 1,
          id: 'events',
          result: { events: [event] },
        }),
      ),
    ).toThrow('Unexpected calendar helper result');
  });

  it('rejects malformed, oversized, and unexpected messages', () => {
    expect(() => parseCalendarMessage('not json')).toThrow(
      'Malformed calendar helper message',
    );
    expect(() => parseCalendarMessage(' '.repeat(1_048_577))).toThrow(
      'Calendar helper message is too large',
    );
    expect(() =>
      parseCalendarMessage(
        JSON.stringify({ version: 1, id: 'one', result: { status: 'magic' } }),
      ),
    ).toThrow('Unexpected calendar helper result');
    expect(() =>
      parseCalendarMessage(
        JSON.stringify({ version: 2, id: 'one', result: {} }),
      ),
    ).toThrow('Unexpected calendar helper message');
  });

  it('accepts only the event-store change notification', () => {
    expect(
      parseCalendarMessage(
        JSON.stringify({ version: 1, event: 'event_store_changed' }),
      ),
    ).toEqual({ kind: 'event', event: 'event_store_changed' });
  });
});
