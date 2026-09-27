import { expect, it } from 'vitest';
import type { PreMeetingBrief } from '../../electron/preMeetingBrief';
import { synthesizePreMeetingBrief } from '../../electron/preMeetingBriefSynthesis';

const brief: PreMeetingBrief = {
  title: 'Review',
  startsAt: null,
  agenda: null,
  relationship: 'related',
  priorMeeting: null,
  lastTime: [
    {
      id: 'decision',
      text: 'We agreed to ship the smaller beta first.',
      trustStatus: 'grounded',
      sourceMeetingId: 'meeting',
      sourceLabel: 'Review',
      sourceDate: null,
    },
  ],
  stillOpen: [],
  relevantContext: [],
  emptyMessage: null,
};
it('only selects existing factual excerpts and accepts source-supported questions', async () => {
  const result = await synthesizePreMeetingBrief(brief, async () =>
    JSON.stringify({
      overviewIds: ['invented', 'decision'],
      talkingPoints: [
        {
          kind: 'status',
          evidenceId: 'decision',
          quote: 'ship the smaller beta first',
        },
        {
          kind: 'status',
          evidenceId: 'foreign',
          quote: 'ship the smaller beta first',
        },
        {
          kind: 'clarify',
          evidenceId: 'decision',
          quote: 'invented supporting quote',
        },
      ],
    }),
  );
  expect(result.overview).toEqual(brief.lastTime);
  expect(result.talkingPoints).toHaveLength(1);
  expect(result.talkingPoints?.[0].sourceMeetingId).toBe('meeting');
});
it('retains the deterministic brief on malformed output or provider failure', async () => {
  expect(await synthesizePreMeetingBrief(brief, async () => 'not json')).toBe(
    brief,
  );
  expect(
    await synthesizePreMeetingBrief(brief, async () => {
      throw new Error('offline');
    }),
  ).toBe(brief);
});
