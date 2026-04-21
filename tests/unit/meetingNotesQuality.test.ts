import { describe, expect, it } from 'vitest';

import {
  scoreMeetingNotesQuality,
  summarizeQualityResults,
} from '../../scripts/lib/meeting_notes_quality.js';

describe('meeting notes quality scoring', () => {
  it('scores a fixture against the human-reviewed rubric', () => {
    const fixture = {
      meeting_id: 'meeting-1',
      label: 'Quality sample',
      generated_analysis: {
        overview:
          'The team aligned on REST for the rollout and captured one concrete follow-up.',
        topics: [
          {
            title: 'API migration',
            key_points: [
              {
                speaker: 'Sarah',
                text: 'GraphQL remained only an option under discussion.',
              },
            ],
            decisions: [{ text: 'Use REST for the rollout' }],
            action_items: [{ text: 'Send rollout email', assignee: 'Sarah' }],
          },
        ],
        all_decisions: [{ text: 'Use REST for the rollout' }],
        all_action_items: [{ text: 'Send rollout email', assignee: 'Sarah' }],
        generation_metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          generation_path: 'single_pass',
          prompt_version: 'notes-v4',
        },
      },
      expected: {
        summary_must_include: ['aligned on REST'],
        decisions: {
          must_include: ['Use REST for the rollout'],
          must_exclude: ['Use GraphQL for the rollout'],
        },
        action_items: {
          must_include: [{ text: 'Send rollout email' }],
        },
        attributions: [
          { speaker: 'Sarah', text: 'GraphQL remained only an option' },
        ],
        must_include_topics: ['API migration'],
        unsupported_inference_must_exclude: ['Bob owns the rollout email'],
      },
    };

    const result = scoreMeetingNotesQuality(fixture);

    expect(result.failure_tags).toEqual([]);
    expect(result.total_score).toBe(result.max_score);
    expect(result.provider).toBe('openai');
  });

  it('summarizes repeated failure tags across results', () => {
    const summary = summarizeQualityResults([
      {
        total_score: 8,
        max_score: 12,
        failure_tags: ['decision_precision'],
      },
      {
        total_score: 10,
        max_score: 12,
        failure_tags: ['decision_precision', 'unsupported_inference_rate'],
      },
    ]);

    expect(summary.meeting_count).toBe(2);
    expect(summary.failure_counts).toEqual({
      decision_precision: 2,
      unsupported_inference_rate: 1,
    });
  });
});
