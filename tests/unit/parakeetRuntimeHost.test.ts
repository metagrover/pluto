import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  runWithLocalInferenceCoordinator,
  runWithNativeInferenceCoordinator,
} from '../../electron/llm/inferenceCoordinator';
import type { NativeChildProcess } from '../../electron/transcription/nativeJsonLineProcess';
import { makeRuntimeHost } from '../../electron/transcription/parakeetRuntimeHost';

class FakeChild extends EventEmitter implements NativeChildProcess {
  readonly stdin = { write: vi.fn(() => true), end: vi.fn() };
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  });
}

const paths = {
  executablePath: '/app/parakeet-runtime',
  modelRoot: '/models/parakeet',
  audioRoot: '/recordings',
};

describe('ParakeetRuntimeHost', () => {
  it('keeps model admission blocked until the native worker has actually exited', async () => {
    const child = new FakeChild();
    child.kill.mockImplementation(() => true);
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      runExclusive: (run, signal) =>
        runWithNativeInferenceCoordinator(run, signal),
    });
    const lease = await host.acquire('final');
    const next = vi.fn(async () => 'notes');
    const notes = runWithLocalInferenceCoordinator({
      key: Symbol('after-native'),
      task: 'notesWriter',
      run: async () => {
        await host.unloadIdleModels();
        return next();
      },
    });
    const released = lease.release();
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(next).not.toHaveBeenCalled();
    child.emit('exit', 0);
    await released;
    await expect(notes).resolves.toBe('notes');
    host.shutdown();
  });

  it('refuses to unload a worker while native inference is active', async () => {
    const child = new FakeChild();
    const host = makeRuntimeHost({ paths, spawn: () => child });
    const lease = await host.acquire('final');
    await expect(host.unloadIdleModels()).rejects.toThrow(
      'parakeet_runtime_busy',
    );
    expect(child.kill).not.toHaveBeenCalled();
    await lease.release();
    host.shutdown();
  });

  it('preserves a pending live lease when an older idle worker exits during text handoff', async () => {
    const first = new FakeChild();
    first.kill.mockImplementation(() => true);
    const second = new FakeChild();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const host = makeRuntimeHost({
      paths,
      spawn,
      runExclusive: (run, signal) =>
        runWithNativeInferenceCoordinator(run, signal),
    });
    const initial = await host.acquire('final');
    await initial.release();
    const generate = vi.fn();
    const text = runWithLocalInferenceCoordinator({
      key: Symbol('handoff-race'),
      task: 'notesWriter',
      run: async (signal) => {
        await host.unloadIdleModels();
        signal.throwIfAborted();
        generate();
      },
    });
    const cancelled = expect(text).rejects.toThrow('foreground_preempted');
    await vi.waitFor(() => expect(first.kill).toHaveBeenCalledWith('SIGTERM'));
    const live = host.acquire('live');
    first.emit('exit', 0);
    await cancelled;
    const lease = await live;
    expect(generate).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
    await lease.release();
    host.shutdown();
  });

  it('reuses voice admission without nesting the same serialized gate', async () => {
    const host = makeRuntimeHost({
      paths,
      spawn: () => new FakeChild(),
      runExclusive: (run, signal) =>
        runWithNativeInferenceCoordinator(run, signal),
    });
    const voice = runWithLocalInferenceCoordinator({
      key: Symbol('voice'),
      task: 'speaker',
      workClass: 'background',
      run: async (signal) => {
        const lease = await host.acquire('final', signal);
        await lease.release();
        return 'voice';
      },
    });
    await expect(voice).resolves.toBe('voice');
    host.shutdown();
  });

  it('settles generation before native admission and holds the gate for the complete lease', async () => {
    let settleGeneration!: () => void;
    let generationSignal!: AbortSignal;
    const generation = runWithLocalInferenceCoordinator({
      key: Symbol('chat'),
      task: 'askPluto',
      run: (signal) =>
        new Promise<void>((resolve) => {
          generationSignal = signal;
          settleGeneration = resolve;
        }),
    });
    await vi.waitFor(() => expect(settleGeneration).toBeDefined());
    const spawn = vi.fn(() => new FakeChild());
    const host = makeRuntimeHost({
      paths,
      spawn,
      runExclusive: (run, signal) =>
        runWithNativeInferenceCoordinator(run, signal),
    });
    expect(host.tryAcquire('final')).toBeNull();
    const native = host.acquire('final');
    expect(generationSignal.aborted).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    settleGeneration();
    await generation;
    const lease = await native;
    const nextRun = vi.fn(async () => 'notes');
    const notes = runWithLocalInferenceCoordinator({
      key: Symbol('notes'),
      task: 'notesWriter',
      run: nextRun,
    });
    expect(nextRun).not.toHaveBeenCalled();
    await lease.release();
    await expect(notes).resolves.toBe('notes');
    host.shutdown();
  });

  it.each(['cancel', 'shutdown'] as const)(
    'does not start a native process after pending admission is stopped: %s',
    async (reason) => {
      let admit!: () => void;
      const waiting = new Promise<void>((resolve) => {
        admit = resolve;
      });
      const spawn = vi.fn(() => new FakeChild());
      const host = makeRuntimeHost({
        paths,
        spawn,
        runExclusive: async (run) => {
          await waiting;
          await run();
        },
      });
      const controller = new AbortController();
      const native = host.acquire('final', controller.signal);
      const rejected = expect(native).rejects.toThrow(
        reason === 'cancel' ? 'parakeet_cancelled' : 'parakeet_runtime_closed',
      );
      if (reason === 'cancel') controller.abort();
      else host.shutdown();
      await rejected;
      admit();
      await Promise.resolve();
      await Promise.resolve();
      expect(spawn).not.toHaveBeenCalled();
      expect(host.diagnostics().activeLeaseCount).toBe(0);
      host.shutdown();
    },
  );

  it('rejects final work preempted by recording while waiting for admission', async () => {
    let admit!: () => void;
    const waiting = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const persist = vi.fn(async () => {});
    const spawn = vi.fn(() => new FakeChild());
    const host = makeRuntimeHost({
      paths,
      spawn,
      persistInterruptedFinalization: persist,
      runExclusive: async (run) => {
        await waiting;
        await run();
      },
    });
    const rejected = vi.fn();
    const final = host.acquire('final').catch(rejected);
    try {
      const live = host.startRecordingLive();
      await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
      admit();
      const lease = await live;
      await vi.waitFor(() =>
        expect(rejected).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'parakeet_cancelled' }),
        ),
      );
      await final;
      expect(spawn).toHaveBeenCalledOnce();
      await lease.release();
    } finally {
      admit();
      host.shutdown();
    }
  });

  it('releases shared admission when the native worker fails', async () => {
    const child = new FakeChild();
    const host = makeRuntimeHost({
      paths,
      spawn: () => child,
      runExclusive: (run, signal) =>
        runWithNativeInferenceCoordinator(run, signal),
    });
    await host.acquire('final');
    const run = vi.fn(async () => 'answer');
    const answer = runWithLocalInferenceCoordinator({
      key: Symbol('chat'),
      task: 'askPluto',
      run,
    });
    expect(run).not.toHaveBeenCalled();
    child.emit('exit', 1);
    await expect(answer).resolves.toBe('answer');
    host.shutdown();
  });

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
