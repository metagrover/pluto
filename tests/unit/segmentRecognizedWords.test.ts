import { describe, expect, it } from 'vitest';

import { segmentRecognizedWords } from '../../src/services/finalTranscription/segmentRecognizedWords';
import type { TranscriptionWord } from '../../src/services/transcription/contracts';

const word = (word: string, start: number, end: number): TranscriptionWord => ({
  word,
  start,
  end,
});

const flatten = (segments: ReturnType<typeof segmentRecognizedWords>) =>
  segments.flatMap((segment) => segment.words ?? []);

describe('segmentRecognizedWords', () => {
  it('returns an empty result for validated no-speech output', () => {
    expect(segmentRecognizedWords([], 20)).toEqual([]);
  });

  it('splits after sentence punctuation without changing words', () => {
    const words = [
      word('Hello', 0, 0.4),
      word('world.', 0.5, 1),
      word('Next', 1.1, 1.5),
      word('thought', 1.6, 2),
    ];

    const segments = segmentRecognizedWords(words, 2);

    expect(segments.map((segment) => segment.text)).toEqual([
      'Hello world.',
      'Next thought',
    ]);
    expect(flatten(segments)).toEqual(words);
  });

  it('splits at an 800ms silence gap', () => {
    const words = [word('before', 0, 0.5), word('after', 1.3, 1.8)];

    expect(segmentRecognizedWords(words, 2)).toHaveLength(2);
  });

  it('splits before exceeding 15 seconds', () => {
    const words = [
      word('start', 0, 7.5),
      word('limit', 7.5, 15),
      word('next', 15, 15.1),
    ];

    expect(
      segmentRecognizedWords(words, 16).map((segment) => segment.words?.length),
    ).toEqual([2, 1]);
  });

  it('caps a segment at 40 words', () => {
    const words = Array.from({ length: 41 }, (_, index) =>
      word(`w${index}`, index * 0.1, index * 0.1 + 0.09),
    );

    expect(
      segmentRecognizedWords(words, 5).map((segment) => segment.words?.length),
    ).toEqual([40, 1]);
    expect(flatten(segmentRecognizedWords(words, 5))).toEqual(words);
  });

  it.each([
    {
      label: 'non-finite start',
      words: [word('bad', Number.NaN, 1)],
      duration: 2,
    },
    { label: 'negative start', words: [word('bad', -1, 1)], duration: 2 },
    { label: 'end before start', words: [word('bad', 1, 0.5)], duration: 2 },
    { label: 'beyond duration', words: [word('bad', 1, 3)], duration: 2 },
    {
      label: 'overlap',
      words: [word('first', 0, 1), word('second', 0.9, 2)],
      duration: 2,
    },
    { label: 'empty text', words: [word('  ', 0, 1)], duration: 2 },
  ])('rejects $label', ({ words, duration }) => {
    expect(() => segmentRecognizedWords(words, duration)).toThrow(
      'transcription_word_timing_invalid',
    );
  });

  it('rejects invalid media duration', () => {
    expect(() => segmentRecognizedWords([], Number.POSITIVE_INFINITY)).toThrow(
      'transcription_duration_invalid',
    );
  });

  it('joins standalone punctuation without inserting a space before it', () => {
    const words = [
      word('Hello', 0, 0.5),
      word(',', 0.5, 0.6),
      word('Pluto', 0.7, 1),
    ];

    expect(segmentRecognizedWords(words, 1)[0].text).toBe('Hello, Pluto');
  });
});
