import fs from 'node:fs';
import path from 'node:path';

// Measured local model throughput on this Mac.
//
// Apple Silicon Macs differ widely (memory, GPU cores, bounded or automatic
// GPU placement, competing load), so interactive budgets are planned from
// what this machine actually achieved, not from its memory size. Every
// completed Ollama generation reports load, prompt-evaluation and output
// timings; they are folded into one profile per model and placement.

export interface LocalThroughputSample {
  model: string;
  digest?: string;
  placement: string;
  promptTokens: number | null;
  promptMs: number | null;
  outputTokens: number | null;
  outputMs: number | null;
  loadMs: number | null;
}

export interface LocalThroughputProfile {
  digest?: string;
  placement: string;
  promptTokensPerSecond: number;
  outputTokensPerSecond: number;
  coldLoadMs: number;
  samples: number;
  updatedAt: string;
  // Largest memory use observed during a cold load, and its context size.
  coldPeakBytes?: number;
  coldPeakContextTokens?: number;
}

// Conservative starting point until this Mac has been measured: slower than
// any supported configuration observed, so first requests err long.
export const DEFAULT_LOCAL_THROUGHPUT: Omit<
  LocalThroughputProfile,
  'placement' | 'samples' | 'updatedAt'
> = {
  promptTokensPerSecond: 40,
  outputTokensPerSecond: 8,
  coldLoadMs: 45_000,
};

const SMOOTHING = 0.3;
// Short evaluations are dominated by fixed overhead and overstate cost.
const MIN_PROMPT_TOKENS = 256;
const MIN_OUTPUT_TOKENS = 16;
// Load durations below this are warm-slot bookkeeping, not weight loading.
const MIN_COLD_LOAD_MS = 1_000;

const profiles = new Map<string, LocalThroughputProfile>();
let storePath: string | null = null;

const normalizeModel = (model: string): string =>
  model
    .trim()
    .toLowerCase()
    .replace(/:latest$/, '');

export const describeOllamaPlacement = (
  options: Record<string, unknown> | undefined,
): string => {
  const gpu = options?.num_gpu;
  return typeof gpu === 'number' && Number.isFinite(gpu)
    ? `gpu:${gpu}`
    : 'gpu:auto';
};

const smooth = (previous: number, next: number, samples: number): number =>
  samples === 0 ? next : previous + SMOOTHING * (next - previous);

const rate = (tokens: number | null, ms: number | null, minimum: number) =>
  tokens !== null && ms !== null && tokens >= minimum && ms > 0
    ? (tokens / ms) * 1000
    : null;

