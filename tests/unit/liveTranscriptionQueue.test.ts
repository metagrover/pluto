import { describe, expect, it, vi } from 'vitest';

import { LiveTranscriptionQueue } from '../../src/utils/liveTranscriptionQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('LiveTranscriptionQueue', () => {
  it('keeps one active job and only the newest queued interval', async () => {
    const active = deferred();
    const events: string[] = [];
    const queue = new LiveTranscriptionQueue();

    expect(
      queue.enqueue(0, async () => {
        events.push('start-0');
        await active.promise;
        events.push('finish-0');
      }),
    ).toBe('started');
    expect(queue.enqueue(1, async () => events.push('run-1'))).toBe('queued');
    expect(queue.enqueue(2, async () => events.push('run-2'))).toBe('replaced');
    expect(queue.snapshot()).toEqual({
      activeSequence: 0,
      queuedSequence: 2,
      replacedCount: 1,
      accepting: true,
    });

    active.resolve();
    await queue.whenIdle();

    expect(events).toEqual(['start-0', 'finish-0', 'run-2']);
  });

  it('closes admission and discards queued work without waiting for it to start', async () => {
    const active = deferred();
    const queued = vi.fn(async () => undefined);
    const queue = new LiveTranscriptionQueue();

    queue.enqueue(4, async () => active.promise);
    queue.enqueue(5, queued);

    expect(queue.close()).toEqual({ discardedSequence: 5 });
    expect(queue.enqueue(6, queued)).toBe('closed');
    active.resolve();
    await queue.whenIdle();

    expect(queued).not.toHaveBeenCalled();
    expect(queue.snapshot()).toMatchObject({
      activeSequence: null,
      queuedSequence: null,
      accepting: false,
    });
  });

  it('can close admission while draining the newest queued interval', async () => {
    const active = deferred();
    const events: string[] = [];
    const queue = new LiveTranscriptionQueue();

    queue.enqueue(8, async () => {
      events.push('start-8');
      await active.promise;
      events.push('finish-8');
    });
    queue.enqueue(9, async () => events.push('run-9'));

    expect(queue.close({ drainQueued: true })).toEqual({
      discardedSequence: null,
    });
    expect(queue.enqueue(10, async () => events.push('run-10'))).toBe('closed');

    active.resolve();
    await queue.whenIdle();

    expect(events).toEqual(['start-8', 'finish-8', 'run-9']);
  });

  it('can discard retained stop-boundary work after a drain timeout', async () => {
    const active = deferred();
    const queued = vi.fn(async () => undefined);
    const queue = new LiveTranscriptionQueue();

    queue.enqueue(11, async () => active.promise);
    queue.enqueue(12, queued);
    queue.close({ drainQueued: true });

    expect(queue.close()).toEqual({ discardedSequence: 12 });
    active.resolve();
    await queue.whenIdle();

    expect(queued).not.toHaveBeenCalled();
  });

  it('releases ownership after an active job fails', async () => {
    const onError = vi.fn();
    const queue = new LiveTranscriptionQueue({ onError });

    queue.enqueue(7, async () => {
      throw new Error('transcription failed');
    });
    await queue.whenIdle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().activeSequence).toBeNull();
  });
});
