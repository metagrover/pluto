export type AskPlutoBenchmarkMode = 'fast' | 'deep';

export interface AskPlutoBenchmarkSample {
  mode: AskPlutoBenchmarkMode;
  firstTokenMs: number;
  totalMs: number;
  qualityPassed: boolean;
}

export const ASK_PLUTO_FIRST_TOKEN_TARGET_MS = {
  fast: 5000,
  deep: 15_000,
} as const;

export const percentile = (values: number[], quantile: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * quantile));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
};

const summarizeMode = (
  samples: AskPlutoBenchmarkSample[],
  mode: AskPlutoBenchmarkMode,
) => {
  const selected = samples.filter((sample) => sample.mode === mode);
  const firstTokenP95Ms = percentile(
    selected.map((sample) => sample.firstTokenMs),
    0.95,
  );
  return {
    sampleCount: selected.length,
    firstTokenP95Ms,
    totalP95Ms: percentile(
      selected.map((sample) => sample.totalMs),
      0.95,
    ),
    targetMs: ASK_PLUTO_FIRST_TOKEN_TARGET_MS[mode],
    qualityPassed:
      selected.length > 0 && selected.every((sample) => sample.qualityPassed),
    passed:
      selected.length > 0 &&
      Number.isFinite(firstTokenP95Ms) &&
      firstTokenP95Ms <= ASK_PLUTO_FIRST_TOKEN_TARGET_MS[mode] &&
      selected.every((sample) => sample.qualityPassed),
  };
};

export const evaluateAskPlutoBenchmark = (
  samples: AskPlutoBenchmarkSample[],
) => {
  const fast = summarizeMode(samples, 'fast');
  const deep = summarizeMode(samples, 'deep');
  return {
    passed: fast.passed && deep.passed,
    fast,
    deep,
  };
};
