import path from 'node:path';
import {
  runRecordingTranscriptValidation,
  type RecordingTranscriptValidationResult,
} from './recordingTranscriptValidation.ts';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  resolveFinalizationCleanupPaths,
} from '../utils/recordingFinalization.ts';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../utils/speakerAttribution.ts';

export type RecordingQualityBenchmarkCaseKind =
  | 'transcript_validation'
  | 'recording_finalization';

export type RecordingQualityBenchmarkManifestCase = {
  id: string;
  issue: number;
  title: string;
  kind: RecordingQualityBenchmarkCaseKind;
  fixture: string;
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
  | RecordingFinalizationFixture;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const sortNumeric = (values: Iterable<number>) =>
  [...values].sort((left, right) => left - right);

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
    throw new Error('Recording quality benchmark manifest needs a schemaVersion.');
  }
  if (!baselineReport) {
    throw new Error('Recording quality benchmark manifest needs a baselineReport.');
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
    if (kind !== 'transcript_validation' && kind !== 'recording_finalization') {
      throw new Error(`Unsupported benchmark case kind: ${kind}`);
    }

    return {
      id,
      issue: Number(entry.issue),
      title: String(entry.title || '').trim(),
      kind,
      fixture: String(entry.fixture || '').trim(),
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
      if (audioPath.includes('/mic.')) return fixture.sources.mic.durationSeconds;
      if (audioPath.includes('/mix.')) return fixture.sources.mix.durationSeconds;
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
    ...((fixture.expected.requiredReasons || []).filter(
      (reason) => !result.reasons.includes(reason),
    ).map((reason) => `missing required reason ${reason}`)),
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
    ...(second === null) === fixture.expected.secondCallReturnsNull
      ? []
      : ['finalization re-entry mismatch'],
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
      reasons: failures,
    },
    expected: fixture.expected,
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
      issueCoverage: sortNumeric(new Set(input.results.map((result) => result.issue))),
      kinds,
    },
    results: input.results,
    failures: input.results.filter((result) => !result.passed),
  };
};
