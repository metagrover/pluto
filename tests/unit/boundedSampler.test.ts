import { describe, expect, it, vi } from 'vitest';
import { startBoundedSampler } from '../../src/utils/boundedSampler';

describe('bounded sampler', () => {
  it('samples immediately and at most five times per second', () => {
    vi.useFakeTimers();
    const sample = vi.fn();

    const stop = startBoundedSampler(sample, 200);
    expect(sample).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    expect(sample).toHaveBeenCalledTimes(6);

    stop();
    vi.advanceTimersByTime(1_000);
    expect(sample).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it('rejects an invalid sampling cadence', () => {
    expect(() => startBoundedSampler(() => {}, 0)).toThrow(
      'bounded_sampler_invalid_interval',
    );
  });

  it('keeps a synthetic thirty-minute capture inside its sampling budget', () => {
    vi.useFakeTimers();
    const sample = vi.fn();
    const stop = startBoundedSampler(sample, 200);

    vi.advanceTimersByTime(30 * 60 * 1_000);
    expect(sample).toHaveBeenCalledTimes(9_001);

    stop();
    vi.useRealTimers();
  });
});
