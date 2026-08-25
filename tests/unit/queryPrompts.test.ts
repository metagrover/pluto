import { describe, expect, it } from 'vitest';

import { getAskPlutoPrompt } from '../../electron/intelligence/queryPrompts';

describe('getAskPlutoPrompt', () => {
  it('includes bounded conversation and the resolved meeting title', () => {
    const prompt = getAskPlutoPrompt(
      'Why did that change?',
      [
        {
          meeting_id: 'meeting-2',
          meeting_title: 'Current product review',
          mid: null,
          evidence_text: 'The launch moved to Friday.',
          score: 1,
          score_breakdown: {
            fts_rank: 0,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [
        { role: 'user', content: 'What changed?' },
        {
          role: 'assistant',
          content: 'The launch moved from Thursday to Friday.',
        },
      ],
    );

    expect(prompt).toContain('Meeting: "Current product review"');
    expect(prompt).toContain('User: What changed?');
    expect(prompt).toContain(
      'Pluto: The launch moved from Thursday to Friday.',
    );
  });
});
