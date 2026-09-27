import { expect, it } from 'vitest';
import type { Entity } from '../../electron/db';
import type { MeetingPrep } from '../../electron/meetingPrep';
import { buildMeetingPrepBrief } from '../../electron/meetingPrepBrief';
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
