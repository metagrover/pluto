import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  askPlutoTimeoutMs,
  runAskPlutoWithDeadline,
} from '../../electron/intelligence/askPlutoDeadline';

afterEach(() => {
  vi.useRealTimers();
});

describe('Ask Pluto request deadline', () => {
  it('uses 30 seconds except for explicit Deep mode', () => {
    expect(askPlutoTimeoutMs(undefined)).toBe(30_000);
    expect(askPlutoTimeoutMs('auto')).toBe(30_000);
    expect(askPlutoTimeoutMs('fast')).toBe(30_000);
    expect(askPlutoTimeoutMs('deep')).toBe(60_000);
  });

  it.each([30_000, 60_000])(
    'settles at %i ms when the provider never stops',
    async (limit) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const silentProvider = new Promise<string>(() => undefined);
      const response = runAskPlutoWithDeadline(
        silentProvider,
        controller,
        limit,
      );
      const rejection = expect(response).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      await vi.advanceTimersByTimeAsync(limit - 1);
      expect(controller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(controller.signal.reason).toMatchObject({
        name: 'TimeoutError',
      });
    },
  );

  it('settles immediately when the user stops a streaming provider', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const delayedProvider = new Promise<string>(() => undefined);
    const response = runAskPlutoWithDeadline(
      delayedProvider,
      controller,
      30_000,
    );
    const rejection = expect(response).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort(new DOMException('Stopped', 'AbortError'));
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a completed answer without leaving a deadline timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = runAskPlutoWithDeadline(
      Promise.resolve('verified answer'),
      controller,
      30_000,
    );
    await expect(response).resolves.toBe('verified answer');
    expect(controller.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows delayed streaming work that finishes before the deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const received: string[] = [];
    const delayedProvider = new Promise<string>((resolve) => {
      setTimeout(() => received.push('first token'), 8_000);
      setTimeout(() => resolve('verified answer'), 29_000);
    });
    const response = runAskPlutoWithDeadline(
      delayedProvider,
      controller,
      30_000,
    );
    await vi.advanceTimersByTimeAsync(29_000);
    await expect(response).resolves.toBe('verified answer');
    expect(received).toEqual(['first token']);
    expect(controller.signal.aborted).toBe(false);
  });

  it('allows local auto to select a deep model while keeping explicit fast bounded', () => {
    expect(askPlutoTimeoutMs(undefined, { isLocal: true })).toBe(120_000);
    expect(askPlutoTimeoutMs('auto', { isLocal: true })).toBe(120_000);
    expect(askPlutoTimeoutMs('fast', { isLocal: true })).toBe(90_000);
    expect(askPlutoTimeoutMs('deep', { isLocal: true })).toBe(120_000);
  });

  it('does not shorten local startup allowance when the model starts before a slow first token', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let progress: ((phase?: 'started' | 'token') => void) | undefined;
    const work = new Promise<string>((resolve) => {
      setTimeout(() => progress?.('started'), 2_000);
      setTimeout(() => progress?.('token'), 75_000);
      setTimeout(() => resolve('complete answer'), 100_000);
    });
    const response = runAskPlutoWithDeadline(
      work,
      controller,
      askPlutoTimeoutMs('auto', { isLocal: true }),
      {
        onProgressSetup: (fn) => {
          progress = fn;
        },
        idleTimeoutMs: 60_000,
      },
    );
    await vi.advanceTimersByTimeAsync(62_000);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(38_000);
    await expect(response).resolves.toBe('complete answer');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still times out a local model that starts but never produces output', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = runAskPlutoWithDeadline(
      new Promise(() => undefined),
      controller,
      120_000,
      {
        onProgressSetup: (progress) => {
          progress('started');
        },
        idleTimeoutMs: 60_000,
      },
    );
    const rejection = expect(response).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('extends the deadline when streaming tokens make active progress beyond initial timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let reportProgress: (() => void) | undefined;
    const streamingProvider = new Promise<string>((resolve) => {
      // Token at 20s
      setTimeout(() => reportProgress?.(), 20_000);
      // Token at 35s (would have exceeded original 30s deadline)
      setTimeout(() => reportProgress?.(), 35_000);
      // Completes at 45s
      setTimeout(() => resolve('complete answer'), 45_000);
    });

    const response = runAskPlutoWithDeadline(
      streamingProvider,
      controller,
      30_000,
      {
        onProgressSetup: (fn) => {
          reportProgress = fn;
        },
        idleTimeoutMs: 25_000,
      },
    );

    // Advance to 20s (token arrives, deadline extended by 25s to 45s)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(controller.signal.aborted).toBe(false);

    // Advance to 35s (second token arrives, deadline extended to 60s)
    await vi.advanceTimersByTimeAsync(15_000);
    expect(controller.signal.aborted).toBe(false);

    // Advance to 45s (resolves)
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(response).resolves.toBe('complete answer');
    expect(controller.signal.aborted).toBe(false);
  });

  it('times out if streaming stalls after initial progress', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let reportProgress: (() => void) | undefined;
    const stalledProvider = new Promise<string>(() => {
      // First token arrives at 10s
      setTimeout(() => reportProgress?.(), 10_000);
      // Then stalls forever
    });

    const response = runAskPlutoWithDeadline(
      stalledProvider,
      controller,
      30_000,
      {
        onProgressSetup: (fn) => {
          reportProgress = fn;
        },
        idleTimeoutMs: 20_000,
      },
    );

    const rejection = expect(response).rejects.toMatchObject({
      name: 'TimeoutError',
    });

    // Advance to 10s (first progress, timer reset to 20s)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.signal.aborted).toBe(false);

    // Advance by 19s (at 29s total, 19s idle)
    await vi.advanceTimersByTimeAsync(19_000);
    expect(controller.signal.aborted).toBe(false);

    // Advance by 1s (at 30s total, 20s idle - timeout fires!)
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(controller.signal.aborted).toBe(true);
  });
});
