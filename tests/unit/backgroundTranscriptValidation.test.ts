import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundTranscriptValidationQueue,
  isBackgroundValidationAllowed,
} from '../../src/utils/backgroundTranscriptValidation';

describe('background transcript validation policy', () => {
  it('admits only AC-powered nominal or fair macOS states', () => {
    expect(
      isBackgroundValidationAllowed({
        onBattery: false,
        thermalState: 'nominal',
      }),
    ).toBe(true);
    expect(
      isBackgroundValidationAllowed({ onBattery: false, thermalState: 'fair' }),
    ).toBe(true);
    for (const thermalState of ['unknown', 'serious', 'critical'] as const) {
      expect(
        isBackgroundValidationAllowed({ onBattery: false, thermalState }),
      ).toBe(false);
    }
    expect(
      isBackgroundValidationAllowed({
        onBattery: true,
        thermalState: 'nominal',
      }),
    ).toBe(false);
  });
});

describe('BackgroundTranscriptValidationQueue', () => {
  it('waits for live-idle, enforces cadence, and bounds pending work', async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const queue = new BackgroundTranscriptValidationQueue({
      now: () => now,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        now += delayMs;
      },
      waitForLiveIdle: vi.fn(async () => true),
      getPolicy: vi.fn(async () => ({
        onBattery: false,
        thermalState: 'nominal' as const,
      })),
      minIntervalMs: 20_000,
    });
    const runs: string[] = [];
    expect(
      queue.enqueue('mic:0', async () => {
        runs.push('mic:0');
      }),
    ).toBe('started');
    await queue.whenIdle();
    expect(
      queue.enqueue('mic:1', async () => {
        runs.push('mic:1');
      }),
    ).toBe('started');
    expect(queue.enqueue('system:1', async () => undefined)).toBe(
      'skipped_backpressure',
    );
    await queue.whenIdle();
    expect(sleeps).toEqual([20_000]);
    expect(runs).toEqual(['mic:0', 'mic:1']);
  });

  it('drops denied or busy work without running it', async () => {
    const run = vi.fn(async () => undefined);
    const busyQueue = new BackgroundTranscriptValidationQueue({
      waitForLiveIdle: vi.fn(async () => false),
      getPolicy: vi.fn(async () => ({
        onBattery: false,
        thermalState: 'nominal' as const,
      })),
      minIntervalMs: 0,
    });
    busyQueue.enqueue('mic:0', run);
    await busyQueue.whenIdle();
    expect(run).not.toHaveBeenCalled();
    const hotQueue = new BackgroundTranscriptValidationQueue({
      waitForLiveIdle: vi.fn(async () => true),
      getPolicy: vi.fn(async () => ({
        onBattery: false,
        thermalState: 'serious' as const,
      })),
      minIntervalMs: 0,
    });
    hotQueue.enqueue('mic:0', run);
    await hotQueue.whenIdle();
    expect(run).not.toHaveBeenCalled();
  });

  it('aborts active work and rejects new work after close', async () => {
    let release: (() => void) | null = null;
    let observedAbort = false;
    const queue = new BackgroundTranscriptValidationQueue({
      waitForLiveIdle: async () => true,
      getPolicy: async () => ({ onBattery: false, thermalState: 'nominal' }),
      minIntervalMs: 0,
    });
    queue.enqueue(
      'mic:0',
      async (signal) =>
        await new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener('abort', () => {
            observedAbort = true;
            resolve();
          });
        }),
    );
    await vi.waitFor(() => expect(release).not.toBeNull());
    queue.close();
    await queue.whenIdle();
    expect(observedAbort).toBe(true);
    expect(queue.enqueue('mic:1', async () => undefined)).toBe('closed');
  });
});
