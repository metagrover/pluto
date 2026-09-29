import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundKnowledgeRefreshCoordinator } from '../../electron/backgroundKnowledgeRefresh';

describe('background knowledge refresh', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for fifteen quiet and system-idle minutes before running', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const policy = {
      systemIdleSeconds: 899,
      onBattery: false,
      thermalState: 'nominal',
      paused: false,
    } as const;
    const getPolicy = vi.fn(() => policy);
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      getPolicy,
      run,
    });

    coordinator.enqueue('meeting-1');
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    expect(run).not.toHaveBeenCalled();

    getPolicy.mockReturnValue({ ...policy, systemIdleSeconds: 900 });
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe('meeting-1');
  });

  it('requires wall power, safe thermals, and an unpaused synthesis lane', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const getPolicy = vi.fn(() => ({
      systemIdleSeconds: 1_000,
      onBattery: true,
      thermalState: 'nominal',
      paused: false,
    }));
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      quietMs: 0,
      retryMs: 1_000,
      getPolicy,
      run,
    });

    coordinator.enqueue('meeting-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    getPolicy.mockReturnValue({
      systemIdleSeconds: 1_000,
      onBattery: false,
      thermalState: 'serious',
      paused: false,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();

    getPolicy.mockReturnValue({
      systemIdleSeconds: 1_000,
      onBattery: false,
      thermalState: 'fair',
      paused: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();

    getPolicy.mockReturnValue({
      systemIdleSeconds: 1_000,
      onBattery: false,
      thermalState: 'fair',
      paused: false,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('aborts active work on foreground activity and retains it for retry', async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    const run = vi.fn((_meetingId: string, signal: AbortSignal) => {
      firstSignal = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    });
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      quietMs: 0,
      retryMs: 1_000,
      getPolicy: () => ({
        systemIdleSeconds: 1_000,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      run,
    });

    coordinator.enqueue('meeting-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    coordinator.notifyForegroundActivity();
    await Promise.resolve();
    expect(firstSignal?.aborted).toBe(true);
    expect(coordinator.snapshot().pendingMeetingIds).toEqual(['meeting-1']);
  });

  it('stops active work when capacity ceases to be safe', async () => {
    vi.useFakeTimers();
    let onBattery = false;
    let observedSignal: AbortSignal | undefined;
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      quietMs: 0,
      monitorMs: 250,
      getPolicy: () => ({
        systemIdleSeconds: 1_000,
        onBattery,
        thermalState: 'nominal',
        paused: false,
      }),
      run: async (_meetingId, signal) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    });

    coordinator.enqueue('meeting-1');
    await vi.advanceTimersByTimeAsync(0);
    onBattery = true;
    await vi.advanceTimersByTimeAsync(250);

    expect(observedSignal?.aborted).toBe(true);
    expect(coordinator.snapshot().pendingMeetingIds).toEqual(['meeting-1']);
  });

  it('deduplicates meetings and removes only successful work', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      quietMs: 0,
      getPolicy: () => ({
        systemIdleSeconds: 1_000,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      run,
    });

    coordinator.enqueue('meeting-1');
    coordinator.enqueue('meeting-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().pendingMeetingIds).toEqual([]);
  });

  it('prioritizes pending document work without bypassing the idle gate', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const coordinator = createBackgroundKnowledgeRefreshCoordinator({
      quietMs: 1_000,
      getPolicy: () => ({
        systemIdleSeconds: 2,
        onBattery: false,
        thermalState: 'nominal',
        paused: false,
      }),
      run,
    });

    coordinator.enqueue('doc:other');
    coordinator.enqueue('doc:project-atlas');
    coordinator.prioritize('doc:project-atlas');
    coordinator.prioritize('doc:missing');
    expect(coordinator.snapshot().pendingMeetingIds).toEqual([
      'doc:project-atlas',
      'doc:other',
    ]);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.mock.calls.map(([id]) => id)).toEqual([
      'doc:project-atlas',
      'doc:other',
    ]);
  });
});
