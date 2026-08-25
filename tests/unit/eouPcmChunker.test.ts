import { describe, expect, it, vi } from 'vitest';

import {
  type EouRendererFrame,
  createEouPcmChunker,
} from '../../src/services/liveTranscription/eouPcmChunker';

describe('EOU PCM chunker', () => {
  it('emits exact 320 ms frames at 48 kHz and retains the tail', () => {
    const frames: EouRendererFrame[] = [];
    const chunker = createEouPcmChunker({
      source: 'mic',
      sampleRate: 48_000,
      onFrame: (frame) => frames.push(frame),
    });

    chunker.append(new Float32Array(4_096).fill(1));
    chunker.append(new Float32Array(4_096).fill(2));
    chunker.append(new Float32Array(10_240).fill(3));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      source: 'mic',
      sequence: 1,
      sampleRate: 48_000,
      audioStartSeconds: 0,
      audioEndSeconds: 0.32,
    });
    expect(frames[0]?.samples).toHaveLength(15_360);
    const tail = chunker.flush();
    expect(tail?.samples).toHaveLength(3_072);
    expect(tail?.audioStartSeconds).toBe(0.32);
    expect(tail?.audioEndSeconds).toBe(0.384);
    expect(chunker.flush()).toBeNull();
  });

  it('uses exactly 14,112 frames at 44.1 kHz', () => {
    const onFrame = vi.fn();
    const chunker = createEouPcmChunker({
      source: 'system',
      sampleRate: 44_100,
      onFrame,
    });

    chunker.append(new Float32Array(14_112));

    expect(onFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        samples: expect.objectContaining({ length: 14_112 }),
        audioEndSeconds: 0.32,
      }),
    );
  });

  it('preserves every sample across arbitrary split points', () => {
    const input = Float32Array.from({ length: 32_111 }, (_, index) => index);
    const output: number[] = [];
    const chunker = createEouPcmChunker({
      source: 'mic',
      sampleRate: 48_000,
      onFrame: ({ samples }) => output.push(...samples),
    });

    for (const [start, end] of [
      [0, 1],
      [1, 4_098],
      [4_098, 20_003],
      [20_003, input.length],
    ]) {
      chunker.append(input.slice(start, end));
    }
    chunker.flush();

    expect(output).toEqual([...input]);
  });

  it('reset discards buffered audio and restarts timing and sequence', () => {
    const onFrame = vi.fn();
    const chunker = createEouPcmChunker({
      source: 'mic',
      sampleRate: 8_000,
      onFrame,
    });
    chunker.append(new Float32Array(100));
    chunker.reset();
    chunker.append(new Float32Array(2_560));

    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: 1,
        audioStartSeconds: 0,
        audioEndSeconds: 0.32,
      }),
    );
  });

  it('rejects empty, non-finite, or sample-rate-invalid input', () => {
    expect(() =>
      createEouPcmChunker({
        source: 'mic',
        sampleRate: 7_999,
        onFrame: vi.fn(),
      }),
    ).toThrow('parakeet_request_invalid');
    const chunker = createEouPcmChunker({
      source: 'mic',
      sampleRate: 48_000,
      onFrame: vi.fn(),
    });
    expect(() => chunker.append(new Float32Array(0))).toThrow(
      'parakeet_request_invalid',
    );
    expect(() => chunker.append(new Float32Array([Number.NaN]))).toThrow(
      'parakeet_request_invalid',
    );
  });
});
