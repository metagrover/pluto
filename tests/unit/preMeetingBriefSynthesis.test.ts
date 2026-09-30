import { expect, it, vi } from 'vitest';
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
it('keeps distinct cited sentences from one discussion item', async () => {
  const source = {
    ...brief.lastTime[0],
    text: 'The team reviewed the draft together. The pilot feedback is still incomplete.',
  };
  const result = await synthesizePreMeetingBrief(
    { ...brief, evidenceItems: [source] },
    async () =>
      JSON.stringify({
        overview: [
          {
            evidenceId: source.id,
            quote: 'The team reviewed the draft together.',
            summary:
              'The team spent the previous meeting reviewing the draft together.',
          },
          {
            evidenceId: source.id,
            quote: 'The pilot feedback is still incomplete.',
            summary:
              'The pilot feedback remained incomplete at the end of that discussion.',
          },
          {
            evidenceId: source.id,
            quote: 'The pilot feedback is still incomplete.',
            summary: 'The same pilot feedback was still incomplete.',
          },
        ],
      }),
  );
  expect(result.overview).toHaveLength(2);
  expect(result.overview?.map((item) => item.sourceQuote)).toEqual([
    'The team reviewed the draft together.',
    'The pilot feedback is still incomplete.',
  ]);
  expect(new Set(result.overview?.map((item) => item.id)).size).toBe(2);
});
it('builds a fuller cited recap with tentative next steps and concerns', async () => {
  const result = await synthesizePreMeetingBrief(
    {
      ...brief,
      evidenceItems: [
        {
          ...brief.lastTime[0],
          id: 'latest-plan',
          text: 'The team agreed to review the draft after the pilot feedback arrives.',
        },
        {
          ...brief.lastTime[0],
          id: 'older-context',
          sourceMeetingId: 'older-meeting',
          text: 'Earlier discussions focused on a limited pilot with the first group.',
        },
        {
          ...brief.lastTime[0],
          id: 'latest-risk',
          text: 'The review remains blocked because the pilot feedback is incomplete.',
        },
      ],
    },
    async (prompt) => {
      const input = JSON.parse(prompt.split('INPUT\n')[1]) as {
        evidence: Array<{ id: string }>;
      };
      expect(input.evidence.slice(0, 2).map((item) => item.id)).toEqual([
        'latest-plan',
        'latest-risk',
      ]);
      return JSON.stringify({
        overview: [
          {
            evidenceId: 'latest-plan',
            quote:
              'The team agreed to review the draft after the pilot feedback arrives.',
            summary:
              'The team planned to review the draft once feedback from the pilot is available.',
          },
          {
            evidenceId: 'latest-risk',
            quote:
              'The review remains blocked because the pilot feedback is incomplete.',
            summary:
              'The review remains blocked while the pilot feedback is incomplete.',
          },
        ],
        possibleNextSteps: [
          {
            evidenceId: 'latest-plan',
            quote: 'review the draft after the pilot feedback arrives',
            summary:
              'Consider checking whether the pilot feedback has arrived before reviewing the draft.',
          },
        ],
        watchouts: [
          {
            evidenceId: 'latest-risk',
            quote:
              'The review remains blocked because the pilot feedback is incomplete.',
            summary:
              'The incomplete pilot feedback could continue to hold up the review.',
          },
          {
            evidenceId: 'invented',
            quote: 'A concern that was never recorded.',
            summary:
              'Check a concern that has no support in the saved meeting.',
          },
        ],
        talkingPoints: [],
      });
    },
  );
  expect(result.synthesisStatus).toBe('ready');
  expect(result.overview).toHaveLength(2);
  expect(result.possibleNextSteps?.[0]).toMatchObject({
    trustStatus: 'inferred',
    sourceMeetingId: 'meeting',
  });
  expect(result.watchouts).toHaveLength(1);
});
it('uses calendar agenda for supported preparation suggestions but not past-discussion claims', async () => {
  const withAgenda = {
    ...brief,
    agenda:
      'Review the pilot timeline and decide whether to invite the second group.',
    calendarInvitees: ['Morgan'],
  };
  const result = await synthesizePreMeetingBrief(withAgenda, async (prompt) => {
    const input = JSON.parse(prompt.split('INPUT\n')[1]) as {
      invitees: string[];
      evidence: Array<{ id: string; kind: string }>;
    };
    expect(input.invitees).toEqual(['Morgan']);
    expect(input.evidence).toContainEqual(
      expect.objectContaining({ id: 'calendar:agenda', kind: 'calendar' }),
    );
    return JSON.stringify({
      overview: [
        {
          evidenceId: 'decision',
          quote: 'We agreed to ship the smaller beta first.',
          summary: 'The group agreed to ship a smaller beta first.',
        },
        {
          evidenceId: 'calendar:agenda',
          quote: 'decide whether to invite the second group',
          summary: 'The group decided to invite the second group last time.',
        },
      ],
      possibleNextSteps: [
        {
          evidenceId: 'calendar:agenda',
          quote: 'decide whether to invite the second group',
          summary: 'Consider asking whether to invite the second group.',
        },
      ],
      watchouts: [
        {
          evidenceId: 'calendar:agenda',
          quote: 'Review the pilot timeline',
          summary: 'The pilot timeline may need another review.',
        },
      ],
    });
  });
  expect(result.overview).toHaveLength(1);
  expect(result.possibleNextSteps?.[0]).toMatchObject({
    sourceMeetingId: null,
    sourceLabel: 'Calendar agenda',
    trustStatus: 'inferred',
  });
  expect(result.watchouts).toHaveLength(1);
});
it('does not mark suggested steps alone as a successful recap', async () => {
  const result = await synthesizePreMeetingBrief(brief, async () =>
    JSON.stringify({
      overview: [],
      possibleNextSteps: [
        {
          evidenceId: 'decision',
          quote: 'We agreed to ship the smaller beta first.',
          summary:
            'Consider checking whether the smaller beta shipped as planned.',
        },
      ],
    }),
  );
  expect(result).toBe(brief);
});
it('allows a local model more than 30 seconds to produce a recap', async () => {
  vi.useFakeTimers();
  try {
    const result = synthesizePreMeetingBrief(brief, async (_prompt, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      expect(signal.aborted).toBe(false);
      return JSON.stringify({
        overview: [
          {
            evidenceId: 'decision',
            quote: 'We agreed to ship the smaller beta first.',
            summary: 'The group agreed to ship a smaller beta first.',
          },
        ],
      });
    });
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await result).synthesisStatus).toBe('ready');
  } finally {
    vi.useRealTimers();
  }
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
