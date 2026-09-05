import { describe, expect, it } from 'vitest';

import { matchCalendarEvent } from '../../electron/calendar/matcher';
import type { CalendarEvent } from '../../electron/calendar/types';

const event = (
  occurrenceKey: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  occurrenceKey,
  eventIdentifier: occurrenceKey,
  calendarIdentifier: 'calendar-a',
  title: occurrenceKey,
  start,
  end,
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
  ...overrides,
});

describe('calendar event matcher', () => {
  it('selects the unique event with strong recording overlap', () => {
    const result = matchCalendarEvent(
      '2026-08-30T17:31:00.000Z',
      '2026-08-30T18:15:00.000Z',
      [
        event(
          'product-review',
          '2026-08-30T17:30:00.000Z',
          '2026-08-30T18:30:00.000Z',
        ),
        event('later', '2026-08-30T20:30:00.000Z', '2026-08-30T21:00:00.000Z'),
      ],
    );
    expect(result).toEqual({
      kind: 'matched',
      occurrenceKey: 'product-review',
      evidence: 'time_overlap',
    });
  });

  it('excludes all-day and cancelled events', () => {
    const candidates = [
      event('all-day', '2026-08-30T00:00:00.000Z', '2026-08-31T00:00:00.000Z', {
        isAllDay: true,
      }),
      event(
        'cancelled',
        '2026-08-30T17:30:00.000Z',
        '2026-08-30T18:30:00.000Z',
        { isCancelled: true },
      ),
    ];
    expect(
      matchCalendarEvent(
        '2026-08-30T17:31:00.000Z',
        '2026-08-30T18:15:00.000Z',
        candidates,
      ),
    ).toEqual({ kind: 'none' });
  });

  it('returns ambiguity instead of guessing between overlapping events', () => {
    const candidates = [
      event('one', '2026-08-30T17:30:00.000Z', '2026-08-30T18:30:00.000Z'),
      event('two', '2026-08-30T17:30:00.000Z', '2026-08-30T18:30:00.000Z'),
    ];
    expect(
      matchCalendarEvent(
        '2026-08-30T17:31:00.000Z',
        '2026-08-30T18:15:00.000Z',
        candidates,
      ),
    ).toEqual({ kind: 'ambiguous', occurrenceKeys: ['one', 'two'] });
  });

  it('does not match a weak nearby event', () => {
    expect(
      matchCalendarEvent(
        '2026-08-30T17:00:00.000Z',
        '2026-08-30T17:05:00.000Z',
        [
          event(
            'later',
            '2026-08-30T17:25:00.000Z',
            '2026-08-30T18:00:00.000Z',
          ),
        ],
      ),
    ).toEqual({ kind: 'none' });
  });

  it('keeps ambiguous cross-calendar matches ambiguous', () => {
    const workEvent = event(
      'work-event',
      '2026-08-30T17:30:00.000Z',
      '2026-08-30T18:30:00.000Z',
      { calendarIdentifier: 'calendar-work' },
    );
    const personalEvent = event(
      'personal-event',
      '2026-08-30T17:30:00.000Z',
      '2026-08-30T18:30:00.000Z',
      { calendarIdentifier: 'calendar-personal' },
    );
    expect(
      matchCalendarEvent(
        '2026-08-30T17:31:00.000Z',
        '2026-08-30T18:15:00.000Z',
        [workEvent, personalEvent],
      ),
    ).toEqual({
      kind: 'ambiguous',
      occurrenceKeys: ['personal-event', 'work-event'],
    });
  });
});
