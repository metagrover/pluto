import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcmLivenessMonitor } from '../../src/utils/pcmLiveness';

describe('PCM transport liveness', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts silence, detects later callback loss, and resumes monitoring after recovery', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const monitor = createPcmLivenessMonitor(failed, 3000);
    vi.advanceTimersByTime(2500);
    monitor.received(new Float32Array(10));
    vi.advanceTimersByTime(2999);
    expect(failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(failed).toHaveBeenCalledTimes(1);
    monitor.received(new Float32Array([0]));
    vi.advanceTimersByTime(3000);
    expect(failed).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('does not let empty or non-finite PCM hide a stall and cancels intentional stops', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const monitor = createPcmLivenessMonitor(failed, 3000);
    vi.advanceTimersByTime(2000);
    monitor.received(new Float32Array());
    monitor.received(new Float32Array([Number.NaN]));
    vi.advanceTimersByTime(1000);
    expect(failed).toHaveBeenCalledTimes(1);
    monitor.received(new Float32Array([0]));
    monitor.stop();
    monitor.received(new Float32Array([0]));
    vi.advanceTimersByTime(10000);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
