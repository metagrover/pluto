import { describe, expect, it } from 'vitest';

import { buildFollowUpDraftDecisions } from '../../src/components/features/followUpDraftDecisions';
import type { DecisionV3 } from '../../src/types';

describe('buildFollowUpDraftDecisions', () => {
  it('includes decision owners from v3 analysis when available', () => {
    const decisions: DecisionV3[] = [
      {
        text: 'Use REST for the rollout',
        decided_by: 'Sarah Chen',
      },
    ];

    expect(
      buildFollowUpDraftDecisions({
        v3Decisions: decisions,
        fallbackDecisions: [],
      }),
    ).toEqual(['Use REST for the rollout (Decided by: Sarah Chen)']);
  });

  it('keeps plain-text fallbacks that were not present in v3 decisions', () => {
    const decisions: DecisionV3[] = [
      {
        text: 'Use REST for the rollout',
        decided_by: 'Sarah Chen',
      },
      {
        text: 'Keep the migration behind a flag',
      },
    ];

    expect(
      buildFollowUpDraftDecisions({
        v3Decisions: decisions,
        fallbackDecisions: [
          'Use REST for the rollout',
          'Send status update after launch',
        ],
      }),
    ).toEqual([
      'Use REST for the rollout (Decided by: Sarah Chen)',
      'Keep the migration behind a flag',
      'Send status update after launch',
    ]);
  });
});
