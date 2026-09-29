import { describe, expect, it } from 'vitest';
import {
  collectPersonSynthesisActivity,
  focusPersonSynthesisSources,
} from '../../electron/personSynthesisSources';

describe('person synthesis sources', () => {
  it('uses attributable notes across more than five meetings without treating attendance as activity', () => {
    const meetings = Array.from({ length: 8 }, (_, index) => ({
      id: `meeting-${index}`,
      title: `Review ${index}`,
      started_at: `2026-09-${String(20 - index).padStart(2, '0')}`,
      created_at: null,
      duration_seconds: null,
      context: null,
      evidence: index === 7 ? ('scheduled' as const) : ('confirmed' as const),
    }));
    const sources = meetings.map((meeting, index) => ({
      id: meeting.id,
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'Team review',
        topics: [
          {
            key_points: [
              {
                text: `Avery reviewed the launch handoff in meeting ${index}.`,
              },
              { text: 'Morgan owns the release schedule and budget.' },
            ],
          },
        ],
      }),
    }));

    const activity = collectPersonSynthesisActivity(
      meetings,
      sources,
      'Avery',
      [],
    );
    expect(activity).toHaveLength(7);
    expect(activity.some((item) => item.meetingId === 'meeting-6')).toBe(true);
    expect(activity.some((item) => item.meetingId === 'meeting-7')).toBe(false);
    expect(activity.every((item) => item.text.startsWith('Avery '))).toBe(true);
  });

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
