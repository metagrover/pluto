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

  it('keeps child termination exclusive to the runtime host', async () => {
    const child = new FakeChild();
    const host = makeRuntimeHost({ paths, spawn: () => child });
    const lease = await host.acquire('final');

    expect('terminate' in host.transport).toBe(false);
    expect('process' in lease).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    host.shutdown();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
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

  it('does not grant live ownership until final cancellation has unwound', async () => {
    let releaseCancellation: (() => void) | undefined;
    const host = makeRuntimeHost({ paths, spawn: () => new FakeChild() });
    const final = await host.acquire('final');
    final.setPreemptionHandler(
      () =>
        new Promise<void>((resolve) => {
          releaseCancellation = resolve;
        }),
    );

    const queuedLive = host.acquire('live');
    let liveResolved = false;
    void queuedLive.then(() => {
      liveResolved = true;
    });

    const cancellation = final.cancelAndPersistForRetry();
    await Promise.resolve();
    await final.release();
    await Promise.resolve();
    expect(liveResolved).toBe(false);

    releaseCancellation?.();
    await cancellation;
    await expect(queuedLive).resolves.toMatchObject({ kind: 'live' });
  });

  it('preempts queued final work before granting recording live ownership', async () => {
    const persisted = vi.fn(async () => undefined);
    const host = makeRuntimeHost({
      paths,
      spawn: () => new FakeChild(),
      persistInterruptedFinalization: persisted,
    });
    const active = await host.acquire('final');
    let releaseActive: (() => void) | undefined;
    active.setPreemptionHandler(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    const queuedFinal = host.acquire('final');
    const live = host.startRecordingLive();
    await expect(queuedFinal).rejects.toThrow('parakeet_cancelled');
    releaseActive?.();
    await expect(live).resolves.toMatchObject({ kind: 'live' });
    expect(persisted).toHaveBeenCalledTimes(2);
  });

  it('keeps live priority while an active final lease unwinds', async () => {
    const persisted = vi.fn(async () => undefined);
    const host = makeRuntimeHost({
      paths,
      spawn: () => new FakeChild(),
      persistInterruptedFinalization: persisted,
    });
    const active = await host.acquire('final');
    let releaseActive: (() => void) | undefined;
    active.setPreemptionHandler(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    const live = host.startRecordingLive();
    const lateFinal = host.acquire('final');
    await expect(lateFinal).rejects.toThrow('parakeet_cancelled');
    releaseActive?.();
    await expect(live).resolves.toMatchObject({ kind: 'live' });
    expect(persisted).toHaveBeenCalledTimes(2);
  });
});
