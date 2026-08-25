import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioCap PCM contract', () => {
  const source = readFileSync('resources/swift/audiocap/main.swift', 'utf8');

  it('downmixes interleaved tap buffers using the stream channel count', () => {
    const callbackStart = source.indexOf('try tap.start(on: queue)');
    const callbackEnd = source.indexOf('break', callbackStart);
    const callback = source.slice(callbackStart, callbackEnd);

    expect(source).toContain(
      'let streamChannels = max(1, Int(desc.mChannelsPerFrame))',
    );
    expect(callback).toContain('if nonInterleaved');
    expect(callback).toContain(
      'let frameCount = availableSamples / streamChannels',
    );
    expect(callback).toContain('samples[(frame * streamChannels) + channel]');
  });
});
