import { describe, expect, it } from 'vitest';
import {
  calendarSeriesKey,
  sanitizeCalendarAgenda,
} from '../../electron/calendar/agenda';

describe('calendar agenda normalization', () => {
  it('removes conferencing boilerplate while preserving authored text and document links', () => {
    expect(
      sanitizeCalendarAgenda(`Review launch risks
Join Zoom Meeting: https://acme.zoom.us/j/123
Spec: https://docs.example.com/launch
Meeting ID: 123 456`),
    ).toBe('Review launch risks\nSpec: https://docs.example.com/launch');
  });

  it('uses calendar-scoped external IDs only for native recurring series', () => {
    expect(
      calendarSeriesKey({
        calendarIdentifier: 'work',
        calendarItemExternalIdentifier: 'server-series-1',
        hasRecurrenceRules: true,
      }),
    ).toBe('work|server-series-1');
    expect(
      calendarSeriesKey({
        calendarIdentifier: 'personal',
        calendarItemExternalIdentifier: 'server-series-1',
        hasRecurrenceRules: true,
      }),
    ).toBe('personal|server-series-1');
    expect(
      calendarSeriesKey({
        calendarIdentifier: 'work',
        calendarItemExternalIdentifier: 'server-series-1',
        hasRecurrenceRules: false,
      }),
    ).toBeNull();
  });
});
