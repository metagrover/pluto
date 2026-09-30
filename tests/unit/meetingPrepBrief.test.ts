import { expect, it } from 'vitest';
import type { Entity } from '../../electron/db';
import type { MeetingPrep } from '../../electron/meetingPrep';
import {
  buildMeetingPrepBrief,
  refreshMeetingPrepBrief,
} from '../../electron/meetingPrepBrief';
const prep = {
  event: { title: 'Launch', start: '2026-09-28', agenda: null },
  meetings: [
    {
      id: 'old',
      title: 'Launch review',
      date: '2026-09-20',
      context: 'We discussed customer pricing and the launch plan.',
      trustStatus: 'grounded',
    },
  ],
} as MeetingPrep;
it('grounds historical context in selected meetings and uses only currently confirmed open commitments', () => {
  const action = (
    id: string,
    status: string,
    metadata: unknown = { commitment_state: 'confirmed' },
  ) =>
    ({
      id,
      name: id,
      type: 'action_item',
      status,
      metadata: JSON.stringify(metadata),
      due_date: '2026-09-30',
    }) as Entity;
  const result = buildMeetingPrepBrief(prep, {
    entities: () => [
      action('open', 'active'),
      action('done', 'completed'),
      action('cancelled', 'active', {
        commitment_state: 'confirmed',
        cancelled_at: 'today',
      }),
      action('possible', 'active', {}),
      action('malformed', 'active', null),
    ],
    blockers: () => [],
  });
  expect(result.lastTime[0]).toMatchObject({
    sourceMeetingId: 'old',
    sourceLabel: 'Launch review',
    trustStatus: 'grounded',
  });
  expect(result.stillOpen.map((item) => item.id)).toEqual(['follow-up:open']);
  expect(result.stillOpen[0].text).toContain('Due 2026-09-30');
  expect(result.talkingPoints).toHaveLength(1);
});
it('returns an empty deterministic briefing without automatically finding unrelated meetings', () => {
  expect(
    buildMeetingPrepBrief(
      { ...prep, meetings: [] },
      { entities: () => [], blockers: () => [] },
    ).lastTime,
  ).toEqual([]);
});

it('passes calendar invitees through the manual prep brief as unverified hints', () => {
  const result = buildMeetingPrepBrief(
    {
      ...prep,
      event: {
        ...prep.event,
        attendees: [
          { name: 'Morgan', email: 'morgan@example.test' },
          { name: null, email: 'lee@example.test' },
          { name: 'You', email: 'you@example.test', isCurrentUser: true },
        ],
        organizer: { name: 'Morgan', email: 'morgan@example.test' },
      },
    },
    { entities: () => [], blockers: () => [] },
  );
  expect(result.calendarInvitees).toEqual(['Morgan', 'lee@example.test']);
  expect(
    refreshMeetingPrepBrief(result, {
      ...result,
      calendarInvitees: ['Taylor'],
    }).calendarInvitees,
  ).toEqual(['Taylor']);
});

it('removes suggestions grounded in a calendar agenda after that agenda changes', () => {
  const baseline = buildMeetingPrepBrief(prep, {
    entities: () => [],
    blockers: () => [],
  });
  const calendarSuggestion = {
    id: 'next:calendar:agenda:0',
    text: 'Review the pilot timeline',
    sourceMeetingId: null,
    sourceLabel: 'Calendar agenda',
    sourceDate: baseline.startsAt,
    trustStatus: 'inferred' as const,
  };
  const saved = {
    ...baseline,
    agenda: 'Review the pilot timeline',
    possibleNextSteps: [calendarSuggestion],
    watchouts: [calendarSuggestion],
  };
  const refreshed = refreshMeetingPrepBrief(saved, {
    ...baseline,
    agenda: 'Discuss the release plan',
  });
  expect(refreshed.possibleNextSteps).toEqual([]);
  expect(refreshed.watchouts).toEqual([]);
});

it('balances overview and synthesis context across selected meetings instead of taking everything from the first', () => {
  const first = {
    ...prep.meetings![0],
    context:
      'First meeting discussed pricing.\nFirst meeting also discussed launch timing.\nMore first-meeting context.',
  };
  const second = {
    ...first,
    id: 'second',
    title: 'Customer review',
    date: '2026-09-19',
    context:
      'Customer review raised onboarding questions.\nCustomer review agreed on trials.',
  };
  const result = buildMeetingPrepBrief(
    { ...prep, meetings: [first, second] },
    { entities: () => [], blockers: () => [] },
  );
  expect(result.overview?.map((item) => item.sourceMeetingId)).toEqual([
    'old',
    'second',
  ]);
  expect(
    result.evidenceItems?.slice(0, 4).map((item) => item.sourceMeetingId),
  ).toEqual(['old', 'second', 'old', 'second']);
});

it('removes completed action items from a saved generated briefing', () => {
  const action = {
    id: 'follow-up:done',
    text: 'Send the launch checklist',
    trustStatus: 'grounded' as const,
    sourceMeetingId: 'old',
    sourceLabel: 'Launch review',
    sourceDate: '2026-09-20',
  };
  const historical = {
    ...action,
    id: 'history:old:0',
    text: 'The team reviewed launch timing.',
  };
  const baseline = buildMeetingPrepBrief(prep, {
    entities: () => [],
    blockers: () => [],
  });
  const refreshed = refreshMeetingPrepBrief(
    {
      ...baseline,
      synthesisStatus: 'ready',
      overview: [action, historical],
      evidenceItems: [action, historical],
      stillOpen: [action],
      talkingPoints: [
        {
          ...action,
          id: 'suggested:follow-up:done',
          text: 'What is the update?',
        },
      ],
    },
    baseline,
  );
  expect(refreshed.synthesisStatus).toBe('ready');
  expect(refreshed.stillOpen).toEqual([]);
  expect(refreshed.overview).toEqual([historical]);
  expect(refreshed.evidenceItems).toEqual([historical]);
  expect(refreshed.talkingPoints).toEqual([]);
});

it('separates confirmed personal, other, and unassigned commitments without guessing ownership', () => {
  const action = (id: string, assigned_to: string | null) =>
    ({
      id,
      name: `Action ${id}`,
      type: 'action_item',
      status: 'active',
      assigned_to,
      metadata: JSON.stringify({ commitment_state: 'confirmed' }),
    }) as Entity;
  const result = buildMeetingPrepBrief(prep, {
    entities: () => [
      action('mine', 'self'),
      action('theirs', 'other'),
      action('unknown', null),
    ],
    blockers: () => [],
    selfPersonId: 'self',
  });
  expect(result.stillOpen.map((item) => [item.id, item.ownerScope])).toEqual([
    ['follow-up:mine', 'self'],
    ['follow-up:theirs', 'other'],
    ['follow-up:unknown', 'unconfirmed'],
  ]);
  expect(
    buildMeetingPrepBrief(prep, {
      entities: () => [action('mine', 'self')],
      blockers: () => [],
    }).stillOpen[0].ownerScope,
  ).toBe('unconfirmed');
});
