import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcmLivenessMonitor } from '../../src/utils/pcmLiveness';

describe('PCM transport liveness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('gives native recovery a grace window and cancels fallback when PCM returns', () => {
    vi.useFakeTimers();
    const warning = vi.fn();
    const recover = vi.fn();
    const monitor = createPcmLivenessMonitor(warning, 3000, recover);
    vi.advanceTimersByTime(3000);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    monitor.received(new Float32Array([0]));
    vi.advanceTimersByTime(2999);
    expect(recover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3001);
    expect(recover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30000);
    expect(recover).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('keeps one timer for healthy traffic and never recovers after stop', () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const recover = vi.fn();
    const monitor = createPcmLivenessMonitor(vi.fn(), 3000, recover);
    const silentPcm = new Float32Array(480);
    for (let frame = 0; frame < 1000; frame += 1) {
      monitor.received(silentPcm);
      vi.advanceTimersByTime(10);
    }
    expect(timers.mock.calls.length).toBeLessThanOrEqual(5);
    expect(vi.getTimerCount()).toBe(1);
    monitor.stop();
    vi.advanceTimersByTime(10000);
    expect(recover).not.toHaveBeenCalled();
  });

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
