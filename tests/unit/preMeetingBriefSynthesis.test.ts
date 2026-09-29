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
it('accepts concise recaps with exact source excerpts and rejects unsupported claims', async () => {
  const result = await synthesizePreMeetingBrief(brief, async () =>
    JSON.stringify({
      overview: [
        {
          evidenceId: 'invented',
          quote: 'ship the smaller beta first',
          summary: 'The group agreed to ship a smaller beta first.',
        },
        {
          evidenceId: 'decision',
          quote: 'We agreed to ship the smaller beta first.',
          summary: 'The group agreed to ship a smaller beta first.',
        },
      ],
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
  expect(result.overview?.[0]).toMatchObject({
    text: brief.lastTime[0].text,
    summary: 'The group agreed to ship a smaller beta first.',
    sourceQuote: 'We agreed to ship the smaller beta first.',
  });
  expect(result.talkingPoints).toHaveLength(1);
  expect(result.talkingPoints?.[0].sourceMeetingId).toBe('meeting');
});
it('rejects a recap that introduces a quantity absent from its source quote', async () => {
  const result = await synthesizePreMeetingBrief(brief, async () =>
    JSON.stringify({
      overview: [
        {
          evidenceId: 'decision',
          quote: 'We agreed to ship the smaller beta first.',
          summary: 'The group agreed to ship 15 smaller betas first.',
        },
      ],
      talkingPoints: [],
    }),
  );
  expect(result).toBe(brief);
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
