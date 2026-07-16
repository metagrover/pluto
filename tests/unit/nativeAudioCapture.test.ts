import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { waitForNativeAudioSpawn } from '../../electron/nativeAudioCapture';

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
