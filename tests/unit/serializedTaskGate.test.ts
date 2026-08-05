import { describe, expect, it, vi } from 'vitest';
import { createSerializedTaskGate } from '../../electron/serializedTaskGate';

describe('createSerializedTaskGate', () => {
  it('coalesces concurrent work for the same key and preserves the result', async () => {
    let release!: (value: string) => void;
    const task = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const run = createSerializedTaskGate<string, string>();

    const first = run('global', task);
    const second = run('global', task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    release('saved');

    await expect(first).resolves.toBe('saved');
    await expect(second).resolves.toBe('saved');
  });

  it('serializes different keys without poisoning the queue after a failure', async () => {
    const events: string[] = [];
    let rejectFirst!: (error: Error) => void;
    const run = createSerializedTaskGate<string, number>();

    const failed = run('first', () => {
      events.push('first:start');
      return new Promise<number>((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const succeeded = run('second', async () => {
      events.push('second:start');
      return 42;
    });

    await vi.waitFor(() => expect(events).toEqual(['first:start']));
    rejectFirst(new Error('failed'));
    await expect(failed).rejects.toThrow('failed');
    await expect(succeeded).resolves.toBe(42);
    expect(events).toEqual(['first:start', 'second:start']);
  });
});
