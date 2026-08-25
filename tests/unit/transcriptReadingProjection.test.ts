import { describe, expect, it } from 'vitest';

import {
  type TranscriptReadingCandidate,
  assembleReadableTranscriptSentences,
  buildTranscriptReadingProjection,
  toStoredLiveTranscriptCandidate,
} from '../../src/utils/transcriptReadingProjection.ts';

const candidate = (
  speaker: string,
  startTime: number,
  endTime: number,
  text: string,
): TranscriptReadingCandidate => ({ speaker, startTime, endTime, text });

describe('saved transcript reading projection', () => {
  it('assembles adjacent fragments into a punctuated sentence', () => {
    expect(
      assembleReadableTranscriptSentences([
        candidate('Them', 0, 0.8, 'this is'),
        candidate('Them', 0.9, 1.8, 'one thought'),
      ]),
    ).toEqual([
      expect.objectContaining({
        speaker: 'Them',
        startTime: 0,
        endTime: 1.8,
        text: 'This is one thought.',
      }),
    ]);
  });

  it('starts a new sentence after a meaningful pause or speaker change', () => {
    expect(
      assembleReadableTranscriptSentences([
        candidate('Me', 0, 1, 'first point'),
        candidate('Me', 2.3, 3, 'second point'),
        candidate('Them', 3.1, 4, 'their answer'),
      ]).map((segment) => [segment.speaker, segment.text]),
    ).toEqual([
      ['Me', 'First point.'],
      ['Me', 'Second point.'],
      ['Them', 'Their answer.'],
    ]);
  });

  it('preserves contractions and acronyms while inferring a question mark', () => {
    expect(
      assembleReadableTranscriptSentences([
        candidate('Me', 0, 2, "can DBX confirm it isn't stale"),
      ])[0].text,
    ).toBe("Can DBX confirm it isn't stale?");
  });

  it('preserves native token boundaries when live rows become stored candidates', () => {
    expect(
      toStoredLiveTranscriptCandidate({
        id: 'live-1',
        speaker: 'Speaker',
        text: 'A complete utterance.',
        rawText: 'a complete utterance',
        source: 'system',
        timestampMs: 1_000,
        endTimestampMs: 2_400,
        confirmed: true,
      }),
    ).toMatchObject({
      id: 'live-1',
      speaker: 'Them',
      text: 'a complete utterance',
      startTime: 1,
      endTime: 2.4,
    });
  });

  it('keeps coherent live wording when the recovered decode is materially fragmented', () => {
    const recovered = [
      candidate('Them', 10, 11, 'The release'),
      candidate('Them', 11.05, 11.4, 'the release'),
      candidate('Them', 11.45, 12.2, 'is going'),
      candidate('Them', 12.25, 13, 'going live'),
    ];
    const live = [candidate('Them', 10, 13, 'The release is going live.')];
    const beforeRecovered = structuredClone(recovered);
    const beforeLive = structuredClone(live);

    const result = buildTranscriptReadingProjection({
      recoveredSegments: recovered,
      liveSegments: live,
    });

    expect(result.segments.map((segment) => segment.text)).toEqual([
      'The release is going live.',
    ]);
    expect(result.segments[0].wordingSource).toBe('live');
    expect(result.metadata).toMatchObject({
      version: 'utterance_reconciliation_v1',
      liveWordingSelections: 1,
      recoveredWordingSelections: 0,
      unresolvedSelections: 0,
    });
    expect(recovered).toEqual(beforeRecovered);
    expect(live).toEqual(beforeLive);
  });

  it('keeps recovered wording when it adds non-duplicated words', () => {
    const result = buildTranscriptReadingProjection({
      recoveredSegments: [
        candidate(
          'Me',
          20,
          24,
          'Can we review the complete release plan tomorrow?',
        ),
      ],
      liveSegments: [
        candidate('Me', 20, 24, 'Can we review the plan tomorrow?'),
      ],
    });

    expect(result.segments).toEqual([
      expect.objectContaining({
        text: 'Can we review the complete release plan tomorrow?',
        wordingSource: 'recovered',
      }),
    ]);
    expect(result.metadata.recoveredWordingSelections).toBe(1);
  });

  it('retains uncovered utterances from both candidates in time order', () => {
    const result = buildTranscriptReadingProjection({
      recoveredSegments: [candidate('Them', 30, 32, 'Recovered only.')],
      liveSegments: [candidate('Me', 35, 37, 'Live only.')],
    });

    expect(result.segments.map((segment) => segment.text)).toEqual([
      'Recovered only.',
      'Live only.',
    ]);
    expect(result.metadata).toMatchObject({
      recoveredWordingSelections: 1,
      liveWordingSelections: 1,
    });
  });

  it('uses recovered timing and speaker evidence when live wording wins', () => {
    const result = buildTranscriptReadingProjection({
      recoveredSegments: [
        candidate('Them', 40, 41, 'This'),
        candidate('Them', 41.1, 43, 'is fragmented fragmented'),
      ],
      liveSegments: [candidate('Speaker', 39.8, 43.2, 'This is coherent.')],
    });

    expect(result.segments).toEqual([
      expect.objectContaining({
        speaker: 'Them',
        startTime: 40,
        endTime: 43,
        text: 'This is coherent.',
        wordingSource: 'live',
      }),
    ]);
  });

  it('is deterministic and idempotent for an already projected candidate', () => {
    const input = [candidate('Me', 50, 53, 'One stable sentence.')];
    const first = buildTranscriptReadingProjection({
      recoveredSegments: input,
      liveSegments: input,
    });
    const second = buildTranscriptReadingProjection({
      recoveredSegments: first.segments,
      liveSegments: input,
    });

    expect(
      second.segments.map(({ text, speaker, startTime, endTime }) => ({
        text,
        speaker,
        startTime,
        endTime,
      })),
    ).toEqual(
      first.segments.map(({ text, speaker, startTime, endTime }) => ({
        text,
        speaker,
        startTime,
        endTime,
      })),
    );
  });
});
