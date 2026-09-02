import { describe, expect, it } from 'vitest';

import { projectSpeakerLabelsOntoTranscript } from '../../src/services/finalTranscription/projectSpeakerLabelsOntoTranscript';

const segment = (
  speaker: string,
  text: string,
  words: Array<{ word: string; start: number; end: number }>,
) => ({
  id: 'original-segment',
  startTime: words[0]?.start ?? 0,
  endTime: words.at(-1)?.end ?? 0,
  speaker,
  text,
  words,
});

describe('projectSpeakerLabelsOntoTranscript', () => {
  it('changes only the speaker when exact timed channel evidence is decisive', () => {
    const original = segment('Them', 'I said this.', [
      { word: 'I', start: 1, end: 1.2 },
      { word: 'said', start: 1.2, end: 1.5 },
      { word: 'this.', start: 1.5, end: 1.8 },
    ]);

    const result = projectSpeakerLabelsOntoTranscript({
      segments: [original],
      evidenceSegments: [
        segment('Me', 'I said this.', [
          { word: 'I', start: 1.02, end: 1.22 },
          { word: 'said', start: 1.22, end: 1.52 },
          { word: 'this.', start: 1.52, end: 1.82 },
        ]),
      ],
    });

    expect(result.segments).toEqual([{ ...original, speaker: 'Me' }]);
    expect(result.relabelledSegmentCount).toBe(1);
  });

  it('keeps the original label when evidence is sparse or conflicting', () => {
    const original = segment('Them', 'Keep this sentence unchanged.', [
      { word: 'Keep', start: 3, end: 3.2 },
      { word: 'this', start: 3.2, end: 3.4 },
      { word: 'sentence', start: 3.4, end: 3.7 },
      { word: 'unchanged.', start: 3.7, end: 4 },
    ]);

    const result = projectSpeakerLabelsOntoTranscript({
      segments: [original],
      evidenceSegments: [
        segment('Me', 'Keep', [{ word: 'Keep', start: 3, end: 3.2 }]),
        segment('Unknown', 'this sentence unchanged.', [
          { word: 'this', start: 3.2, end: 3.4 },
          { word: 'sentence', start: 3.4, end: 3.7 },
          { word: 'unchanged.', start: 3.7, end: 4 },
        ]),
      ],
    });

    expect(result.segments).toEqual([original]);
    expect(result.relabelledSegmentCount).toBe(0);
  });
});
