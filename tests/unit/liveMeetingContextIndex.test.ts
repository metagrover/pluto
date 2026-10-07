import { describe, expect, it } from 'vitest';

import {
  classifyLiveMeetingQuery,
  createLiveMeetingContextIndex,
} from '../../electron/intelligence/liveMeetingContextIndex';
import type { MeetingContextIngestionSegment } from '../../src/types/meetingContext';

const segment = (
  id: string,
  timestampMs: number,
  text: string,
  speaker = 'Avery',
  confirmed = true,
): MeetingContextIngestionSegment => ({
  id,
  speaker,
  text,
  timestampMs,
  confirmed,
});

describe('live meeting context index', () => {
  it('indexes only confirmed segments and reuses stable segment IDs', () => {
    const index = createLiveMeetingContextIndex();

    expect(
      index.ingest('meeting-1', [
        segment('one', 1_000, 'Pricing needs another pass.'),
        segment('draft', 2_000, 'Unstable words', 'Avery', false),
      ]),
    ).toBe(1);
    expect(
      index.ingest('meeting-1', [
        segment('one', 1_000, 'Pricing needs another pass.'),
      ]),
    ).toBe(0);
    expect(index.inspect('meeting-1')).toEqual({
      segmentCount: 1,
      storedCharacters: 'Pricing needs another pass.'.length,
    });
  });

  it('retains a fact after 500 characters and its neighboring explanation', () => {
    const index = createLiveMeetingContextIndex();
    const longTurn = `${'Background detail. '.repeat(40)}Morgan created the migration plan.`;
    index.ingest('meeting-1', [
      segment('long', 1000, longTurn),
      segment(
        'reason',
        2000,
        'Because testing found a serious gap, we postponed it.',
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        segment(`noise-${i}`, 3000 + i, 'An unrelated design discussion.'),
      ),
    ]);
    const selection = index.select(
      'meeting-1',
      'Who created the migration plan?',
    );
    expect(selection.segments.find((s) => s.id === 'long')?.text).toBe(
      longTurn,
    );
    expect(selection.segments.map((s) => s.id)).toContain('reason');
    expect(
      index.createCheckpoint('meeting-1')?.segments.find((s) => s.id === 'long')
        ?.text,
    ).toBe(longTurn);
  });
  it('retrieves a focused summary instead of sampling unrelated topics', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      ...Array.from({ length: 100 }, (_, i) =>
        segment(`noise-${i}`, i * 1000, 'We discussed colors and spacing.'),
      ),
      segment('pricing', 4500, 'Pricing will stay unchanged.'),
      segment(
        'pricing-reason',
        4501,
        'This avoids surprising existing customers.',
      ),
    ]);
    const selection = index.select('meeting-1', 'Summarize pricing');
    expect(selection.segments.map((s) => s.id)).toContain('pricing');
    expect(selection.segments.map((s) => s.id)).toContain('pricing-reason');
  });

  it('retrieves and samples the requested recent time range', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest(
      'meeting-1',
      Array.from({ length: 31 }, (_, item) =>
        segment(`segment-${item}`, item * 60_000, `Minute ${item} discussion`),
      ),
    );

    const selected = index.select(
      'meeting-1',
      'What was said in the last 10 minutes?',
      6,
    );

    expect(selected.intent).toBe('recent_range');
    expect(selected.temporalRange).toEqual({
      startMs: 20 * 60_000,
      endMs: 30 * 60_000,
    });
    expect(selected.segments).toHaveLength(6);
    expect(selected.segments[0].id).toBe('segment-20');
    expect(selected.segments.at(-1)?.id).toBe('segment-30');
  });

  it('uses speaker and lexical evidence while retaining recent continuity', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment('one', 1_000, 'The launch is planned for Monday.', 'Avery'),
      segment('two', 2_000, 'Pricing needs another pass.', 'Riley'),
      segment('three', 3_000, 'The launch checklist is ready.', 'Avery'),
      segment('four', 4_000, 'Let us review the design.', 'Riley'),
      segment('five', 5_000, 'I will share the document.', 'Riley'),
    ]);

    const selected = index.select(
      'meeting-1',
      'What did Avery say about the launch?',
      5,
    );

    expect(selected.intent).toBe('speaker_recall');
    expect(selected.segments.map(({ id }) => id)).toEqual([
      'one',
      'three',
      'five',
    ]);
  });

  it('classifies the user question independently from cited retrieval hints', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment('author', 1_000, 'Morgan built the plan.'),
      segment('later', 2_000, 'We will send a follow-up.'),
    ]);
    const selected = index.select(
      'meeting-1',
      'Who built the plan? A follow-up was promised.',
      2,
      'Who built the plan?',
    );
    expect(selected.intent).toBe('fact');
    expect(selected.segments.map(({ id }) => id)).toContain('author');
  });

  it('bounds retained memory by evicting the oldest evidence', () => {
    const index = createLiveMeetingContextIndex({
      maxSegments: 24,
      maxCharacters: 12_000,
    });
    index.ingest(
      'meeting-1',
      Array.from({ length: 30 }, (_, item) =>
        segment(`segment-${item}`, item, `Evidence ${item}`),
      ),
    );

    expect(index.inspect('meeting-1').segmentCount).toBe(24);
    const selected = index.select('meeting-1', 'Summarize the discussion');
    expect(selected.segments[0].id).toBe('segment-6');
  });

  it('creates a bounded checkpoint and restores it idempotently', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment('one', 1_000, 'x'.repeat(100)),
      segment('two', 2_000, 'y'.repeat(100)),
      segment('three', 3_000, 'z'.repeat(100)),
    ]);

    const saved = index.createCheckpoint(
      'meeting-1',
      '2026-09-10T10:00:00.000Z',
      210,
    );
    expect(saved?.segments.map(({ id }) => id)).toEqual(['two', 'three']);
    expect(saved?.updatedThrough).toEqual({
      segmentId: 'three',
      timestampMs: 3_000,
    });

    const restored = createLiveMeetingContextIndex();
    expect(restored.restoreCheckpoint(saved!)).toBe(true);
    expect(restored.restoreCheckpoint(saved!)).toBe(true);
    expect(restored.inspect('meeting-1').segmentCount).toBe(2);
  });

  it('provides observable speaker signals only for coaching retrieval', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment('one', 1_000, 'Can you explain that?', 'Avery'),
      segment('two', 2_000, 'x'.repeat(330), 'Avery'),
      segment('three', 3_000, 'Yes.', 'Riley'),
    ]);

    const selected = index.select(
      'meeting-1',
      'What could the speaker do better?',
    );
    expect(selected.speakerStats).toEqual([
      {
        speaker: 'Avery',
        segmentCount: 2,
        characterCount: 351,
        questionCount: 1,
        longTurnCount: 1,
      },
      {
        speaker: 'Riley',
        segmentCount: 1,
        characterCount: 4,
        questionCount: 0,
        longTurnCount: 0,
      },
    ]);
  });

  it('groups alternating generic turns by audio source rather than inferred people', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      {
        ...segment('one', 1_000, 'My first point.', 'Speaker 1'),
        source: 'mic',
      },
      {
        ...segment('two', 2_000, 'A response from the call.', 'Speaker 2'),
        source: 'system',
      },
      {
        ...segment('three', 3_000, 'My follow-up?', 'Speaker 3'),
        source: 'mic',
      },
      {
        ...segment('four', 4_000, 'Another remote response.', 'Speaker 4'),
        source: 'system',
      },
    ]);

    const selected = index.select('meeting-1', 'How am I doing?', 4);

    expect(
      index
        .createCheckpoint('meeting-1')
        ?.segments.map(({ speaker }) => speaker),
    ).toEqual(['Me', 'Call audio', 'Me', 'Call audio']);
    expect(selected.segments.map(({ speaker }) => speaker)).toEqual([
      'Me',
      'Call audio',
      'Me',
      'Call audio',
    ]);
    expect(selected.speakerStats?.map(({ speaker }) => speaker)).toEqual([
      'Call audio',
      'Me',
    ]);
  });

  it('keeps serialized crash checkpoints under the database size limit', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest(
      'meeting-1',
      Array.from({ length: 500 }, (_, item) =>
        segment(`segment-${item}`, item, 'x'.repeat(500)),
      ),
    );

    const saved = index.createCheckpoint('meeting-1');
    expect(
      new TextEncoder().encode(JSON.stringify(saved)).byteLength,
    ).toBeLessThan(300_000);
  });

  it.each([
    ['What are the decisions so far?', 'decision'],
    ['List the action items', 'action'],
    ['List the agreed action items, stated owners, and deadlines.', 'action'],
    ['Did we agree to daily meetings or asynchronous follow-up?', 'decision'],
    ['What did I miss?', 'recent_range'],
    ['What should I ask next?', 'advice'],
    ['What did we decide?', 'decision'],
    ['What are the next steps?', 'action'],
    ['Did Riley understand the proposal?', 'clarification'],
    ['What could I communicate better?', 'coaching'],
    ['How is Riley doing in this conversation?', 'coaching'],
    ['What did Riley talk about?', 'speaker_recall'],
    ['Summarize the discussion', 'meeting_summary'],
  ] as const)('routes %s without a model call', (query, expected) => {
    expect(classifyLiveMeetingQuery(query, ['Riley'])).toBe(expected);
  });

  it('includes short agreements and corrections when the meeting fits the budget', () => {
    const index = createLiveMeetingContextIndex();
    const turns = [
      segment('proposal', 1000, 'Should we use the blue design?'),
      segment('agreement', 2000, 'Yes, let us use that.'),
      segment('owner', 3000, 'Morgan will implement it.'),
      segment('qualification', 4000, 'But only after approval.'),
    ];
    index.ingest('meeting-1', turns);
    expect(
      index
        .select('meeting-1', 'What are the decisions?')
        .segments.map((s) => s.id),
    ).toEqual(turns.map((s) => s.id));
  });

  it('prioritizes distinctive decision topics and equivalent async wording', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      ...Array.from({ length: 60 }, (_, i) =>
        segment(
          `noise-${i}`,
          i * 1000,
          'We agreed to keep the current design.',
        ),
      ),
      segment(
        'cadence',
        70000,
        'We can work asynchronously instead of daily meetings.',
      ),
      segment('confirmation', 71000, 'That works for me.'),
    ]);
    const selected = index.select(
      'meeting-1',
      'Did we agree to daily meetings or async follow-up?',
      4,
    );
    expect(selected.intent).toBe('decision');
    expect(selected.segments.map((s) => s.id)).toContain('cadence');
  });

  it('retrieves early decisions and actions from long meetings using plural requests', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment('decision', 1000, 'We agreed to keep the current design.'),
      segment('action', 2000, 'Morgan will prepare the checklist.'),
      ...Array.from({ length: 80 }, (_, i) =>
        segment(`noise-${i}`, 3000 + i, 'Colors and spacing look fine.'),
      ),
    ]);
    expect(
      index
        .select('meeting-1', 'What are the decisions?')
        .segments.map((s) => s.id),
    ).toContain('decision');
    expect(
      index.select('meeting-1', 'List action items').segments.map((s) => s.id),
    ).toContain('action');
  });

  it('keeps many matching commitments ahead of unrelated neighboring turns', () => {
    const index = createLiveMeetingContextIndex();
    const turns = Array.from({ length: 10 }, (_, i) => [
      segment(`action-${i}`, i * 3000, `We will finish checklist ${i}.`),
      segment(`noise-${i}-a`, i * 3000 + 1000, 'Colors look fine.'),
      segment(`noise-${i}-b`, i * 3000 + 2000, 'Spacing looks fine.'),
    ]).flat();
    index.ingest('meeting-1', turns);
    expect(
      index
        .select('meeting-1', 'List action items')
        .segments.filter((s) => s.id.startsWith('action-')),
    ).toHaveLength(10);
  });

  it('prioritizes an earlier blocker when asking what to ask next', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      segment(
        'blocked',
        1000,
        'The migration is blocked waiting for approval.',
      ),
      ...Array.from({ length: 80 }, (_, i) =>
        segment(`noise-${i}`, 3000 + i, 'Colors and spacing look fine.'),
      ),
    ]);
    expect(
      index
        .select('meeting-1', 'What should I ask next?')
        .segments.map((s) => s.id),
    ).toContain('blocked');
  });

  it('includes salient agreements in a long catch-up instead of relying on uniform sampling', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest(
      'meeting-1',
      Array.from({ length: 100 }, (_, i) =>
        segment(
          `turn-${i}`,
          i * 1000,
          i === 37
            ? 'We agreed to keep the compact design.'
            : 'Colors and spacing look fine.',
        ),
      ),
    );
    expect(
      index.select('meeting-1', 'What did I miss?').segments.map((s) => s.id),
    ).toContain('turn-37');
    expect(
      index.select('meeting-1', 'What did I miss?', 1).segments,
    ).toHaveLength(1);
  });
});

