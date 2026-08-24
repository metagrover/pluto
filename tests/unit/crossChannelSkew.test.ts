import { describe, expect, it } from 'vitest';

import { estimateCrossChannelSkew } from '../../src/services/finalTranscription/crossChannelSkew';
import type { AttributionSegment } from '../../src/utils/speakerAttribution';

const makeSegment = (
  speaker: 'Me' | 'Them',
  startTime: number,
  text: string,
): AttributionSegment => {
  const tokens = text.split(' ');
  const words = tokens.map((word, index) => ({
    word,
    start: startTime + index * 0.2,
    end: startTime + index * 0.2 + 0.16,
  }));
  return {
    speaker,
    startTime,
    endTime: words.at(-1)?.end ?? startTime,
    text,
    words,
  };
};

const phrases = [
  'alpha beta gamma delta',
  'north south east west',
  'spring summer autumn winter',
  'red green blue amber',
  'mercury venus earth mars',
];

const pairedSegments = (offsets: number[]) => ({
  micSegments: offsets.map((_offset, index) =>
    makeSegment('Me', 10 + index * 20, phrases[index]),
  ),
  systemSegments: offsets.map((offset, index) =>
    makeSegment('Them', 10 + index * 20 + offset, phrases[index]),
  ),
});

describe('estimateCrossChannelSkew', () => {
  it('estimates a stable 1.2 second System delay from independent anchors', () => {
    expect(
      estimateCrossChannelSkew(pairedSegments([1.2, 1.2, 1.2, 1.2])),
    ).toEqual({
      policyVersion: 'cross_channel_skew_v1',
      offsetSeconds: 1.2,
      anchorCount: 4,
      confidence: 1,
    });
  });

  it('accepts a dominant cluster while excluding a conflicting anchor', () => {
    expect(
      estimateCrossChannelSkew(pairedSegments([1.2, 1.12, 1.28, 1.2, -1.2])),
    ).toEqual({
      policyVersion: 'cross_channel_skew_v1',
      offsetSeconds: 1.2,
      anchorCount: 4,
      confidence: 0.8,
    });
  });

  it('rejects fewer than three independent anchors', () => {
    expect(estimateCrossChannelSkew(pairedSegments([1.2, 1.2]))).toBeNull();
  });

  it('rejects repeated ambiguous n-grams', () => {
    const repeated = 'same repeated phrase here';
    expect(
      estimateCrossChannelSkew({
        micSegments: [
          makeSegment('Me', 10, repeated),
          makeSegment('Me', 30, repeated),
          makeSegment('Me', 50, repeated),
        ],
        systemSegments: [
          makeSegment('Them', 11.2, repeated),
          makeSegment('Them', 31.2, repeated),
          makeSegment('Them', 51.2, repeated),
        ],
      }),
    ).toBeNull();
  });

  it('rejects offsets outside the bounded calibration range', () => {
    expect(
      estimateCrossChannelSkew(pairedSegments([3, 3, 3, 3])),
    ).toBeNull();
  });

  it('leaves offsets within the direct matcher tolerance uncalibrated', () => {
    expect(
      estimateCrossChannelSkew(pairedSegments([0.6, 0.6, 0.6, 0.6])),
    ).toBeNull();
  });

  it('rejects a dominant cluster below seventy-five percent', () => {
    expect(
      estimateCrossChannelSkew(pairedSegments([1.2, 1.2, 1.2, -1.2, -1.2])),
    ).toBeNull();
  });
});
