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
