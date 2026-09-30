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
  it('removes cancelled live acquisitions so a stopped recovery cannot steal a later lease', async () => {
    const host = makeRuntimeHost({ paths, spawn: () => new FakeChild() });
    const active = await host.acquire('live');
    const controller = new AbortController();
    const pending = host.acquire('live', controller.signal);
    const rejected = expect(pending).rejects.toThrow('parakeet_cancelled');
    controller.abort();
    await rejected;
    expect(host.diagnostics().queuedLeaseCount).toBe(0);
    await active.release();
    await expect(host.acquire('final')).resolves.toMatchObject({
      kind: 'final',
    });
    host.shutdown();
  });
  it('passes an explicitly selected live configuration to the native runtime', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const host = makeRuntimeHost({
      paths,
      spawn,
      liveConfigurationId: 'low-latency-2s',
    });
    await host.acquire('live');

    expect(spawn).toHaveBeenCalledWith(
      '/app/parakeet-runtime',
      [
        '--model-root',
        '/models/parakeet',
        '--audio-root',
        '/recordings',
        '--live-config',
        'low-latency-2s',
      ],
      expect.any(Object),
    );
    host.shutdown();
  });

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

  it('terminates child and drains host when active lease calls invalidateWorker', async () => {
    const child = new FakeChild();
    const diagnostic = vi.fn();
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      diagnostic,
    });
    const live = await host.acquire('live');
    expect(child.kill).not.toHaveBeenCalled();

    await live.invalidateWorker('parakeet_cleanup_timeout');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(diagnostic).toHaveBeenCalledWith('parakeet_cleanup_timeout');
    expect(host.diagnostics().activeLeaseCount).toBe(0);
  });

  it('does not terminate child if lease is already released or ownership has changed', async () => {
    const child1 = new FakeChild();
    const child2 = new FakeChild();
    let spawnCount = 0;
    const host = makeRuntimeHost({
      paths,
      spawn: () => (spawnCount++ === 0 ? child1 : child2),
    });
    const live1 = await host.acquire('live');
    await live1.release();

    const live2 = await host.acquire('live');
    // Stale live1 calls invalidateWorker
    await live1.invalidateWorker('stale_call');

    // child2 should NOT be killed because live1 is not the active lease
    expect(child2.kill).not.toHaveBeenCalled();
    expect(host.diagnostics().activeLeaseCount).toBe(1);

    await live2.release();
  });
});
