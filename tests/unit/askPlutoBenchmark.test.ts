import { describe, expect, it } from 'vitest';

import {
  evaluateAskPlutoBenchmark,
  percentile,
} from '../../src/services/askPlutoBenchmark';

describe('Ask Pluto benchmark evaluation', () => {
  it('calculates the nearest-rank percentile', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);
    expect(percentile([500, 100, 300, 200, 400], 0.5)).toBe(300);
  });

  it('passes when fast and deep visible-first-token p95 stay within contract', () => {
    expect(
      evaluateAskPlutoBenchmark([
        {
          mode: 'fast',
          firstTokenMs: 4100,
          totalMs: 7000,
          qualityPassed: true,
        },
        {
          mode: 'fast',
          firstTokenMs: 4800,
          totalMs: 8000,
          qualityPassed: true,
        },
        {
          mode: 'deep',
          firstTokenMs: 12_000,
          totalMs: 25_000,
          qualityPassed: true,
        },
        {
          mode: 'deep',
          firstTokenMs: 14_500,
          totalMs: 28_000,
          qualityPassed: true,
        },
      ]),
    ).toMatchObject({
      passed: true,
      fast: { firstTokenP95Ms: 4800, passed: true },
      deep: { firstTokenP95Ms: 14_500, passed: true },
    });
  });

  it('fails truthfully when either mode misses its first-token target', () => {
    const result = evaluateAskPlutoBenchmark([
      { mode: 'fast', firstTokenMs: 5100, totalMs: 8000, qualityPassed: true },
      {
        mode: 'deep',
        firstTokenMs: 14_000,
        totalMs: 28_000,
        qualityPassed: true,
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.fast.passed).toBe(false);
    expect(result.deep.passed).toBe(true);
  });

  it('fails when a responsive answer misses required grounded content', () => {
    const result = evaluateAskPlutoBenchmark([
      { mode: 'fast', firstTokenMs: 100, totalMs: 900, qualityPassed: true },
      { mode: 'deep', firstTokenMs: 150, totalMs: 1100, qualityPassed: false },
    ]);

    expect(result.passed).toBe(false);
    expect(result.deep.qualityPassed).toBe(false);
  });
});
