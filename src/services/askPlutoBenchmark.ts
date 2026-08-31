export type AskPlutoBenchmarkMode = 'fast' | 'deep';

export interface AskPlutoBenchmarkSample {
  mode: AskPlutoBenchmarkMode;
  policy: 'notes_only' | 'transcript_exact' | 'transcript_fallback';
  retrievalMs: number;
  queueMs: number;
  firstTokenMs: number;
  generationMs: number;
  totalMs: number;
  promptChars: number;
  evidenceChars: number;
  sourceCount: number;
  coldStart: boolean;
  qualityPassed: boolean;
}

const SAMPLE_KEYS = new Set<keyof AskPlutoBenchmarkSample>([
  'mode',
  'policy',
  'retrievalMs',
  'queueMs',
  'firstTokenMs',
  'generationMs',
  'totalMs',
  'promptChars',
  'evidenceChars',
  'sourceCount',
  'coldStart',
  'qualityPassed',
]);

export const validateAskPlutoBenchmarkSample = (
  value: unknown,
): value is AskPlutoBenchmarkSample => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !SAMPLE_KEYS.has(key as never))) {
    return false;
  }
  return (
    (record.mode === 'fast' || record.mode === 'deep') &&
    (record.policy === 'notes_only' ||
      record.policy === 'transcript_exact' ||
      record.policy === 'transcript_fallback') &&
    [
      'retrievalMs',
      'queueMs',
      'firstTokenMs',
      'generationMs',
      'totalMs',
      'promptChars',
      'evidenceChars',
      'sourceCount',
    ].every(
      (key) =>
        typeof record[key] === 'number' &&
        Number.isFinite(record[key]) &&
        Number(record[key]) >= 0,
    ) &&
    typeof record.coldStart === 'boolean' &&
    typeof record.qualityPassed === 'boolean'
  );
};

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
