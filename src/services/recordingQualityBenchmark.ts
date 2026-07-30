import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  appendCaptureJournalChunk,
  createCaptureJournal,
} from '../../electron/captureJournal.ts';
import { recoverInterruptedCaptureJournals } from '../../electron/captureJournalRecovery.ts';
import type { Meeting } from '../types.ts';
import {
  type LiveTranscriptResponsivenessSummary,
  createLiveTranscriptResponsivenessAccumulator,
} from '../utils/liveTranscriptResponsiveness.ts';
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
  | 'capture_recovery'
  | 'transcript_validation'
  | 'recording_finalization'
  | 'retry_validation'
  | 'live_transcript_responsiveness'
  | 'candidate_eligibility';

export type RecordingQualityBenchmarkTier = 'pr' | 'manual';
export type RecordingQualityBenchmarkTierSelection =
  | RecordingQualityBenchmarkTier
  | 'all';

export type RecordingQualityBenchmarkManifestCase = {
  id: string;
  issue: number;
  title: string;
  kind: RecordingQualityBenchmarkCaseKind;
  fixture: string;
  tier: RecordingQualityBenchmarkTier;
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

export type RecordingQualityBenchmarkMeasurement =
  | {
      status: 'available';
      value: number;
      unit: 'milliseconds' | 'microseconds' | 'bytes';
      stability: 'stable' | 'hardware_dependent';
      method:
        | 'monotonic_elapsed'
        | 'process_cpu_delta'
        | 'sampled_process_rss'
        | 'case_artifact_sum';
    }
  | {
      status: 'unavailable';
      reason: 'not_applicable' | 'unsupported_runtime' | 'collection_failed';
    };

export type RecordingQualityBenchmarkMeasurements = {
  elapsedTime: RecordingQualityBenchmarkMeasurement;
  cpuTime: RecordingQualityBenchmarkMeasurement;
  peakRss: RecordingQualityBenchmarkMeasurement;
  artifactBytes: RecordingQualityBenchmarkMeasurement;
};

export type RecordingQualityBenchmarkTrackedMetric = {
  name: string;
  tolerance: number;
  stability: 'stable' | 'hardware_dependent';
};

export type RecordingQualityBenchmarkExpectation = {
  status: 'validated' | 'needs_attention';
  primaryMetric?: RecordingQualityBenchmarkMetric;
  eligibility?: {
    eligible: boolean;
    reasons: string[];
  };
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
    eligibility?: {
      eligible: boolean;
      reasons: string[];
    };
    responsiveness?: LiveTranscriptResponsivenessSummary;
    reasons?: string[];
  };
  expected: RecordingQualityBenchmarkExpectation;
  measurements?: RecordingQualityBenchmarkMeasurements;
  failures?: string[];
};

