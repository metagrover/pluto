import type { LiveSource } from './contracts';

export type EouRendererFrame = {
  source: LiveSource;
  sequence: number;
  sampleRate: number;
  samples: Float32Array;
  audioStartSeconds: number;
  audioEndSeconds: number;
};

export type EouPcmChunker = {
  append(samples: Float32Array): void;
  flush(): EouRendererFrame | null;
  reset(): void;
};

const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 192_000;

export function createEouPcmChunker(options: {
  source: LiveSource;
  sampleRate: number;
  advanceMs?: 320;
  onFrame: (frame: EouRendererFrame) => void;
}): EouPcmChunker {
  const advanceMs = options.advanceMs ?? 320;
  if (
    (options.source !== 'mic' && options.source !== 'system') ||
    !Number.isSafeInteger(options.sampleRate) ||
    options.sampleRate < MINIMUM_SAMPLE_RATE ||
    options.sampleRate > MAXIMUM_SAMPLE_RATE ||
    advanceMs !== 320 ||
    typeof options.onFrame !== 'function'
  ) {
    throw new Error('parakeet_request_invalid');
  }
  const frameLength = Math.round((options.sampleRate * advanceMs) / 1_000);
  let buffered = new Float32Array(0);
  let emittedSamples = 0;
  let nextSequence = 1;

  const emit = (samples: Float32Array): EouRendererFrame => {
    const frame: EouRendererFrame = {
      source: options.source,
      sequence: nextSequence,
      sampleRate: options.sampleRate,
      samples,
      audioStartSeconds: emittedSamples / options.sampleRate,
      audioEndSeconds: (emittedSamples + samples.length) / options.sampleRate,
    };
    nextSequence += 1;
    emittedSamples += samples.length;
    options.onFrame(frame);
    return frame;
  };

  return {
    append(samples) {
      if (!(samples instanceof Float32Array) || samples.length === 0) {
        throw new Error('parakeet_request_invalid');
      }
      for (const sample of samples) {
        if (!Number.isFinite(sample)) {
          throw new Error('parakeet_request_invalid');
        }
      }
      const joined = new Float32Array(buffered.length + samples.length);
      joined.set(buffered);
      joined.set(samples, buffered.length);
      buffered = joined;
      while (buffered.length >= frameLength) {
        const complete = buffered.slice(0, frameLength);
        buffered = buffered.slice(frameLength);
        emit(complete);
      }
    },
    flush() {
      if (buffered.length === 0) return null;
      const tail = buffered;
      buffered = new Float32Array(0);
      return emit(tail);
    },
    reset() {
      buffered = new Float32Array(0);
      emittedSamples = 0;
      nextSequence = 1;
    },
  };
}
