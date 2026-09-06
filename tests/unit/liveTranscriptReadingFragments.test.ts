import { describe, expect, it } from 'vitest';
import { liveEchoOmissionFixture } from '../fixtures/liveEchoOmission';
import { liveTranscriptJumbledSourcesFixture } from '../fixtures/liveTranscriptJumbledSources';

import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import { reconcileLiveTranscriptReading } from '../../src/services/liveTranscription/liveTranscriptReconciliation';

const timedSegment = (
  id: string,
  source: 'mic' | 'system',
  tokens: string[],
  startMs = 1_000,
): LiveTranscriptSegment => ({
  id,
  source,
  speaker: source === 'mic' ? 'Me' : 'Them',
  text: tokens.join(' '),
  rawText: tokens.join(' '),
  timestampMs: startMs,
  endTimestampMs: startMs + tokens.length * 100,
  confirmed: true,
  wordTimings: tokens.map((text, index) => ({
    text,
    timestampMs: startMs + index * 100,
    endTimestampMs: startMs + (index + 1) * 100,
  })),
});

describe('live transcript reading ranges', () => {
  it('maps normalized punctuation matches back to exact original characters', () => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const first = reconcileLiveTranscriptReading({
      segments: fixture.segments,
      activityWindows: [],
      echoEvidence: fixture.echoEvidence,
    }).ranges.find(
      (range) =>
        range.sourceSegmentId === fixture.mic.id &&
        range.visibility === 'suppressed_echo',
    )!;
    expect(first).toMatchObject({
      startWord: 0,
      endWord: 12,
      startCharacter: 0,
      text: fixture.mic.text.split(/\s+/u).slice(0, 12).join(' '),
      supportingSegmentIds: ['system-1'],
      timestampMs: 0,
      endTimestampMs: 3_600,
    });
    expect(
      fixture.mic.text.slice(first.startCharacter, first.endCharacter),
    ).toBe(first.text);
    expect(first.text).toMatch(/^Alpha,/u);
    expect(first.text).toMatch(/sunrise\.$/u);
  });

  it('projects the legacy padded-EOU match as a lossless suppressed and visible partition', () => {
    const { mic, system, echoEvidence, local } = liveEchoOmissionFixture();
    const ranges = reconcileLiveTranscriptReading({
      segments: [mic, system],
      activityWindows: [],
      echoEvidence,
    }).ranges.filter((range) => range.sourceSegmentId === mic.id);
    expect(
      ranges.filter((range) => range.visibility === 'suppressed_echo'),
    ).toHaveLength(1);
    expect(
      ranges
        .filter((range) => range.visibility === 'visible')
        .map((range) => range.text)
        .join(' '),
    ).toBe(local);
    expect(ranges.map((range) => range.text).join(' ')).toBe(mic.text);
  });

  it('selects an overlapping candidate deterministically by supporting source id', () => {
    const tokens = Array.from({ length: 12 }, (_, index) => `word${index}`);
    const mic = timedSegment('mic', 'mic', tokens);
    const systemB = timedSegment('system-b', 'system', tokens);
    const systemA = timedSegment('system-a', 'system', tokens);
    const evidence = [
      {
        micStartMs: 1_000,
        micEndMs: 2_200,
        systemStartMs: 1_000,
        systemEndMs: 2_200,
      },
    ];
    const reconcile = (systems: LiveTranscriptSegment[]) =>
      reconcileLiveTranscriptReading({
        segments: [mic, ...systems],
        activityWindows: [],
        echoEvidence: evidence,
      }).ranges.find(
        (range) =>
          range.sourceSegmentId === mic.id &&
          range.visibility === 'suppressed_echo',
      )?.supportingSegmentIds;
    expect(reconcile([systemB, systemA])).toEqual(['system-a']);
    expect(reconcile([systemA, systemB])).toEqual(['system-a']);
  });

  it.each([
    [256, 'suppressed_echo'],
    [257, 'visible'],
  ] as const)(
    'keeps the exact per-row token bound at %s',
    (count, visibility) => {
      const tokens = Array.from(
        { length: count },
        (_, index) => `token${index}`,
      );
      const mic = timedSegment('mic', 'mic', tokens);
      const system = timedSegment('system', 'system', tokens);
      const ranges = reconcileLiveTranscriptReading({
        segments: [mic, system],
        activityWindows: [],
        echoEvidence: [
          {
            micStartMs: mic.timestampMs,
            micEndMs: mic.endTimestampMs!,
            systemStartMs: system.timestampMs,
            systemEndMs: system.endTimestampMs!,
          },
        ],
      }).ranges.filter((range) => range.sourceSegmentId === mic.id);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toMatchObject({
        startWord: 0,
        endWord: count,
        visibility,
      });
    },
  );

  it.each([
    ['source rows reversed', true, false],
    ['evidence reversed', false, true],
    ['both reversed', true, true],
  ])('is deterministic when %s', (_label, reverseRows, reverseEvidence) => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const ranges = reconcileLiveTranscriptReading({
      segments: reverseRows
        ? [...fixture.segments].reverse()
        : fixture.segments,
      activityWindows: [],
      echoEvidence: reverseEvidence
        ? [...fixture.echoEvidence].reverse()
        : fixture.echoEvidence,
    })
      .ranges.filter(
        (range) =>
          range.sourceSegmentId === fixture.mic.id &&
          range.visibility === 'suppressed_echo',
      )
      .map(({ startWord, endWord, supportingSegmentIds }) => ({
        startWord,
        endWord,
        supportingSegmentId: supportingSegmentIds[0],
      }));
    expect(ranges).toEqual(fixture.expectedSuppressedWordRanges);
  });
});
