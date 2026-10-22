import { describe, expect, it } from 'vitest';
import { parseDueDate } from '../../electron/actionDueDate';

describe('source calendar deadlines', () => {
  const meeting = '2026-05-11T12:00:00-07:00';

  it.each([
    ['Friday, May 15', '2026-05-15'],
    ['by Friday May 15th', '2026-05-15'],
    ['May 15', '2026-05-15'],
    ['15 May', '2026-05-15'],
    ['on Friday, 15 May 2026', '2026-05-15'],
    ['Wednesday, May 15, 2024', '2024-05-15'],
    ['29 February 2024', '2024-02-29'],
  ])(
    'normalizes %s using explicit or source-meeting year',
    (text, expected) => {
      expect(parseDueDate(text, meeting)).toBe(expected);
    },
  );

  it('does not need an anchor for an explicit named calendar year', () => {
    expect(parseDueDate('Wednesday, May 15, 2024')).toBe('2024-05-15');
    expect(parseDueDate('May 15')).toBeNull();
    expect(parseDueDate('May 15', 'invalid')).toBeNull();
  });

  it.each([
    'Tuesday, May 15',
    'Friday, May 15, 2024',
    'February 29',
    'April 31',
    'May 0',
    'May 32',
    'May 15 after approval',
    'next May 15',
    '5/15',
    'May 15.5',
  ])('refuses invalid, contradictory or qualified date %s', (text) => {
    expect(parseDueDate(text, meeting)).toBeNull();
  });

  it('preserves an explicit past year and never rolls a partial date forward', () => {
    expect(parseDueDate('May 15, 2024', meeting)).toBe('2024-05-15');
    expect(parseDueDate('January 5', '2026-12-31T12:00:00Z')).toBe(
      '2026-01-05',
    );
  });

  it('uses the existing meeting-local calendar when a timezone is supplied', () => {
    const started = '2027-01-01T00:30:00Z';
    expect(parseDueDate('January 5', started, 'America/Los_Angeles')).toBe(
      '2026-01-05',
    );
    expect(parseDueDate('January 5', started)).toBe('2027-01-05');
    expect(parseDueDate('January 5', started, 'Invalid/Timezone')).toBeNull();
  });

  it('retains existing strict ISO and relative-day behavior', () => {
    expect(parseDueDate('2026-05-15')).toBe('2026-05-15');
    expect(parseDueDate('2026-05-15T09:00:00-07:00')).toBe(
      '2026-05-15T16:00:00.000Z',
    );
    expect(parseDueDate('tomorrow', meeting)).toBe('2026-05-12');
    expect(parseDueDate('by Friday', meeting)).toBe('2026-05-15');
    expect(parseDueDate('next week', meeting)).toBeNull();
  });
});
