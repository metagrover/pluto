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
  trackedMetrics?: RecordingQualityBenchmarkTrackedMetric[];
};

export type RecordingQualityBenchmarkCaseResult = {
  id: string;
  issue: number;
  title: string;
  kind: RecordingQualityBenchmarkCaseKind;
  passed: boolean;
  actual: {
    status: 'validated' | 'needs_attention';
    primaryMetric?: RecordingQualityBenchmarkMetric;
    metrics?: RecordingQualityBenchmarkMetric[];
    reasons?: string[];
  };
  expected: RecordingQualityBenchmarkExpectation;
  failures?: string[];
};

export type RecordingQualityBenchmarkComparisonEntry = {
  caseId: string;
  metricName: string;
  baselineValue: number | string | boolean;
  currentValue: number | string | boolean;
  tolerance: number;
  delta?: number;
};

export type RecordingQualityBenchmarkComparison = {
  summary: {
    stableRegressions: number;
    hardwareDependentChanges: number;
    missingBaselineCases: number;
    missingBaselineMetrics: number;
    withinTolerance: number;
    improvements: number;
  };
  stableRegressions: RecordingQualityBenchmarkComparisonEntry[];
  hardwareDependentChanges: RecordingQualityBenchmarkComparisonEntry[];
  missingBaselineCases: string[];
  missingBaselineMetrics: Array<{ caseId: string; metricName: string }>;
  withinTolerance: RecordingQualityBenchmarkComparisonEntry[];
  improvements: RecordingQualityBenchmarkComparisonEntry[];
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
  baselineComparison?: RecordingQualityBenchmarkComparison;
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

const toTrackedMetric = (
  raw: unknown,
): RecordingQualityBenchmarkTrackedMetric => {
  if (!isObject(raw)) {
    throw new Error('Tracked benchmark metrics must be objects.');
  }

  const name = String(raw.name || '').trim();
  const tolerance = Number(raw.tolerance);
  const stability = String(raw.stability || '').trim();

  if (!name) {
    throw new Error('Tracked benchmark metrics need a name.');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      `Tracked benchmark metric ${name} needs a non-negative tolerance.`,
    );
  }
  if (stability !== 'stable' && stability !== 'hardware_dependent') {
    throw new Error(
      `Tracked benchmark metric ${name} needs stability stable or hardware_dependent.`,
    );
  }

  return {
    name,
    tolerance,
    stability,
  };
};

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
        ? entry.trackedMetrics.map((metric) => toTrackedMetric(metric))
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

const metricArray = (
  metric: RecordingQualityBenchmarkMetric | undefined,
): RecordingQualityBenchmarkMetric[] =>
  metric ? [metric] : [];

const collectTranscriptMetrics = (
  result: RecordingTranscriptValidationResult,
): RecordingQualityBenchmarkMetric[] => [
  {
    name: 'localTranscriptCoveredSeconds',
    value: result.evidence.localTranscriptCoveredSeconds,
  },
  {
    name: 'remoteTranscriptCoveredSeconds',
    value: result.evidence.remoteTranscriptCoveredSeconds,
  },
  {
    name: 'unresolvedAmbiguousSeconds',
    value: result.evidence.unresolvedAmbiguousSeconds,
  },
];

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
    actual: {
      status: result.status,
      primaryMetric: actualMetric,
      metrics: collectTranscriptMetrics(result),
      reasons: result.reasons,
    },
    expected: {
      ...fixture.expected,
      trackedMetrics: meta.trackedMetrics,
    },
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
    actual: {
      status: failures.length === 0 ? 'validated' : 'needs_attention',
      primaryMetric: actualMetric,
      metrics: metricArray(actualMetric),
      reasons: failures,
    },
    expected: {
      ...fixture.expected,
      trackedMetrics: meta.trackedMetrics,
    },
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

const collectRetryValidationMetrics = (
  meeting: Meeting,
): RecordingQualityBenchmarkMetric[] => {
  const metric = makeRetryValidationMetric(meeting, 'activityEvidenceSource');
  return metricArray(metric);
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
    actual: {
      status: actualStatus,
      primaryMetric: actualMetric,
      metrics: collectRetryValidationMetrics(currentMeeting),
      reasons,
    },
    expected: {
      ...fixture.expected,
      trackedMetrics: meta.trackedMetrics,
    },
    ...(failures.length > 0 ? { failures } : {}),
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
  };
};

const metricDirection = (
  metricName: string,
): 'higher_is_better' | 'lower_is_better' | 'exact_match' => {
  switch (metricName) {
    case 'localTranscriptCoveredSeconds':
    case 'remoteTranscriptCoveredSeconds':
      return 'higher_is_better';
    case 'unresolvedAmbiguousSeconds':
    case 'durationSeconds':
      return 'lower_is_better';
    default:
      return 'exact_match';
  }
};

const getActualMetric = (
  result: RecordingQualityBenchmarkCaseResult,
  metricName: string,
): RecordingQualityBenchmarkMetric | undefined => {
  const metrics = result.actual.metrics || metricArray(result.actual.primaryMetric);
  return metrics.find((metric) => metric.name === metricName);
};

