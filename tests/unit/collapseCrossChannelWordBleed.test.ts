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

const timedWords = (text: string, start: number) =>
  text.split(' ').map((word, index) => ({
    word,
    start: start + index * 0.2,
    end: start + index * 0.2 + 0.16,
  }));

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

  it('retains the mic phrase when sealed activity identifies the duplicate as local speech', () => {
    const shared = [
      { word: 'local', start: 1, end: 1.4 },
      { word: 'speaker', start: 1.5, end: 1.9 },
      { word: 'phrase', start: 2, end: 2.4 },
    ];

    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', shared)],
      systemSegments: [segment('Them', shared)],
      activityWindows: [{ speaker: 'Me', startTime: 0.8, endTime: 2.6 }],
    });

    expect(result.micSegments).toHaveLength(1);
    expect(result.systemSegments).toEqual([]);
    expect(result.droppedMicWordCount).toBe(0);
  });

  it('preserves an equal-activity word once as Unknown instead of inventing a speaker', () => {
    const shared = [
      { word: 'shared', start: 1, end: 1.4 },
      { word: 'overlap', start: 1.5, end: 1.9 },
      { word: 'phrase', start: 2, end: 2.4 },
    ];

    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', shared)],
      systemSegments: [segment('Them', shared)],
      activityWindows: [
        { speaker: 'Me', startTime: 0.8, endTime: 2.6 },
        { speaker: 'Them', startTime: 0.8, endTime: 2.6 },
      ],
    });

    expect(result.micSegments).toEqual([
      expect.objectContaining({ speaker: 'Unknown' }),
    ]);
    expect(result.systemSegments).toEqual([]);
    expect(result.unresolvedAmbiguousSeconds).toBe(0);
  });

  it('uses sealed activity only to break a word-level acoustic tie', () => {
    const shared = [
      { word: 'local', start: 1, end: 1.4 },
      { word: 'tie', start: 1.5, end: 1.9 },
      { word: 'breaker', start: 2, end: 2.4 },
    ];

    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', shared)],
      systemSegments: [segment('Them', shared)],
      activityWindows: [
        { speaker: 'Me', startTime: 0.8, endTime: 2.6 },
        { speaker: 'Them', startTime: 0.8, endTime: 2.6 },
      ],
      fallbackActivityWindows: [
        { speaker: 'Me', startTime: 0.8, endTime: 2.6 },
      ],
    });

    expect(result.micSegments).toHaveLength(1);
    expect(result.systemSegments).toEqual([]);
    expect(result.unresolvedAmbiguousSeconds).toBe(0);
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

  it('collapses duplicate phrases after calibrating stable System delay', () => {
    const phrases = [
      ['alpha beta gamma delta', 10],
      ['north south east west', 30],
      ['spring summer autumn winter', 50],
      ['remove this echo', 70],
    ] as const;
    const result = collapseCrossChannelWordBleed({
      micSegments: phrases.map(([text, start]) =>
        segment('Me', timedWords(text, start)),
      ),
      systemSegments: phrases.map(([text, start]) =>
        segment('Them', timedWords(text, start + 1.2)),
      ),
    });

    expect(result.micSegments).toEqual([]);
    expect(result.systemSegments).toHaveLength(4);
    expect(result.reconciliation).toMatchObject({
      policyVersion: 'cross_channel_skew_v1',
      skewApplied: true,
      estimatedOffsetMs: 1200,
      anchorCount: 3,
      confidence: 1,
      droppedMicWordCount: 15,
    });
  });

  it('preserves delayed repetition when only two calibration anchors exist', () => {
    const phrases = [
      ['alpha beta gamma delta', 10],
      ['north south east west', 30],
      ['yes yes yes', 50],
    ] as const;
    const result = collapseCrossChannelWordBleed({
      micSegments: phrases.map(([text, start]) =>
        segment('Me', timedWords(text, start)),
      ),
      systemSegments: phrases.map(([text, start]) =>
        segment('Them', timedWords(text, start + 1.2)),
      ),
    });

    expect(result.micSegments).toHaveLength(3);
    expect(result.reconciliation).toMatchObject({
      skewApplied: false,
      droppedMicWordCount: 0,
    });
  });

  it('removes exact same-source duplicates before reconciliation', () => {
    const duplicate = segment('Me', [{ word: 's', start: 2, end: 2.1 }]);

    const result = collapseCrossChannelWordBleed({
      micSegments: [duplicate, { ...duplicate, id: 'duplicate-copy' }],
      systemSegments: [],
    });

    expect(result.micSegments).toHaveLength(1);
    expect(result.reconciliation.droppedExactDuplicateSegmentCount).toBe(1);
  });

  it('removes only a strict one-letter mic artifact embedded in remote speech', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', [{ word: 's', start: 2, end: 2.1 }]),
        segment('Me', [{ word: 'Okay', start: 5, end: 5.3 }]),
      ],
      systemSegments: [
        segment('Them', [
          { word: 'the', start: 1, end: 1.4 },
          { word: 'rollout', start: 1.5, end: 2.4 },
          { word: 'continues', start: 2.5, end: 3.2 },
        ]),
      ],
    });

    expect(result.micSegments.map((entry) => entry.text)).toEqual(['Okay']);
    expect(result.reconciliation.droppedEmbeddedMicFragmentCount).toBe(1);
  });

  it('removes short mic bleed fragments fully embedded in a longer remote utterance', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', [{ word: 'kinda', start: 2.1, end: 2.4 }]),
        segment('Me', timedWords('run uh running uh', 5.2)),
      ],
      systemSegments: [
        segment('Them', timedWords("that's kind of still ongoing", 1.6)),
        segment(
          'Them',
          timedWords(
            'these are the entry points we are going to be running',
            4.8,
          ),
        ),
      ],
    });

    expect(result.micSegments).toEqual([]);
    expect(result.reconciliation.droppedEmbeddedMicFragmentCount).toBe(2);
  });

  it('preserves a short local turn that continues beyond remote speech', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', timedWords('Do these match the original format', 3.4)),
      ],
      systemSegments: [
        segment('Them', timedWords('this should fit in as written', 1.8)),
      ],
    });

    expect(result.micSegments).toHaveLength(1);
    expect(result.reconciliation.droppedEmbeddedMicFragmentCount).toBe(0);
  });
});
