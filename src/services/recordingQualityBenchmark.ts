import path from 'node:path';
import type { Meeting } from '../types.ts';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  resolveFinalizationCleanupPaths,
} from '../utils/recordingFinalization.ts';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../utils/speakerAttribution.ts';
import {
  type RecordingTranscriptValidationResult,
  runRecordingTranscriptValidation,
} from './recordingTranscriptValidation.ts';
import { retryMeetingTranscriptValidation } from './retryMeetingTranscriptValidation.ts';

export type RecordingQualityBenchmarkCaseKind =
  | 'transcript_validation'
  | 'recording_finalization'
  | 'retry_validation';

export type RecordingQualityBenchmarkManifestCase = {
  id: string;
  issue: number;
  title: string;
  kind: RecordingQualityBenchmarkCaseKind;
  fixture: string;
  trackedMetrics?: RecordingQualityBenchmarkTrackedMetric[];
};

export type RecordingQualityBenchmarkManifest = {
  schemaVersion: number;
  baselineReport: string;
  cases: RecordingQualityBenchmarkManifestCase[];
};

export type RecordingQualityBenchmarkMetric = {
  name: string;
  value: number | string | boolean;
};

export type RecordingQualityBenchmarkTrackedMetric = {
  name: string;
  tolerance: number;
  stability: 'stable' | 'hardware_dependent';
};

export type RecordingQualityBenchmarkExpectation = {
  status: 'validated' | 'needs_attention';
  primaryMetric?: RecordingQualityBenchmarkMetric;
};

export type RecordingQualityBenchmarkCaseResult = {
  id: string;
  issue: number;
  title: string;
  kind: RecordingQualityBenchmarkCaseKind;
  passed: boolean;
  trackedMetrics?: RecordingQualityBenchmarkTrackedMetric[];
  actual: {
    status: 'validated' | 'needs_attention';
    primaryMetric?: RecordingQualityBenchmarkMetric;
    reasons?: string[];
  };
  expected: RecordingQualityBenchmarkExpectation;
  failures?: string[];
};

export type RecordingQualityBenchmarkReport = {
  schemaVersion: number;
  generatedAt: string;
  manifestPath: string;
  baselineReportPath: string;
  sourceCommit: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    passRate: number;
    issueCoverage: number[];
    kinds: Record<
      RecordingQualityBenchmarkCaseKind,
      {
        passed: number;
        failed: number;
      }
    >;
  };
  results: RecordingQualityBenchmarkCaseResult[];
  failures: RecordingQualityBenchmarkCaseResult[];
  comparisonSummary: RecordingQualityBenchmarkComparisonCounts;
  comparisons: RecordingQualityBenchmarkComparisonEntry[];
};

export type RecordingQualityBenchmarkComparisonOutcome =
  | 'stable_regression'
  | 'stable_improvement'
  | 'stable_within_tolerance'
  | 'hardware_dependent_drift'
  | 'missing_baseline_metric';

export type RecordingQualityBenchmarkComparisonEntry = {
  id: string;
  issue: number;
  title: string;
  metricName: string;
  tolerance: number;
  stability: 'stable' | 'hardware_dependent';
  outcome: RecordingQualityBenchmarkComparisonOutcome;
  baselineValue?: number | string | boolean;
  currentValue?: number | string | boolean;
  delta?: number;
};

export type RecordingQualityBenchmarkComparisonCounts = {
  stableRegressions: number;
  stableImprovements: number;
  stableWithinTolerance: number;
  hardwareDependentDrift: number;
  missingBaselineMetrics: number;
};

export type RecordingQualityBenchmarkCliOptions = {
  manifest: string;
  out: string;
};

type TranscriptValidationFixtureSource = {
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
  meta?: Record<string, unknown>;
  durationSeconds: number;
};

export type TranscriptValidationFixture = {
  type: 'transcript_validation';
  meetingId: string;
  recordingDurationSeconds: number;
  provisionalSegments: AttributionSegment[];
  activityWindows: SpeakerActivityWindow[];
  sources: {
    mic: TranscriptValidationFixtureSource;
    mix: TranscriptValidationFixtureSource;
    system: TranscriptValidationFixtureSource;
  };
  expected: RecordingQualityBenchmarkExpectation & {
    requiredReasons?: string[];
  };
};

