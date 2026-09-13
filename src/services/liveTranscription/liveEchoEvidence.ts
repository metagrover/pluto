export type LiveEchoEvidenceWindow = {
  micStartMs: number;
  micEndMs: number;
  systemStartMs: number;
  systemEndMs: number;
};
export type LiveEchoEvidenceFrame = {
  source: 'mic' | 'system';
  sampleRate: number;
  samples: Float32Array;
  startTimeMs: number;
  endTimeMs: number;
};

export type LiveEchoEvidenceDiagnostics = {
  analyzedWindows: number;
  completeMicWindows: number;
  lagComparisons: number;
  insufficientActivityComparisons: number;
  independentMicComparisons: number;
  degenerateComparisons: number;
  lowSimilarityComparisons: number;
  similarityQualifiedComparisons: number;
  candidateWindows: number;
  compatibleCandidatePairs: number;
  retainedWindows: number;
};

type EnergyBin = { energy: number; durationMs: number };
type Match = LiveEchoEvidenceWindow & {
  lagBins: number;
  activeBins: number[];
  retained?: boolean;
};
const BIN_MS = 10;
const WINDOW_BINS = 50;
const STRIDE_BINS = 10;
const MAX_LAG_BINS = 50;
const HISTORY_BINS = 12000;

/** Acoustic corroboration for small, text-anchored ambiguities; not voice identity
 * or permission to suppress arbitrary mic speech. Quiet double talk can retain
 * a correlated envelope, so consumers must preserve insertions/critical words. */
