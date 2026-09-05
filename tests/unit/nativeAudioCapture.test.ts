import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canReuseRunningCaptureForProbe,
  waitForNativeAudioPcm,
} from '../../electron/nativeAudioCapture';

describe('canReuseRunningCaptureForProbe', () => {
  it('requires a real probe when target meeting-app processes are provided', () => {
    expect(canReuseRunningCaptureForProbe(true, [123])).toBe(false);
  });

  it('reuses a running capture for an untargeted readiness probe', () => {
    expect(canReuseRunningCaptureForProbe(true)).toBe(true);
  });
});

describe('native PCM readiness', () => {
  afterEach(() => vi.useRealTimers());
  const child = () =>
    Object.assign(new EventEmitter(), { stdout: new EventEmitter() });

  it('waits beyond spawn and split bytes for a complete silent Float32 sample', async () => {
    const capture = child();
    const settled = vi.fn();
    const ready = waitForNativeAudioPcm(capture, 3000).then(settled);
    capture.emit('spawn');
    capture.stdout.emit('data', Buffer.alloc(3));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    capture.stdout.emit('data', Buffer.alloc(1));
    await ready;
    expect(settled).toHaveBeenCalledWith(true);
    expect(capture.stdout.listenerCount('data')).toBe(0);
  });

  it.each(['error', 'close'])(
    'fails on %s before PCM and removes listeners',
    async (event) => {
      const capture = child();
      const ready = waitForNativeAudioPcm(capture, 3000);
      capture.emit(event, new Error('capture failed'));
      await expect(ready).resolves.toBe(false);
      expect(capture.stdout.listenerCount('data')).toBe(0);
    },
  );

  it('times out without PCM even if the process spawned', async () => {
    vi.useFakeTimers();
    const capture = child();
    const ready = waitForNativeAudioPcm(capture, 3000);
    capture.emit('spawn');
    vi.advanceTimersByTime(3000);
    await expect(ready).resolves.toBe(false);
  });

  it('rejects a non-finite first PCM frame', async () => {
    const capture = child();
    const ready = waitForNativeAudioPcm(capture, 3000);
    const invalid = Buffer.alloc(4);
    invalid.writeFloatLE(Number.NaN);
    capture.stdout.emit('data', invalid);
    await expect(ready).resolves.toBe(false);
  });
});
