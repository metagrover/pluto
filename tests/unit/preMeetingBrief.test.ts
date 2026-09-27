import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../electron/calendar/types';
import type { Entity, PersistedMeeting } from '../../electron/db';
import {
  buildPreMeetingBrief,
  resolvePriorMeeting,
  validatePreMeetingBriefRequest,
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

it('finds email history under changed titles and excludes mention-only history', () => {
  const brief = buildPreMeetingBrief(
    {
      kind: 'calendar',
      event: event({ title: 'A completely different title', seriesKey: null }),
    },
    {
      listPriorMeetingContexts: () => [priorContext()],
      getMeeting: (id) =>
        id === 'meeting-1' ? meeting : { ...meeting, id: 'mention' },
      getMeetingEntities: () => [action('completed'), action('active')],
      getBlockedActionItems: () => [],
      searchMeetingSummaries: () => [],
      getGlobalWorkingMemory: () => undefined,
      getPeopleBriefingSummaries: () => [],
      resolveAttendees: () => [
        {
          key: 'email:sam@example.com',
          name: 'Sam',
          email: 'sam@example.com',
          personId: 'sam',
          personName: 'Sam',
          status: 'identified',
          basis: 'email',
          suggestions: [],
        },
      ],
      getPersonHistory: () => ({
        meetings: [{ id: 'mention', evidence: 'mentioned' }],
      }),
    },
  );
  expect(brief.priorMeeting?.id).toBe('meeting-1');
  expect(brief.sourceMeetings?.map((source) => source.id)).toEqual([
    'meeting-1',
  ]);
  expect(brief.sourceMeetings?.[0].evidence).toBe('invited');
  expect(brief.stillOpen).toHaveLength(1);
});
it('rechecks the corrected person and drops the previously selected person history', () => {
  let personId = 'first';
  const deps = {
    listPriorMeetingContexts: () => [],
    getMeeting: (id: string) => ({ ...meeting, id, title: id }),
    getMeetingEntities: () => [],
    getBlockedActionItems: () => [],
    searchMeetingSummaries: () => [],
    getGlobalWorkingMemory: () => undefined,
    getPeopleBriefingSummaries: () => [],
    resolveAttendees: () => [
      {
        key: 'email:sam@example.com',
        name: 'Sam',
        email: 'sam@example.com',
        personId,
        personName: personId,
        status: 'identified' as const,
        basis: 'user' as const,
        suggestions: [],
      },
    ],
    getPersonHistory: (id: string) => ({
      meetings: [{ id: `history-${id}`, evidence: 'confirmed' }],
    }),
  };
  const request = { kind: 'calendar' as const, event: event() };
  expect(buildPreMeetingBrief(request, deps).priorMeeting?.id).toBe(
    'history-first',
  );
  personId = 'second';
  expect(
    buildPreMeetingBrief(request, deps).sourceMeetings?.map((m) => m.id),
  ).toEqual(['history-second']);
});
it('prioritizes shared group history over individual history and orders equal relevance by date', () => {
  const attendee = (id: string) => ({
    key: `email:${id}@example.com`,
    name: id,
    email: `${id}@example.com`,
    personId: id,
    personName: id,
    status: 'identified' as const,
    basis: 'email' as const,
    suggestions: [],
  });
  const brief = buildPreMeetingBrief(
    {
      kind: 'calendar',
      event: event({
        seriesKey: null,
        title: 'Group',
        attendees: [
          { name: 'Sam', email: 'sam@example.com' },
          { name: 'Alex', email: 'alex@example.com' },
        ],
      }),
    },
    {
      listPriorMeetingContexts: () => [],
      getMeeting: (id) => ({
        ...meeting,
        id,
        title: id,
        started_at:
          id === 'shared-old' ? '2026-09-10T10:00:00Z' : '2026-09-14T10:00:00Z',
      }),
      getMeetingEntities: () => [],
      getBlockedActionItems: () => [],
      searchMeetingSummaries: () => [],
      getGlobalWorkingMemory: () => undefined,
      getPeopleBriefingSummaries: () => [],
      resolveAttendees: () => [attendee('sam'), attendee('alex')],
      getPersonHistory: (id) => ({
        meetings: [
          { id: 'shared-old', evidence: 'confirmed' },
          { id: 'shared-new', evidence: 'confirmed' },
          { id: `solo-${id}`, evidence: 'confirmed' },
        ],
      }),
    },
  );
  expect(brief.sourceMeetings?.slice(0, 2).map((m) => m.id)).toEqual([
    'shared-new',
    'shared-old',
  ]);
});

it('validates prep IPC requests and rejects malformed calendar payloads', () => {
  expect(
    validatePreMeetingBriefRequest({ kind: 'calendar', event: event() }).kind,
  ).toBe('calendar');
  for (const value of [
    null,
    { kind: 'query', query: '' },
    { kind: 'query', query: 'x'.repeat(201) },
    { kind: 'calendar', event: event({ start: 'invalid' }) },
    {
      kind: 'calendar',
      event: { ...event(), attendees: [{ name: 42, email: null }] },
    },
  ]) {
    expect(() => validatePreMeetingBriefRequest(value)).toThrow(
      'Invalid prep request',
    );
  }
});
it('includes other confirmed email aliases in history retrieval', () => {
  let emails: string[] = [];
  const brief = buildPreMeetingBrief(
    { kind: 'calendar', event: event({ seriesKey: null, title: 'New title' }) },
    {
      listPriorMeetingContexts: () => [],
      listRelatedMeetingContexts: (_event, keys) => {
        emails = keys;
        return [
          priorContext({
            attendees: [{ name: 'Sam', email: 'old@example.com' }],
          }),
        ];
      },
      getMeeting: () => meeting,
      getMeetingEntities: () => [],
      getBlockedActionItems: () => [],
      searchMeetingSummaries: () => [],
      getGlobalWorkingMemory: () => undefined,
      getPeopleBriefingSummaries: () => [],
      resolveAttendees: () => [
        {
          key: 'email:sam@example.com',
          name: 'Sam',
          email: 'sam@example.com',
          personId: 'sam',
          personName: 'Sam',
          status: 'identified',
          basis: 'user',
          suggestions: [],
        },
      ],
      getPersonEmails: () => ['old@example.com'],
    },
  );
  expect(emails).toContain('old@example.com');
  expect(brief.priorMeeting?.id).toBe('meeting-1');
});
it('excludes rejected and cancelled follow-ups from the briefing', () => {
  const brief = buildPreMeetingBrief(
    { kind: 'calendar', event: event() },
    {
      listPriorMeetingContexts: () => [priorContext()],
      getMeeting: () => meeting,
      getMeetingEntities: () => [
        {
          ...action('active'),
          metadata: JSON.stringify({ commitment_state: 'rejected' }),
        },
        {
          ...action('active'),
          id: 'cancelled',
          metadata: JSON.stringify({ cancelled_at: '2026-09-15' }),
        },
      ],
      getBlockedActionItems: () => [],
      searchMeetingSummaries: () => [],
      getGlobalWorkingMemory: () => undefined,
      getPeopleBriefingSummaries: () => [],
    },
  );
  expect(brief.stillOpen).toEqual([]);
});