export const createLiveEchoEvidence = () => {
  const bins = {
    mic: new Map<number, EnergyBin>(),
    system: new Map<number, EnergyBin>(),
  };
  const lastEnd = {
    mic: Number.NEGATIVE_INFINITY,
    system: Number.NEGATIVE_INFINITY,
  };
  const verified: LiveEchoEvidenceWindow[] = [];
  let nextWindow: number | null = null;
  let previous: Match[] = [];
  const lastByLag = new Map<number, LiveEchoEvidenceWindow>();
  let revision = 0;
  const diagnostics: Omit<LiveEchoEvidenceDiagnostics, 'retainedWindows'> = {
    analyzedWindows: 0,
    completeMicWindows: 0,
    lagComparisons: 0,
    insufficientActivityComparisons: 0,
    independentMicComparisons: 0,
    degenerateComparisons: 0,
    lowSimilarityComparisons: 0,
    similarityQualifiedComparisons: 0,
    candidateWindows: 0,
    compatibleCandidatePairs: 0,
  };

  const rms = (source: 'mic' | 'system', start: number): number[] | null => {
    const values: number[] = [];
    for (let i = 0; i < WINDOW_BINS; i++) {
      const bin = bins[source].get(start + i);
      if (!bin || bin.durationMs < 9.5 || bin.durationMs > 10.5) return null;
      values.push(Math.sqrt(bin.energy / bin.durationMs));
    }
    return values;
  };
  const score = (
    mic: number[],
    system: number[],
  ):
    | { kind: 'candidate'; correlation: number; activeBins: number[] }
    | {
        kind:
          | 'insufficient_activity'
          | 'independent_mic'
          | 'degenerate'
          | 'low_similarity';
      } => {
    let x = 0;
    let y = 0;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    const active: number[] = [];
    let micExclusiveEnergy = 0;
    for (let i = 0; i < WINDOW_BINS; i++) {
      x += mic[i];
      y += system[i];
      xx += mic[i] ** 2;
      yy += system[i] ** 2;
      xy += mic[i] * system[i];
      if (system[i] >= 0.002 && mic[i] >= 0.001) active.push(i);
      if (system[i] < 0.002) micExclusiveEnergy += mic[i] ** 2;
    }
    if (active.length < 10) return { kind: 'insufficient_activity' };
    if (xx <= 1e-12 || yy <= 1e-12) return { kind: 'degenerate' };
    if (micExclusiveEnergy / xx > 0.02) return { kind: 'independent_mic' };
    const variance =
      (xx - (x * x) / WINDOW_BINS) * (yy - (y * y) / WINDOW_BINS);
    if (variance <= 1e-12) return { kind: 'degenerate' };
    const correlation = (xy - (x * y) / WINDOW_BINS) / Math.sqrt(variance);
    const residual = Math.max(0, 1 - (xy * xy) / (xx * yy));
    return correlation >= 0.9 && residual <= 0.1
      ? { kind: 'candidate', correlation, activeBins: active }
      : { kind: 'low_similarity' };
  };
  const retain = (match: Match): void => {
    if (match.retained) return;
    match.retained = true;
    const {
      lagBins: _lag,
      activeBins: _active,
      retained: _retained,
      ...window
    } = match;
    const last = lastByLag.get(match.lagBins);
    if (
      last &&
      window.micStartMs <= last.micEndMs &&
      window.micEndMs >= last.micStartMs &&
      // Consumers map a coalesced interval using its start offset. Retain
      // separate intervals when lag changes, even when adjacent candidates
      // are close enough to corroborate each other acoustically.
      window.micStartMs - window.systemStartMs ===
        last.micStartMs - last.systemStartMs
    ) {
      if (window.micStartMs < last.micStartMs) {
        last.micStartMs = window.micStartMs;
        last.systemStartMs = window.systemStartMs;
        revision++;
      }
      if (window.micEndMs > last.micEndMs) {
        last.micEndMs = window.micEndMs;
        last.systemEndMs = window.systemEndMs;
        revision++;
      }
    } else {
      verified.push(window);
      lastByLag.set(match.lagBins, window);
      revision++;
    }
  };
  const analyze = (): void => {
    if (nextWindow === null) return;
    const completeUntil = Math.floor(
      Math.min(lastEnd.mic, lastEnd.system - MAX_LAG_BINS * BIN_MS) / BIN_MS,
    );
    while (nextWindow + WINDOW_BINS <= completeUntil) {
      diagnostics.analyzedWindows += 1;
      const start = nextWindow;
      nextWindow += STRIDE_BINS;
      previous = previous.filter(
        (match) => start * BIN_MS - match.micStartMs <= WINDOW_BINS * BIN_MS,
      );
      const mic = rms('mic', start);
      let best: { lag: number; score: number; activeBins: number[] } | null =
        null;
      if (mic) {
        diagnostics.completeMicWindows += 1;
        for (let lag = -MAX_LAG_BINS; lag <= MAX_LAG_BINS; lag++) {
          const system = rms('system', start + lag);
          if (!system) continue;
          diagnostics.lagComparisons += 1;
          const candidate = score(mic, system);
          if (candidate.kind !== 'candidate') {
            if (candidate.kind === 'insufficient_activity')
              diagnostics.insufficientActivityComparisons += 1;
            else if (candidate.kind === 'independent_mic')
              diagnostics.independentMicComparisons += 1;
            else if (candidate.kind === 'degenerate')
              diagnostics.degenerateComparisons += 1;
            else diagnostics.lowSimilarityComparisons += 1;
            continue;
          }
          diagnostics.similarityQualifiedComparisons += 1;
          if (!best || candidate.correlation > best.score)
            best = {
              lag,
              score: candidate.correlation,
              activeBins: candidate.activeBins,
            };
        }
      }
      if (!best) {
        continue;
      }
      diagnostics.candidateWindows += 1;
      const match: Match = {
        micStartMs: start * BIN_MS,
        micEndMs: (start + WINDOW_BINS) * BIN_MS,
        systemStartMs: (start + best.lag) * BIN_MS,
        systemEndMs: (start + best.lag + WINDOW_BINS) * BIN_MS,
        lagBins: best.lag,
        activeBins: best.activeBins,
      };
      // Sliding windows remove dependence on the arbitrary capture-start phase.
      // Require 600 ms of distinct active support in BOTH channel clocks;
      // overlapping windows and slightly changing lags must not count twice.
      for (const prior of previous) {
        if (Math.abs(prior.lagBins - match.lagBins) > 3) continue;
        diagnostics.compatibleCandidatePairs += 1;
        const micActivity = new Set<number>();
        const systemActivity = new Set<number>();
        for (const candidate of [prior, match]) {
          for (const bin of candidate.activeBins) {
            micActivity.add(candidate.micStartMs / BIN_MS + bin);
            systemActivity.add(candidate.systemStartMs / BIN_MS + bin);
          }
        }
        if (micActivity.size >= 60 && systemActivity.size >= 60) {
          retain(prior);
          retain(match);
        }
      }
      previous.push(match);
    }
  };
  return {
    append(frame: LiveEchoEvidenceFrame): boolean {
      const beforeRevision = revision;
      const { source, sampleRate, samples, startTimeMs, endTimeMs } = frame;
      if (
        (source !== 'mic' && source !== 'system') ||
        !Number.isFinite(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 192000 ||
        !Number.isFinite(startTimeMs) ||
        startTimeMs < 0 ||
        !Number.isFinite(endTimeMs) ||
        endTimeMs <= startTimeMs ||
        !(samples instanceof Float32Array) ||
        samples.length === 0 ||
        !samples.every(Number.isFinite) ||
        Math.abs(
          (samples.length / sampleRate) * 1000 - (endTimeMs - startTimeMs),
        ) > 1 ||
        startTimeMs < lastEnd[source] - 0.01
      )
        return false;
      const durationMs = 1000 / sampleRate;
      for (let i = 0; i < samples.length; i++) {
        const index = Math.floor(
          (startTimeMs + (i + 0.5) * durationMs) / BIN_MS,
        );
        const bin = bins[source].get(index) ?? { energy: 0, durationMs: 0 };
        bin.energy += samples[i] * samples[i] * durationMs;
        bin.durationMs += durationMs;
        bins[source].set(index, bin);
      }
      lastEnd[source] = endTimeMs;
      if (source === 'mic' && nextWindow === null)
        nextWindow = Math.ceil(startTimeMs / BIN_MS);
      const cutoff =
        Math.floor(Math.max(lastEnd.mic, lastEnd.system) / BIN_MS) -
        HISTORY_BINS;
      for (const channel of ['mic', 'system'] as const)
        for (const index of bins[channel].keys())
          if (index < cutoff) bins[channel].delete(index);
      if (nextWindow !== null && nextWindow < cutoff) {
        nextWindow = cutoff;
        previous = [];
      }
      analyze();
      return revision !== beforeRevision;
    },
    snapshot(): LiveEchoEvidenceWindow[] {
      return verified
        .map((window) => ({ ...window }))
        .sort((a, b) => a.micStartMs - b.micStartMs);
    },
    diagnostics(): LiveEchoEvidenceDiagnostics {
      return { ...diagnostics, retainedWindows: verified.length };
    },
    reset(): void {
      bins.mic.clear();
      bins.system.clear();
      lastEnd.mic = Number.NEGATIVE_INFINITY;
      lastEnd.system = Number.NEGATIVE_INFINITY;
      verified.length = 0;
      lastByLag.clear();
      nextWindow = null;
      previous = [];
      revision = 0;
      for (const key of Object.keys(diagnostics) as Array<
        keyof typeof diagnostics
      >) {
        diagnostics[key] = 0;
      }
    },
  };
};
