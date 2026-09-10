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
});
