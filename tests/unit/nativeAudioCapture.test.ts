import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  canReuseRunningCaptureForProbe,
  waitForNativeAudioSpawn,
} from '../../electron/nativeAudioCapture';

describe('canReuseRunningCaptureForProbe', () => {
  it('requires a real probe when target meeting-app processes are provided', () => {
    expect(canReuseRunningCaptureForProbe(true, [123])).toBe(false);
  });

  it('reuses a running capture for an untargeted readiness probe', () => {
    expect(canReuseRunningCaptureForProbe(true)).toBe(true);
  });
});

describe('waitForNativeAudioSpawn', () => {
  it('resolves true after the child confirms it spawned', async () => {
    const child = new EventEmitter();
    const started = waitForNativeAudioSpawn(child);

    child.emit('spawn');

    await expect(started).resolves.toBe(true);
  });

  it('resolves false when the child emits an asynchronous spawn error', async () => {
    const child = new EventEmitter();
    const started = waitForNativeAudioSpawn(child);

    child.emit('error', new Error('spawn EACCES'));

    await expect(started).resolves.toBe(false);
  });
});