const persist = () => {
  if (!storePath) return;
  try {
    const temporary = `${storePath}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, profiles: Object.fromEntries(profiles) }),
      { mode: 0o600 },
    );
    fs.renameSync(temporary, storePath);
  } catch {
    // Profiles are an optimization; a failed write must not affect inference.
  }
};

export const configureLocalInferenceProfileStore = (
  directory: string | null,
): void => {
  profiles.clear();
  storePath = directory
    ? path.join(directory, 'local-inference-profile.json')
    : null;
  if (!storePath) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
      version?: number;
      profiles?: Record<string, LocalThroughputProfile>;
    };
    if (parsed.version !== 1 || !parsed.profiles) return;
    for (const [model, profile] of Object.entries(parsed.profiles))
      if (
        profile &&
        typeof profile.placement === 'string' &&
        profile.promptTokensPerSecond > 0 &&
        profile.outputTokensPerSecond > 0 &&
        profile.coldLoadMs > 0
      )
        profiles.set(model, profile);
  } catch {
    // Missing or unreadable profiles start from the conservative default.
  }
};

export const recordLocalThroughput = (sample: LocalThroughputSample): void => {
  const key = normalizeModel(sample.model);
  if (!key) return;
  const coldLoad =
    sample.loadMs !== null && sample.loadMs >= MIN_COLD_LOAD_MS
      ? sample.loadMs
      : null;
  // A warm request can reuse a cached prompt prefix, so its token count and
  // duration need not describe the same work. A fresh load has no cache.
  const promptRate =
    coldLoad === null
      ? null
      : rate(sample.promptTokens, sample.promptMs, MIN_PROMPT_TOKENS);
  const outputRate = rate(
    sample.outputTokens,
    sample.outputMs,
    MIN_OUTPUT_TOKENS,
  );
  if (promptRate === null && outputRate === null && coldLoad === null) return;

  const existing = profiles.get(key);
  // A different artifact or GPU placement is a different machine profile.
  const current =
    existing &&
    existing.placement === sample.placement &&
    (existing.digest ?? null) === (sample.digest ?? null)
      ? existing
      : undefined;
  const samples = current?.samples ?? 0;
  const base = current ?? {
    ...DEFAULT_LOCAL_THROUGHPUT,
    digest: sample.digest,
    placement: sample.placement,
    samples: 0,
    updatedAt: '',
  };
  profiles.set(key, {
    digest: sample.digest,
    placement: sample.placement,
    promptTokensPerSecond:
      promptRate === null
        ? base.promptTokensPerSecond
        : smooth(base.promptTokensPerSecond, promptRate, samples),
    outputTokensPerSecond:
      outputRate === null
        ? base.outputTokensPerSecond
        : smooth(base.outputTokensPerSecond, outputRate, samples),
    coldLoadMs:
      coldLoad === null
        ? base.coldLoadMs
        : smooth(base.coldLoadMs, coldLoad, samples),
    samples: samples + 1,
    updatedAt: new Date().toISOString(),
    ...(current?.coldPeakBytes
      ? {
          coldPeakBytes: current.coldPeakBytes,
          coldPeakContextTokens: current.coldPeakContextTokens,
        }
      : {}),
  });
  persist();
};

// Peaks below this reflect concurrent memory release, not a load.
const MIN_PLAUSIBLE_PEAK_BYTES = 1024 ** 3;

// Keeps the largest observed cold-load peak so admission stays conservative.
export const recordLocalColdPeak = ({
  model,
  digest,
  placement,
  peakBytes,
  contextTokens,
}: {
  model: string;
  digest?: string;
  placement: string;
  peakBytes: number;
  contextTokens: number;
}): void => {
  const key = normalizeModel(model);
  const existing = profiles.get(key);
  if (
    !key ||
    !existing ||
    existing.placement !== placement ||
    (existing.digest ?? null) !== (digest ?? null) ||
    !Number.isFinite(peakBytes) ||
    peakBytes < MIN_PLAUSIBLE_PEAK_BYTES
  )
    return;
  // Compare peaks at the same context by removing the context allowance.
  const normalized = (bytes: number, tokens: number) =>
    bytes - tokens * 64 * 1024;
  if (
    existing.coldPeakBytes !== undefined &&
    normalized(existing.coldPeakBytes, existing.coldPeakContextTokens ?? 0) >=
      normalized(peakBytes, contextTokens)
  )
    return;
  profiles.set(key, {
    ...existing,
    coldPeakBytes: peakBytes,
    coldPeakContextTokens: contextTokens,
    updatedAt: new Date().toISOString(),
  });
  persist();
};

export const getMeasuredColdPeak = (
  model: string,
  digest: string | undefined,
  placement: string,
): { bytes: number; contextTokens: number } | undefined => {
  const profile = profiles.get(normalizeModel(model));
  return profile?.coldPeakBytes &&
    profile.placement === placement &&
    (profile.digest ?? null) === (digest ?? null)
    ? {
        bytes: profile.coldPeakBytes,
        contextTokens: profile.coldPeakContextTokens ?? 0,
      }
    : undefined;
};

export const getLocalThroughputProfile = (
  model: string,
): LocalThroughputProfile | undefined => profiles.get(normalizeModel(model));

// Measured values when available; otherwise the conservative default.
export const resolveLocalThroughput = (
  model: string,
): Pick<
  LocalThroughputProfile,
  'promptTokensPerSecond' | 'outputTokensPerSecond' | 'coldLoadMs'
> & { measured: boolean } => {
  const profile = getLocalThroughputProfile(model);
  return profile
    ? {
        promptTokensPerSecond: profile.promptTokensPerSecond,
        outputTokensPerSecond: profile.outputTokensPerSecond,
        coldLoadMs: profile.coldLoadMs,
        measured: true,
      }
    : { ...DEFAULT_LOCAL_THROUGHPUT, measured: false };
};

export const resetLocalInferenceProfilesForTest = (): void => {
  profiles.clear();
  storePath = null;
};
