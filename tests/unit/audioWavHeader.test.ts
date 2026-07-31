import { describe, expect, it } from 'vitest';

import {
  createWavBlob,
  decodeFloat32PcmChunk,
  isCaptureChunkPairReady,
  resolvePcmTimelineSampleRate,
  trimPcmLeadingOverflow,
} from '../../src/utils/audio';

const readWavChannelCount = async (blob: Blob): Promise<number> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  return view.getUint16(22, true);
};

describe('createWavBlob', () => {
  it('writes mono channel metadata by default', async () => {
    const blob = createWavBlob(new Float32Array([0, 0.1, -0.1, 0.2]));
    const channels = await readWavChannelCount(blob);
    expect(channels).toBe(1);
  });

  it('writes explicit channel metadata when provided', async () => {
    const blob = createWavBlob(new Float32Array([0, 0.1, -0.1, 0.2]), 48000, 2);
    const channels = await readWavChannelCount(blob);
    expect(channels).toBe(2);
  });
});

describe('decodeFloat32PcmChunk', () => {
  it('preserves all float samples across misaligned byte chunks', () => {
    const original = new Float32Array([0.25, -0.5, 1, -1, 0.125]);
    const bytes = new Uint8Array(original.buffer.slice(0));
    const splits = [5, 3, 7];
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (const split of splits) {
      parts.push(bytes.slice(offset, offset + split));
      offset += split;
    }
    parts.push(bytes.slice(offset));

    let carry = new Uint8Array(0);
    const decoded: number[] = [];
    for (const part of parts) {
      const result = decodeFloat32PcmChunk(part, carry);
      carry = result.carryoverBytes;
      decoded.push(...Array.from(result.samples));
    }

    expect(carry.length).toBe(0);
    expect(decoded.length).toBe(original.length);
    decoded.forEach((sample, idx) => {
      expect(sample).toBeCloseTo(original[idx], 6);
    });
  });

  it('keeps trailing incomplete bytes as carryover', () => {
    const full = new Uint8Array([0, 0, 128, 63, 255]); // float32(1.0) + 1 trailing byte
    const result = decodeFloat32PcmChunk(full);

    expect(result.samples.length).toBe(1);
    expect(result.samples[0]).toBeCloseTo(1, 6);
    expect(result.carryoverBytes.length).toBe(1);
    expect(result.carryoverBytes[0]).toBe(255);
  });
});

describe('resolvePcmTimelineSampleRate', () => {
  it('preserves wall-clock duration for a four-channel native float stream', () => {
    const durationSeconds = 16.5;
    const interleavedSampleCount = 48_000 * 4 * durationSeconds;

    expect(
      resolvePcmTimelineSampleRate(
        interleavedSampleCount,
        durationSeconds,
        48_000,
      ),
    ).toBe(192_000);
  });

  it('preserves wall-clock duration for a six-channel native float stream', () => {
    const durationSeconds = 13.5;
    const interleavedSampleCount = 48_000 * 6 * durationSeconds;

    expect(
      resolvePcmTimelineSampleRate(
        interleavedSampleCount,
        durationSeconds,
        48_000,
      ),
    ).toBe(288_000);
  });
});

describe('isCaptureChunkPairReady', () => {
  it('waits for an expected system tail after recorder state resets', () => {
    expect(
      isCaptureChunkPairReady({
        micReady: true,
        systemReady: false,
        systemExpected: true,
      }),
    ).toBe(false);
    expect(
      isCaptureChunkPairReady({
        micReady: true,
        systemReady: true,
        systemExpected: true,
      }),
    ).toBe(true);
  });
});

describe('trimPcmLeadingOverflow', () => {
  it('drops buffered native pre-roll from the leading edge', () => {
    const samples = Float32Array.from([1, 2, 3, 4, 5, 6]);

    expect(Array.from(trimPcmLeadingOverflow(samples, 2, 2))).toEqual([
      3, 4, 5, 6,
    ]);
  });
});
