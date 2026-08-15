import { describe, expect, it } from 'vitest';

import {
  distributeTimedTokens,
  matchTimeAlignedTokens,
  multisetTokenIntersectionSize,
  normalizeTranscriptTokens,
  transcriptEditDistance,
} from '../../src/services/privateTranscriptionMetrics.ts';

describe('private transcription metrics', () => {
  it('normalizes and compares transcript tokens deterministically', () => {
    const reference = normalizeTranscriptTokens("Hello, Pluto's world!");
    const candidate = normalizeTranscriptTokens("hello pluto's new world");
    expect(reference).toEqual(['hello', "pluto's", 'world']);
    expect(transcriptEditDistance(reference, candidate)).toBe(1);
    expect(multisetTokenIntersectionSize(reference, candidate)).toBe(3);
  });

  it('distributes segment text across its time envelope', () => {
    expect(
      distributeTimedTokens([{ text: 'one two', start: 10, end: 12 }]),
    ).toEqual([
      { token: 'one', at: 10.5 },
      { token: 'two', at: 11.5 },
    ]);
  });

  it('matches simultaneous words independent of channel ordering', () => {
    const result = matchTimeAlignedTokens(
      [
        { token: 'local', at: 4 },
        { token: 'remote', at: 4.2 },
      ],
      [
        { token: 'remote', at: 4.1 },
        { token: 'local', at: 4.3 },
        { token: 'extra', at: 4.4 },
      ],
      0.5,
    );
    expect(result).toEqual({ matched: 2, precision: 2 / 3, recall: 1 });
  });

  it('does not match the same candidate token twice', () => {
    const result = matchTimeAlignedTokens(
      [
        { token: 'yes', at: 1 },
        { token: 'yes', at: 1.1 },
      ],
      [{ token: 'yes', at: 1.05 }],
      0.2,
    );
    expect(result.matched).toBe(1);
  });
});
