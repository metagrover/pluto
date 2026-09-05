import { describe, expect, it } from 'vitest';
import { createLiveEchoEvidence } from '../../src/services/liveTranscription/liveEchoEvidence';

const pcm = (sampleRate: number, seconds: number, pattern = 0): Float32Array =>
  Float32Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) => {
    const bin = Math.floor((i * 100) / sampleRate);
    const seed = ((bin + 1) * 1664525 + pattern * 1013904223) >>> 0;
    const hash = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
    const amplitude = 0.01 + (hash / 4294967296) * 0.2;
    return amplitude * Math.sin((i * 2 * Math.PI * 1000) / sampleRate);
  });
const appendPair = (
  evidence: ReturnType<typeof createLiveEchoEvidence>,
  offset = 0,
) => {
  evidence.append({
    source: 'system',
    sampleRate: 48000,
    samples: pcm(48000, 3),
    startTimeMs: offset,
    endTimeMs: offset + 3000,
  });
  evidence.append({
    source: 'mic',
    sampleRate: 24000,
    samples: pcm(24000, 3).map((v) => v * 0.4),
    startTimeMs: offset + 200,
    endTimeMs: offset + 3200,
  });
};

describe('live acoustic echo evidence', () => {
  it('corroborates a delayed attenuated echo across different sample rates', () => {
    const evidence = createLiveEchoEvidence();
    appendPair(evidence);
    const windows = evidence.snapshot();
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].micStartMs).toBe(200);
    expect(windows[0].systemStartMs).toBe(0);
    expect(windows[0].micEndMs - windows[0].micStartMs).toBeGreaterThanOrEqual(
      1000,
    );
  });
  it('does not turn silence, unrelated speech, or strong double talk into echo evidence', () => {
    for (const kind of ['silence', 'unrelated', 'double-talk']) {
      const evidence = createLiveEchoEvidence();
      const remote = pcm(16000, 3);
      const unrelated = pcm(16000, 3, 2);
      evidence.append({
        source: 'system',
        sampleRate: 16000,
        samples: kind === 'silence' ? new Float32Array(remote.length) : remote,
        startTimeMs: 0,
        endTimeMs: 3000,
      });
      evidence.append({
        source: 'mic',
        sampleRate: 16000,
        samples:
          kind === 'double-talk'
            ? remote.map((v, i) => v * 0.4 + unrelated[i] * 2)
            : unrelated,
        startTimeMs: 200,
        endTimeMs: 3200,
      });
      expect(evidence.snapshot()).toEqual([]);
    }
  });
  it('corroborates stable speech across a word-end pause without admitting local speech in that pause', () => {
    for (const localInPause of [false, true]) {
      const evidence = createLiveEchoEvidence();
      const system = pcm(16000, 3).map((v, i) => (i % 16000 < 12000 ? v : 0));
      const mic = system.map(
        (v, i) =>
          v * 0.4 +
          (localInPause && i % 16000 >= 12000
            ? 0.02 * Math.sin((i * 2 * Math.PI * 700) / 16000)
            : 0),
      );
      evidence.append({
        source: 'system',
        sampleRate: 16000,
        samples: system,
        startTimeMs: 0,
        endTimeMs: 3000,
      });
      evidence.append({
        source: 'mic',
        sampleRate: 16000,
        samples: mic,
        startTimeMs: 200,
        endTimeMs: 3200,
      });
      expect(
        evidence
          .snapshot()
          .some(
            (window) => window.micStartMs <= 200 && window.micEndMs >= 1200,
          ),
      ).toBe(!localInPause);
    }
  });

  it('corroborates a short echo burst across window phases without counting overlapping activity twice', () => {
    for (const phaseMs of [0, 60, 130]) {
      for (const burstMs of [500, 900]) {
        const evidence = createLiveEchoEvidence();
        const system = pcm(16000, 3);
        const local = pcm(16000, 3, 2);
        const begin = 300 + phaseMs;
        const mic = system.map((v, i) =>
          i / 16 >= begin && i / 16 < begin + burstMs ? v * 0.4 : local[i] * 2,
        );
        for (const source of ['system', 'mic'] as const) {
          evidence.append({
            source,
            sampleRate: 16000,
            samples: source === 'system' ? system : mic,
            startTimeMs: 0,
            endTimeMs: 3000,
          });
        }
        const windows = evidence.snapshot();
        if (burstMs === 500) expect(windows).toEqual([]);
        else {
          expect(
            windows.some(
              (w) => w.micStartMs <= begin + 100 && w.micEndMs >= begin + 800,
            ),
          ).toBe(true);
          expect(
            windows.every(
              (w) =>
                w.micStartMs >= begin - 100 &&
                w.micEndMs <= begin + burstMs + 100,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it('does not corroborate independent changing lags between adjacent windows', () => {
    const evidence = createLiveEchoEvidence();
    const system = pcm(16000, 3);
    const mic = system.map((_, i) => {
      const lag = Math.floor(i / 8000) % 2 ? 6400 : 0;
      return (system[i - lag] ?? 0) * 0.4;
    });
    evidence.append({
      source: 'system',
      sampleRate: 16000,
      samples: system,
      startTimeMs: 0,
      endTimeMs: 3000,
    });
    evidence.append({
      source: 'mic',
      sampleRate: 16000,
      samples: mic,
      startTimeMs: 0,
      endTimeMs: 3000,
    });
    expect(evidence.snapshot()).toEqual([]);
  });

  it('does not accumulate gradual lag drift inside a coalesced window', () => {
    const evidence = createLiveEchoEvidence();
    const system = pcm(16000, 4);
    const mic = system.map((_, i) => {
      const lag = 1600 + Math.floor(i / 8000) * 320;
      return (system[i - lag] ?? 0) * 0.4;
    });
    evidence.append({
      source: 'system',
      sampleRate: 16000,
      samples: system,
      startTimeMs: 0,
      endTimeMs: 4000,
    });
    evidence.append({
      source: 'mic',
      sampleRate: 16000,
      samples: mic,
      startTimeMs: 0,
      endTimeMs: 4000,
    });
    const windows = evidence.snapshot();
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(window.micStartMs - window.systemStartMs).toBe(
        window.micEndMs - window.systemEndMs,
      );
    }
  });

  it('reports only newly corroborated coverage so late PCM can refresh unchanged text', () => {
    const evidence = createLiveEchoEvidence();
    const system = {
      source: 'system' as const,
      sampleRate: 16000,
      samples: pcm(16000, 3),
      startTimeMs: 0,
      endTimeMs: 3000,
    };
    const mic = {
      source: 'mic' as const,
      sampleRate: 16000,
      samples: pcm(16000, 3),
      startTimeMs: 200,
      endTimeMs: 3200,
    };
    expect(evidence.append(mic)).toBe(false);
    expect(evidence.append(system)).toBe(true);
    expect(evidence.append(system)).toBe(false);
  });

  it('does not bridge missing or invalid PCM and resets all session evidence', () => {
    const evidence = createLiveEchoEvidence();
    evidence.append({
      source: 'system',
      sampleRate: 16000,
      samples: pcm(16000, 3),
      startTimeMs: 0,
      endTimeMs: 3000,
    });
    evidence.append({
      source: 'mic',
      sampleRate: 16000,
      samples: pcm(16000, 0.5),
      startTimeMs: 200,
      endTimeMs: 700,
    });
    evidence.append({
      source: 'mic',
      sampleRate: 16000,
      samples: Float32Array.of(Number.NaN),
      startTimeMs: 700,
      endTimeMs: 700.0625,
    });
    expect(evidence.snapshot()).toEqual([]);
    evidence.reset();
    appendPair(evidence);
    expect(evidence.snapshot().length).toBeGreaterThan(0);
    evidence.reset();
    expect(evidence.snapshot()).toEqual([]);
  });
  it('retains prior positive metadata after PCM history expires without filling the gap', () => {
    const evidence = createLiveEchoEvidence();
    appendPair(evidence);
    const original = evidence.snapshot();
    appendPair(evidence, 130000);
    const later = evidence.snapshot();
    expect(original.length).toBeGreaterThan(0);
    expect(later.slice(0, original.length)).toEqual(original);
    expect(later.length).toBeGreaterThan(original.length);
    expect(later.some((w) => w.micStartMs < 10000 && w.micEndMs > 130000)).toBe(
      false,
    );
  });
});