export type RecordingQualityBenchmarkMeasurementAdapters = {
  monotonicNow: () => number;
  cpuUsage: () => { user: number; system: number };
  rssBytes: () => number;
  startInterval: (sample: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
  samplingIntervalMs: number;
};

const unavailableMeasurement = (
  reason: Extract<
    RecordingQualityBenchmarkMeasurement,
    { status: 'unavailable' }
  >['reason'],
): RecordingQualityBenchmarkMeasurement => ({ status: 'unavailable', reason });

const availableMeasurement = (
  value: number,
  unit: Extract<
    RecordingQualityBenchmarkMeasurement,
    { status: 'available' }
  >['unit'],
  stability: Extract<
    RecordingQualityBenchmarkMeasurement,
    { status: 'available' }
  >['stability'],
  method: Extract<
    RecordingQualityBenchmarkMeasurement,
    { status: 'available' }
  >['method'],
): RecordingQualityBenchmarkMeasurement =>
  Number.isFinite(value) && value >= 0
    ? {
        status: 'available',
        value: Math.round(value),
        unit,
        stability,
        method,
      }
    : unavailableMeasurement('collection_failed');

export const measureRecordingQualityBenchmarkCase = async (
  run: () =>
    | RecordingQualityBenchmarkCaseResult
    | Promise<RecordingQualityBenchmarkCaseResult>,
  adapters: RecordingQualityBenchmarkMeasurementAdapters,
): Promise<RecordingQualityBenchmarkCaseResult> => {
  let startedAt: number | undefined;
  let startedCpu: { user: number; system: number } | undefined;
  const rssSamples: number[] = [];
  let intervalHandle: unknown;

  try {
    startedAt = adapters.monotonicNow();
  } catch {
    startedAt = undefined;
  }
  try {
    startedCpu = adapters.cpuUsage();
  } catch {
    startedCpu = undefined;
  }
  const sampleRss = () => {
    try {
      rssSamples.push(adapters.rssBytes());
    } catch {
      rssSamples.push(Number.NaN);
    }
  };
  sampleRss();
  try {
    intervalHandle = adapters.startInterval(
      sampleRss,
      adapters.samplingIntervalMs,
    );
  } catch {
    rssSamples.push(Number.NaN);
  }

  try {
    const result = await run();
    let endedAt: number | undefined;
    let endedCpu: { user: number; system: number } | undefined;
    try {
      endedAt = adapters.monotonicNow();
    } catch {
      endedAt = undefined;
    }
    try {
      endedCpu = adapters.cpuUsage();
    } catch {
      endedCpu = undefined;
    }
    sampleRss();

    const elapsed =
      startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
        ? availableMeasurement(
            Math.ceil(endedAt - startedAt),
            'milliseconds',
            'hardware_dependent',
            'monotonic_elapsed',
          )
        : unavailableMeasurement('collection_failed');
    const cpuDelta =
      startedCpu &&
      endedCpu &&
      endedCpu.user >= startedCpu.user &&
      endedCpu.system >= startedCpu.system
        ? endedCpu.user -
          startedCpu.user +
          (endedCpu.system - startedCpu.system)
        : undefined;
    const cpu =
      cpuDelta === undefined
        ? unavailableMeasurement('collection_failed')
        : availableMeasurement(
            cpuDelta,
            'microseconds',
            'hardware_dependent',
            'process_cpu_delta',
          );
    const validRss =
      rssSamples.length > 0 &&
      rssSamples.every((sample) => Number.isFinite(sample) && sample >= 0);
    const peakRss = validRss
      ? availableMeasurement(
          Math.max(...rssSamples),
          'bytes',
          'hardware_dependent',
          'sampled_process_rss',
        )
      : unavailableMeasurement('collection_failed');

    return {
      ...result,
      measurements: {
        elapsedTime: elapsed,
        cpuTime: cpu,
        peakRss,
        artifactBytes:
          result.measurements?.artifactBytes ||
          unavailableMeasurement('not_applicable'),
      },
    };
  } finally {
    if (intervalHandle !== undefined) {
      adapters.clearInterval(intervalHandle);
    }
  }
};

export type RecordingQualityBenchmarkReport = {
  schemaVersion: number;
  tier: RecordingQualityBenchmarkTierSelection;
  generatedAt: string;
  manifestPath: string;
  baselineReportPath: string;
  sourceCommit: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    measurementContractVersion?: number;
    rssSamplingIntervalMs?: number;
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
  tier: RecordingQualityBenchmarkTierSelection;
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

export type CandidateAcquisitionMode =
  | 'bundled'
  | 'pluto_managed_download'
  | 'external_hub_download'
  | 'manual_download';

export type CandidateDistributionMetadata = {
  candidateId: string;
  acquisitionMode: CandidateAcquisitionMode;
  licenseId: string;
  supportedPlatforms: string[];
  requiresUserCredentials: boolean;
  requiresManualTermsAcceptance: boolean;
  artifactChecksumSha256: string;
};

export type CandidateEligibilityFixture = {
  type: 'candidate_eligibility';
  candidate: CandidateDistributionMetadata;
  expected: RecordingQualityBenchmarkExpectation & {
    eligibility: {
      eligible: boolean;
      reasons: string[];
    };
  };
};

export type RecordingQualityBenchmarkFixture =
  | CaptureRecoveryFixture
  | TranscriptValidationFixture
  | RecordingFinalizationFixture
  | RetryValidationFixture
  | LiveTranscriptResponsivenessFixture
  | CandidateEligibilityFixture;

export type LiveTranscriptResponsivenessFixture = {
  type: 'live_transcript_responsiveness';
  startAtMs: number;
  events: Array<
    | { type: 'publish'; atMs: number; acceptedSegmentCount: number }
    | { type: 'stop'; atMs: number }
  >;
  expected: RecordingQualityBenchmarkExpectation & {
    summary: LiveTranscriptResponsivenessSummary;
  };
};

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

type CaptureRecoveryFixtureChunk = {
  source: 'mic' | 'system';
  sequence: number;
  startSec: number;
  endSec: number;
  data: string;
};

export type CaptureRecoveryFixture = {
  type: 'capture_recovery';
  meetingId: string;
  startedAtMs: number;
  chunks: CaptureRecoveryFixtureChunk[];
  corruptAfterJournal?: {
    source: 'mic' | 'system';
    sequence: number;
    replacementData: string;
  };
  expected: RecordingQualityBenchmarkExpectation & {
    requiredRecoveredSources?: Array<'mic' | 'system'>;
    requiredReasons?: string[];
  };
};

const isSupportedBenchmarkCaseKind = (
  kind: string,
): kind is RecordingQualityBenchmarkCaseKind =>
  kind === 'capture_recovery' ||
  kind === 'transcript_validation' ||
  kind === 'recording_finalization' ||
  kind === 'retry_validation' ||
  kind === 'live_transcript_responsiveness' ||
  kind === 'candidate_eligibility';

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
    tier: 'pr',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }

    if (
      (arg === '--manifest' || arg === '--out' || arg === '--tier') &&
      index + 1 < args.length
    ) {
      const value = args[index + 1];
      if (arg === '--manifest') options.manifest = value;
      if (arg === '--out') options.out = value;
      if (arg === '--tier') {
        if (value !== 'pr' && value !== 'manual' && value !== 'all') {
          throw new Error(`Unsupported benchmark tier: ${value}`);
        }
        options.tier = value;
      }
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
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    throw new Error(
      `Unsupported recording quality benchmark manifest schemaVersion ${schemaVersion}.`,
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
    if (!isSupportedBenchmarkCaseKind(kind)) {
      throw new Error(`Unsupported benchmark case kind: ${kind}`);
    }
    const tier = String(entry.tier || '').trim();
    if (!tier) {
      throw new Error(`${id} needs a benchmark tier.`);
    }
    if (tier !== 'pr' && tier !== 'manual') {
      throw new Error(`Unsupported benchmark tier: ${tier}`);
    }

    return {
      id,
      issue: Number(entry.issue),
      title: String(entry.title || '').trim(),
      kind,
      fixture: String(entry.fixture || '').trim(),
      tier,
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
            if (
              (name === 'measurements.elapsedTime' ||
                name === 'measurements.cpuTime' ||
                name === 'measurements.peakRss') &&
              stability !== 'hardware_dependent'
            ) {
              throw new Error(
                `Tracked measurement ${name} for ${id} must use hardware_dependent stability.`,
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

export const selectRecordingQualityBenchmarkCases = (
  cases: RecordingQualityBenchmarkManifestCase[],
  tier: RecordingQualityBenchmarkTierSelection,
) => {
  const selected =
    tier === 'all' ? cases : cases.filter((entry) => entry.tier === tier);
  if (selected.length === 0) {
    throw new Error(`No ${tier} benchmark cases are declared in the manifest.`);
  }
  return selected;
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

const compareEligibility = (
  actual:
    | {
        eligible: boolean;
        reasons: string[];
      }
    | undefined,
  expected:
    | {
        eligible: boolean;
        reasons: string[];
      }
    | undefined,
) => {
  if (!expected) return [];
  if (!actual) return ['missing eligibility verdict'];
  const failures: string[] = [];
  if (actual.eligible !== expected.eligible) {
    failures.push(
      `eligibility mismatch: expected ${String(expected.eligible)}, received ${String(actual.eligible)}`,
    );
  }
  if (actual.reasons.join('|') !== expected.reasons.join('|')) {
    failures.push(
      `eligibility reasons mismatch: expected ${expected.reasons.join(', ') || 'none'}, received ${actual.reasons.join(', ') || 'none'}`,
    );
  }
  return failures;
};

export const evaluateCandidateDistributionEligibility = (
  candidate: CandidateDistributionMetadata,
  platform: string,
) => {
  const reasons: string[] = [];
  if (candidate.requiresUserCredentials) {
    reasons.push('requires_user_credentials');
  }
  if (candidate.requiresManualTermsAcceptance) {
    reasons.push('requires_manual_terms_acceptance');
  }
  if (!candidate.artifactChecksumSha256.trim()) {
    reasons.push('artifact_not_pinned');
  }
  if (!candidate.supportedPlatforms.includes(platform)) {
    reasons.push('unsupported_platform');
  }
  if (
    candidate.acquisitionMode !== 'bundled' &&
    candidate.acquisitionMode !== 'pluto_managed_download'
  ) {
    reasons.push('non_pluto_distribution_channel');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
  };
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

const makeLiveTranscriptResponsivenessMetric = (
  summary: LiveTranscriptResponsivenessSummary | null,
  metricName?: string,
): RecordingQualityBenchmarkMetric | undefined => {
  if (!summary || !metricName) return undefined;

  switch (metricName) {
    case 'firstTextLatencyMs':
      return summary.status === 'available'
        ? { name: metricName, value: summary.firstTextLatencyMs }
        : undefined;
    case 'acceptedPublicationCount':
    case 'cadenceSampleCount':
      return { name: metricName, value: summary[metricName] };
    case 'maximumUpdateGapMs':
      return summary.maximumUpdateGapMs === null
        ? undefined
        : { name: metricName, value: summary.maximumUpdateGapMs };
    case 'responsivenessStatus':
      return { name: metricName, value: summary.status };
    case 'responsivenessReason':
      return summary.status === 'available'
        ? undefined
        : { name: metricName, value: summary.reason };
    default:
      return undefined;
  }
};

export const runLiveTranscriptResponsivenessBenchmarkCase = (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: LiveTranscriptResponsivenessFixture,
): RecordingQualityBenchmarkCaseResult => {
  const accumulator = createLiveTranscriptResponsivenessAccumulator();
  accumulator.start(fixture.startAtMs);
  for (const event of fixture.events) {
    if (event.type === 'publish') {
      accumulator.publish(event.atMs, event.acceptedSegmentCount);
    } else {
      accumulator.stop(event.atMs);
    }
  }

  const summary = accumulator.snapshot();
  const actualStatus =
    summary?.status === 'available' ? 'validated' : 'needs_attention';
  const actualMetric = makeLiveTranscriptResponsivenessMetric(
    summary,
    fixture.expected.primaryMetric?.name,
  );
  const failures = [
    ...(actualStatus === fixture.expected.status ? [] : ['status mismatch']),
    ...compareMetric(actualMetric, fixture.expected.primaryMetric),
    ...(JSON.stringify(summary) === JSON.stringify(fixture.expected.summary)
      ? []
      : ['responsiveness summary mismatch']),
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
      ...(summary ? { responsiveness: summary } : {}),
      reasons:
        summary?.status === 'available'
          ? []
          : [summary?.reason || 'no_summary'],
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

export const runCandidateEligibilityBenchmarkCase = (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: CandidateEligibilityFixture,
  platform: string,
): RecordingQualityBenchmarkCaseResult => {
  const eligibility = evaluateCandidateDistributionEligibility(
    fixture.candidate,
    platform,
  );
  const failures = compareEligibility(
    eligibility,
    fixture.expected.eligibility,
  );
  const status =
    eligibility.eligible && failures.length === 0
      ? 'validated'
      : 'needs_attention';

  return {
    id: meta.id,
    issue: meta.issue,
    title: meta.title,
    kind: meta.kind,
    passed: failures.length === 0,
    actual: {
      status,
      eligibility,
      reasons: eligibility.reasons,
    },
    expected: fixture.expected,
    ...(failures.length > 0 ? { failures } : {}),
  };
};

type CaptureRecoveryIntegrity = {
  gap_detected: boolean;
  recovered_sources: Record<
    'mic' | 'system',
    {
      acknowledgedChunkCount: number;
      recoveredChunkCount: number;
      recoveredAudioPath: string | null;
    }
  >;
  recovery_gaps: Array<{
    source: 'mic' | 'system';
    sequence: number;
    reason: string;
  }>;
};

export const runCaptureRecoveryBenchmarkCase = async (
  meta: RecordingQualityBenchmarkManifestCase,
  fixture: CaptureRecoveryFixture,
): Promise<RecordingQualityBenchmarkCaseResult> => {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), 'pluto-recording-quality-recovery-'),
  );

  try {
    let manifest = await createCaptureJournal(rootDir, {
      meetingId: fixture.meetingId,
      startedAtMs: fixture.startedAtMs,
    });
    for (const chunk of fixture.chunks) {
      manifest = await appendCaptureJournalChunk(rootDir, {
        meetingId: fixture.meetingId,
        source: chunk.source,
        sequence: chunk.sequence,
        chunkStartSec: chunk.startSec,
        chunkEndSec: chunk.endSec,
        format: 'wav',
        data: Buffer.from(chunk.data),
      });
    }

    if (fixture.corruptAfterJournal) {
      const corruptEntry = manifest.entries.find(
        (entry) =>
          entry.source === fixture.corruptAfterJournal?.source &&
          entry.sequence === fixture.corruptAfterJournal.sequence,
      );
      if (!corruptEntry) {
        throw new Error(
          'Capture recovery fixture corruption target is missing',
        );
      }
      await writeFile(
        path.join(rootDir, corruptEntry.relativePath),
        Buffer.from(fixture.corruptAfterJournal.replacementData),
      );
    }

    let savedMeeting: { transcript_integrity_json?: string | null } | null =
      null;
    await recoverInterruptedCaptureJournals(rootDir, {
      getMeeting: () => null,
      saveMeeting: (meeting) => {
        savedMeeting = meeting;
        return meeting;
      },
      stitchWavSegments: async (segments, outputTag) => {
        const outputPath = path.join(rootDir, `${outputTag}.wav`);
        const segmentBytes = await Promise.all(
          segments.map((segment) => readFile(segment.path)),
        );
        await writeFile(outputPath, Buffer.concat(segmentBytes));
        return outputPath;
      },
      nowMs: fixture.startedAtMs + 10_000,
    });

    if (!savedMeeting) {
      throw new Error('Capture recovery benchmark did not save a meeting');
    }
    const integrity = JSON.parse(
      savedMeeting.transcript_integrity_json || '{}',
    ) as CaptureRecoveryIntegrity;
    const acknowledgedChunks = Object.values(
      integrity.recovered_sources,
    ).reduce((total, source) => total + source.acknowledgedChunkCount, 0);
    const recoveredChunks = Object.values(integrity.recovered_sources).reduce(
      (total, source) => total + source.recoveredChunkCount,
      0,
    );
    const actualMetric: RecordingQualityBenchmarkMetric = {
      name: 'recoveredChunkRatio',
      value:
        acknowledgedChunks === 0
          ? 0
          : Number((recoveredChunks / acknowledgedChunks).toFixed(4)),
    };
    const reasons = integrity.recovery_gaps.map(
      (gap) => `${gap.reason}:${gap.source}:${gap.sequence}`,
    );
    const actualStatus = integrity.gap_detected
      ? 'needs_attention'
      : 'validated';
    const missingSources = (fixture.expected.requiredRecoveredSources || [])
      .filter(
        (source) => !integrity.recovered_sources[source].recoveredAudioPath,
      )
      .map((source) => `missing recovered source ${source}`);
    const failures = [
      ...(actualStatus === fixture.expected.status ? [] : ['status mismatch']),
      ...compareMetric(actualMetric, fixture.expected.primaryMetric),
      ...(fixture.expected.requiredReasons || [])
        .filter((reason) => !reasons.includes(reason))
        .map((reason) => `missing required reason ${reason}`),
      ...missingSources,
    ];
    let artifactBytes: RecordingQualityBenchmarkMeasurement;
    try {
      const recoveredPaths = Object.values(integrity.recovered_sources)
        .map((source) => source.recoveredAudioPath)
        .filter((artifactPath): artifactPath is string =>
          Boolean(artifactPath),
        );
      const artifactStats = await Promise.all(
        recoveredPaths.map((artifactPath) => stat(artifactPath)),
      );
      artifactBytes = availableMeasurement(
        artifactStats.reduce((total, artifact) => total + artifact.size, 0),
        'bytes',
        'stable',
        'case_artifact_sum',
      );
    } catch {
      artifactBytes = unavailableMeasurement('collection_failed');
    }

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
      measurements: {
        elapsedTime: unavailableMeasurement('unsupported_runtime'),
        cpuTime: unavailableMeasurement('unsupported_runtime'),
        peakRss: unavailableMeasurement('unsupported_runtime'),
        artifactBytes,
      },
      ...(failures.length > 0 ? { failures } : {}),
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
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
    measurements?: Partial<RecordingQualityBenchmarkMeasurements>;
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

  const resolveTrackedMetric = (
    result:
      | {
          actual?: { primaryMetric?: RecordingQualityBenchmarkMetric };
          measurements?: Partial<RecordingQualityBenchmarkMeasurements>;
        }
      | undefined,
    metricName: string,
  ): RecordingQualityBenchmarkMetric | undefined => {
    if (result?.actual?.primaryMetric?.name === metricName) {
      return result.actual.primaryMetric;
    }
    if (!metricName.startsWith('measurements.')) return undefined;
    const measurementName = metricName.slice(
      'measurements.'.length,
    ) as keyof RecordingQualityBenchmarkMeasurements;
    const measurement = result?.measurements?.[measurementName];
    return measurement?.status === 'available'
      ? { name: metricName, value: measurement.value }
      : undefined;
  };

  for (const result of input.results) {
    for (const trackedMetric of result.trackedMetrics || []) {
      const baselineMetric = resolveTrackedMetric(
        baselineById.get(result.id),
        trackedMetric.name,
      );
      const currentMetric = resolveTrackedMetric(result, trackedMetric.name);

      if (!baselineMetric) {
        counts.missingBaselineMetrics += 1;
        comparisons.push({
          id: result.id,
          issue: result.issue,
          title: result.title,
          metricName: trackedMetric.name,
          tolerance: trackedMetric.tolerance,
          stability: trackedMetric.stability,
          outcome: 'missing_baseline_metric',
          currentValue: currentMetric?.value,
        });
        sections.missingBaseline.push(comparisons[comparisons.length - 1]);
        continue;
      }

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
  tier: RecordingQualityBenchmarkTierSelection;
  manifestPath: string;
  baselineReportPath: string;
  generatedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    measurementContractVersion?: number;
    rssSamplingIntervalMs?: number;
  };
  sourceCommit: string;
  results: RecordingQualityBenchmarkCaseResult[];
  baselineResults?: Array<{
    id: string;
    actual?: {
      primaryMetric?: RecordingQualityBenchmarkMetric;
    };
    measurements?: Partial<RecordingQualityBenchmarkMeasurements>;
  }>;
}): RecordingQualityBenchmarkReport => {
  const passedCases = input.results.filter((result) => result.passed).length;
  const failedCases = input.results.length - passedCases;
  const kinds: Record<
    RecordingQualityBenchmarkCaseKind,
    { passed: number; failed: number }
  > = {
    candidate_eligibility: { passed: 0, failed: 0 },
    capture_recovery: { passed: 0, failed: 0 },
    live_transcript_responsiveness: { passed: 0, failed: 0 },
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
    tier: input.tier,
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
