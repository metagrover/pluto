import { describe, expect, it } from 'vitest';

import {
  buildScheduleAnswer,
  findPreviousOccurrence,
  isScheduleQuestion,
} from '../../electron/intelligence/askPlutoCalendar';
import { resolveTemporalQuery } from '../../electron/intelligence/temporalScope';

const now = new Date(2026, 10, 2, 21, 0);

describe('schedule questions', () => {
  it('recognizes upcoming-schedule questions', () => {
    for (const query of [
      'What meetings do I have tomorrow, and what should I prep?',
      "What's on my calendar?",
      'Any calls scheduled next week?',
      'When is my next meeting?',
    ])
      expect(
        isScheduleQuestion(
          query,
          resolveTemporalQuery(query, now)?.range ?? null,
          now,
        ),
      ).toBe(true);
  });

  it('leaves recorded-meeting questions alone', () => {
    for (const query of [
      'What meetings did I have last week?',
      'Summarize my last meeting with Adam.',
      'What decisions were made about the PBX migration?',
    ])
      expect(
        isScheduleQuestion(
          query,
          resolveTemporalQuery(query, now)?.range ?? null,
          now,
        ),
      ).toBe(false);
  });
});

describe('schedule answers', () => {
  const meetings = [
    {
      id: 'r1',
      title: 'NCT Daily Check-in: 09/22',
      started_at: '2026-09-22T19:01:00Z',
    },
    {
      id: 'r2',
      title: 'NCT Daily Check-in',
      started_at: '2026-09-16T19:01:00Z',
    },
    { id: 'r3', title: 'Adam: 1-1', started_at: '2026-09-22T20:00:00Z' },
  ];
  const events = [
    {
      title: 'NCT Daily Check-in',
      start: '2026-11-03T19:00:00Z',
      end: '2026-11-03T19:30:00Z',
      attendees: [{ name: 'Hema' }, { email: 'arnold@example.com' }],
    },
    {
      title: 'Quarterly planning',
      start: '2026-11-03T17:00:00Z',
      end: '2026-11-03T18:00:00Z',
      attendees: [],
    },
  ];

  it('links an event to its latest recorded occurrence, ignoring title dates', () => {
    expect(findPreviousOccurrence(events[0], meetings)?.id).toBe('r1');
    expect(findPreviousOccurrence(events[1], meetings)).toBeUndefined();
  });

  it('lists events in time order with invitees and prior notes', () => {
    const { answer, relatedMeetings } = buildScheduleAnswer({
      events,
      meetings,
      rangeLabel: 'tomorrow',
      calendarConnected: true,
    });
    expect(answer.indexOf('Quarterly planning')).toBeLessThan(
      answer.indexOf('NCT Daily Check-in'),
    );
    expect(answer).toContain('invited: Hema, arnold@example.com');
    expect(answer).toContain('Last recorded: “NCT Daily Check-in: 09/22”');
    expect(relatedMeetings.map((meeting) => meeting.id)).toEqual(['r1']);
  });

  it('is explicit when the calendar is empty or not connected', () => {
    expect(
      buildScheduleAnswer({
        events: [],
        meetings,
        rangeLabel: 'tomorrow',
        calendarConnected: true,
      }).answer,
    ).toBe('Your calendar has no meetings tomorrow.');
    expect(
      buildScheduleAnswer({
        events,
        meetings,
        rangeLabel: 'tomorrow',
        calendarConnected: false,
      }).answer,
    ).toContain("isn't connected");
  });
});
