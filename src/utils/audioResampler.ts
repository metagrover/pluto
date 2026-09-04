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

    // Estimate output sample count
    const outSamples: number[] = [];
    const maxInputIndex = combined.length - 1;

    // For downsampling, average/interpolate samples within the fractional window
    // to achieve clean anti-aliasing without phase distortion or pitch shift
    const windowRadius = Math.max(1, Math.round(ratio));

    while (phase <= maxInputIndex) {
      const center = phase;
      const startIdx = Math.max(0, Math.floor(center - windowRadius * 0.5));
      const endIdx = Math.min(
        maxInputIndex,
        Math.ceil(center + windowRadius * 0.5),
      );

      if (ratio > 1.0) {
        // Downsampling: integrate / average over the input window covered by this output sample
        let sum = 0;
        let weightSum = 0;
        for (let i = startIdx; i <= endIdx; i++) {
          const dist = Math.abs(i - center);
          // Triangle window weight
          const weight = Math.max(0, 1 - dist / (windowRadius * 0.5 + 0.5));
          if (weight > 0) {
            sum += combined[i] * weight;
            weightSum += weight;
          }
        }
        outSamples.push(
          weightSum > 0 ? sum / weightSum : combined[Math.round(center)],
        );
      } else {
        // Upsampling or exact interpolation: linear interpolation between surrounding samples
        const i0 = Math.floor(center);
        const i1 = Math.min(maxInputIndex, i0 + 1);
        const frac = center - i0;
        const s0 = combined[i0];
        const s1 = combined[i1];
        outSamples.push(s0 + frac * (s1 - s0));
      }

      phase += ratio;
    }

    // Retain remaining samples after the last processed point as carryover for the next chunk
    const consumedInputIndex = Math.floor(phase);
    if (consumedInputIndex < combined.length) {
      carryover = combined.slice(consumedInputIndex);
      phase -= consumedInputIndex;
    } else {
      phase -= combined.length;
      carryover = new Float32Array(0);
    }

    return new Float32Array(outSamples);
  };

  return {
    getInputSampleRate: () => inRate,
    getOutputSampleRate: () => outRate,
    setInputSampleRate,
    process,
    reset,
  };
}
