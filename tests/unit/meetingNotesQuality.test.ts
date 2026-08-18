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

  it('accepts faithful wording variants without requiring literal phrasing', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview:
          'Clients on the do-not-contact list are excluded prior to lead score computation.',
        topics: [
          {
            title: 'Lead Score Filtering',
            summary:
              'Client filtering and scoring excludes do-not-contact records.',
            key_points: [
              {
                speaker: 'Me',
                text: 'We need to filter out the clients first.',
              },
            ],
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: [
          'filter out do-not-contact clients before computing lead score',
        ],
        attributions: [{ speaker: 'Me', text: 'Filter out clients' }],
        must_include_topics: ['Client Filtering and Scoring'],
      },
    });

    expect(result.failure_tags).toEqual([]);
  });

  it('still rejects wording that omits the required concept', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'The rollout approach remains under discussion.',
        topics: [{ title: 'General rollout', summary: 'No choice was made.' }],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: ['aligned on REST'],
        must_include_topics: ['REST rollout'],
      },
    });

    expect(result.failure_tags).toEqual(
      expect.arrayContaining(['summary_factuality', 'critical_topic_omission']),
    );
  });

  it('rejects a semantically similar attribution assigned to the wrong speaker', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'Clients are filtered before scoring.',
        topics: [
          {
            title: 'Client filtering',
            summary: 'Client filtering happens before scoring.',
            key_points: [
              { speaker: 'Them', text: 'Filter out clients before scoring.' },
            ],
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        attributions: [{ speaker: 'Me', text: 'Filter out clients' }],
      },
    });

    expect(result.failure_tags).toContain('attribution_correctness');
  });

  it('rejects a competing technical choice with otherwise similar wording', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'The rollout approach was selected.',
        topics: [{ title: 'Rollout', summary: 'The rollout was settled.' }],
        all_decisions: [{ text: 'Use GraphQL for rollout' }],
        all_action_items: [],
      },
      expected: {
        decisions: { must_include: ['Use REST for rollout'] },
      },
    });

    expect(result.failure_tags).toContain('decision_precision');
  });

  it('rejects a negated decision when the expectation is affirmative', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'The rollout decision was discussed.',
        topics: [{ title: 'Rollout', summary: 'The rollout was discussed.' }],
        all_decisions: [{ text: 'Do not use REST for rollout' }],
        all_action_items: [],
      },
      expected: {
        decisions: { must_include: ['Use REST for rollout'] },
      },
    });

    expect(result.failure_tags).toContain('decision_precision');
  });

  it('rejects reversed filtering order and inclusion semantics', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview:
          'Include do-not-contact clients after computing the lead score.',
        topics: [
          {
            title: 'Lead scoring',
            summary:
              'Include do-not-contact clients after computing the lead score.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: [
          'filter out do-not-contact clients before computing lead score',
        ],
      },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it('rejects reversed before-and-after roles', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'Run validation before migration.',
        topics: [
          {
            title: 'Migration sequence',
            summary: 'Run validation before migration.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: ['Run migration before validation'],
      },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it('rejects reversed multiword before-and-after roles', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'Run final schema validation before database migration.',
        topics: [
          {
            title: 'Migration sequence',
            summary: 'Run final schema validation before database migration.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: [
          'Run database migration before final schema validation',
        ],
      },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it('rejects reversed before relations with single-token subjects', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'Deploy backend before testing frontend.',
        topics: [
          {
            title: 'Deployment sequence',
            summary: 'Deploy backend before testing frontend.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: ['Test frontend before deploying backend'],
      },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it('accepts an identical relation whose sides repeat a shared subject', () => {
    const summary = 'Deploy backend service before testing backend API.';
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: summary,
        topics: [{ title: 'Deployment sequence', summary }],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: [
          'Deploy backend service before testing backend API',
        ],
      },
    });

    expect(result.failure_tags).toEqual([]);
  });

  it('accepts harmless tense and plural variants in summary concepts', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'The Databricks view is loaded before downstream delivery.',
        topics: [
          {
            title: 'Databricks delivery',
            summary:
              'The Databricks view is loaded before downstream delivery.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: ['load Databricks views first'],
      },
    });

    expect(result.failure_tags).toEqual([]);
  });

  it('rejects reversed relations with different framing verbs', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview:
          'Fully complete final schema validation before carefully starting database migration.',
        topics: [
          {
            title: 'Migration sequence',
            summary:
              'Fully complete final schema validation before carefully starting database migration.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: [
          'Fully complete database migration before carefully starting final schema validation',
        ],
      },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it.each([
    ['Enable request validation', 'Disable request validation'],
    ['Allow workspace access', 'Block workspace access'],
    ['Remove the legacy endpoint', 'Retain the legacy endpoint'],
  ])('rejects reversed concepts: %s versus %s', (expected, actual) => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: actual,
        topics: [{ title: 'System change', summary: actual }],
        all_decisions: [],
        all_action_items: [],
      },
      expected: { summary_must_include: [expected] },
    });

    expect(result.failure_tags).toContain('summary_factuality');
  });

  it('does not mistake antonym substrings inside identical valid wording', () => {
    const result = scoreMeetingNotesQuality({
      generated_analysis: {
        overview: 'Allow blockchain access for the pilot.',
        topics: [
          {
            title: 'Blockchain access',
            summary: 'Allow blockchain access for the pilot.',
          },
        ],
        all_decisions: [],
        all_action_items: [],
      },
      expected: {
        summary_must_include: ['Allow blockchain access for the pilot'],
      },
    });

    expect(result.failure_tags).toEqual([]);
  });
});
