import type { NativeLiveSource } from './nativeJsonLineProcess';

export type EouPcmAppend = {
  streamId: string;
  source: NativeLiveSource;
  generation: number;
  sequence: number;
  sampleRate: number;
  samples: Float32Array;
  audioStartSeconds: number;
  audioEndSeconds: number;
};

export type EncodedEouPcmAppend = Omit<EouPcmAppend, 'samples'> & {
  channelCount: 1;
  frameCount: number;
  pcmBase64: string;
};

const STREAM_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 192_000;
const MAXIMUM_DURATION_SECONDS = 2;

export const encodeEouPcmAppend = (
  append: EouPcmAppend,
): EncodedEouPcmAppend => {
  const { samples } = append;
  const declaredDuration = append.audioEndSeconds - append.audioStartSeconds;
  const sampleDuration = samples.length / append.sampleRate;
  if (
    !STREAM_ID_PATTERN.test(append.streamId) ||
    append.streamId.includes('..') ||
    (append.source !== 'mic' && append.source !== 'system') ||
    !Number.isSafeInteger(append.generation) ||
    append.generation <= 0 ||
    !Number.isSafeInteger(append.sequence) ||
    append.sequence <= 0 ||
    !Number.isSafeInteger(append.sampleRate) ||
    append.sampleRate < MINIMUM_SAMPLE_RATE ||
    append.sampleRate > MAXIMUM_SAMPLE_RATE ||
    !(samples instanceof Float32Array) ||
    samples.length === 0 ||
    samples.length > append.sampleRate * MAXIMUM_DURATION_SECONDS ||
    !Number.isFinite(append.audioStartSeconds) ||
    !Number.isFinite(append.audioEndSeconds) ||
    append.audioStartSeconds < 0 ||
    append.audioEndSeconds <= append.audioStartSeconds ||
    Math.abs(declaredDuration - sampleDuration) > 0.5 / append.sampleRate
  ) {
    throw new Error('parakeet_request_invalid');
  }

  const bytes = Buffer.allocUnsafe(
    samples.length * Float32Array.BYTES_PER_ELEMENT,
  );
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) throw new Error('parakeet_request_invalid');
    bytes.writeFloatLE(sample, index * Float32Array.BYTES_PER_ELEMENT);
  }

  return {
    streamId: append.streamId,
    source: append.source,
    generation: append.generation,
    sequence: append.sequence,
    sampleRate: append.sampleRate,
    channelCount: 1,
    frameCount: samples.length,
    audioStartSeconds: append.audioStartSeconds,
    audioEndSeconds: append.audioEndSeconds,
    pcmBase64: bytes.toString('base64'),
  };
};
