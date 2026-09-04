/**
 * Audio Resampler for real-time PCM streams.
 * Decouples dynamic hardware input sample rates (16k, 24k, 44.1k, 48k, etc.)
 * into uniform 16 kHz mono Float32 audio for VAD, ASR, and capture pipelines.
 */

export interface AudioResamplerOptions {
  inputSampleRate: number;
  outputSampleRate?: number;
}

export interface AudioResampler {
  getInputSampleRate(): number;
  getOutputSampleRate(): number;
  setInputSampleRate(newRate: number): void;
  process(input: Float32Array): Float32Array;
  flush(): Float32Array;
  reset(): void;
}

export function createAudioResampler(
  options: AudioResamplerOptions,
): AudioResampler {
  let inRate = Math.round(options.inputSampleRate);
  const outRate = Math.round(options.outputSampleRate ?? 16000);

  if (inRate <= 0 || outRate <= 0) {
    throw new Error('Invalid sample rate');
  }

  let ratio = inRate / outRate;
  let phase = 0.0;
  // Carryover buffer from previous chunk to ensure smooth boundary interpolation
  let carryover: Float32Array = new Float32Array(0);

  const reset = () => {
    phase = 0.0;
    carryover = new Float32Array(0);
  };

  const setInputSampleRate = (newRate: number) => {
    const rounded = Math.round(newRate);
    if (rounded <= 0) throw new Error('Invalid sample rate');
    if (rounded !== inRate) {
      inRate = rounded;
      ratio = inRate / outRate;
      // Reset phase accumulator to maintain clean alignment on rate change
      phase = 0.0;
      carryover = new Float32Array(0);
    }
  };

  const process = (input: Float32Array): Float32Array => {
    if (input.length === 0) {
      return new Float32Array(0);
    }

    // 1:1 Passthrough optimization
    if (inRate === outRate) {
      reset();
      return new Float32Array(input);
    }

    // Concatenate carryover from previous chunk with current input
    const combinedLength = carryover.length + input.length;
    const combined = new Float32Array(combinedLength);
    if (carryover.length > 0) {
      combined.set(carryover, 0);
    }
    combined.set(input, carryover.length);

    const outSamples: number[] = [];
    const maxInputIndex = combined.length - 1;

    // Normalized cutoff frequency relative to input sample rate.
    // For downsampling, cutoff is slightly below output Nyquist (0.45 / ratio)
    // to provide a transition band that eliminates all aliasing into the speech band.
    const cutoff = ratio > 1.0 ? 0.45 / ratio : 0.45;
    const filterRadius = Math.max(8, Math.round(12 * Math.max(1, ratio)));

    const sinc = (x: number): number => {
      if (Math.abs(x) < 1e-7) return 1.0;
      const piX = Math.PI * x;
      return Math.sin(piX) / piX;
    };

    const computeSample = (center: number, source: Float32Array): number => {
      const startIdx = Math.max(0, Math.floor(center - filterRadius));
      const endIdx = Math.min(
        source.length - 1,
        Math.ceil(center + filterRadius),
      );
      let sum = 0;
      let totalWeight = 0;

      for (let i = startIdx; i <= endIdx; i++) {
        const tau = i - center;
        // Blackman window
        const w =
          0.42 +
          0.5 * Math.cos((Math.PI * tau) / filterRadius) +
          0.08 * Math.cos((2 * Math.PI * tau) / filterRadius);
        const h = 2 * cutoff * sinc(2 * cutoff * tau);
        const weight = h * w;
        sum += source[i] * weight;
        totalWeight += weight;
      }

      return totalWeight > 0 ? sum / totalWeight : source[Math.round(center)];
    };

    while (phase <= maxInputIndex) {
      outSamples.push(computeSample(phase, combined));
      phase += ratio;
    }

    // Retain filterRadius samples from the end of combined for the next chunk's history
    const historyCount = Math.min(combined.length, filterRadius);
    carryover = combined.slice(combined.length - historyCount);
    // Adjust phase to be relative to the new carryover buffer in the next chunk
    phase = phase - combined.length + historyCount;

    return new Float32Array(outSamples);
  };

  const flush = (): Float32Array => {
    reset();
    return new Float32Array(0);
  };

  return {
    getInputSampleRate: () => inRate,
    getOutputSampleRate: () => outRate,
    setInputSampleRate,
    process,
    flush,
    reset,
  };
}
