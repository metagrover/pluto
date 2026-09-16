import { describe, expect, it } from 'vitest';

import {
  buildContextBundle,
  estimateContextBundleTokens,
} from '../../electron/llm/contextBuilder';

describe('buildContextBundle', () => {
  it('keeps newest ephemeral turns and relevant evidence within the token bound', () => {
    const bundle = buildContextBundle({
      tokenBudget: 8,
      recentTurns: [
        { role: 'user', content: 'old question that is too long' },
        { role: 'assistant', content: 'new answer' },
      ],
      evidence: [
        { sourceId: 'S1', kind: 'note', text: 'short fact' },
        { sourceId: 'S2', kind: 'transcript', text: 'x'.repeat(80) },
      ],
    });

    expect(bundle.recentTurns).toEqual([
      { role: 'assistant', content: 'new answer' },
    ]);
    expect(bundle.evidence.map((item) => item.sourceId)).toEqual(['S1']);
    expect(estimateContextBundleTokens(bundle)).toBeLessThanOrEqual(8);
  });

  it('deduplicates local source IDs and never expands the provided evidence', () => {
    const bundle = buildContextBundle({
      tokenBudget: 100,
      evidence: [
        { sourceId: 'T1', kind: 'transcript', text: 'first' },
        { sourceId: 'T1', kind: 'transcript', text: 'duplicate' },
      ],
    });
    expect(bundle.evidence).toEqual([
      { sourceId: 'T1', kind: 'transcript', text: 'first' },
    ]);
  });
});
