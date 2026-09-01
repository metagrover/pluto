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

  it('keeps large temporal meeting sets inside the foreground context budget', () => {
    const context = Array.from({ length: 20 }, (_, index) => ({
      meeting_id: `meeting-${index}`,
      meeting_title: `Meeting ${index}`,
      mid: null,
      evidence_text: `Evidence ${index} ${'detail '.repeat(800)}`,
      score: 1,
      score_breakdown: {
        fts_rank: 1,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    }));

    const prompt = getAskPlutoPrompt(
      "Summarize today's meetings",
      context,
      'temporal',
    );

    expect(context.every((source) => prompt.includes(source.meeting_id))).toBe(
      true,
    );
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toContain('Write a rich, readable breakdown');
    expect(prompt).toContain(
      'Keep each sentence to one independently verifiable claim',
    );
    expect(prompt).toContain('Do not add headings');
    expect(prompt).not.toContain('Topics: None');
    expect(prompt).not.toContain('Decisions: None');
    expect(prompt).not.toContain('Action Items: None');
    expect(prompt).toContain('using one bullet for each meeting');
    expect(prompt).not.toContain(
      'Use markdown bullet points to list key items',
    );
  });

  it('asks for a useful evidence-close answer that survives local validation', () => {
    const prompt = getAskPlutoPrompt(
      'What happened in the current meeting?',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Recording review',
          mid: null,
          evidence_text:
            'The recorder consistently misses the first twenty seconds of audio.',
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
    );

    expect(prompt).toContain('Prefer wording already present in the evidence');
    expect(prompt).toContain('Split compound facts into separate sentences');
    expect(prompt).toContain('up to 4 supported points');
    expect(prompt).toContain('stay under 160 words');
    expect(prompt).toContain(
      'Include the decision, owner, deadline, or next step when it directly helps answer the question',
    );
    expect(prompt).toContain('Make every point self-contained');
    expect(prompt).toContain('"an application"');
    expect(prompt).toContain('smallest set of directly supporting sources');
  });

  it('asks for a useful per-meeting breakdown when several meetings are in scope', () => {
    const context = Array.from({ length: 3 }, (_, index) => ({
      meeting_id: `meeting-${index}`,
      meeting_title: `Review ${index}`,
      mid: null,
      evidence_text: `[Occurred]: 2026-08-2${index}\n[Transcript]: Project ${index} was reviewed.`,
      score: 1,
      score_breakdown: {
        fts_rank: 0,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    }));

    const prompt = getAskPlutoPrompt(
      'Show me a breakdown of my recent meetings',
      context,
      'factual',
    );

    expect(prompt).toContain('Cover each meeting that has meaningful evidence');
    expect(prompt).toContain('up to 260 words');
    expect(prompt).toContain('do not spend output on an uncited overview');
    expect(prompt).not.toContain('up to 4 supported points');
  });

  it('includes user corrections as constraints rather than meeting evidence', () => {
    const prompt = getAskPlutoPrompt(
      'Who owns pricing approval?',
      [],
      'factual',
      [],
      'These are explicit user corrections, not meeting evidence.\n1. Replace "Sam owns pricing approval" with "Alex owns pricing approval".',
    );

    expect(prompt).toContain('User corrections:');
    expect(prompt).toContain('Alex owns pricing approval');
    expect(prompt).toContain(
      'Never cite a user correction as meeting evidence',
    );
  });

  it('bounds each source before sending it to the synchronous chat model', () => {
    const prompt = getAskPlutoPrompt(
      'What is the main topic?',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Current meeting',
          evidence_text: `${'e'.repeat(5_000)}EVIDENCE_END`,
          mid: {
            topics: [{ name: `${'t'.repeat(1_000)}TOPIC_END` }],
            decisions: [{ description: `${'d'.repeat(1_000)}DECISION_END` }],
            action_items: [{ description: `${'a'.repeat(1_000)}ACTION_END` }],
          },
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
    );

    expect(prompt).not.toContain('EVIDENCE_END');
    expect(prompt).not.toContain('TOPIC_END');
    expect(prompt).not.toContain('DECISION_END');
    expect(prompt).not.toContain('ACTION_END');
    expect(prompt.length).toBeLessThan(8_000);
  });
});
