import { describe, expect, it } from 'vitest';

import {
  type AskPlutoBenchmarkSample,
  evaluateAskPlutoBenchmark,
  percentile,
  validateAskPlutoBenchmarkSample,
} from '../../src/services/askPlutoBenchmark';

const sample = (
  value: Pick<
    AskPlutoBenchmarkSample,
    'mode' | 'firstTokenMs' | 'totalMs' | 'qualityPassed'
  > &
    Partial<AskPlutoBenchmarkSample>,
): AskPlutoBenchmarkSample => ({
  policy: 'notes_only',
  retrievalMs: 8,
  queueMs: 4,
  generationMs: value.totalMs - 12,
  promptChars: 840,
  evidenceChars: 220,
  sourceCount: 1,
  coldStart: false,
  ...value,
});

describe('Ask Pluto benchmark evaluation', () => {
  it('accepts only content-free production-path timing samples', () => {
    const sample = {
      mode: 'fast' as const,
      policy: 'notes_only' as const,
      retrievalMs: 8,
      queueMs: 4,
      firstTokenMs: 120,
      generationMs: 300,
      totalMs: 312,
      promptChars: 840,
      evidenceChars: 220,
      sourceCount: 1,
      coldStart: false,
      qualityPassed: true,
    };

    expect(validateAskPlutoBenchmarkSample(sample)).toBe(true);
    expect(
      validateAskPlutoBenchmarkSample({
        ...sample,
        answer: 'Private meeting text',
      }),
    ).toBe(false);
    expect(
      validateAskPlutoBenchmarkSample({
        ...sample,
        prompt: 'Private prompt text',
      }),
    ).toBe(false);
  });

  it('calculates the nearest-rank percentile', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);
    expect(percentile([500, 100, 300, 200, 400], 0.5)).toBe(300);
  });

  it('passes when fast and deep visible-first-token p95 stay within contract', () => {
    expect(
      evaluateAskPlutoBenchmark([
        sample({
          mode: 'fast',
          firstTokenMs: 4100,
          totalMs: 7000,
          qualityPassed: true,
        }),
        sample({
          mode: 'fast',
          firstTokenMs: 4800,
          totalMs: 8000,
          qualityPassed: true,
        }),
        sample({
          mode: 'deep',
          firstTokenMs: 12_000,
          totalMs: 25_000,
          qualityPassed: true,
        }),
        sample({
          mode: 'deep',
          firstTokenMs: 14_500,
          totalMs: 28_000,
          qualityPassed: true,
        }),
      ]),
    ).toMatchObject({
      passed: true,
      fast: { firstTokenP95Ms: 4800, passed: true },
      deep: { firstTokenP95Ms: 14_500, passed: true },
    });
  });

  it('fails truthfully when either mode misses its first-token target', () => {
    const result = evaluateAskPlutoBenchmark([
      sample({
        mode: 'fast',
        firstTokenMs: 5100,
        totalMs: 8000,
        qualityPassed: true,
      }),
      sample({
        mode: 'deep',
        firstTokenMs: 14_000,
        totalMs: 28_000,
        qualityPassed: true,
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.fast.passed).toBe(false);
    expect(result.deep.passed).toBe(true);
  });

  it('fails when a responsive answer misses required grounded content', () => {
    const result = evaluateAskPlutoBenchmark([
      sample({
        mode: 'fast',
        firstTokenMs: 100,
        totalMs: 900,
        qualityPassed: true,
      }),
      sample({
        mode: 'deep',
        firstTokenMs: 150,
        totalMs: 1100,
        qualityPassed: false,
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.deep.qualityPassed).toBe(false);
  });
});
