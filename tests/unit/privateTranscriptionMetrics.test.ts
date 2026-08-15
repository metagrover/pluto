import { describe, expect, it } from 'vitest';

import {
  arePrivateReviewSourcesAligned,
  distributeTimedTokens,
  hasPrivateReviewSpeechInWindow,
  isIndependentPrivateMicSource,
  matchTimeAlignedTokens,
  multisetTokenIntersectionSize,
  normalizePrivateEvaluationFailureCode,
  normalizeTranscriptTokens,
  privateEvaluationSourceDuration,
  privateReviewTimelineDuration,
  transcriptEditDistance,
} from '../../src/services/privateTranscriptionMetrics.ts';

describe('private transcription metrics', () => {
  it('rejects a mixed artifact masquerading as the mic source', () => {
    expect(
      isIndependentPrivateMicSource('/private/mix.wav', '/private/mix.wav'),
    ).toBe(false);
    expect(
      isIndependentPrivateMicSource('/private/mic.wav', '/private/mix.wav'),
    ).toBe(true);
    expect(isIndependentPrivateMicSource(null, '/private/mix.wav')).toBe(false);
  });

  it('uses real per-source durations and rejects unaligned review media', () => {
    const sources = {
      micPath: '/private/mic.wav',
      micDurationSeconds: 100,
      systemPath: '/private/system.wav',
      systemDurationSeconds: 72,
    };
    expect(privateEvaluationSourceDuration('/private/mic.wav', sources)).toBe(
      100,
    );
    expect(
      privateEvaluationSourceDuration('/private/system.wav', sources),
    ).toBe(72);
    expect(privateEvaluationSourceDuration('/private/other.wav', sources)).toBe(
      null,
    );
    expect(arePrivateReviewSourcesAligned(100, [100, 72])).toBe(false);
    expect(arePrivateReviewSourcesAligned(100, [99.5, 100.25])).toBe(true);
    expect(privateReviewTimelineDuration(100, [99.5, 100.25])).toBe(99.5);
    expect(privateReviewTimelineDuration(100, [100, 72])).toBe(null);
    expect(
      hasPrivateReviewSpeechInWindow(
        [
          { startSeconds: 10, endSeconds: 10.5 },
          { startSeconds: 11, endSeconds: 11.5 },
          { startSeconds: 12, endSeconds: 12.5 },
        ],
        10,
        20,
      ),
    ).toBe(true);
    expect(
      hasPrivateReviewSpeechInWindow(
        [{ startSeconds: 30, endSeconds: 31 }],
        10,
        20,
      ),
    ).toBe(false);
  });

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

  it('keeps evaluator failures content-free and finite', () => {
    expect(
      normalizePrivateEvaluationFailureCode('parakeet_transcription_failed'),
    ).toBe('parakeet_transcription_failed');
    expect(
      normalizePrivateEvaluationFailureCode('parakeet_request_timeout'),
    ).toBe('parakeet_request_timeout');
    expect(normalizePrivateEvaluationFailureCode('/private/path leaked')).toBe(
      'parakeet_failure_unknown',
    );
    expect(normalizePrivateEvaluationFailureCode(undefined)).toBe(
      'parakeet_failure_unknown',
    );
  });
});
