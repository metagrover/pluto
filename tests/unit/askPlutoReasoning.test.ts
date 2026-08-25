import { describe, expect, it } from 'vitest';

import {
  getCrossMeetingCandidateLimit,
  queryReferencesPriorTurn,
  resolveAskPlutoReasoningMode,
} from '../../electron/intelligence/askPlutoReasoning';

describe('resolveAskPlutoReasoningMode', () => {
  it('keeps straightforward retrieval on the fast path', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Who owns the migration checklist?',
        intent: 'factual',
      }),
    ).toBe('fast');
  });

  it('uses deep reasoning for comparisons, change, conflict, risk, and advice', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Compare the current meeting with the last one',
        intent: 'comparative',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'What changed and what risks should I consider?',
        intent: 'factual',
      }),
    ).toBe('deep');
  });

  it('honors an explicit user override', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Who owns this?',
        intent: 'factual',
        override: 'deep',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Compare these meetings',
        intent: 'comparative',
        override: 'fast',
      }),
    ).toBe('fast');
  });

  it('recognizes follow-up references that need prior cited meetings', () => {
    expect(queryReferencesPriorTurn('Why did you suggest it?')).toBe(true);
    expect(
      queryReferencesPriorTurn('Compare that with the current meeting'),
    ).toBe(true);
    expect(
      queryReferencesPriorTurn('What did Riley decide about pricing?'),
    ).toBe(false);
  });

  it('selects bounded historical anchors for current-meeting comparisons', () => {
    expect(
      getCrossMeetingCandidateLimit(
        'Compare the current meeting with the last one',
        'comparative',
      ),
    ).toBe(1);
    expect(
      getCrossMeetingCandidateLimit(
        'What patterns changed across meetings?',
        'comparative',
      ),
    ).toBe(3);
    expect(getCrossMeetingCandidateLimit('What was decided?', 'factual')).toBe(
      0,
    );
  });
});
