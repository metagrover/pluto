import { describe, expect, it } from 'vitest';

import {
  getChunkCoverageSeconds,
  shouldUseSystemAudioReconstructionFallback,
} from '../../src/utils/systemAudioReconstruction';

describe('systemAudioReconstruction', () => {
  it('computes merged chunk coverage across overlapping windows', () => {
    const coverage = getChunkCoverageSeconds([
      { chunkIndex: 0, path: '/tmp/a.wav', startSec: 0, endSec: 4 },
      { chunkIndex: 1, path: '/tmp/b.wav', startSec: 3.5, endSec: 8 },
      { chunkIndex: 2, path: '/tmp/c.wav', startSec: 10, endSec: 12 },
    ]);

    expect(coverage).toBeCloseTo(10, 5);
  });

  it('uses fallback when primary system session is effectively empty and chunk coverage is meaningful', () => {
    const shouldUseFallback = shouldUseSystemAudioReconstructionFallback({
      primaryDurationSec: 0.01,
      meetingDurationSec: 120,
      chunks: [
        { chunkIndex: 0, path: '/tmp/a.wav', startSec: 0, endSec: 10 },
        { chunkIndex: 1, path: '/tmp/b.wav', startSec: 15, endSec: 30 },
      ],
    });

    expect(shouldUseFallback).toBe(true);
  });

  it('does not use fallback when the primary system session already has substantial duration', () => {
    const shouldUseFallback = shouldUseSystemAudioReconstructionFallback({
      primaryDurationSec: 45,
      meetingDurationSec: 120,
      chunks: [
        { chunkIndex: 0, path: '/tmp/a.wav', startSec: 0, endSec: 10 },
        { chunkIndex: 1, path: '/tmp/b.wav', startSec: 15, endSec: 30 },
      ],
    });

    expect(shouldUseFallback).toBe(false);
  });

  it('does not use fallback when chunk coverage is too sparse', () => {
    const shouldUseFallback = shouldUseSystemAudioReconstructionFallback({
      primaryDurationSec: 0,
      meetingDurationSec: 300,
      chunks: [{ chunkIndex: 0, path: '/tmp/a.wav', startSec: 20, endSec: 22 }],
    });

    expect(shouldUseFallback).toBe(false);
  });
});