describe('live exchange selection', () => {
  it('retains a fragmented question, confirmation and subsequent correction together', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('fragmented', [
      ...Array.from({ length: 80 }, (_, i) =>
        segment(`old-${i}`, i * 1000, 'Old unrelated discussion.'),
      ),
      segment('question', 100000, 'Should we meet daily?'),
      segment('reply-a', 101000, 'Actually asynchronous'),
      segment('reply-b', 102000, 'updates are fine.'),
      segment('confirm', 103000, 'Yes, let us do that.'),
      ...Array.from({ length: 80 }, (_, i) =>
        segment(`later-${i}`, 200000 + i * 1000, 'Later unrelated discussion.'),
      ),
    ]);
    const selected = index.select(
      'fragmented',
      'Did we agree to daily meetings or asynchronous updates?',
    );
    expect(selected.segments.map((s) => s.id)).toEqual(
      expect.arrayContaining(['question', 'reply-a', 'reply-b', 'confirm']),
    );
  });
  it('does not anchor next-question advice to an old resolved exchange', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('fragmented', [
      segment('old', 1000, 'The release is blocked waiting for approval.'),
      segment('resolved', 2000, 'That has now been approved.'),
      segment(
        'current',
        20 * 60000,
        'Which onboarding check should we run next?',
      ),
      segment(
        'current-reply',
        20 * 60000 + 1000,
        'We still need to choose the device test.',
      ),
    ]);
    expect(
      index
        .select('fragmented', 'What should I ask next?')
        .segments.map((s) => s.id),
    ).toEqual(['current', 'current-reply']);
  });
  it('limits an unspecified catch-up to recent discussion while preserving explicit ranges', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('catch-up', [
      segment('early', 0, 'We approved the catering budget.'),
      segment('middle', 6 * 60000, 'The venue booking is confirmed.'),
      segment(
        'latest',
        10 * 60000,
        'The shuttle is delayed; guests need a pickup update.',
      ),
    ]);
    expect(
      index.select('catch-up', 'What did I miss?').segments.map((s) => s.id),
    ).toEqual(['latest']);
    expect(
      index
        .select('catch-up', 'Catch me up on the last 5 minutes')
        .segments.map((s) => s.id),
    ).toEqual(['middle', 'latest']);
    expect(
      index
        .select('catch-up', 'Summarize the whole meeting')
        .segments.map((s) => s.id),
    ).toContain('early');
  });
  it('retains context for a paraphrased question with no lexical matches', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('synonyms', [
      segment('visit', 0, 'The visit remains tentative.'),
    ]);
    expect(
      index.select('synonyms', 'Appointment status?').segments.map((s) => s.id),
    ).toEqual(['visit']);
  });
  it('keeps an action correction without filling the budget with unrelated exchanges', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('action-focus', [
      segment('promise', 0, 'I will send the revised contract on Monday.'),
      segment('correction', 46000, 'Correction: Thursday, not Monday.'),
      ...Array.from({ length: 20 }, (_, i) =>
        segment(
          `other-${i}`,
          120000 + i * 60000,
          'The cafeteria serves soup and salad.',
        ),
      ),
    ]);
    const selected = index.select(
      'action-focus',
      'What action items were agreed?',
    ).segments;
    expect(selected.map((s) => s.id)).toEqual(
      expect.arrayContaining(['promise', 'correction']),
    );
    expect(selected.length).toBeLessThanOrEqual(8);
  });
  it('bounds source characters without destroying canonical IDs or timestamps', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest(
      'large',
      Array.from({ length: 1000 }, (_, i) =>
        segment(`id-${i}`, i * 1000, `Discussion ${i} ${'detail '.repeat(15)}`),
      ),
    );
    const selected = index.select('large', 'What did I miss?').segments;
    expect(
      selected.reduce((total, s) => total + s.text.length, 0),
    ).toBeLessThanOrEqual(12000);
    expect(selected.length).toBeLessThanOrEqual(512);
    expect(selected.every((s) => s.id === `id-${s.timestampMs / 1000}`)).toBe(
      true,
    );
    expect(selected.at(-1)?.id).toBe('id-999');
  });
});

it('retains explicit promises beyond the four highest-ranked exchanges', () => {
  const index = createLiveMeetingContextIndex();
  const verbs = [
    'send',
    'review',
    'arrange',
    'book',
    'upload',
    'deliver',
    'check',
  ];
  const promises = Array.from({ length: 7 }, (_, i) =>
    segment(
      `promise-${i}`,
      i * 120_000,
      `I will ${verbs[i]} the workshop document ${i}.`,
    ),
  );
  index.ingest('promises', promises);
  const selection = index.select('promises', 'List the explicit action items.');
  expect(selection.segments.map((s) => s.id)).toEqual(
    promises.map((s) => s.id),
  );
});
