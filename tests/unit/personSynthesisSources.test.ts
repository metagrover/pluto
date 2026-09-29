import { describe, expect, it } from 'vitest';
import { focusPersonSynthesisSources } from '../../electron/personSynthesisSources';

describe('person synthesis sources', () => {
  it('excludes broad meeting topics and keeps only attributable notes', () => {
    const sources = focusPersonSynthesisSources(
      [
        {
          id: 'meeting-1',
          evidence: 'The team discussed revenue and launch timing.',
          enhanced_notes: 'A broad meeting recap.',
          user_notes: 'A note about another participant.',
          entity_names: ['Avery', 'Morgan'],
        },
        {
          id: 'meeting-2',
          evidence: 'Morgan owns the rollout.',
        },
      ],
      [
        {
          text: 'Avery reviewed the launch handoff.',
          meetingId: 'meeting-1',
          meetingTitle: 'Product review',
          occurredAt: '2026-09-12',
          evidence: 'confirmed',
        },
      ],
      'Avery',
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: 'meeting-1',
      evidence: 'Avery reviewed the launch handoff.',
      enhanced_notes: null,
      user_notes: null,
      entity_names: ['Avery'],
    });
    expect(JSON.stringify(sources)).not.toContain('revenue');
    expect(JSON.stringify(sources)).not.toContain('Morgan');
  });
});
