import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { NativeChildProcess } from '../../electron/transcription/nativeJsonLineProcess';
import { makeRuntimeHost } from '../../electron/transcription/parakeetRuntimeHost';

class FakeChild extends EventEmitter implements NativeChildProcess {
  readonly stdin = { write: vi.fn(() => true), end: vi.fn() };
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

const paths = {
  executablePath: '/app/parakeet-runtime',
  modelRoot: '/models/parakeet',
  audioRoot: '/recordings',
};

describe('ParakeetRuntimeHost', () => {
  it('hands the one runtime from a cancelled final lease to waiting live work', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const host = makeRuntimeHost({ paths, spawn });

    const final = await host.acquire('final');
    let liveResolved = false;
    const live = host.acquire('live').then((lease) => {
      liveResolved = true;
      return lease;
    });

    await Promise.resolve();
    expect(liveResolved).toBe(false);

    await final.cancelAndPersistForRetry();

    await expect(live).resolves.toMatchObject({ kind: 'live' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('queues final work while live owns the shared runtime', async () => {
    const host = makeRuntimeHost({ paths, spawn: () => new FakeChild() });
    const live = await host.acquire('live');
    let finalResolved = false;
    const final = host.acquire('final').then((lease) => {
      finalResolved = true;
      return lease;
    });

    await Promise.resolve();
    expect(finalResolved).toBe(false);
    expect(host.diagnostics()).toEqual({
      state: 'live',
      activeLeaseCount: 1,
      queuedLeaseCount: 1,
      durableRetryHandoffCount: 0,
    });

    await live.release();
    await expect(final).resolves.toMatchObject({ kind: 'final' });
  });

  it('persists an interrupted final request before recording receives live ownership', async () => {
    const order: string[] = [];
    const host = makeRuntimeHost({
      paths,
      spawn: () => new FakeChild(),
      persistInterruptedFinalization: async () => {
        order.push('persist');
      },
    });
    const final = await host.acquire('final');
    final.setPreemptionHandler(async () => {
      order.push('cancel-and-quiesce');
    });

    const live = await host.startRecordingLive();

    expect(order).toEqual(['cancel-and-quiesce', 'persist']);
    expect(live.kind).toBe('live');
    expect(host.diagnostics()).toMatchObject({
      state: 'live',
      durableRetryHandoffCount: 0,
    });
  });
});