const compareTrackedMetric = (input: {
  caseId: string;
  trackedMetric: RecordingQualityBenchmarkTrackedMetric;
  currentMetric: RecordingQualityBenchmarkMetric;
  baselineMetric: RecordingQualityBenchmarkMetric;
}) => {
  const { caseId, trackedMetric, currentMetric, baselineMetric } = input;

  if (
    typeof currentMetric.value === 'number' &&
    typeof baselineMetric.value === 'number'
  ) {
    const delta = Number(
      (currentMetric.value - baselineMetric.value).toFixed(4),
    );
    const magnitude = Math.abs(delta);
    const entry: RecordingQualityBenchmarkComparisonEntry = {
      caseId,
      metricName: trackedMetric.name,
      baselineValue: baselineMetric.value,
      currentValue: currentMetric.value,
      tolerance: trackedMetric.tolerance,
      delta,
    };

    if (magnitude <= trackedMetric.tolerance) {
      return { bucket: 'withinTolerance' as const, entry };
    }

    if (trackedMetric.stability === 'hardware_dependent') {
      return { bucket: 'hardwareDependentChanges' as const, entry };
    }

    const direction = metricDirection(trackedMetric.name);
    if (direction === 'higher_is_better' && delta > 0) {
      return { bucket: 'improvements' as const, entry };
    }
    if (direction === 'lower_is_better' && delta < 0) {
      return { bucket: 'improvements' as const, entry };
    }

    return { bucket: 'stableRegressions' as const, entry };
  }

  if (currentMetric.value === baselineMetric.value) {
    return {
      bucket: 'withinTolerance' as const,
      entry: {
        caseId,
        metricName: trackedMetric.name,
        baselineValue: baselineMetric.value,
        currentValue: currentMetric.value,
        tolerance: trackedMetric.tolerance,
      },
    };
  }

  const entry: RecordingQualityBenchmarkComparisonEntry = {
    caseId,
    metricName: trackedMetric.name,
    baselineValue: baselineMetric.value,
    currentValue: currentMetric.value,
    tolerance: trackedMetric.tolerance,
  };

  return trackedMetric.stability === 'hardware_dependent'
    ? { bucket: 'hardwareDependentChanges' as const, entry }
    : { bucket: 'stableRegressions' as const, entry };
};

export const compareRecordingQualityBenchmarkToBaseline = (input: {
  report: RecordingQualityBenchmarkReport;
  baselineReport: RecordingQualityBenchmarkReport;
}): RecordingQualityBenchmarkComparison => {
  const comparison: RecordingQualityBenchmarkComparison = {
    summary: {
      stableRegressions: 0,
      hardwareDependentChanges: 0,
      missingBaselineCases: 0,
      missingBaselineMetrics: 0,
      withinTolerance: 0,
      improvements: 0,
    },
    stableRegressions: [],
    hardwareDependentChanges: [],
    missingBaselineCases: [],
    missingBaselineMetrics: [],
    withinTolerance: [],
    improvements: [],
  };

  const baselineById = new Map(
    input.baselineReport.results.map((result) => [result.id, result]),
  );

  for (const result of input.report.results) {
    const trackedMetrics = result.expected.trackedMetrics || [];
    if (trackedMetrics.length === 0) continue;

    const baselineResult = baselineById.get(result.id);
    if (!baselineResult) {
      comparison.missingBaselineCases.push(result.id);
      continue;
    }

    for (const trackedMetric of trackedMetrics) {
      const currentMetric = getActualMetric(result, trackedMetric.name);
      const baselineMetric = getActualMetric(baselineResult, trackedMetric.name);
      if (!currentMetric || !baselineMetric) {
        comparison.missingBaselineMetrics.push({
          caseId: result.id,
          metricName: trackedMetric.name,
        });
        continue;
      }

      const classified = compareTrackedMetric({
        caseId: result.id,
        trackedMetric,
        currentMetric,
        baselineMetric,
      });
      comparison[classified.bucket].push(classified.entry);
    }
  }

  comparison.summary = {
    stableRegressions: comparison.stableRegressions.length,
    hardwareDependentChanges: comparison.hardwareDependentChanges.length,
    missingBaselineCases: comparison.missingBaselineCases.length,
    missingBaselineMetrics: comparison.missingBaselineMetrics.length,
    withinTolerance: comparison.withinTolerance.length,
    improvements: comparison.improvements.length,
  };

  return comparison;
};

const summarizeEntries = (
  label: string,
  entries: RecordingQualityBenchmarkComparisonEntry[],
) =>
  entries.length === 0
    ? null
    : `${label}: ${entries
        .map((entry) => `${entry.caseId}.${entry.metricName}`)
        .join(', ')}`;

export const formatRecordingQualityBenchmarkComparisonSummary = (
  comparison: RecordingQualityBenchmarkComparison,
) => {
  const parts = [
    `[RecordingQualityBenchmark] baseline comparison: ${comparison.summary.stableRegressions} stable regressions, ${comparison.summary.hardwareDependentChanges} hardware-dependent changes, ${comparison.summary.withinTolerance} within tolerance, ${comparison.summary.improvements} improvements, ${comparison.summary.missingBaselineCases} missing baseline cases, ${comparison.summary.missingBaselineMetrics} missing baseline metrics`,
    summarizeEntries('stable regressions', comparison.stableRegressions),
    summarizeEntries(
      'hardware-dependent changes',
      comparison.hardwareDependentChanges,
    ),
    summarizeEntries('within tolerance', comparison.withinTolerance),
    summarizeEntries('improvements', comparison.improvements),
    comparison.missingBaselineCases.length === 0
      ? null
      : `missing baseline cases: ${comparison.missingBaselineCases.join(', ')}`,
    comparison.missingBaselineMetrics.length === 0
      ? null
      : `missing baseline metrics: ${comparison.missingBaselineMetrics
          .map((entry) => `${entry.caseId}.${entry.metricName}`)
          .join(', ')}`,
  ];

  return parts.filter(Boolean).join('\n');
};
