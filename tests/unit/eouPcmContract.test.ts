import { describe, expect, it } from 'vitest';
import {
  type EouPcmAppend,
  encodeEouPcmAppend,
} from '../../electron/transcription/eouPcmContract';

const append = (overrides: Partial<EouPcmAppend> = {}): EouPcmAppend => ({
  streamId: 'meeting.mic',
  source: 'mic',
  generation: 1,
  sequence: 1,
  sampleRate: 48_000,
  samples: new Float32Array(15_360).fill(0.25),
  audioStartSeconds: 0,
  audioEndSeconds: 0.32,
  ...overrides,
});

describe('EOU PCM contract', () => {
  it('preserves one exact 320 ms frame at the observed 48 kHz rate', () => {
    const samples = new Float32Array(15_360);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin(index / 100);
    }

    const encoded = encodeEouPcmAppend(append({ samples }));

    expect(encoded.frameCount).toBe(15_360);
    expect(encoded.audioEndSeconds).toBe(0.32);
    expect(Buffer.from(encoded.pcmBase64, 'base64')).toEqual(
      Buffer.from(samples.buffer),
    );
  });

  it('encodes exact little-endian Float32 bytes and declarations', () => {
    const samples = new Float32Array([0, 0.25, -0.5, 1]);
    const encoded = encodeEouPcmAppend(
      append({
        sampleRate: 8_000,
        samples,
        audioEndSeconds: samples.length / 8_000,
      }),
    );

    expect(encoded).toMatchObject({
      streamId: 'meeting.mic',
      source: 'mic',
      generation: 1,
      sequence: 1,
      sampleRate: 8_000,
      channelCount: 1,
      frameCount: 4,
      audioStartSeconds: 0,
      audioEndSeconds: 0.0005,
    });
    const bytes = Buffer.from(encoded.pcmBase64, 'base64');
    expect(
      [...Array(4)].map((_, index) => bytes.readFloatLE(index * 4)),
    ).toEqual([...samples]);
  });

  it.each([
    { samples: new Float32Array(0) },
    { samples: new Float32Array([Number.NaN]) },
    { samples: new Float32Array([Number.POSITIVE_INFINITY]) },
    { sampleRate: 7_999 },
    { sampleRate: 192_001 },
    { generation: 0 },
    { sequence: 0 },
    { streamId: '../private' },
    { audioStartSeconds: -1 },
    { audioEndSeconds: 0 },
    {
      samples: new Float32Array(16_001),
      sampleRate: 8_000,
      audioEndSeconds: 2.000125,
    },
    { samples: new Float32Array(1), audioEndSeconds: 1 },
  ])('rejects malformed append %#', (overrides) => {
    expect(() => encodeEouPcmAppend(append(overrides))).toThrow(
      'parakeet_request_invalid',
    );
  });

  it('rejects a detached Float32Array', () => {
    const samples = new Float32Array(4);
    structuredClone(samples, { transfer: [samples.buffer] });

    expect(() => encodeEouPcmAppend(append({ samples }))).toThrow(
      'parakeet_request_invalid',
    );
  });
});
