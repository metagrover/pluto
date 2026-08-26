import { describe, expect, it } from 'vitest';

import {
  DownloadSpeedTracker,
  formatDownloadProgress,
} from '../../src/services/modelDownloadProgress';

describe('model download progress', () => {
  it('formats real downloaded bytes, total size, and transfer speed', () => {
    expect(
      formatDownloadProgress({
        phase: 'downloading',
        downloadedBytes: 438_000_000,
        totalBytes: 986_000_000,
        bytesPerSecond: 18_400_000,
      }),
    ).toBe('438 MB of 986 MB · 18.4 MB/s');
  });

  it('labels sizing and verification without inventing a download speed', () => {
    expect(
      formatDownloadProgress({
        phase: 'sizing',
        downloadedBytes: 0,
        totalBytes: 0,
        bytesPerSecond: null,
      }),
    ).toBe('Calculating download size');
    expect(
      formatDownloadProgress({
        phase: 'loading',
        downloadedBytes: 835_000_000,
        totalBytes: 986_000_000,
        bytesPerSecond: null,
      }),
    ).toBe('835 MB of 986 MB downloaded · Loading models');
    expect(
      formatDownloadProgress({
        phase: 'verifying',
        downloadedBytes: 986_000_000,
        totalBytes: 986_000_000,
        bytesPerSecond: null,
      }),
    ).toBe('986 MB downloaded · Verifying models');
  });

  it('uses a short rolling window and resets when bytes move backward', () => {
    const tracker = new DownloadSpeedTracker(3_000);

    expect(tracker.update(0, 0)).toBeNull();
    expect(tracker.update(10_000_000, 1_000)).toBe(10_000_000);
    expect(tracker.update(40_000_000, 4_000)).toBe(10_000_000);
    expect(tracker.update(2_000_000, 5_000)).toBeNull();
  });
});
