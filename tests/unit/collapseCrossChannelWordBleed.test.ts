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
  it.each(['remote', 'missing', 'local', 'later'] as const)(
    'handles a silence-padded final System word with %s onset evidence',
    (evidence) => {
      const shared = timedWords('check the final transcript', 42);
      const micTail = {
        word: 'today',
        start: evidence === 'later' ? 46 : 42.8,
        end: evidence === 'later' ? 46.8 : 44,
      };
      const systemTail = { word: 'today', start: 42.8, end: 53 };
      const local = segment('Me', timedWords('please verify the result', 46.2));
      const system = segment('Them', [...shared, systemTail]);
      const result = collapseCrossChannelWordBleed({
        micSegments: [segment('Me', [...shared, micTail]), local],
        systemSegments: [system],
        activityWindows:
          evidence === 'missing'
            ? []
            : [
                { speaker: 'Them', startTime: 42, endTime: 43.1 },
                { speaker: 'Me', startTime: 46.2, endTime: 47 },
                ...(evidence === 'local'
                  ? [{ speaker: 'Me' as const, startTime: 42.8, endTime: 44 }]
                  : []),
              ],
      });
      expect(result.systemSegments).toEqual([system]);
      expect(result.micSegments.map((row) => row.text)).toEqual(
        evidence === 'remote' ? [local.text] : ['today', local.text],
      );
    },
  );

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

  it('removes system-explained mic echo when the two ASR transcripts disagree', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', [
          { word: 'So', start: 82.24, end: 82.6 },
          { word: 'deep', start: 84.1, end: 84.5 },
          { word: 'arch', start: 86.2, end: 86.6 },
          { word: 'forward', start: 89.1, end: 89.52 },
        ]),
      ],
      systemSegments: [
        segment(
          'Them',
          timedWords(
            'the remote speaker says a substantially different sentence that parakeet recognizes without matching the leaked microphone words',
            82.16,
          ).map((word, index, words) => ({
            ...word,
            start: 82.16 + index * (7.36 / words.length),
            end: 82.16 + (index + 1) * (7.36 / words.length) - 0.02,
          })),
        ),
      ],
      activityWindows: [{ speaker: 'Them', startTime: 82.16, endTime: 89.52 }],
    });

    expect(result.micSegments).toEqual([]);
    expect(result.systemSegments).toHaveLength(1);
    expect(result.droppedMicWordCount).toBe(4);
    expect(result.reconciliation.droppedSystemExplainedMicSegmentCount).toBe(1);
  });

  it('never drops the System counterpart of a mic word already removed by segment evidence', () => {
    const first = timedWords('we can discuss this next', 0);
    first[first.length - 1].end = 2;
    const second = [
      { word: 'please', start: 2, end: 2.4 },
      { word: 'keep', start: 2.4, end: 2.8 },
      { word: 'the', start: 2.8, end: 3.2 },
      { word: 'last', start: 3.2, end: 3.9 },
      { word: 'word', start: 3.9, end: 4 },
    ];
    const system = [segment('Them', first), segment('Them', second)];
    const result = collapseCrossChannelWordBleed({
      micSegments: [segment('Me', first), segment('Me', second)],
      systemSegments: system,
      activityWindows: [
        { speaker: 'Them', startTime: 0, endTime: 1 },
        { speaker: 'Them', startTime: 2, endTime: 3.9 },
        { speaker: 'Me', startTime: 3.9, endTime: 4 },
      ],
    });

    expect(result.reconciliation.droppedSystemExplainedMicSegmentCount).toBe(1);
    expect(result.micSegments).toEqual([]);
    expect(result.systemSegments).toEqual(system);
  });

  it('preserves a divergent mic turn when near-end evidence overlaps remote speech', () => {
    const mic = segment('Me', timedWords('my local interruption', 10.2));
    const system = segment(
      'Them',
      timedWords('a completely different remote sentence continues', 10),
    );

    const result = collapseCrossChannelWordBleed({
      micSegments: [mic],
      systemSegments: [system],
      activityWindows: [
        { speaker: 'Them', startTime: 10, endTime: 11 },
        { speaker: 'Me', startTime: 10.2, endTime: 10.76 },
      ],
    });

    expect(result.micSegments).toEqual([mic]);
    expect(result.reconciliation.droppedSystemExplainedMicSegmentCount).toBe(0);
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

  it('does not turn gaps left by removed echo words into microphone speech', () => {
    const result = collapseCrossChannelWordBleed({
      micSegments: [
        segment('Me', [
          { word: 'local', start: 0, end: 0.3 },
          { word: 'remove', start: 1, end: 1.2 },
          { word: 'this', start: 1.3, end: 1.5 },
          { word: 'echo', start: 1.6, end: 1.9 },
          { word: 'response', start: 3, end: 3.4 },
        ]),
      ],
      systemSegments: [
        segment('Them', [
          { word: 'remove', start: 1, end: 1.2 },
          { word: 'this', start: 1.3, end: 1.5 },
          { word: 'echo', start: 1.6, end: 1.9 },
        ]),
      ],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 0.3 },
        { speaker: 'Them', startTime: 1, endTime: 1.9 },
        { speaker: 'Me', startTime: 3, endTime: 3.4 },
      ],
    });

    expect(result.micSegments).toEqual([
      expect.objectContaining({
        text: 'local',
        startTime: 0,
        endTime: 0.3,
      }),
      expect.objectContaining({
        text: 'response',
        startTime: 3,
        endTime: 3.4,
      }),
    ]);
    expect(result.micSegments).not.toContainEqual(
      expect.objectContaining({ startTime: 0, endTime: 3.4 }),
    );
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
