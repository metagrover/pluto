import path from 'node:path';

export type MeetingNotesLatencyDurationBucket = '15m' | '30m' | '45m';

export type PrivateMeetingNotesLatencyCase = {
  caseKey: string;
  meetingId: string;
  durationBucket: MeetingNotesLatencyDurationBucket;
};

export type PrivateMeetingNotesLatencyManifest = {
  schemaVersion: 1;
  databasePath: string;
  cases: PrivateMeetingNotesLatencyCase[];
};

export type MeetingNotesLatencySample = {
  caseKey: string;
  durationBucket: MeetingNotesLatencyDurationBucket;
  status: 'published' | 'failed' | 'cancelled';
  totalMs: number;
  queueMs: number;
  modelMs: number;
  modelCallCount: number;
  errorCode?: string;
};

const invalidManifest = (): never => {
  throw new Error('invalid_private_meeting_notes_latency_manifest');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const durationBuckets = new Set<MeetingNotesLatencyDurationBucket>([
  '15m',
  '30m',
  '45m',
]);

export const parsePrivateMeetingNotesLatencyManifest = (
  value: unknown,
): PrivateMeetingNotesLatencyManifest => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.databasePath !== 'string' ||
    !path.isAbsolute(value.databasePath) ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    value.cases.length > 24
  ) {
    return invalidManifest();
  }
  const cases: PrivateMeetingNotesLatencyCase[] = [];
  const caseKeys = new Set<string>();
  const meetingIds = new Set<string>();
  for (const candidate of value.cases) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some(
        (key) => !['caseKey', 'meetingId', 'durationBucket'].includes(key),
      ) ||
      typeof candidate.caseKey !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.caseKey) ||
      typeof candidate.meetingId !== 'string' ||
      !candidate.meetingId.trim() ||
      !durationBuckets.has(
        candidate.durationBucket as MeetingNotesLatencyDurationBucket,
      ) ||
      caseKeys.has(candidate.caseKey) ||
      meetingIds.has(candidate.meetingId)
    ) {
      return invalidManifest();
    }
    caseKeys.add(candidate.caseKey);
    meetingIds.add(candidate.meetingId);
    cases.push({
      caseKey: candidate.caseKey,
      meetingId: candidate.meetingId,
      durationBucket:
        candidate.durationBucket as MeetingNotesLatencyDurationBucket,
    });
  }
  return { schemaVersion: 1, databasePath: value.databasePath, cases };
};

export const summarizePrivateMeetingNotesLatencyManifest = (
  manifest: PrivateMeetingNotesLatencyManifest,
) => ({
  schemaVersion: 1 as const,
  caseCount: manifest.cases.length,
  durationBuckets: {
    '15m': manifest.cases.filter((entry) => entry.durationBucket === '15m')
      .length,
    '30m': manifest.cases.filter((entry) => entry.durationBucket === '30m')
      .length,
    '45m': manifest.cases.filter((entry) => entry.durationBucket === '45m')
      .length,
  },
});

const forbiddenReportKeys = new Set([
  'prompt',
  'transcript',
  'notes',
  'title',
  'speaker',
  'audiopath',
  'systemaudiopath',
  'mixedaudiopath',
  'meetingid',
  'databasepath',
  'sourcetext',
  'raw',
  'rawresponse',
]);

export const assertContentFreeMeetingNotesLatencyReport = (
  value: unknown,
  privateSentinels: readonly string[] = [],
): void => {
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      if (
        privateSentinels.some(
          (sentinel) => sentinel.length > 0 && candidate.includes(sentinel),
        )
      ) {
        throw new Error('unsafe_meeting_notes_latency_report');
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (forbiddenReportKeys.has(key.toLowerCase())) {
        throw new Error('unsafe_meeting_notes_latency_report');
      }
      visit(entry);
    }
  };
  visit(value);
};

const roundedMean = (values: number[]): number | null =>
  values.length
    ? Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
      )
    : null;

const percentile = (values: number[], fraction: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[midpoint - 1]! + sorted[midpoint]!) / 2)
    : sorted[midpoint]!;
};

export const aggregateMeetingNotesLatencySamples = (
  samples: readonly MeetingNotesLatencySample[],
) => {
  const published = samples.filter((sample) => sample.status === 'published');
  const totals = published.map((sample) => sample.totalMs);
  return {
    sampleCount: samples.length,
    publishedCount: published.length,
    failedCount: samples.filter((sample) => sample.status === 'failed').length,
    publishRate: samples.length ? published.length / samples.length : 0,
    meanTotalMs: roundedMean(totals),
    medianTotalMs: median(totals),
    p90TotalMs: percentile(totals, 0.9),
    meanQueueMs: roundedMean(published.map((sample) => sample.queueMs)),
    meanModelMs: roundedMean(published.map((sample) => sample.modelMs)),
    meanModelCallCount: roundedMean(
      published.map((sample) => sample.modelCallCount),
    ),
  };
};
