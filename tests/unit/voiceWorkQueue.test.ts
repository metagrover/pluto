import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithLocalInferenceCoordinator } from '../../electron/llm/inferenceCoordinator';
import {
  canRunVoiceWork,
  createVoiceWorkQueue,
} from '../../electron/voiceWorkQueue';

describe('voice work admission', () => {
  it('lets other meetings proceed when one extraction keeps failing', async () => {
    vi.useFakeTimers();
    const visited: string[] = [];
    const queue = createVoiceWorkQueue({
      canRun: () => true,
      hasMemoryCapacity: async () => true,
      run: async (id) => {
        visited.push(id);
        if (id === 'bad') throw new Error('retry');
      },
    });
    queue.enqueue('bad');
    queue.enqueue('good');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(visited.slice(0, 2)).toEqual(['bad', 'good']);
    queue.close();
  });
  afterEach(() => vi.useRealTimers());

  it('excludes only its own transcription lease while still protecting foreground work', () => {
    const policy = {
      active: true,
      runtime: {
        state: 'final' as const,
        activeLeaseCount: 1,
        queuedLeaseCount: 0,
        durableRetryHandoffCount: 0,
      },
      pauses: { transcription: 1 },
      transcriptionCount: 1,
      onBattery: false,
      thermalState: 'nominal',
      cpuLoad: 1,
      cpuCount: 8,
    };
    expect(canRunVoiceWork(policy)).toBe(true);
    for (const reason of [
      'capture',
      'downstream',
      'ask_pluto_session',
      'llm_active',
    ]) {
      expect(
        canRunVoiceWork({
          ...policy,
          pauses: { ...policy.pauses, [reason]: 1 },
        }),
      ).toBe(false);
    }
    expect(canRunVoiceWork({ ...policy, transcriptionCount: 2 })).toBe(false);
    expect(
      canRunVoiceWork({
        ...policy,
        runtime: { ...policy.runtime, state: 'live' },
      }),
    ).toBe(false);
    expect(canRunVoiceWork({ ...policy, onBattery: true })).toBe(false);
    expect(canRunVoiceWork({ ...policy, thermalState: 'serious' })).toBe(false);
    expect(canRunVoiceWork({ ...policy, active: false })).toBe(false);
  });

  it('runs without user idle, deduplicates, and defers when Parakeet is busy', async () => {
    vi.useFakeTimers();
    let available = false;
    const run = vi.fn(async () => undefined);
    const queue = createVoiceWorkQueue({
      canRun: () => available,
      hasMemoryCapacity: async () => true,
      run,
    });
    queue.enqueue('meeting');
    queue.enqueue('meeting');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    available = true;
    queue.notifyForegroundActivity();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().pendingMeetingIds).toEqual([]);
    queue.close();
  });

  it('keeps voice and Gemma exclusive and retries after foreground preemption', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let release!: () => void;
    const run = vi.fn(async (_id: string, signal: AbortSignal) => {
      events.push('voice-start');
      if (events.filter((value) => value === 'voice-start').length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener('abort', () => events.push('voice-cancel'));
        });
        events.push('voice-cleaned');
        signal.throwIfAborted();
      }
    });
    const queue = createVoiceWorkQueue({
      canRun: () => true,
      hasMemoryCapacity: async () => true,
      run,
    });
    queue.enqueue('meeting');
    await vi.advanceTimersByTimeAsync(0);
    const notes = runWithLocalInferenceCoordinator({
      key: Symbol(),
      task: 'notesWriter',
      workClass: 'manual_notes',
      run: async () => {
        events.push('notes-start');
      },
    });
    expect(events).toEqual(['voice-start', 'voice-cancel']);
    release();
    await vi.advanceTimersByTimeAsync(1);
    await notes;
    expect(events).toEqual([
      'voice-start',
      'voice-cancel',
      'voice-cleaned',
      'notes-start',
    ]);
    expect(queue.snapshot().pendingMeetingIds).toEqual(['meeting']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.snapshot().pendingMeetingIds).toEqual([]);
    queue.close();
  });

  it('cancels for capture or resource pressure and waits for cleanup before retry', async () => {
    vi.useFakeTimers();
    let available = true;
    let received: AbortSignal | undefined;
    const queue = createVoiceWorkQueue({
      canRun: () => available,
      hasMemoryCapacity: async () => true,
      run: async (_id, signal) => {
        received = signal;
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    });
    queue.enqueue('meeting');
    await vi.advanceTimersByTimeAsync(0);
    available = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(received?.aborted).toBe(true);
    expect(queue.snapshot().pendingMeetingIds).toEqual(['meeting']);
    queue.close();
  });

  it('does not start when memory is pressured or recording begins during the probe', async () => {
    vi.useFakeTimers();
    let available = true;
    const run = vi.fn();
    const queue = createVoiceWorkQueue({
      canRun: () => available,
      hasMemoryCapacity: async () => {
        available = false;
        return true;
      },
      run,
    });
    queue.enqueue('meeting');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    expect(queue.snapshot().pendingMeetingIds).toEqual(['meeting']);
    queue.close();
  });
});