export type RecordingFinalizationFixture = {
  type: 'recording_finalization';
  begin: {
    first: {
      meetingId: string | null;
      stopInFlight: boolean;
      recordingStartedAtMs: number;
      nowMs: number;
    };
    second: {
      meetingId: string | null;
      stopInFlight: boolean;
      recordingStartedAtMs: number;
      nowMs: number;
    };
  };
  timing: {
    recordingStartedAtMs: number;
    recordingEndedAtMs: number;
  };
  cleanup: {
    primaryAudioPath: string;
    systemAudioPath: string;
    rebuiltSystemAudioPath: string;
    mixedAudioPath: string;
    validationStatus: 'validated' | 'needs_attention';
  };
  expected: RecordingQualityBenchmarkExpectation & {
    secondCallReturnsNull: boolean;
    cleanupPaths: string[];
  };
};

export type RecordingQualityBenchmarkFixture =
  | TranscriptValidationFixture
  | RecordingFinalizationFixture
  | RetryValidationFixture;

type RetryValidationFixtureTranscription = {
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  meta?: Record<string, unknown>;
};

export type RetryValidationFixture = {
  type: 'retry_validation';
  meeting: Meeting;
  transcribeByPath: Record<string, RetryValidationFixtureTranscription>;
  probeDurationByPath: Record<string, number | null>;
  expected: RecordingQualityBenchmarkExpectation & {
    requiredReasons?: string[];
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const sortNumeric = (values: Iterable<number>) =>
  [...values].sort((left, right) => left - right);

const defaultComparisonCounts =
  (): RecordingQualityBenchmarkComparisonCounts => ({
    stableRegressions: 0,
    stableImprovements: 0,
    stableWithinTolerance: 0,
    hardwareDependentDrift: 0,
    missingBaselineMetrics: 0,
  });

export const parseRecordingQualityBenchmarkCliArgs = (
  args: string[],
  cwd: string,
  now = Date.now(),
): RecordingQualityBenchmarkCliOptions => {
  const options: RecordingQualityBenchmarkCliOptions = {
    manifest: path.join(cwd, 'scripts', 'recording-quality', 'manifest.json'),
    out: path.join(cwd, 'tmp', `recording-quality-benchmark-${now}.json`),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }

    if ((arg === '--manifest' || arg === '--out') && index + 1 < args.length) {
      const value = args[index + 1];
      if (arg === '--manifest') options.manifest = value;
      if (arg === '--out') options.out = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

export const loadRecordingQualityBenchmarkManifest = (
  raw: unknown,
): RecordingQualityBenchmarkManifest => {
  if (!isObject(raw)) {
    throw new Error('Recording quality benchmark manifest must be an object.');
  }

  const schemaVersion = Number(raw.schemaVersion);
  const baselineReport = String(raw.baselineReport || '').trim();
  const casesRaw = Array.isArray(raw.cases) ? raw.cases : [];
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error(
      'Recording quality benchmark manifest needs a schemaVersion.',
    );
  }
  if (!baselineReport) {
    throw new Error(
      'Recording quality benchmark manifest needs a baselineReport.',
    );
  }

  const seenIds = new Set<string>();
  const cases = casesRaw.map((entry) => {
    if (!isObject(entry)) {
      throw new Error('Recording quality benchmark cases must be objects.');
    }
    const id = String(entry.id || '').trim();
    if (!id) {
      throw new Error('Recording quality benchmark case id is required.');
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate benchmark case id: ${id}`);
    }
    seenIds.add(id);

    const kind = String(entry.kind || '').trim();
    if (
      kind !== 'transcript_validation' &&
      kind !== 'recording_finalization' &&
      kind !== 'retry_validation'
    ) {
      throw new Error(`Unsupported benchmark case kind: ${kind}`);
    }

    return {
      id,
      issue: Number(entry.issue),
      title: String(entry.title || '').trim(),
      kind,
      fixture: String(entry.fixture || '').trim(),
      trackedMetrics: Array.isArray(entry.trackedMetrics)
        ? entry.trackedMetrics.map((metric) => {
            if (!isObject(metric)) {
              throw new Error(`Tracked metrics for ${id} must be objects.`);
            }
            const name = String(metric.name || '').trim();
            const tolerance = Number(metric.tolerance);
            const stability = String(metric.stability || '').trim();
            if (!name) {
              throw new Error(`Tracked metrics for ${id} need a name.`);
            }
            if (Number.isNaN(tolerance) || tolerance < 0) {
              throw new Error(
                `Tracked metric ${name} for ${id} needs a non-negative tolerance.`,
              );
            }
            if (stability !== 'stable' && stability !== 'hardware_dependent') {
              throw new Error(
                `Tracked metric ${name} for ${id} has unsupported stability ${stability}.`,
              );
            }
            return {
              name,
              tolerance,
              stability,
            } satisfies RecordingQualityBenchmarkTrackedMetric;
          })
        : undefined,
    } satisfies RecordingQualityBenchmarkManifestCase;
  });

  return {
    schemaVersion,
    baselineReport,
    cases,
  };
};

const compareMetric = (
  actual: RecordingQualityBenchmarkMetric | undefined,
  expected: RecordingQualityBenchmarkMetric | undefined,
) => {
  if (!expected) return [];
  if (!actual) return [`missing primary metric ${expected.name}`];
  const failures: string[] = [];
  if (actual.name !== expected.name) {
    failures.push(
      `primary metric mismatch: expected ${expected.name}, received ${actual.name}`,
    );
  }
  if (actual.value !== expected.value) {
    failures.push(
      `${expected.name} mismatch: expected ${String(expected.value)}, received ${String(actual.value)}`,
    );
  }
  return failures;
};

const makeTranscriptMetric = (
  result: RecordingTranscriptValidationResult,
  metricName?: string,
): RecordingQualityBenchmarkMetric | undefined => {
  switch (metricName) {
    case 'localTranscriptCoveredSeconds':
      return {
        name: metricName,
        value: result.evidence.localTranscriptCoveredSeconds,
      };
    case 'remoteTranscriptCoveredSeconds':
      return {
        name: metricName,
        value: result.evidence.remoteTranscriptCoveredSeconds,
      };
    case 'unresolvedAmbiguousSeconds':
      return {
        name: metricName,
        value: result.evidence.unresolvedAmbiguousSeconds,
      };
    default:
      return undefined;
  }
};

export const runTranscriptValidationBenchmarkCase = async (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: TranscriptValidationFixture,
): Promise<RecordingQualityBenchmarkCaseResult> => {
  const result = await runRecordingTranscriptValidation({
    meetingId: fixture.meetingId,
    recordingDurationSeconds: fixture.recordingDurationSeconds,
    micAudioPath: '/synthetic/mic.wav',
    mixAudioPath: '/synthetic/mix.wav',
    systemAudioPath: '/synthetic/system.wav',
    provisionalSegments: fixture.provisionalSegments,
    activityWindows: fixture.activityWindows,
    transcribe: async (audioPath) => {
      if (audioPath.includes('/mic.')) return fixture.sources.mic;
      if (audioPath.includes('/mix.')) return fixture.sources.mix;
      return fixture.sources.system;
    },
    probeDuration: async (audioPath) => {
      if (audioPath.includes('/mic.'))
        return fixture.sources.mic.durationSeconds;
      if (audioPath.includes('/mix.'))
        return fixture.sources.mix.durationSeconds;
      return fixture.sources.system.durationSeconds;
    },
  });

  const actualMetric = makeTranscriptMetric(
    result,
    fixture.expected.primaryMetric?.name,
  );
  const failures = [
    ...(result.status === fixture.expected.status ? [] : ['status mismatch']),
    ...compareMetric(actualMetric, fixture.expected.primaryMetric),
    ...(fixture.expected.requiredReasons || [])
      .filter((reason) => !result.reasons.includes(reason))
      .map((reason) => `missing required reason ${reason}`),
  ];

  return {
    id: meta.id,
    issue: meta.issue,
    title: meta.title,
    kind: meta.kind,
    passed: failures.length === 0,
    trackedMetrics: meta.trackedMetrics,
    actual: {
      status: result.status,
      primaryMetric: actualMetric,
      reasons: result.reasons,
    },
    expected: fixture.expected,
    ...(failures.length > 0 ? { failures } : {}),
  };
};

export const runRecordingFinalizationBenchmarkCase = (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: RecordingFinalizationFixture,
): RecordingQualityBenchmarkCaseResult => {
  const first = beginRecordingFinalization(fixture.begin.first);
  const second = beginRecordingFinalization(fixture.begin.second);
  const timing = buildMeetingTiming(fixture.timing);
  const cleanupPaths = resolveFinalizationCleanupPaths(fixture.cleanup);
  const actualMetric: RecordingQualityBenchmarkMetric = {
    name: 'durationSeconds',
    value: timing.durationSeconds,
  };

  const failures = [
    ...((second === null) === fixture.expected.secondCallReturnsNull
      ? []
      : ['finalization re-entry mismatch']),
    ...compareMetric(actualMetric, fixture.expected.primaryMetric),
    ...(cleanupPaths.join('|') === fixture.expected.cleanupPaths.join('|')
      ? []
      : ['cleanup path mismatch']),
    ...(first ? [] : ['first finalization call did not start']),
  ];

  return {
    id: meta.id,
    issue: meta.issue,
    title: meta.title,
    kind: meta.kind,
    passed: failures.length === 0,
    trackedMetrics: meta.trackedMetrics,
    actual: {
      status: failures.length === 0 ? 'validated' : 'needs_attention',
      primaryMetric: actualMetric,
      reasons: failures,
    },
    expected: fixture.expected,
    ...(failures.length > 0 ? { failures } : {}),
  };
};

const makeRetryValidationMetric = (
  meeting: Meeting,
  metricName?: string,
): RecordingQualityBenchmarkMetric | undefined => {
  if (!metricName) return undefined;

  let parsedIntegrity: Record<string, unknown> = {};
  try {
    parsedIntegrity = JSON.parse(
      meeting.transcript_integrity_json || '{}',
    ) as Record<string, unknown>;
  } catch {
    parsedIntegrity = {};
  }

  switch (metricName) {
    case 'activityEvidenceSource':
      return typeof parsedIntegrity.activityEvidenceSource === 'string'
        ? {
            name: metricName,
            value: parsedIntegrity.activityEvidenceSource,
          }
        : undefined;
    default:
      return undefined;
  }
};

const readRetryValidationReasons = (meeting: Meeting): string[] => {
  try {
    const parsed = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      reasons?: unknown;
    };
    return Array.isArray(parsed.reasons)
      ? parsed.reasons.filter(
          (reason): reason is string => typeof reason === 'string',
        )
      : [];
  } catch {
    return [];
  }
};

export const runRetryValidationBenchmarkCase = async (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: RetryValidationFixture,
): Promise<RecordingQualityBenchmarkCaseResult> => {
  let currentMeeting: Meeting = structuredClone(fixture.meeting);

  const invoke = async (channel: string, ...args: unknown[]) => {
    if (channel === 'GET_MEETING') return currentMeeting;
    if (channel === 'SAVE_MEETING') {
      currentMeeting = {
        ...currentMeeting,
        ...((args[0] as Partial<Meeting> | undefined) || {}),
      };
      return true;
    }
    if (channel === 'WHISPER_TRANSCRIBE') {
      const audioPath = String(args[0] || '');
      return fixture.transcribeByPath[audioPath] || { segments: [] };
    }
    if (channel === 'AUDIO_PROBE_DURATION') {
      const audioPath = String(args[0] || '');
      return fixture.probeDurationByPath[audioPath] ?? null;
    }
    throw new Error(
      `Unexpected retry-validation benchmark channel: ${channel}`,
    );
  };

  const retryResult = await retryMeetingTranscriptValidation(
    String(fixture.meeting.id),
    invoke,
  );
  const actualMetric = makeRetryValidationMetric(
    currentMeeting,
    fixture.expected.primaryMetric?.name,
  );
  const reasons = readRetryValidationReasons(currentMeeting);
  const actualStatus =
    retryResult.status === 'superseded'
      ? 'needs_attention'
      : currentMeeting.transcript_status === 'validated'
        ? 'validated'
        : 'needs_attention';
  const failures = [
    ...(actualStatus === fixture.expected.status ? [] : ['status mismatch']),
    ...compareMetric(actualMetric, fixture.expected.primaryMetric),
    ...(fixture.expected.requiredReasons || [])
      .filter((reason) => !reasons.includes(reason))
      .map((reason) => `missing required reason ${reason}`),
  ];

  return {
    id: meta.id,
    issue: meta.issue,
    title: meta.title,
    kind: meta.kind,
    passed: failures.length === 0,
    trackedMetrics: meta.trackedMetrics,
    actual: {
      status: actualStatus,
      primaryMetric: actualMetric,
      reasons,
    },
    expected: fixture.expected,
    ...(failures.length > 0 ? { failures } : {}),
  };
};

const calculateMetricDelta = (
  baselineValue: number | string | boolean,
  currentValue: number | string | boolean,
) => {
  if (typeof baselineValue === 'number' && typeof currentValue === 'number') {
    return Number((currentValue - baselineValue).toFixed(4));
  }
  return undefined;
};

const formatValue = (value: number | string | boolean | undefined) =>
  value === undefined ? 'n/a' : String(value);

export const buildRecordingQualityBenchmarkComparisonSummary = (input: {
  baselineResults: Array<{
    id: string;
    actual?: {
      primaryMetric?: RecordingQualityBenchmarkMetric;
    };
  }>;
  results: RecordingQualityBenchmarkCaseResult[];
}) => {
  const counts = defaultComparisonCounts();
  const baselineById = new Map(
    input.baselineResults.map((result) => [result.id, result]),
  );
  const comparisons: RecordingQualityBenchmarkComparisonEntry[] = [];
  const sections = {
    stableRegressions: [] as RecordingQualityBenchmarkComparisonEntry[],
    stableImprovements: [] as RecordingQualityBenchmarkComparisonEntry[],
    stableWithinTolerance: [] as RecordingQualityBenchmarkComparisonEntry[],
    hardwareDependent: [] as RecordingQualityBenchmarkComparisonEntry[],
    missingBaseline: [] as RecordingQualityBenchmarkComparisonEntry[],
  };

  for (const result of input.results) {
    for (const trackedMetric of result.trackedMetrics || []) {
      const baselineMetric = baselineById.get(result.id)?.actual?.primaryMetric;

      if (!baselineMetric || baselineMetric.name !== trackedMetric.name) {
        counts.missingBaselineMetrics += 1;
        comparisons.push({
          id: result.id,
          issue: result.issue,
          title: result.title,
          metricName: trackedMetric.name,
          tolerance: trackedMetric.tolerance,
          stability: trackedMetric.stability,
          outcome: 'missing_baseline_metric',
          currentValue:
            result.actual.primaryMetric?.name === trackedMetric.name
              ? result.actual.primaryMetric.value
              : undefined,
        });
        sections.missingBaseline.push(comparisons[comparisons.length - 1]);
        continue;
      }

      const currentMetric =
        result.actual.primaryMetric?.name === trackedMetric.name
          ? result.actual.primaryMetric
          : undefined;

      if (!currentMetric) {
        counts.missingBaselineMetrics += 1;
        comparisons.push({
          id: result.id,
          issue: result.issue,
          title: result.title,
          metricName: trackedMetric.name,
          tolerance: trackedMetric.tolerance,
          stability: trackedMetric.stability,
          outcome: 'missing_baseline_metric',
          baselineValue: baselineMetric.value,
        });
        sections.missingBaseline.push(comparisons[comparisons.length - 1]);
        continue;
      }

      const delta = calculateMetricDelta(
        baselineMetric.value,
        currentMetric.value,
      );
      const valuesMatch = baselineMetric.value === currentMetric.value;
      const absDelta =
        typeof delta === 'number'
          ? Math.abs(delta)
          : valuesMatch
            ? 0
            : Number.POSITIVE_INFINITY;
      let outcome: RecordingQualityBenchmarkComparisonOutcome;

      if (trackedMetric.stability === 'hardware_dependent') {
        if (absDelta > trackedMetric.tolerance) {
          counts.hardwareDependentDrift += 1;
          outcome = 'hardware_dependent_drift';
        } else {
          counts.stableWithinTolerance += 1;
          outcome = 'stable_within_tolerance';
        }
      } else if (absDelta <= trackedMetric.tolerance) {
        counts.stableWithinTolerance += 1;
        outcome = 'stable_within_tolerance';
      } else if (typeof delta === 'number' && delta > 0) {
        counts.stableImprovements += 1;
        outcome = 'stable_improvement';
      } else {
        counts.stableRegressions += 1;
        outcome = 'stable_regression';
      }

      comparisons.push({
        id: result.id,
        issue: result.issue,
        title: result.title,
        metricName: trackedMetric.name,
        tolerance: trackedMetric.tolerance,
        stability: trackedMetric.stability,
        outcome,
        baselineValue: baselineMetric.value,
        currentValue: currentMetric.value,
        delta,
      });

      const entry = comparisons[comparisons.length - 1];
      if (outcome === 'stable_regression') {
        sections.stableRegressions.push(entry);
      } else if (outcome === 'stable_improvement') {
        sections.stableImprovements.push(entry);
      } else if (outcome === 'stable_within_tolerance') {
        sections.stableWithinTolerance.push(entry);
      } else if (outcome === 'hardware_dependent_drift') {
        sections.hardwareDependent.push(entry);
      }
    }
  }

  return {
    counts,
    comparisons,
    failures: sections.stableRegressions,
    sections,
    lines: [
      ...sections.stableRegressions.map(
        (entry) =>
          `stable regressions: ${entry.id} ${entry.metricName} ${formatValue(entry.baselineValue)} -> ${formatValue(entry.currentValue)} (tol +/-${entry.tolerance})`,
      ),
      ...sections.stableImprovements.map(
        (entry) =>
          `stable improvements: ${entry.id} ${entry.metricName} ${formatValue(entry.baselineValue)} -> ${formatValue(entry.currentValue)} (tol +/-${entry.tolerance})`,
      ),
      ...sections.stableWithinTolerance.map(
        (entry) =>
          `stable within tolerance: ${entry.id} ${entry.metricName} ${formatValue(entry.baselineValue)} -> ${formatValue(entry.currentValue)} (tol +/-${entry.tolerance})`,
      ),
      ...sections.hardwareDependent.map(
        (entry) =>
          `hardware-dependent drift: ${entry.id} ${entry.metricName} ${formatValue(entry.baselineValue)} -> ${formatValue(entry.currentValue)} (tol +/-${entry.tolerance})`,
      ),
      ...sections.missingBaseline.map(
        (entry) => `missing baseline metrics: ${entry.id} ${entry.metricName}`,
      ),
    ],
  };
};

export const buildRecordingQualityBenchmarkReport = (input: {
  schemaVersion: number;
  manifestPath: string;
  baselineReportPath: string;
  generatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  sourceCommit: string;
  results: RecordingQualityBenchmarkCaseResult[];
  baselineResults?: Array<{
    id: string;
    actual?: {
      primaryMetric?: RecordingQualityBenchmarkMetric;
    };
  }>;
}): RecordingQualityBenchmarkReport => {
  const passedCases = input.results.filter((result) => result.passed).length;
  const failedCases = input.results.length - passedCases;
  const kinds: Record<
    RecordingQualityBenchmarkCaseKind,
    { passed: number; failed: number }
  > = {
    recording_finalization: { passed: 0, failed: 0 },
    transcript_validation: { passed: 0, failed: 0 },
    retry_validation: { passed: 0, failed: 0 },
  };

  for (const result of input.results) {
    if (result.passed) kinds[result.kind].passed += 1;
    else kinds[result.kind].failed += 1;
  }

  const comparisonSummary = input.baselineResults
    ? buildRecordingQualityBenchmarkComparisonSummary({
        baselineResults: input.baselineResults,
        results: input.results,
      })
    : {
        counts: defaultComparisonCounts(),
        comparisons: [],
      };

  return {
    schemaVersion: input.schemaVersion,
    generatedAt: input.generatedAt,
    manifestPath: input.manifestPath,
    baselineReportPath: input.baselineReportPath,
    sourceCommit: input.sourceCommit,
    environment: input.environment,
    summary: {
      totalCases: input.results.length,
      passedCases,
      failedCases,
      passRate:
        input.results.length === 0
          ? 0
          : Number((passedCases / input.results.length).toFixed(4)),
      issueCoverage: sortNumeric(
        new Set(input.results.map((result) => result.issue)),
      ),
      kinds,
    },
    results: input.results,
    failures: input.results.filter((result) => !result.passed),
    comparisonSummary: comparisonSummary.counts,
    comparisons: comparisonSummary.comparisons,
  };
};
