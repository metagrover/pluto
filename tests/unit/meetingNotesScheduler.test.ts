import { expect, it, vi } from 'vitest';
import { createMeetingNotesScheduler } from '../../electron/meetingNotesScheduler';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

it('admits one primary job and selects manual-first then FIFO within class', async () => {
  const first = deferred<string>();
  const order: string[] = [];
  const scheduler = createMeetingNotesScheduler();
  const automatic1 = scheduler.enqueue({
    key: 'automatic-1',
    scheduleClass: 'automatic',
    run: async () => {
      order.push('automatic-1');
      return first.promise;
    },
  });
  const automatic2 = scheduler.enqueue({
    key: 'automatic-2',
    scheduleClass: 'automatic',
    run: async () => {
      order.push('automatic-2');
      return 'automatic-2';
    },
  });
  const manual1 = scheduler.enqueue({
    key: 'manual-1',
    scheduleClass: 'manual',
    run: async () => {
      order.push('manual-1');
      return 'manual-1';
    },
  });
  const manual2 = scheduler.enqueue({
    key: 'manual-2',
    scheduleClass: 'manual',
    run: async () => {
      order.push('manual-2');
      return 'manual-2';
    },
  });

  await vi.waitFor(() => expect(order).toEqual(['automatic-1']));
  expect(scheduler.snapshot()).toEqual([
    { key: 'automatic-1', state: 'active', position: null },
    { key: 'manual-1', state: 'queued', position: 1 },
    { key: 'manual-2', state: 'queued', position: 2 },
    { key: 'automatic-2', state: 'queued', position: 3 },
  ]);
  first.resolve('automatic-1');

  await expect(
    Promise.all([automatic1, automatic2, manual1, manual2]),
  ).resolves.toEqual(['automatic-1', 'automatic-2', 'manual-1', 'manual-2']);
  expect(order).toEqual(['automatic-1', 'manual-1', 'manual-2', 'automatic-2']);
});

it('coalesces a key, removes a cancelled queued job, and snapshots transitions', async () => {
  const active = deferred<string>();
  const snapshots: unknown[] = [];
  const scheduler = createMeetingNotesScheduler((snapshot) =>
    snapshots.push(snapshot),
  );
  const first = scheduler.enqueue({
    key: 'active',
    scheduleClass: 'automatic',
    run: () => active.promise,
  });
  const queuedRun = vi.fn(async () => 'queued');
  const queued = scheduler.enqueue({
    key: 'queued',
    scheduleClass: 'manual',
    run: queuedRun,
  });
  const coalesced = scheduler.enqueue({
    key: 'queued',
    scheduleClass: 'manual',
    run: vi.fn(async () => 'duplicate'),
  });
  const reason = new Error('cancelled');

  expect(scheduler.cancel('queued', reason)).toBe(true);
  await expect(queued).rejects.toBe(reason);
  await expect(coalesced).rejects.toBe(reason);
  expect(queuedRun).not.toHaveBeenCalled();
  expect(scheduler.snapshot()).toEqual([
    { key: 'active', state: 'active', position: null },
  ]);
  active.resolve('active');
  await expect(first).resolves.toBe('active');
  expect(snapshots.length).toBeGreaterThanOrEqual(4);
});

it('continues after a failed job without poisoning the queue', async () => {
  const scheduler = createMeetingNotesScheduler();
  const failure = new Error('failed');
  const failed = scheduler.enqueue({
    key: 'failed',
    scheduleClass: 'automatic',
    run: async () => {
      throw failure;
    },
  });
  const next = scheduler.enqueue({
    key: 'next',
    scheduleClass: 'automatic',
    run: async () => 'ok',
  });

  await expect(failed).rejects.toBe(failure);
  await expect(next).resolves.toBe('ok');
  expect(scheduler.snapshot()).toEqual([]);
});
