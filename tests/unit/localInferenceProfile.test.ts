import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCAL_THROUGHPUT,
  configureLocalInferenceProfileStore,
  getLocalThroughputProfile,
  getMeasuredColdPeak,
  recordLocalColdPeak,
  recordLocalThroughput,
  resetLocalInferenceProfilesForTest,
  resolveLocalThroughput,
} from '../../electron/llm/localInferenceProfile';

const sample = (
  overrides: Partial<Parameters<typeof recordLocalThroughput>[0]> = {},
) => ({
  model: 'gemma4:12b',
  digest: 'digest-a',
  placement: 'gpu:16',
  promptTokens: 4_000,
  promptMs: 50_000,
  outputTokens: 200,
  outputMs: 20_000,
  loadMs: 25_000,
  ...overrides,
});

afterEach(() => {
  resetLocalInferenceProfilesForTest();
});

describe('local inference profile', () => {
  it('starts from the conservative default until measured', () => {
    expect(resolveLocalThroughput('gemma4:12b')).toEqual({
      ...DEFAULT_LOCAL_THROUGHPUT,
      measured: false,
    });
  });

  it('adopts the first measurement and smooths later ones', () => {
    recordLocalThroughput(sample());
    expect(resolveLocalThroughput('gemma4:12b')).toMatchObject({
      promptTokensPerSecond: 80,
      outputTokensPerSecond: 10,
      coldLoadMs: 25_000,
      measured: true,
    });
    recordLocalThroughput(sample({ promptMs: 25_000 }));
    const profile = getLocalThroughputProfile('gemma4:12b:latest');
    expect(profile?.promptTokensPerSecond).toBeCloseTo(80 + 0.3 * 80, 5);
    expect(profile?.samples).toBe(2);
  });

  it('ignores evaluations too short to measure throughput', () => {
    recordLocalThroughput(
      sample({ promptTokens: 40, outputTokens: 4, loadMs: 50 }),
    );
    expect(getLocalThroughputProfile('gemma4:12b')).toBeUndefined();
  });

  it('measures prompt speed only from fresh loads, which cannot reuse a cache', () => {
    recordLocalThroughput(sample());
    recordLocalThroughput(sample({ promptMs: 2_000, loadMs: 80 }));
    expect(getLocalThroughputProfile('gemma4:12b')?.promptTokensPerSecond).toBe(
      80,
    );
  });

  it('keeps warm-request load bookkeeping out of the cold-load estimate', () => {
    recordLocalThroughput(sample());
    recordLocalThroughput(sample({ loadMs: 120 }));
    expect(getLocalThroughputProfile('gemma4:12b')?.coldLoadMs).toBe(25_000);
  });

  it('starts over when the artifact or GPU placement changes', () => {
    recordLocalThroughput(sample());
    recordLocalThroughput(
      sample({ placement: 'gpu:auto', promptMs: 10_000, loadMs: 5_000 }),
    );
    const profile = getLocalThroughputProfile('gemma4:12b');
    expect(profile).toMatchObject({
      placement: 'gpu:auto',
      promptTokensPerSecond: 400,
      coldLoadMs: 5_000,
      samples: 1,
    });
  });

  it('persists profiles in the profile directory across restarts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-profile-'));
    try {
      configureLocalInferenceProfileStore(directory);
      recordLocalThroughput(sample());
      configureLocalInferenceProfileStore(directory);
      expect(resolveLocalThroughput('gemma4:12b')).toMatchObject({
        promptTokensPerSecond: 80,
        measured: true,
      });
      fs.writeFileSync(
        path.join(directory, 'local-inference-profile.json'),
        '{not json',
      );
      configureLocalInferenceProfileStore(directory);
      expect(resolveLocalThroughput('gemma4:12b').measured).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the largest plausible cold-load peak for the same placement', () => {
    recordLocalThroughput(sample());
    const peak = (bytes: number, contextTokens = 8192, placement = 'gpu:16') =>
      recordLocalColdPeak({
        model: 'gemma4:12b',
        digest: 'digest-a',
        placement,
        peakBytes: bytes,
        contextTokens,
      });
    peak(8e9);
    peak(7e9);
    peak(200e6);
    expect(getMeasuredColdPeak('gemma4:12b', 'digest-a', 'gpu:16')).toEqual({
      bytes: 8e9,
      contextTokens: 8192,
    });
    // Another placement or artifact does not borrow this measurement.
    expect(
      getMeasuredColdPeak('gemma4:12b', 'digest-a', 'gpu:auto'),
    ).toBeUndefined();
    expect(
      getMeasuredColdPeak('gemma4:12b', 'digest-b', 'gpu:16'),
    ).toBeUndefined();
    // Later throughput samples keep the recorded peak.
    recordLocalThroughput(sample());
    expect(getMeasuredColdPeak('gemma4:12b', 'digest-a', 'gpu:16')?.bytes).toBe(
      8e9,
    );
  });
});
