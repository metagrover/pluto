import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../../electron/calendar/types';
import { getEligibleCalendarPrompt } from '../../src/utils/calendarPromptDecision';
import {
  getCalendarRosterNames,
  isMatchedActiveCalendarResult,
} from '../../src/utils/calendarRoster';

const makeEvent = (
  occurrenceKey: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  occurrenceKey,
  eventIdentifier: occurrenceKey,
  calendarIdentifier: 'cal-1',
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

describe('calendar prompt decision', () => {
  const now = new Date('2026-09-04T17:28:00.000Z').getTime(); // 17:28

  it('returns eligible upcoming event starting in 2 minutes with conference link', () => {
    const upcoming = makeEvent(
      'sprint-planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        title: 'Sprint Planning (https://meet.google.com/abc-defg-hij)',
      },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [upcoming],
      dismissedKeys: new Set(),
      isRecording: false,
      promptEnabled: true,
    });

    expect(result).not.toBeNull();
    expect(result?.occurrenceKey).toBe('sprint-planning');
  });

  it('returns null if recording is already active', () => {
    const upcoming = makeEvent(
      'sprint-planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        title: 'Sprint Planning (https://meet.google.com/abc-defg-hij)',
      },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [upcoming],
      dismissedKeys: new Set(),
      isRecording: true,
      promptEnabled: true,
    });

    expect(result).toBeNull();
  });

  it('returns null if promptEnabled is false in settings', () => {
    const upcoming = makeEvent(
      'sprint-planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        title: 'Sprint Planning (https://meet.google.com/abc-defg-hij)',
      },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [upcoming],
      dismissedKeys: new Set(),
      isRecording: false,
      promptEnabled: false,
    });

    expect(result).toBeNull();
  });

  it('ignores events in dismissedKeys', () => {
    const upcoming = makeEvent(
      'sprint-planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        title: 'Sprint Planning (https://meet.google.com/abc-defg-hij)',
      },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [upcoming],
      dismissedKeys: new Set(['sprint-planning']),
      isRecording: false,
      promptEnabled: true,
    });

    expect(result).toBeNull();
  });

  it('ignores cancelled and all-day events', () => {
    const cancelled = makeEvent(
      'cancelled',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        title: 'Cancelled (https://zoom.us/j/123)',
        isCancelled: true,
      },
    );
    const allDay = makeEvent(
      'allDay',
      '2026-09-04T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
      {
        title: 'Holiday (https://zoom.us/j/123)',
        isAllDay: true,
      },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [cancelled, allDay],
      dismissedKeys: new Set(),
      isRecording: false,
      promptEnabled: true,
    });

    expect(result).toBeNull();
  });

  it('prioritizes events with conference links over events without', () => {
    const withoutLink = makeEvent(
      'in-person-sync',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      { title: 'In-person hallway sync' },
    );
    const withLink = makeEvent(
      'zoom-call',
      '2026-09-04T17:35:00.000Z',
      '2026-09-04T18:00:00.000Z',
      { title: 'Zoom Call (https://zoom.us/j/1234567890)' },
    );

    const result = getEligibleCalendarPrompt({
      nowMs: now,
      events: [withoutLink, withLink],
      dismissedKeys: new Set(),
      isRecording: false,
      promptEnabled: true,
    });

    expect(result?.occurrenceKey).toBe('zoom-call');
  });
});

describe('calendar recording roster', () => {
  it('provides unique named organizer and attendees as roster hints', () => {
    const event = makeEvent(
      'planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
      {
        organizer: { name: 'Alex Chen', email: 'alex@example.com' },
        attendees: [
          { name: 'Jordan Lee', email: 'jordan@example.com' },
          { name: 'alex chen', email: 'other@example.com' },
          { name: null, email: 'unnamed@example.com' },
        ],
      },
    );

    expect(getCalendarRosterNames(event)).toEqual([
      'Alex Chen',
      'Jordan Lee',
      'unnamed@example.com',
    ]);
  });

  it('accepts only the matcher matched discriminator', () => {
    const event = makeEvent(
      'planning',
      '2026-09-04T17:30:00.000Z',
      '2026-09-04T18:00:00.000Z',
    );
    expect(
      isMatchedActiveCalendarResult({
        match: { kind: 'matched', occurrenceKey: 'planning' },
        event,
      }),
    ).toBe(true);
    expect(
      isMatchedActiveCalendarResult({
        match: { kind: 'match', occurrenceKey: 'planning' },
        event,
      }),
    ).toBe(false);
  });
});
