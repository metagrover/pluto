import { describe, expect, it } from 'vitest';

import { collapseCrossChannelWordBleed } from '../../src/services/finalTranscription/collapseCrossChannelWordBleed.ts';
import type { AttributionSegment } from '../../src/utils/speakerAttribution.ts';

const segment = (
  speaker: 'Me' | 'Them',
  words: Array<{ word: string; start: number; end: number }>,
): AttributionSegment => ({
  speaker,
  startTime: words[0].start,
  endTime: words.at(-1)?.end ?? words[0].end,
  text: words.map((word) => word.word).join(' '),
  words,
});

describe('collapseCrossChannelWordBleed', () => {
  it('removes an exact time-aligned phrase from mic while retaining system', () => {
    const shared = [
      { word: 'shared', start: 1, end: 1.4 },
      { word: 'remote', start: 1.5, end: 1.9 },
      { word: 'phrase', start: 2, end: 2.4 },
    ];
    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', shared)],
      systemSegments: [segment('Them', shared)],
    });
    expect(result.micSegments).toEqual([]);
    expect(result.systemSegments).toHaveLength(1);
    expect(result.droppedMicWordCount).toBe(3);
  });

  it('collapses phrases even when segment boundaries differ', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', [
          { word: 'keep', start: 0, end: 0.3 },
          { word: 'one', start: 1, end: 1.2 },
          { word: 'two', start: 1.3, end: 1.5 },
        ]),
        segment('Me', [{ word: 'three', start: 1.6, end: 1.9 }]),
      ],
      systemSegments: [
        segment('Them', [
          { word: 'one', start: 1.05, end: 1.25 },
          { word: 'two', start: 1.35, end: 1.55 },
          { word: 'three', start: 1.65, end: 1.95 },
        ]),
      ],
    });
    expect(result.micSegments.map((entry) => entry.text)).toEqual(['keep']);
    expect(result.droppedMicWordCount).toBe(3);
  });

  it('preserves short coincidental overlap', () => {
    const words = [
      { word: 'yeah', start: 1, end: 1.2 },
      { word: 'okay', start: 1.3, end: 1.6 },
    ];
    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', words)],
      systemSegments: [segment('Them', words)],
    });
    expect(result.micSegments).toHaveLength(1);
    expect(result.droppedMicWordCount).toBe(0);
  });

  it('preserves matching words outside the timing tolerance', () => {
    const words = [
      { word: 'one', start: 1, end: 1.2 },
      { word: 'two', start: 1.3, end: 1.5 },
      { word: 'three', start: 1.6, end: 1.9 },
    ];
    const delayed = words.map((word) => ({
      ...word,
      start: word.start + 2,
      end: word.end + 2,
    }));
    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', words)],
      systemSegments: [segment('Them', delayed)],
    });
    expect(result.droppedMicWordCount).toBe(0);
  });
});
