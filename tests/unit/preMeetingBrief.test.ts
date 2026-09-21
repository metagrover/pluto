import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import type { Entity, PersistedMeeting } from '../../electron/db';
import {
  buildPreMeetingBrief,
  resolvePriorMeeting,
} from '../../electron/preMeetingBrief';

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  occurrenceKey: 'work|event-2|2026-09-21T17:00:00.000Z',
  eventIdentifier: 'event-2',
  calendarIdentifier: 'work',
  title: 'Weekly Product Review',
  start: '2026-09-21T17:00:00.000Z',
  end: '2026-09-21T17:30:00.000Z',
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [{ name: 'Sam', email: 'sam@example.com' }],
  lastModified: null,
  calendarItemIdentifier: 'local-2',
  calendarItemExternalIdentifier: 'series-1',
  notes: 'Review the launch',
  agenda: 'Review the launch',
  hasRecurrenceRules: true,
  recurrenceRules: [],
  seriesKey: 'work|series-1',
  ...overrides,
});

const priorContext = (overrides: Partial<CalendarEvent> = {}) => ({
  sourceKind: 'macos_calendar' as const,
  occurrenceKey: 'work|event-1|2026-09-14T17:00:00.000Z',
  calendarTitle: 'Work',
  event: event({
    occurrenceKey: 'work|event-1|2026-09-14T17:00:00.000Z',
    eventIdentifier: 'event-1',
    start: '2026-09-14T17:00:00.000Z',
    end: '2026-09-14T17:30:00.000Z',
    ...overrides,
  }),
  matchOrigin: 'automatic' as const,
  matchEvidence: 'time_overlap' as const,
  meetingId: 'meeting-1',
  meetingTitle: 'Weekly Product Review',
  meetingStartedAt: '2026-09-14T17:00:00.000Z',
});

const meeting: PersistedMeeting = {
  id: 'meeting-1',
  title: 'Weekly Product Review',
  started_at: '2026-09-14T17:00:00.000Z',
  created_at: '2026-09-14T17:00:00.000Z',
  mid_json: JSON.stringify({
    decisions: [{ description: 'Ship the smaller beta first' }],
  }),
};

const action = (status: Entity['status']): Entity => ({
  id: `action-${status}`,
  type: 'action_item',
  name: `${status} follow-up`,
  normalized_name: `${status} follow-up`,
  status,
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'work',
  created_at: '2026-09-14T17:00:00.000Z',
  updated_at: '2026-09-14T17:00:00.000Z',
});

describe('pre-meeting briefs', () => {
  it('prefers native recurrence identity and labels title fallback as related', () => {
    expect(resolvePriorMeeting(event(), [priorContext()])?.relationship).toBe(
      'same_series',
    );
    expect(
      resolvePriorMeeting(
        event({ seriesKey: null, hasRecurrenceRules: false }),
        [priorContext({ seriesKey: null, hasRecurrenceRules: false })],
      )?.relationship,
    ).toBe('related');
    expect(
      resolvePriorMeeting(event({ calendarIdentifier: 'other' }), [
        priorContext(),
      ]),
    ).toBeNull();
    expect(
      resolvePriorMeeting(
        event({
          title: 'Weekly sync',
          seriesKey: null,
          attendees: [],
        }),
        [
          priorContext({
            title: 'Weekly sync',
            seriesKey: null,
            attendees: [],
          }),
        ],
      ),
    ).toBeNull();
  });

  it('uses current commitment lifecycle rather than replaying completed snapshots', () => {
    const brief = buildPreMeetingBrief(
      { kind: 'calendar', event: event() },
      {
        listPriorMeetingContexts: () => [priorContext()],
        getMeeting: () => meeting,
        getMeetingEntities: () => [action('active'), action('completed')],
        getBlockedActionItems: () => [],
        searchMeetingSummaries: () => [],
        getGlobalWorkingMemory: () => undefined,
        getPeopleBriefingSummaries: () => [],
      },
    );

    expect(brief.relationship).toBe('same_series');
    expect(brief.lastTime.map((entry) => entry.text)).toContain(
      'Ship the smaller beta first',
    );
    expect(brief.stillOpen.map((entry) => entry.text)).toEqual([
      'active follow-up',
    ]);
    expect(brief.agenda).toBe('Review the launch');
  });

  it('returns an honest empty state when no prior meeting exists', () => {
    const brief = buildPreMeetingBrief(
      { kind: 'calendar', event: event() },
      {
        listPriorMeetingContexts: () => [],
        getMeeting: () => undefined,
        getMeetingEntities: () => [],
        getBlockedActionItems: () => [],
        searchMeetingSummaries: () => [],
        getGlobalWorkingMemory: () => undefined,
        getPeopleBriefingSummaries: () => [],
      },
    );
    expect(brief.priorMeeting).toBeNull();
    expect(brief.emptyMessage).toMatch(/No trustworthy previous meeting/);
  });
});
