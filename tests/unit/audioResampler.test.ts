import { describe, expect, it } from 'vitest';
import { createAudioResampler } from '../../src/utils/audioResampler';

describe('audioResampler', () => {
  it('passes through 16kHz audio directly', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 16000,
      outputSampleRate: 16000,
    });
    const input = new Float32Array([0.1, 0.2, 0.3, -0.4, 0.5]);
    const output = resampler.process(input);
    expect(output.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(output[i]).toBeCloseTo(input[i], 5);
    }
  });

  it('resamples from 48kHz to 16kHz (3:1 integer decimation)', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 48000,
      outputSampleRate: 16000,
    });
    // 4800 samples at 48kHz = 100ms. At 16kHz, 100ms = 1600 samples.
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const output = resampler.process(input);
    expect(output.length).toBe(1600);
  });

  it('resamples from 24kHz to 16kHz (1.5:1 ratio)', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 24000,
      outputSampleRate: 16000,
    });
    // 2400 samples at 24kHz = 100ms -> 1600 samples at 16kHz
    const input = new Float32Array(2400);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 24000);
    }
    const output = resampler.process(input);
    expect(output.length).toBe(1600);
  });

  it('resamples from 44.1kHz to 16kHz without sample count drift', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 44100,
      outputSampleRate: 16000,
    });
    // 4410 samples at 44.1kHz = 100ms -> 1600 samples at 16kHz
    const input = new Float32Array(4410);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
    }
    const output = resampler.process(input);
    expect(output.length).toBe(1600);
  });

  it('preserves sine wave pitch (440Hz in produces 440Hz out)', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 48000,
      outputSampleRate: 16000,
    });
    // 1 second of 440 Hz sine wave
    const sampleCount48k = 48000;
    const input = new Float32Array(sampleCount48k);
    for (let i = 0; i < sampleCount48k; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const output = resampler.process(input);
    expect(output.length).toBe(16000);

    // Count zero-crossings (positive-going) to estimate frequency in output
    let positiveCrossings = 0;
    for (let i = 1; i < output.length; i++) {
      if (output[i - 1] <= 0 && output[i] > 0) {
        positiveCrossings++;
      }
    }
    // In 1 second of 440 Hz, there should be ~440 positive zero-crossings
    expect(Math.abs(positiveCrossings - 440)).toBeLessThanOrEqual(2);
  });

  it('maintains continuous streaming without boundary phase jumps', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 48000,
      outputSampleRate: 16000,
    });
    // Stream 3 consecutive chunks of 1600 samples (33.3ms each)
    const chunk1 = new Float32Array(1600);
    const chunk2 = new Float32Array(1600);
    for (let i = 0; i < 1600; i++) {
      chunk1[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      chunk2[i] = Math.sin((2 * Math.PI * 440 * (1600 + i)) / 48000);
    }
    const out1 = resampler.process(chunk1);
    const out2 = resampler.process(chunk2);

    expect(out1.length).toBeGreaterThan(0);
    expect(out2.length).toBeGreaterThan(0);

    // The transition between the end of out1 and start of out2 should be smooth:
    // Difference between consecutive output samples should be bounded (sin wave max slope: 2*pi*f/fs ~ 0.17)
    const lastOut1 = out1[out1.length - 1];
    const firstOut2 = out2[0];
    const step = Math.abs(firstOut2 - lastOut1);
    expect(step).toBeLessThan(0.25);
  });

  it('dynamically adapts input sample rate on device switch', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 48000,
      outputSampleRate: 16000,
    });
    // Initially at 48kHz
    const input48k = new Float32Array(4800);
    const out48k = resampler.process(input48k);
    expect(out48k.length).toBe(1600);

    // Switch to 24kHz (e.g. Bluetooth headset connected)
    resampler.setInputSampleRate(24000);
    expect(resampler.getInputSampleRate()).toBe(24000);

    // Now 2400 samples at 24kHz should yield 1600 samples at 16kHz
    const input24k = new Float32Array(2400);
    const out24k = resampler.process(input24k);
    expect(out24k.length).toBe(1600);
  });

  it('handles empty buffers cleanly', () => {
    const resampler = createAudioResampler({
      inputSampleRate: 48000,
      outputSampleRate: 16000,
    });
    const output = resampler.process(new Float32Array(0));
    expect(output.length).toBe(0);
  });
});
