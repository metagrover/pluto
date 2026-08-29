import { describe, expect, it, vi } from 'vitest';
import { createSerializedTaskGate } from '../../electron/serializedTaskGate';

describe('createSerializedTaskGate', () => {
  it('cancels queued work before the active task finishes and permits retry', async () => {
    const run = createSerializedTaskGate<string, string>();
    let release!: () => void;
    const active = run(
      'active',
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    const controller = new AbortController();
    const task = vi.fn(async () => 'expired');
    const pending = run('review', task, 5, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('deadline');
    controller.abort(new Error('deadline'));
    await rejected;
    expect(task).not.toHaveBeenCalled();
    const retry = run('review', async () => 'retry', 5);
    release();
    await active;
    await expect(retry).resolves.toBe('retry');
  });

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

  it('runs higher-priority meeting work before queued maintenance work', async () => {
    const events: string[] = [];
    let releaseActive!: () => void;
    const run = createSerializedTaskGate<string, string>();

    const active = run('active', () => {
      events.push('active');
      return new Promise<string>((resolve) => {
        releaseActive = () => resolve('active');
      });
    });
    const maintenance = run(
      'maintenance',
      async () => {
        events.push('maintenance');
        return 'maintenance';
      },
      0,
    );
    const meeting = run(
      'meeting',
      async () => {
        events.push('meeting');
        return 'meeting';
      },
      10,
    );

    await vi.waitFor(() => expect(events).toEqual(['active']));
    releaseActive();
    await Promise.all([active, maintenance, meeting]);
    expect(events).toEqual(['active', 'meeting', 'maintenance']);
  });

  it('lets a multi-pass high-priority workflow enqueue its next pass before maintenance', async () => {
    const events: string[] = [];
    const run = createSerializedTaskGate<string, string>();

    const firstPass = run(
      'meeting-pass-1',
      async () => {
        events.push('meeting-pass-1');
        return 'first';
      },
      10,
    );
    const maintenance = run(
      'maintenance',
      async () => {
        events.push('maintenance');
        return 'maintenance';
      },
      0,
    );
    await firstPass;
    const secondPass = run(
      'meeting-pass-2',
      async () => {
        events.push('meeting-pass-2');
        return 'second';
      },
      10,
    );

    await Promise.all([maintenance, secondPass]);
    expect(events).toEqual(['meeting-pass-1', 'meeting-pass-2', 'maintenance']);
  });

  it('cooperatively preempts active maintenance before foreground work starts', async () => {
    const events: string[] = [];
    const run = createSerializedTaskGate<string, string>();
    const maintenance = run(
      'maintenance',
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          events.push('maintenance:start');
          signal.addEventListener(
            'abort',
            () => {
              events.push('maintenance:settled');
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      0,
      { preemptible: true },
    );
    await vi.waitFor(() => expect(events).toEqual(['maintenance:start']));
    const maintenanceOutcome = expect(maintenance).rejects.toMatchObject({
      name: 'AbortError',
      message: 'foreground_preempted',
    });

    const foreground = run(
      'foreground',
      async () => {
        events.push('foreground:start');
        return 'done';
      },
      10,
    );

    await maintenanceOutcome;
    await expect(foreground).resolves.toBe('done');
    expect(events).toEqual([
      'maintenance:start',
      'maintenance:settled',
      'foreground:start',
    ]);
  });
});
