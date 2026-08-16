import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { NativeEvent } from '../electron/transcription/nativeJsonLineProcess.ts';
import {
  type LiveReplayPublication,
  type LiveReplayRepetition,
  type LiveReplayResourceSoak,
  type LiveReplayVerdict,
  type PrivateLiveReplayReport,
  buildPrivateLiveReplayReport,
  evaluateLiveReplay,
  sanitizeLiveReplayReport,
} from '../src/services/liveTranscriptionReplayMetrics.ts';
import {
  type PrivateLiveReplayManifest,
  type PrivateLiveReplayMeeting,
  readPrivateLiveReplayManifest,
  validatePrivateLiveReplayManifest,
} from './validate_private_parakeet_live_manifest.ts';

export type ReplayMode = 'causal' | 'realtime-soak';
export type ReplaySource = 'mic' | 'system';
export type ParakeetConfig = 'pinned-default' | 'low-latency-2s';
type Engine = 'mlxProduction' | 'parakeetPinnedDefault' | 'parakeetLowLatency';
type TimedToken = { token: string; atSeconds: number };

export type PrivateLiveReplayOptions = {
  manifestPath: string;
  mode: ReplayMode;
  repetitions: number;
  outputPath: string;
};

export type ReplayFrame = {
  sequence: number;
  startSeconds: number;
  endSeconds: number;
  availableAtSeconds: number;
  audioPath?: string;
};

export type ReplayGap = {
  label: 'early' | 'middle' | 'late';
  startSeconds: number;
  endSeconds: number;
  omittedSequences: readonly number[];
};

export type ResourceSample = {
  sourceSeconds: number;
  wallTimeMs: number;
  schedulingJitterMs: number;
  rssGiB: number;
  thermal?: 'nominal' | 'fair' | 'serious' | 'critical';
};

export type PreparedMeeting = {
  meeting: PrivateLiveReplayMeeting;
  frames: Record<ReplaySource, readonly ReplayFrame[]>;
  mlxJobs: readonly {
    sequence: number;
    availableAtSeconds: number;
    micPath: string;
    systemPath: string;
  }[];
  wholePaths: Record<ReplaySource, string>;
};

type StreamFlush = {
  finalPreview: string;
  timedTokens: readonly TimedToken[];
  degradations: readonly {
    reason: string;
    affectedSequence?: number;
    chunkStartSeconds?: number;
    chunkEndSeconds?: number;
  }[];
  events: readonly NativeEvent[];
};

type DiagnosticResult =
  | { status: 'available'; text: string; timedTokens: readonly TimedToken[] }
  | { status: 'unavailable' };

export type ParakeetReplayRun = {
  openPair(prepared: PreparedMeeting): Promise<void>;
  append(
    source: ReplaySource,
    frame: ReplayFrame,
  ): Promise<readonly NativeEvent[]>;
  flush(source: ReplaySource): Promise<StreamFlush>;
  batch(source: ReplaySource): Promise<DiagnosticResult>;
  probeGap(
    source: ReplaySource,
    gap: ReplayGap,
    prefix: readonly ReplayFrame[],
    suffix: ReplayFrame,
  ): Promise<{ events: readonly NativeEvent[] }>;
  repair(
    source: ReplaySource,
    startSeconds: number,
    endSeconds: number,
  ): Promise<DiagnosticResult>;
  sample(
    sourceSeconds: number,
    expectedWallTimeMs: number,
  ): ResourceSample | undefined;
  close(): Promise<'exited' | 'cleanup_failed'>;
};

export type MlxReplayRun = {
  transcribePair(job: PreparedMeeting['mlxJobs'][number]): Promise<{
    completedAtSeconds: number;
    mic: DiagnosticResult;
    system: DiagnosticResult;
  }>;
  batch(
    prepared: PreparedMeeting,
    source: ReplaySource,
  ): Promise<DiagnosticResult>;
  sample(
    sourceSeconds: number,
    expectedWallTimeMs: number,
  ): ResourceSample | undefined;
  close(): Promise<'exited' | 'cleanup_failed'>;
};

export type PrivateReplayDependencies = {
  nowWallTimeMs(): number;
  wait(milliseconds: number): Promise<void>;
  observeSourceRelease?(sourceSeconds: number): void;
  prepareMeeting(meeting: PrivateLiveReplayMeeting): Promise<PreparedMeeting>;
  startParakeet(
    config: ParakeetConfig,
    repetition: number,
  ): Promise<ParakeetReplayRun>;
  startMlx(
    repetition: number,
  ): Promise<
    | { status: 'available'; run: MlxReplayRun }
    | { status: 'unavailable'; reason: 'cache_missing' | 'runtime_unavailable' }
  >;
};

export type PrivateLiveReplayComparison = {
  schemaVersion: 1;
  benchmark: 'parakeet_live_config_comparison';
  configs: {
    pinnedDefault: PrivateLiveReplayReport;
    lowLatency: PrivateLiveReplayReport;
  };
  decision: 'pass' | 'fail' | 'unavailable';
};

const SOURCES = ['mic', 'system'] as const;
const FRAME_SECONDS = 0.25;
const RESOURCE_JITTER_LIMIT_MS = 250;
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const RUNTIME = Object.freeze({
  fluidAudioVersion: '0.15.5',
  fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
  modelId: 'parakeet-tdt-0.6b-v3',
});
const SAFE_CODES = new Set([
  'benchmark_failed',
  'cleanup_failed',
  'decode_unavailable',
  'insufficient_corpus',
  'integrity_not_sealed',
  'manifest_invalid',
  'manifest_unavailable',
  'meeting_not_recent',
  'mixed_mic_source',
  'model_unavailable',
  'options_invalid',
  'private_content_not_allowed',
  'report_unavailable',
  'runtime_unavailable',
  'source_duration_mismatch',
  'source_not_independent',
  'source_unavailable',
  'unresolved_capture_gap',
]);

const tokens = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const editDistance = (left: readonly string[], right: readonly string[]) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

const compareTokens = (
  candidate: readonly string[],
  reference: readonly string[],
) => {
  const distance = editDistance(candidate, reference);
  const matched = Math.max(
    0,
    Math.max(candidate.length, reference.length) - distance,
  );
  return {
    editRate: Math.min(1, distance / Math.max(1, reference.length)),
    precision: Math.min(1, matched / Math.max(1, candidate.length)),
    recall: Math.min(1, matched / Math.max(1, reference.length)),
    duplicateTokens: Math.max(0, candidate.length - reference.length),
    omittedTokens: Math.max(0, reference.length - candidate.length),
    referenceTokens: reference.length,
  };
};

export const buildEngineRunOrder = (repetitions: number): Engine[][] => {
  if (!Number.isSafeInteger(repetitions) || repetitions !== 3)
    throw new Error('options_invalid');
  return Array.from({ length: repetitions }, (_, index) =>
    index % 2 === 0
      ? ['mlxProduction', 'parakeetPinnedDefault', 'parakeetLowLatency']
      : ['parakeetLowLatency', 'parakeetPinnedDefault', 'mlxProduction'],
  );
};

export const buildQuarterSecondFrames = (
  durationSeconds: number,
): ReplayFrame[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('options_invalid');
  const frames: ReplayFrame[] = [];
  for (
    let startSeconds = 0, sequence = 0;
    startSeconds < durationSeconds;
    sequence += 1
  ) {
    const endSeconds = Math.min(durationSeconds, startSeconds + FRAME_SECONDS);
    frames.push({
      sequence,
      startSeconds,
      endSeconds,
      availableAtSeconds: endSeconds,
    });
    startSeconds = endSeconds;
  }
  return frames;
};

export const buildGapInjections = (durationSeconds: number): ReplayGap[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 30)
    throw new Error('options_invalid');
  const frameCount = Math.floor(durationSeconds / FRAME_SECONDS);
  const startIndex = (fraction: number) => {
    const desired = Math.round((frameCount * fraction - 4) / 8) * 8;
    return Math.max(8, Math.min(frameCount - 16, desired));
  };
  return (
    [
      ['early', 0.1],
      ['middle', 0.5],
      ['late', 0.9],
    ] as const
  ).map(([label, fraction]) => {
    const first = startIndex(fraction);
    return {
      label,
      startSeconds: first * FRAME_SECONDS,
      endSeconds: (first + 8) * FRAME_SECONDS,
      omittedSequences: Array.from({ length: 8 }, (_, index) => first + index),
    };
  });
};

export const nextMlxProductionQueueIndex = (
  currentIndex: number,
  completedAtSeconds: number,
  segmentCount: number,
  sourceDurationSeconds: number,
) => {
  if (
    !Number.isSafeInteger(currentIndex) ||
    !Number.isSafeInteger(segmentCount) ||
    currentIndex < 0 ||
    segmentCount <= currentIndex ||
    !Number.isFinite(completedAtSeconds) ||
    !Number.isFinite(sourceDurationSeconds)
  )
    throw new Error('benchmark_failed');
  let latestQueued = currentIndex;
  while (
    latestQueued + 1 < segmentCount &&
    Math.min(sourceDurationSeconds, (latestQueued + 2) * 5) <=
      completedAtSeconds
  )
    latestQueued += 1;
  return {
    nextIndex: latestQueued > currentIndex ? latestQueued : currentIndex + 1,
    admittedThroughIndex: latestQueued,
  };
};

export const timedAgreement = (
  candidate: readonly TimedToken[],
  reference: readonly TimedToken[],
  toleranceSeconds: number,
) => {
  const used = new Set<number>();
  let matches = 0;
  for (const candidateToken of candidate) {
    const index = reference.findIndex(
      (referenceToken, referenceIndex) =>
        !used.has(referenceIndex) &&
        referenceToken.token === candidateToken.token &&
        Math.abs(referenceToken.atSeconds - candidateToken.atSeconds) <=
          toleranceSeconds,
    );
    if (index >= 0) {
      used.add(index);
      matches += 1;
    }
  }
  return {
    precision: matches / Math.max(1, candidate.length),
    recall: matches / Math.max(1, reference.length),
  };
};

const scoreChunkSeams = (
  candidate: readonly TimedToken[],
  reference: readonly TimedToken[],
  durationSeconds: number,
  intervalSeconds = FRAME_SECONDS,
) => {
  let duplicateTokens = 0;
  let omittedTokens = 0;
  let referenceTokens = 0;
  for (
    let boundary = intervalSeconds;
    boundary < durationSeconds;
    boundary += intervalSeconds
  ) {
    const candidateWindow = candidate
      .filter(
        ({ atSeconds }) => Math.abs(atSeconds - boundary) <= FRAME_SECONDS,
      )
      .map(({ token }) => token);
    const referenceWindow = reference
      .filter(
        ({ atSeconds }) => Math.abs(atSeconds - boundary) <= FRAME_SECONDS,
      )
      .map(({ token }) => token);
    const comparison = compareTokens(candidateWindow, referenceWindow);
    duplicateTokens += comparison.duplicateTokens;
    omittedTokens += comparison.omittedTokens;
    referenceTokens += comparison.referenceTokens;
  }
  return { duplicateTokens, omittedTokens, referenceTokens };
};

export const proveTargetedRepair = (
  candidateBeforeRepair: readonly TimedToken[],
  repairText: string,
  repairStartSeconds: number,
  repairEndSeconds: number,
  splicedCandidate?: readonly TimedToken[],
  repairReference: readonly TimedToken[] = candidateBeforeRepair,
) => {
  if (
    !Number.isFinite(repairStartSeconds) ||
    !Number.isFinite(repairEndSeconds) ||
    repairStartSeconds < 0 ||
    repairEndSeconds <= repairStartSeconds
  )
    throw new Error('benchmark_failed');
  const before = candidateBeforeRepair.filter(
    ({ atSeconds }) => atSeconds < repairStartSeconds,
  );
  const region = repairReference.filter(
    ({ atSeconds }) =>
      atSeconds >= repairStartSeconds && atSeconds <= repairEndSeconds,
  );
  const after = candidateBeforeRepair.filter(
    ({ atSeconds }) => atSeconds > repairEndSeconds,
  );
  const actualSplice = splicedCandidate ?? [
    ...before,
    ...tokens(repairText).map((token) => ({
      token,
      atSeconds: (repairStartSeconds + repairEndSeconds) / 2,
    })),
    ...after,
  ];
  const outsideBefore = [...before, ...after].map(({ token }) => token);
  const outsideAfter = [
    ...actualSplice.slice(0, before.length),
    ...actualSplice.slice(actualSplice.length - after.length),
  ].map(({ token }) => token);
  const comparison = compareTokens(
    tokens(repairText),
    region.map(({ token }) => token),
  );
  const repairedTokenF1 =
    comparison.precision === 0 || comparison.recall === 0
      ? 0
      : (2 * comparison.precision * comparison.recall) /
        (comparison.precision + comparison.recall);
  return {
    repairedTokenF1,
    outsideContextTokenChanges: editDistance(outsideBefore, outsideAfter),
  };
};

export class OnlineCommittedPrefixTracker {
  private previous = '';
  private previousTokenCount = 0;
  private violations = 0;
  private retainedBytes = 0;

  observe(value: string) {
    const nextTokenCount = tokens(value).length;
    const prefixViolation = Boolean(
      this.previous && !value.startsWith(this.previous),
    );
    if (prefixViolation) this.violations += 1;
    this.previous = value;
    this.retainedBytes = Buffer.byteLength(value);
    const result = {
      prefixViolation,
      newTokenCount: Math.max(0, nextTokenCount - this.previousTokenCount),
      rollbackTokens: Math.max(0, this.previousTokenCount - nextTokenCount),
    };
    this.previousTokenCount = nextTokenCount;
    return result;
  }

  finish() {
    return {
      committedPrefixViolationCount: this.violations,
      retainedCommittedSnapshotCount: this.previous ? 1 : 0,
      retainedCommittedSnapshotBytes: this.retainedBytes,
    };
  }
}

export const validateCoverageGapProbe = (
  gap: ReplayGap,
  prefix: readonly ReplayFrame[],
  suffix: ReplayFrame,
  events: readonly NativeEvent[],
): boolean => {
  const omitted = new Set(gap.omittedSequences);
  if (
    omitted.size !== 8 ||
    [...omitted].some((sequence) => !Number.isSafeInteger(sequence)) ||
    Math.abs(gap.endSeconds - gap.startSeconds - 2) > 1e-9 ||
    prefix.some(({ sequence }) => omitted.has(sequence)) ||
    suffix.sequence !== gap.omittedSequences[7] + 1 ||
    suffix.startSeconds !== gap.endSeconds
  )
    return false;
  const correlated = events.filter(
    (event) =>
      event.event === 'stream_degraded' &&
      event.reason === 'coverage_gap' &&
      event.chunkStartSeconds === gap.startSeconds &&
      event.chunkEndSeconds === gap.endSeconds,
  );
  return correlated.length === 1;
};

const expectedResourceTimes = (
  durationSeconds: number,
  intervalSeconds: 0.25 | 1,
) => {
  const times: number[] = [];
  for (let time = 0; time < durationSeconds; time += intervalSeconds)
    times.push(Number(time.toFixed(9)));
  if (times.at(-1) !== durationSeconds) times.push(durationSeconds);
  return times;
};

export const validateResourceTimeline = (
  samples: readonly ResourceSample[],
  durationSeconds: number,
  intervalSeconds: 0.25 | 1,
  realtime: boolean,
): boolean => {
  const expected = expectedResourceTimes(durationSeconds, intervalSeconds);
  if (samples.length !== expected.length) return false;
  return samples.every((sample, index) => {
    const prior = samples[index - 1];
    return (
      sample.sourceSeconds === expected[index] &&
      Number.isFinite(sample.wallTimeMs) &&
      Number.isFinite(sample.schedulingJitterMs) &&
      Number.isFinite(sample.rssGiB) &&
      sample.rssGiB >= 0 &&
      (!prior || sample.wallTimeMs >= prior.wallTimeMs) &&
      (!realtime ||
        Math.abs(sample.schedulingJitterMs) <= RESOURCE_JITTER_LIMIT_MS)
    );
  });
};

export const buildPrivateLiveReplayComparison = (
  pinnedDefault: PrivateLiveReplayReport,
  lowLatency: PrivateLiveReplayReport,
): PrivateLiveReplayComparison => {
  const pinned = sanitizeLiveReplayReport(pinnedDefault);
  const low = sanitizeLiveReplayReport(lowLatency);
  if (
    pinned.runtime.configId !== 'pinned-default-v1' ||
    low.runtime.configId !== 'low-latency-v1'
  )
    throw new Error('benchmark_failed');
  const mlxUnavailable = [pinned, low].some(
    (report) => report.engines.mlxProduction.status === 'unavailable',
  );
  const statuses = [
    pinned.engines.parakeetSliding.status,
    low.engines.parakeetSliding.status,
  ];
  const decision = mlxUnavailable
    ? 'unavailable'
    : statuses.includes('fail')
      ? 'fail'
      : statuses.includes('unavailable')
        ? 'unavailable'
        : 'pass';
  return {
    schemaVersion: 1,
    benchmark: 'parakeet_live_config_comparison',
    configs: { pinnedDefault: pinned, lowLatency: low },
    decision,
  };
};

const parseOption = (
  argv: readonly string[],
  name: string,
  required = true,
) => {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--')))
    throw new Error('options_invalid');
  return value;
};

export const parsePrivateLiveReplayOptions = (
  argv: readonly string[],
): PrivateLiveReplayOptions => {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const known = new Set(['--manifest', '--mode', '--repetitions', '--out']);
  for (let index = 0; index < normalized.length; index += 2)
    if (!known.has(normalized[index]) || !normalized[index + 1])
      throw new Error('options_invalid');
  const manifestPath = parseOption(normalized, '--manifest') as string;
  const outputPath = parseOption(normalized, '--out') as string;
  const mode = parseOption(normalized, '--mode') as ReplayMode;
  const repetitionText = parseOption(normalized, '--repetitions', false);
  const repetitions = repetitionText
    ? Number(repetitionText)
    : mode === 'realtime-soak'
      ? 1
      : 3;
  if (
    !path.isAbsolute(manifestPath) ||
    !path.isAbsolute(outputPath) ||
    (mode !== 'causal' && mode !== 'realtime-soak') ||
    !Number.isSafeInteger(repetitions) ||
    (mode === 'causal' ? repetitions !== 3 : repetitions !== 1)
  )
    throw new Error('options_invalid');
  return { manifestPath, outputPath, mode, repetitions };
};

const emptyDiagnostic = {
  editRate: 1,
  precisionAt2Seconds: 0,
  recallAt2Seconds: 0,
  precisionAt5Seconds: 0,
  recallAt5Seconds: 0,
};

const makeRepetition = (input: {
  meeting: PrivateLiveReplayMeeting;
  publications: LiveReplayPublication[];
  tracker: OnlineCommittedPrefixTracker;
  candidate: readonly TimedToken[];
  batch: DiagnosticResult;
  accepted: number[];
  processed: number[];
  handoffs: number[];
  inferenceSeconds: number;
  coverageSeconds?: number;
  repair: LiveReplayRepetition['repair'];
  proxy: LiveReplayRepetition['proxy'];
}): LiveReplayRepetition => {
  const coverageSeconds = input.coverageSeconds ?? FRAME_SECONDS;
  const batchAvailable = input.batch.status === 'available';
  const batchTokens = batchAvailable ? input.batch.timedTokens : [];
  const comparison = batchAvailable
    ? compareTokens(
        input.candidate.map(({ token }) => token),
        batchTokens.map(({ token }) => token),
      )
    : undefined;
  const agreement2 = batchAvailable
    ? timedAgreement(input.candidate, batchTokens, 2)
    : undefined;
  const agreement5 = batchAvailable
    ? timedAgreement(input.candidate, batchTokens, 5)
    : undefined;
  const seams = batchAvailable
    ? scoreChunkSeams(
        input.candidate,
        batchTokens,
        input.meeting.sealedDurationSeconds,
        coverageSeconds,
      )
    : undefined;
  return {
    firstSealedActivitySeconds: 0,
    publications: input.publications,
    ...input.tracker.finish(),
    acceptedSequences: input.accepted,
    processedSequences: input.processed,
    acceptedCoverage: input.accepted.map((receipt) => ({
      receipt,
      startSeconds: (receipt - 1) * coverageSeconds,
      endSeconds: Math.min(
        input.meeting.sealedDurationSeconds,
        receipt * coverageSeconds,
      ),
    })),
    processedCoverage: input.processed.map((receipt) => ({
      receipt,
      startSeconds: (receipt - 1) * coverageSeconds,
      endSeconds: Math.min(
        input.meeting.sealedDurationSeconds,
        receipt * coverageSeconds,
      ),
    })),
    expectedSourceSeconds: input.meeting.sealedDurationSeconds,
    processedSourceSeconds: input.processed.reduce(
      (total, receipt) =>
        total +
        Math.min(
          coverageSeconds,
          input.meeting.sealedDurationSeconds - (receipt - 1) * coverageSeconds,
        ),
      0,
    ),
    inferenceSeconds: input.inferenceSeconds,
    seamDuplicateTokens: seams?.duplicateTokens ?? 0,
    seamOmittedTokens: seams?.omittedTokens ?? 0,
    seamReferenceTokens: seams?.referenceTokens ?? 0,
    committedSyntheticSeamDuplicateTokens: 0,
    committedSyntheticSeamOmittedTokens: 0,
    batchDiagnostic: comparison
      ? {
          editRate: comparison.editRate,
          precisionAt2Seconds: agreement2?.precision ?? 0,
          recallAt2Seconds: agreement2?.recall ?? 0,
          precisionAt5Seconds: agreement5?.precision ?? 0,
          recallAt5Seconds: agreement5?.recall ?? 0,
        }
      : emptyDiagnostic,
    proxy: input.proxy,
    repair: input.repair,
    captureHandoffMilliseconds: input.handoffs,
    rendererInferenceCallbacks: 0,
    wholeSessionAsrCalls: 0,
    analysisBeforeCanonicalCommit: 0,
  };
};

const loadProxy = (proxyPath: string): TimedToken[] => {
  try {
    const raw = JSON.parse(fs.readFileSync(proxyPath, 'utf8')) as unknown;
    const entries = Array.isArray(raw)
      ? raw
      : raw &&
          typeof raw === 'object' &&
          Array.isArray((raw as { segments?: unknown }).segments)
        ? (raw as { segments: unknown[] }).segments
        : [];
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const segment = entry as Record<string, unknown>;
      const end =
        typeof segment.endTime === 'number'
          ? segment.endTime
          : typeof segment.end === 'number'
            ? segment.end
            : undefined;
      return typeof segment.text === 'string' &&
        typeof end === 'number' &&
        Number.isFinite(end)
        ? tokens(segment.text).map((token) => ({ token, atSeconds: end }))
        : [];
    });
  } catch {
    throw new Error('benchmark_failed');
  }
};

const proxyMetrics = (
  candidate: readonly TimedToken[],
  proxy: readonly TimedToken[],
  mlx: readonly TimedToken[] | undefined,
): LiveReplayRepetition['proxy'] => {
  const candidateComparison = compareTokens(
    candidate.map(({ token }) => token),
    proxy.map(({ token }) => token),
  );
  const candidateAgreement = timedAgreement(candidate, proxy, 2);
  const mlxComparison = mlx
    ? compareTokens(
        mlx.map(({ token }) => token),
        proxy.map(({ token }) => token),
      )
    : undefined;
  const mlxAgreement = mlx ? timedAgreement(mlx, proxy, 2) : undefined;
  return {
    disagreementRate: candidateComparison.editRate,
    alignedRecall: candidateAgreement.recall,
    mlxDisagreementRate: mlxComparison?.editRate ?? 1,
    mlxAlignedRecall: mlxAgreement?.recall ?? 0,
  };
};

export const buildResourceSoakEvidence = (
  samples: readonly ResourceSample[],
  durationSeconds: number,
  intervalSeconds: 0.25 | 1,
  realtime: boolean,
): LiveReplayResourceSoak | undefined => {
  if (
    !validateResourceTimeline(
      samples,
      durationSeconds,
      intervalSeconds,
      realtime,
    )
  )
    return undefined;
  if (samples.some((sample) => sample.thermal === undefined)) return undefined;
  return {
    sourceStartSeconds: 0,
    sourceEndSeconds: durationSeconds,
    sourceDurationSeconds: durationSeconds,
    soakStartSeconds: 0,
    soakEndSeconds: durationSeconds,
    warmupEndSeconds: 0,
    sampleIntervalSeconds: 1,
    realTime: true,
    longestSource: true,
    preparedIdleRssGiB: samples[0].rssGiB,
    peakRssGiB: Math.max(...samples.map(({ rssGiB }) => rssGiB)),
    rssSamples: samples.map(
      ({ sourceSeconds, rssGiB, wallTimeMs, schedulingJitterMs }) => ({
        atSeconds: sourceSeconds,
        rssGiB,
        wallTimeMs,
        schedulingJitterMs,
      }),
    ),
    thermalSamples: samples.map(({ sourceSeconds, thermal }) => ({
      atSeconds: sourceSeconds,
      state: thermal as 'nominal' | 'fair' | 'serious' | 'critical',
    })),
  };
};

type CollectedEngine = {
  repetitions: LiveReplayRepetition[];
  timedByMeeting: Map<string, TimedToken[]>;
  soak?: LiveReplayResourceSoak;
  batchAvailable: boolean;
};

const collectEvents = (
  events: readonly NativeEvent[],
  publications: LiveReplayPublication[],
  tracker: OnlineCommittedPrefixTracker,
  completedAtSeconds: number,
) => {
  for (const event of events) {
    if (event.event !== 'stream_update') continue;
    const change = tracker.observe(event.text);
    publications.push({
      availableAtSeconds: event.audioEndSeconds,
      lookaheadReadyAtSeconds: event.audioEndSeconds,
      completedAtSeconds,
      audioEndSeconds: event.audioEndSeconds,
      changed: true,
      activeSpeech: tokens(event.text).length > 0,
      newTokenCount: change.newTokenCount,
      rollbackTokens: change.rollbackTokens,
      volatileOperationCount: Number(change.prefixViolation),
      revisionAgeSeconds: 0,
    });
  }
};

const paceTo = async (
  dependencies: PrivateReplayDependencies,
  mode: ReplayMode,
  startedWallMs: number,
  sourceSeconds: number,
) => {
  if (mode === 'realtime-soak') {
    const delay =
      startedWallMs + sourceSeconds * 1_000 - dependencies.nowWallTimeMs();
    if (delay > 0) await dependencies.wait(delay);
  }
  dependencies.observeSourceRelease?.(sourceSeconds);
};

const runParakeetConfig = async (input: {
  config: ParakeetConfig;
  repetition: number;
  meetings: readonly PreparedMeeting[];
  dependencies: PrivateReplayDependencies;
  mode: ReplayMode;
  mlxByMeeting: ReadonlyMap<string, TimedToken[]>;
}): Promise<CollectedEngine> => {
  const run = await input.dependencies.startParakeet(
    input.config,
    input.repetition,
  );
  const collected: CollectedEngine = {
    repetitions: [],
    timedByMeeting: new Map(),
    batchAvailable: true,
  };
  let failure: unknown;
  try {
    for (const prepared of input.meetings) {
      await run.openPair(prepared);
      const startedWallMs = input.dependencies.nowWallTimeMs();
      const publications = Object.fromEntries(
        SOURCES.map((source) => [source, [] as LiveReplayPublication[]]),
      ) as Record<ReplaySource, LiveReplayPublication[]>;
      const trackers = Object.fromEntries(
        SOURCES.map((source) => [source, new OnlineCommittedPrefixTracker()]),
      ) as Record<ReplaySource, OnlineCommittedPrefixTracker>;
      const priorUpdates = {
        mic: undefined as { text: string; endSeconds: number } | undefined,
        system: undefined as { text: string; endSeconds: number } | undefined,
      };
      const eventTimedTokens = {
        mic: [] as TimedToken[],
        system: [] as TimedToken[],
      };
      const collectStreamEvents = (
        source: ReplaySource,
        events: readonly NativeEvent[],
        completedAtSeconds: number,
      ) => {
        for (const event of events) {
          if (event.event !== 'stream_update') continue;
          const prior = priorUpdates[source];
          if (event.qualifiesPriorTentative && prior) {
            eventTimedTokens[source].push(
              ...tokens(prior.text).map((token) => ({
                token,
                atSeconds: prior.endSeconds,
              })),
            );
          }
          priorUpdates[source] = {
            text: event.text,
            endSeconds: event.audioEndSeconds,
          };
        }
        collectEvents(
          events,
          publications[source],
          trackers[source],
          completedAtSeconds,
        );
      };
      const accepted = Object.fromEntries(
        SOURCES.map((source) => [source, [] as number[]]),
      ) as Record<ReplaySource, number[]>;
      const processed = Object.fromEntries(
        SOURCES.map((source) => [source, [] as number[]]),
      ) as Record<ReplaySource, number[]>;
      const handoffs = Object.fromEntries(
        SOURCES.map((source) => [source, [] as number[]]),
      ) as Record<ReplaySource, number[]>;
      const inference = { mic: 0, system: 0 };
      const pending: Array<{
        source: ReplaySource;
        receipt: number;
        availableAtSeconds: number;
        started: number;
        operation: Promise<readonly NativeEvent[]>;
      }> = [];
      const settle = async () => {
        const entry = pending.shift();
        if (!entry) return;
        const events = await entry.operation;
        inference[entry.source] +=
          (input.dependencies.nowWallTimeMs() - entry.started) / 1_000;
        processed[entry.source].push(entry.receipt);
        collectStreamEvents(
          entry.source,
          events,
          entry.availableAtSeconds +
            (input.dependencies.nowWallTimeMs() - entry.started) / 1_000,
        );
      };
      const interval = input.mode === 'realtime-soak' ? 1 : 0.25;
      const resourceTimes = expectedResourceTimes(
        prepared.meeting.sealedDurationSeconds,
        interval,
      );
      const samples: ResourceSample[] = [];
      let resourceIndex = 0;
      const sampleThrough = (sourceSeconds: number) => {
        while (
          resourceIndex < resourceTimes.length &&
          resourceTimes[resourceIndex] <= sourceSeconds
        ) {
          const indexed = resourceTimes[resourceIndex];
          const sample = run.sample(indexed, startedWallMs + indexed * 1_000);
          if (sample) samples.push(sample);
          resourceIndex += 1;
        }
      };
      sampleThrough(0);
      for (const frame of prepared.frames.mic) {
        await paceTo(
          input.dependencies,
          input.mode,
          startedWallMs,
          frame.availableAtSeconds,
        );
        sampleThrough(frame.availableAtSeconds);
        for (const source of SOURCES) {
          if (pending.length >= 2) await settle();
          const started = input.dependencies.nowWallTimeMs();
          const sourceFrame = prepared.frames[source][frame.sequence];
          accepted[source].push(frame.sequence + 1);
          const operation = run.append(source, sourceFrame);
          handoffs[source].push(input.dependencies.nowWallTimeMs() - started);
          pending.push({
            source,
            receipt: frame.sequence + 1,
            availableAtSeconds: sourceFrame.availableAtSeconds,
            started,
            operation,
          });
        }
      }
      while (pending.length > 0) await settle();
      sampleThrough(prepared.meeting.sealedDurationSeconds);
      const flushes = Object.fromEntries(
        await Promise.all(
          SOURCES.map(
            async (source) => [source, await run.flush(source)] as const,
          ),
        ),
      ) as Record<ReplaySource, StreamFlush>;
      const proxy = loadProxy(prepared.meeting.proxyTranscriptPath);
      for (const source of SOURCES) {
        collectStreamEvents(
          source,
          flushes[source].events,
          prepared.meeting.sealedDurationSeconds +
            (input.dependencies.nowWallTimeMs() - startedWallMs) / 1_000,
        );
        trackers[source].observe(flushes[source].finalPreview);
        const prior = priorUpdates[source];
        if (prior)
          eventTimedTokens[source].push(
            ...tokens(prior.text).map((token) => ({
              token,
              atSeconds: prior.endSeconds,
            })),
          );
        const candidate =
          eventTimedTokens[source].length > 0
            ? eventTimedTokens[source]
            : [...flushes[source].timedTokens];
        const batch = await run.batch(source);
        if (
          batch.status === 'unavailable' ||
          scoreChunkSeams(
            candidate,
            batch.timedTokens,
            prepared.meeting.sealedDurationSeconds,
          ).referenceTokens === 0
        )
          collected.batchAvailable = false;
        let exactGapDetected = true;
        let repairedTokenF1 = 1;
        let outsideContextTokenChanges = 0;
        for (const gap of buildGapInjections(
          prepared.meeting.sealedDurationSeconds,
        )) {
          const omitted = new Set(gap.omittedSequences);
          const prefix = prepared.frames[source].filter(
            (frame) =>
              frame.sequence < gap.omittedSequences[0] &&
              !omitted.has(frame.sequence),
          );
          const suffix = prepared.frames[source][gap.omittedSequences[7] + 1];
          const probe = await run.probeGap(source, gap, prefix, suffix);
          exactGapDetected &&= validateCoverageGapProbe(
            gap,
            prefix,
            suffix,
            probe.events,
          );
          const repairStart = Math.max(0, gap.startSeconds - 2);
          const repairEnd = Math.min(
            prepared.meeting.sealedDurationSeconds,
            gap.endSeconds + 2,
          );
          const repair = await run.repair(source, repairStart, repairEnd);
          if (repair.status === 'unavailable') {
            repairedTokenF1 = 0;
            continue;
          }
          const before = candidate.filter(
            ({ atSeconds }) => atSeconds < repairStart,
          );
          const after = candidate.filter(
            ({ atSeconds }) => atSeconds > repairEnd,
          );
          const spliced = [...before, ...repair.timedTokens, ...after];
          const proof = proveTargetedRepair(
            candidate,
            repair.text,
            repairStart,
            repairEnd,
            spliced,
            batch.status === 'available' ? batch.timedTokens : candidate,
          );
          repairedTokenF1 = Math.min(repairedTokenF1, proof.repairedTokenF1);
          outsideContextTokenChanges += proof.outsideContextTokenChanges;
        }
        const mlx = input.mlxByMeeting.get(`${prepared.meeting.id}:${source}`);
        collected.repetitions.push(
          makeRepetition({
            meeting: prepared.meeting,
            publications: publications[source],
            tracker: trackers[source],
            candidate,
            batch,
            accepted: accepted[source],
            processed: processed[source],
            handoffs: handoffs[source],
            inferenceSeconds: inference[source],
            repair: {
              exactGapDetected,
              contextBeforeSeconds: 2,
              contextAfterSeconds: 2,
              outsideContextTokenChanges,
              repairedTokenF1,
            },
            proxy: proxyMetrics(candidate, proxy, mlx),
          }),
        );
        collected.timedByMeeting.set(
          `${prepared.meeting.id}:${source}`,
          candidate,
        );
      }
      if (
        input.mode === 'realtime-soak' &&
        prepared.meeting.sealedDurationSeconds ===
          Math.max(
            ...input.meetings.map(
              ({ meeting }) => meeting.sealedDurationSeconds,
            ),
          )
      )
        collected.soak = buildResourceSoakEvidence(
          samples,
          prepared.meeting.sealedDurationSeconds,
          1,
          true,
        );
    }
  } catch (error) {
    failure = error;
  }
  const cleanup = await run.close().catch(() => 'cleanup_failed' as const);
  if (cleanup !== 'exited') throw new Error('cleanup_failed');
  if (failure) throw new Error('benchmark_failed');
  return collected;
};

const runMlxRepetition = async (
  repetition: number,
  meetings: readonly PreparedMeeting[],
  dependencies: PrivateReplayDependencies,
  mode: ReplayMode,
): Promise<CollectedEngine | undefined> => {
  const created = await dependencies.startMlx(repetition);
  if (created.status === 'unavailable') return undefined;
  const collected: CollectedEngine = {
    repetitions: [],
    timedByMeeting: new Map(),
    batchAvailable: true,
  };
  let failure: unknown;
  try {
    for (const prepared of meetings) {
      const bySource = { mic: [] as TimedToken[], system: [] as TimedToken[] };
      const publications = {
        mic: [] as LiveReplayPublication[],
        system: [] as LiveReplayPublication[],
      };
      const acceptedJobs: number[] = [];
      const processedJobs: number[] = [];
      const startedWallMs = dependencies.nowWallTimeMs();
      const interval = mode === 'realtime-soak' ? 1 : 0.25;
      const resourceTimes = expectedResourceTimes(
        prepared.meeting.sealedDurationSeconds,
        interval,
      );
      const samples: ResourceSample[] = [];
      let resourceIndex = 0;
      const sampleThrough = async (sourceSeconds: number) => {
        while (
          resourceIndex < resourceTimes.length &&
          resourceTimes[resourceIndex] <= sourceSeconds
        ) {
          const indexed = resourceTimes[resourceIndex];
          await paceTo(dependencies, mode, startedWallMs, indexed);
          const sample = created.run.sample(
            indexed,
            startedWallMs + indexed * 1_000,
          );
          if (sample) samples.push(sample);
          resourceIndex += 1;
        }
      };
      await sampleThrough(0);
      let index = 0;
      let previousCompletedAtSeconds = 0;
      while (index < prepared.mlxJobs.length) {
        await sampleThrough(prepared.mlxJobs[index].availableAtSeconds);
        const result = await created.run.transcribePair(
          prepared.mlxJobs[index],
        );
        if (
          result.completedAtSeconds <
            prepared.mlxJobs[index].availableAtSeconds ||
          result.completedAtSeconds < previousCompletedAtSeconds
        )
          throw new Error('benchmark_failed');
        previousCompletedAtSeconds = result.completedAtSeconds;
        for (const source of SOURCES) {
          const diagnostic = result[source];
          if (diagnostic.status === 'available') {
            bySource[source].push(...diagnostic.timedTokens);
            publications[source].push({
              availableAtSeconds: prepared.mlxJobs[index].availableAtSeconds,
              lookaheadReadyAtSeconds:
                prepared.mlxJobs[index].availableAtSeconds,
              completedAtSeconds: result.completedAtSeconds,
              audioEndSeconds: prepared.mlxJobs[index].availableAtSeconds,
              changed: diagnostic.timedTokens.length > 0,
              activeSpeech: diagnostic.timedTokens.length > 0,
              newTokenCount: diagnostic.timedTokens.length,
              rollbackTokens: 0,
              volatileOperationCount: 0,
              revisionAgeSeconds: 0,
            });
          } else collected.batchAvailable = false;
        }
        processedJobs.push(index + 1);
        const queue = nextMlxProductionQueueIndex(
          index,
          result.completedAtSeconds,
          prepared.mlxJobs.length,
          prepared.meeting.sealedDurationSeconds,
        );
        for (
          let admitted = index;
          admitted <= queue.admittedThroughIndex;
          admitted += 1
        )
          if (!acceptedJobs.includes(admitted + 1))
            acceptedJobs.push(admitted + 1);
        index = queue.nextIndex;
      }
      await sampleThrough(prepared.meeting.sealedDurationSeconds);
      if (
        mode === 'realtime-soak' &&
        prepared.meeting.sealedDurationSeconds ===
          Math.max(
            ...meetings.map(({ meeting }) => meeting.sealedDurationSeconds),
          )
      )
        collected.soak = buildResourceSoakEvidence(
          samples,
          prepared.meeting.sealedDurationSeconds,
          1,
          true,
        );
      const proxy = loadProxy(prepared.meeting.proxyTranscriptPath);
      for (const source of SOURCES) {
        const batch = await created.run.batch(prepared, source);
        if (
          batch.status === 'unavailable' ||
          scoreChunkSeams(
            bySource[source],
            batch.timedTokens,
            prepared.meeting.sealedDurationSeconds,
            5,
          ).referenceTokens === 0
        )
          collected.batchAvailable = false;
        const tracker = new OnlineCommittedPrefixTracker();
        tracker.observe(bySource[source].map(({ token }) => token).join(' '));
        collected.repetitions.push(
          makeRepetition({
            meeting: prepared.meeting,
            publications: publications[source],
            tracker,
            candidate: bySource[source],
            batch,
            accepted: acceptedJobs,
            processed: processedJobs,
            handoffs: [],
            inferenceSeconds: 0,
            coverageSeconds: 5,
            repair: {
              exactGapDetected: false,
              contextBeforeSeconds: 2,
              contextAfterSeconds: 2,
              outsideContextTokenChanges: 0,
              repairedTokenF1: 0,
            },
            proxy: proxyMetrics(bySource[source], proxy, bySource[source]),
          }),
        );
        collected.timedByMeeting.set(
          `${prepared.meeting.id}:${source}`,
          bySource[source],
        );
      }
    }
  } catch (error) {
    failure = error;
  }
  const cleanup = await created.run
    .close()
    .catch(() => 'cleanup_failed' as const);
  if (cleanup !== 'exited') throw new Error('cleanup_failed');
  if (failure) throw new Error('benchmark_failed');
  return collected;
};

const mergeCollected = (target: CollectedEngine, source: CollectedEngine) => {
  target.repetitions.push(...source.repetitions);
  for (const [key, value] of source.timedByMeeting)
    target.timedByMeeting.set(key, value);
  target.soak ??= source.soak;
  target.batchAvailable &&= source.batchAvailable;
};

const unavailableVerdict = (): LiveReplayVerdict => ({
  status: 'unavailable',
  metrics: {},
  invariants: {},
  failures: ['dependency_unavailable'],
});

export const orchestratePrivateReplay = async (
  manifest: PrivateLiveReplayManifest,
  options: Pick<PrivateLiveReplayOptions, 'mode' | 'repetitions'>,
  dependencies: PrivateReplayDependencies,
): Promise<PrivateLiveReplayComparison> => {
  const longest = [...manifest.meetings].sort(
    (left, right) => right.sealedDurationSeconds - left.sealedDurationSeconds,
  )[0];
  const selected =
    options.mode === 'realtime-soak' ? [longest] : manifest.meetings;
  const prepared = await Promise.all(selected.map(dependencies.prepareMeeting));
  const orders =
    options.mode === 'causal'
      ? buildEngineRunOrder(options.repetitions)
      : [
          [
            'mlxProduction',
            'parakeetPinnedDefault',
            'parakeetLowLatency',
          ] as Engine[],
        ];
  const mlxAll: CollectedEngine = {
    repetitions: [],
    timedByMeeting: new Map(),
    batchAvailable: true,
  };
  const pinnedAll: CollectedEngine = {
    repetitions: [],
    timedByMeeting: new Map(),
    batchAvailable: true,
  };
  const lowAll: CollectedEngine = {
    repetitions: [],
    timedByMeeting: new Map(),
    batchAvailable: true,
  };
  let mlxAvailable = true;
  for (let repetition = 0; repetition < orders.length; repetition += 1) {
    for (const engine of orders[repetition]) {
      if (engine === 'mlxProduction') {
        const mlx = await runMlxRepetition(
          repetition,
          prepared,
          dependencies,
          options.mode,
        );
        if (!mlx) mlxAvailable = false;
        else mergeCollected(mlxAll, mlx);
        continue;
      }
      const config =
        engine === 'parakeetPinnedDefault'
          ? 'pinned-default'
          : 'low-latency-2s';
      const result = await runParakeetConfig({
        config,
        repetition,
        meetings: prepared,
        dependencies,
        mode: options.mode,
        mlxByMeeting: mlxAll.timedByMeeting,
      });
      mergeCollected(config === 'pinned-default' ? pinnedAll : lowAll, result);
    }
  }
  const evidence = (collected: CollectedEngine, isMlx: boolean) => ({
    corpusEligible: true,
    aecEvidenceAvailable: false,
    resourceEvidenceAvailable: collected.soak !== undefined,
    resourceSoak: collected.soak,
    engineOrderAlternated: options.mode === 'causal',
    mlxProductionQueueVerified: isMlx ? mlxAvailable : true,
  });
  const mlxVerdict = mlxAvailable
    ? evaluateLiveReplay(mlxAll.repetitions, evidence(mlxAll, true))
    : unavailableVerdict();
  if (!mlxAll.batchAvailable && mlxVerdict.status !== 'unavailable') {
    mlxVerdict.status = 'unavailable';
    mlxVerdict.failures = [
      ...new Set([...mlxVerdict.failures, 'dependency_unavailable']),
    ];
  }
  const evaluateParakeet = (collected: CollectedEngine) => {
    const verdict = evaluateLiveReplay(collected.repetitions, {
      ...evidence(collected, false),
      ...(mlxVerdict.status !== 'unavailable' &&
      typeof mlxVerdict.metrics.firstTextP95Seconds === 'number' &&
      typeof mlxVerdict.metrics.runtimeFactorMaximum === 'number'
        ? {
            mlxBaseline: {
              firstTextP95Seconds: mlxVerdict.metrics.firstTextP95Seconds,
              runtimeFactor: mlxVerdict.metrics.runtimeFactorMaximum,
            },
          }
        : {}),
    });
    if (!collected.batchAvailable && verdict.status !== 'unavailable') {
      verdict.status = 'unavailable';
      verdict.failures = [
        ...new Set([...verdict.failures, 'dependency_unavailable']),
      ];
    }
    return verdict;
  };
  const corpus = {
    meetingCount: manifest.meetings.length,
    sourceCount: manifest.meetings.length * 2,
    audioMinutes:
      manifest.meetings.reduce(
        (total, meeting) => total + meeting.sealedDurationSeconds,
        0,
      ) / 60,
  };
  const makeReport = (
    configId: 'pinned-default-v1' | 'low-latency-v1',
    parakeet: LiveReplayVerdict,
  ) =>
    buildPrivateLiveReplayReport({
      corpus,
      runtime: { ...RUNTIME, configId },
      mlxProduction: mlxVerdict,
      parakeetSliding: parakeet,
    });
  return buildPrivateLiveReplayComparison(
    makeReport('pinned-default-v1', evaluateParakeet(pinnedAll)),
    makeReport('low-latency-v1', evaluateParakeet(lowAll)),
  );
};

const decodeSegments = (
  inputPath: string,
  outputDirectory: string,
  segmentSeconds: number,
): string[] => {
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-reset_timestamps',
      '1',
      '-y',
      path.join(outputDirectory, 'frame-%08d.wav'),
    ],
    { stdio: 'ignore', timeout: 2 * 60 * 60_000 },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
  return fs
    .readdirSync(outputDirectory)
    .filter((name) => /^frame-\d{8}\.wav$/.test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));
};

const extractWindow = (
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-ss',
      String(startSeconds),
      '-t',
      String(durationSeconds),
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      outputPath,
    ],
    { stdio: 'ignore', timeout: 30 * 60_000 },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
};

const decodeWhole = (inputPath: string, outputPath: string) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      outputPath,
    ],
    { stdio: 'ignore', timeout: 2 * 60 * 60_000 },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
};

const terminateChild = async (
  child: ChildProcess,
): Promise<'exited' | 'cleanup_failed'> => {
  if (child.exitCode !== null || child.signalCode !== null) return 'exited';
  child.kill('SIGTERM');
  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    const failed = setTimeout(() => resolve('cleanup_failed'), 7_000);
    child.once('exit', () => {
      clearTimeout(kill);
      clearTimeout(failed);
      resolve('exited');
    });
  });
};

const sampleRss = (pid: number) => {
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const rssKiB = Number(result.stdout.trim());
  return result.status === 0 && Number.isFinite(rssKiB) && rssKiB >= 0
    ? rssKiB / 1024 / 1024
    : undefined;
};

// macOS does not expose a reliable finite thermal state through the production
// adapter. Absence-of-warning notes are not converted into invented evidence.
const sampleThermal = (): ResourceSample['thermal'] => undefined;

export const hasPreparedMlxMediumCache = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const home = environment.HF_HOME
    ? path.resolve(environment.HF_HOME)
    : path.join(os.homedir(), '.cache', 'huggingface');
  const root = path.join(
    home,
    'hub',
    'models--mlx-community--whisper-medium-mlx',
  );
  try {
    return (
      fs.realpathSync(root) === root &&
      fs.lstatSync(root).isDirectory() &&
      !fs.lstatSync(root).isSymbolicLink() &&
      fs.readdirSync(path.join(root, 'snapshots')).length > 0
    );
  } catch {
    return false;
  }
};

const waitForMlx = async (port: number, child: ChildProcess) => {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error('runtime_unavailable');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // bounded warm-up poll
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('runtime_unavailable');
};

const mlxRequest = async (
  port: number,
  audioPath: string,
): Promise<DiagnosticResult> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        audio_path: audioPath,
        model: 'medium',
        device: 'mlx',
        compute_type: 'float16',
        language: 'en',
        word_timestamps: true,
      }),
    });
    if (!response.ok) return { status: 'unavailable' };
    const payload = (await response.json()) as {
      segments?: Array<{ text?: string; end?: number }>;
    };
    const segments = payload.segments ?? [];
    return {
      status: 'available',
      text: segments.map(({ text }) => text ?? '').join(' '),
      timedTokens: segments.flatMap((segment) =>
        tokens(segment.text ?? '').map((token) => ({
          token,
          atSeconds:
            typeof segment.end === 'number' && Number.isFinite(segment.end)
              ? segment.end
              : 0,
        })),
      ),
    };
  } catch {
    return { status: 'unavailable' };
  }
};

export const createProductionDependencies = (
  manifest: PrivateLiveReplayManifest,
  temporaryRoot: string,
): PrivateReplayDependencies => {
  return {
    nowWallTimeMs: Date.now,
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    prepareMeeting: async (meeting) => {
      const root = path.join(
        temporaryRoot,
        `meeting-${meeting.sealedGeneration}`,
      );
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const framePaths = Object.fromEntries(
        SOURCES.map((source) => [
          source,
          decodeSegments(
            meeting.sources[`${source}Path`],
            path.join(root, `${source}-250ms`),
            0.25,
          ),
        ]),
      ) as Record<ReplaySource, string[]>;
      const mlxPaths = Object.fromEntries(
        SOURCES.map((source) => [
          source,
          decodeSegments(
            meeting.sources[`${source}Path`],
            path.join(root, `${source}-5s`),
            5,
          ),
        ]),
      ) as Record<ReplaySource, string[]>;
      const wholePaths = Object.fromEntries(
        SOURCES.map((source) => {
          const outputPath = path.join(root, `${source}-whole.wav`);
          decodeWhole(meeting.sources[`${source}Path`], outputPath);
          return [source, outputPath];
        }),
      ) as Record<ReplaySource, string>;
      const frames = Object.fromEntries(
        SOURCES.map((source) => [
          source,
          buildQuarterSecondFrames(meeting.sealedDurationSeconds).map(
            (frame) => ({
              ...frame,
              audioPath: framePaths[source][frame.sequence],
            }),
          ),
        ]),
      ) as Record<ReplaySource, ReplayFrame[]>;
      const value: PreparedMeeting = {
        meeting,
        frames,
        mlxJobs: mlxPaths.mic.map((micPath, index) => ({
          sequence: index + 1,
          availableAtSeconds: Math.min(
            meeting.sealedDurationSeconds,
            (index + 1) * 5,
          ),
          micPath,
          systemPath: mlxPaths.system[index],
        })),
        wholePaths,
      };
      return value;
    },
    startMlx: async () => {
      if (!hasPreparedMlxMediumCache())
        return {
          status: 'unavailable' as const,
          reason: 'cache_missing' as const,
        };
      const pythonPath = path.resolve('python/venv/bin/python');
      const serverPath = path.resolve('python/mlx_transcription_server.py');
      if (
        ![pythonPath, serverPath].every((filePath) => fs.existsSync(filePath))
      )
        return {
          status: 'unavailable' as const,
          reason: 'runtime_unavailable' as const,
        };
      const port = 54_000 + Math.floor(Math.random() * 1_000);
      const child = spawn(pythonPath, [serverPath], {
        stdio: 'ignore',
        env: {
          ...process.env,
          HF_DATASETS_OFFLINE: '1',
          HF_HUB_DISABLE_TELEMETRY: '1',
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          MLX_PREVIEW_PORT: String(port),
        },
      });
      try {
        await waitForMlx(port, child);
      } catch {
        await terminateChild(child);
        return {
          status: 'unavailable' as const,
          reason: 'runtime_unavailable' as const,
        };
      }
      return {
        status: 'available' as const,
        run: {
          transcribePair: async (job) => {
            const started = performance.now();
            const [micRaw, systemRaw] = await Promise.all([
              mlxRequest(port, job.micPath),
              mlxRequest(port, job.systemPath),
            ]);
            const offset = (job.sequence - 1) * 5;
            const offsetDiagnostic = (
              diagnostic: DiagnosticResult,
            ): DiagnosticResult =>
              diagnostic.status === 'available'
                ? {
                    ...diagnostic,
                    timedTokens: diagnostic.timedTokens.map((token) => ({
                      ...token,
                      atSeconds: offset + token.atSeconds,
                    })),
                  }
                : diagnostic;
            return {
              completedAtSeconds:
                job.availableAtSeconds + (performance.now() - started) / 1_000,
              mic: offsetDiagnostic(micRaw),
              system: offsetDiagnostic(systemRaw),
            };
          },
          batch: (meeting, source) =>
            mlxRequest(port, meeting.wholePaths[source]),
          sample: (sourceSeconds, expectedWallTimeMs) => {
            if (!child.pid) return undefined;
            const rssGiB = sampleRss(child.pid);
            const wallTimeMs = Date.now();
            return rssGiB === undefined
              ? undefined
              : {
                  sourceSeconds,
                  wallTimeMs,
                  schedulingJitterMs: wallTimeMs - expectedWallTimeMs,
                  rssGiB,
                  thermal: sampleThermal(),
                };
          },
          close: () => terminateChild(child),
        },
      };
    },
    startParakeet: async (config, repetition) => {
      const [{ NativeJsonLineProcess }, { ParakeetLiveClient }] =
        await Promise.all([
          import('../electron/transcription/nativeJsonLineProcess.ts'),
          import('../electron/transcription/parakeetLiveClient.ts'),
        ]);
      let child: ChildProcess | undefined;
      const transport = new NativeJsonLineProcess({
        executablePath: manifest.runtime.executablePath,
        args: [
          '--model-root',
          manifest.runtime.modelRoot,
          '--audio-root',
          temporaryRoot,
          '--live-config',
          config,
        ],
        spawn: (executablePath, args, options) => {
          child = spawn(executablePath, args, options);
          return child as never;
        },
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
      });
      const client = new ParakeetLiveClient({
        process: transport,
        maxQueuedAppends: 2,
      });
      const queuedEvents: NativeEvent[] = [];
      const unsubscribe = client.onEvent((event) => queuedEvents.push(event));
      let prepare: Awaited<ReturnType<typeof transport.request>>;
      try {
        prepare = await transport.request({
          schemaVersion: 1,
          id: `prepare-${repetition}-${config}`,
          method: 'prepare',
          modelRoot: manifest.runtime.modelRoot,
        });
      } catch {
        unsubscribe();
        client.close();
        if (child) await terminateChild(child);
        throw new Error('runtime_unavailable');
      }
      if (
        !prepare.ok ||
        prepare.result?.liveConfigId !== config ||
        !child?.pid
      ) {
        unsubscribe();
        client.close();
        if (child) await terminateChild(child);
        throw new Error('runtime_unavailable');
      }
      let active: PreparedMeeting | undefined;
      const identities = {} as Record<
        ReplaySource,
        { streamId: string; source: ReplaySource; generation: number }
      >;
      const drain = () => queuedEvents.splice(0);
      return {
        openPair: async (meeting) => {
          active = meeting;
          for (const source of SOURCES)
            identities[source] = {
              streamId: `${source}-${repetition}-${meeting.meeting.sealedGeneration}`,
              source,
              generation: meeting.meeting.sealedGeneration,
            };
          await Promise.all(
            SOURCES.map((source) => client.open(identities[source])),
          );
          drain();
        },
        append: async (source, frame) => {
          if (!frame.audioPath) throw new Error('benchmark_failed');
          await client.append({
            ...identities[source],
            sequence: frame.sequence + 1,
            audioPath: frame.audioPath,
            chunkStartSeconds: frame.startSeconds,
            chunkEndSeconds: frame.endSeconds,
          });
          return drain();
        },
        flush: async (source) => {
          const result = await client.flush(identities[source]);
          const events = drain();
          return {
            finalPreview: result.finalPreview,
            timedTokens: tokens(result.finalPreview).map((token) => ({
              token,
              atSeconds: active?.meeting.sealedDurationSeconds ?? 0,
            })),
            degradations: result.degradations,
            events,
          };
        },
        batch: async (source) => {
          if (!active) return { status: 'unavailable' as const };
          const response = await transport.request({
            schemaVersion: 1,
            id: `batch-${source}-${active.meeting.sealedGeneration}`,
            method: 'transcribe',
            audioPath: active.wholePaths[source],
            language: 'en',
            vocabulary: [],
          });
          const transcription = response.result?.transcription as
            | {
                text?: unknown;
                words?: Array<{ text?: unknown; endSeconds?: unknown }>;
              }
            | undefined;
          if (!response.ok || typeof transcription?.text !== 'string')
            return { status: 'unavailable' as const };
          return {
            status: 'available' as const,
            text: transcription.text,
            timedTokens: (transcription.words ?? []).flatMap((word) =>
              typeof word.text === 'string' &&
              typeof word.endSeconds === 'number'
                ? tokens(word.text).map((token) => ({
                    token,
                    atSeconds: word.endSeconds as number,
                  }))
                : [],
            ),
          };
        },
        probeGap: async (source, gap, prefix, suffix) => {
          if (!active) return { events: [] };
          const identity = {
            streamId: `${source}-${repetition}-${gap.label}-probe`,
            source,
            generation:
              active.meeting.sealedGeneration + gap.omittedSequences[0] + 1,
          } as const;
          await client.open(identity);
          drain();
          for (const frame of prefix) {
            if (!frame.audioPath) throw new Error('benchmark_failed');
            await client.append({
              ...identity,
              sequence: frame.sequence + 1,
              audioPath: frame.audioPath,
              chunkStartSeconds: frame.startSeconds,
              chunkEndSeconds: frame.endSeconds,
            });
          }
          if (!suffix.audioPath) throw new Error('benchmark_failed');
          await client
            .append({
              ...identity,
              sequence: prefix.length + 1,
              audioPath: suffix.audioPath,
              chunkStartSeconds: suffix.startSeconds,
              chunkEndSeconds: suffix.endSeconds,
            })
            .catch(() => undefined);
          const events = drain();
          await client.cancel(identity).catch(() => undefined);
          return { events };
        },
        repair: async (source, startSeconds, endSeconds) => {
          if (!active) return { status: 'unavailable' as const };
          const repairPath = path.join(
            temporaryRoot,
            `repair-${repetition}-${active.meeting.sealedGeneration}-${source}-${Math.round(startSeconds * 1_000)}.wav`,
          );
          extractWindow(
            active.meeting.sources[`${source}Path`],
            repairPath,
            startSeconds,
            endSeconds - startSeconds,
          );
          const response = await transport.request({
            schemaVersion: 1,
            id: `repair-${source}-${active.meeting.sealedGeneration}-${Math.round(startSeconds * 1_000)}`,
            method: 'transcribe',
            audioPath: repairPath,
            language: 'en',
            vocabulary: [],
          });
          const transcription = response.result?.transcription as
            | {
                text?: unknown;
                words?: Array<{ text?: unknown; endSeconds?: unknown }>;
              }
            | undefined;
          if (!response.ok || typeof transcription?.text !== 'string')
            return { status: 'unavailable' as const };
          return {
            status: 'available' as const,
            text: transcription.text,
            timedTokens: (transcription.words ?? []).flatMap((word) =>
              typeof word.text === 'string' &&
              typeof word.endSeconds === 'number'
                ? tokens(word.text).map((token) => ({
                    token,
                    atSeconds: startSeconds + (word.endSeconds as number),
                  }))
                : [],
            ),
          };
        },
        sample: (sourceSeconds, expectedWallTimeMs) => {
          if (!child?.pid) return undefined;
          const rssGiB = sampleRss(child.pid);
          const wallTimeMs = Date.now();
          return rssGiB === undefined
            ? undefined
            : {
                sourceSeconds,
                wallTimeMs,
                schedulingJitterMs: wallTimeMs - expectedWallTimeMs,
                rssGiB,
                thermal: sampleThermal(),
              };
        },
        close: async () => {
          unsubscribe();
          client.close();
          return child ? terminateChild(child) : 'cleanup_failed';
        },
      };
    },
  };
};

export const assertReportTargetSafe = (
  outputPath: string,
  manifestPath: string,
  manifest: PrivateLiveReplayManifest,
) => {
  const parent = path.dirname(path.resolve(outputPath));
  try {
    if (fs.realpathSync(parent) !== parent)
      throw new Error('report_unavailable');
  } catch {
    throw new Error('report_unavailable');
  }
  const protectedPaths = [
    manifestPath,
    manifest.runtime.executablePath,
    ...manifest.meetings.flatMap((meeting) => [
      meeting.sources.micPath,
      meeting.sources.systemPath,
      meeting.proxyTranscriptPath,
    ]),
  ].map((filePath) => fs.realpathSync(filePath));
  const resolved = path.resolve(outputPath);
  const modelRoot = fs.realpathSync(manifest.runtime.modelRoot);
  if (
    fs.existsSync(resolved) ||
    protectedPaths.includes(resolved) ||
    resolved.startsWith(`${modelRoot}${path.sep}`)
  )
    throw new Error('report_unavailable');
};

export const writePrivateReplayReportAtomic = (
  outputPath: string,
  report: PrivateLiveReplayComparison,
) => {
  const parent = path.dirname(outputPath);
  const temporary = path.join(
    parent,
    `.private-live-${process.pid}-${Date.now()}.tmp`,
  );
  let handle: number | undefined;
  try {
    handle = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.linkSync(temporary, outputPath);
    fs.unlinkSync(temporary);
    const directoryHandle = fs.openSync(parent, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } catch {
    if (handle !== undefined) fs.closeSync(handle);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw new Error('report_unavailable');
  }
};

export const runPrivateLiveReplay = async (
  options: PrivateLiveReplayOptions,
  injected?: {
    manifest?: PrivateLiveReplayManifest;
    dependencies?: PrivateReplayDependencies;
  },
) => {
  const manifest =
    injected?.manifest ??
    validatePrivateLiveReplayManifest(
      readPrivateLiveReplayManifest(options.manifestPath),
    );
  assertReportTargetSafe(options.outputPath, options.manifestPath, manifest);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-live-replay-'),
  );
  fs.chmodSync(temporaryRoot, 0o700);
  try {
    return await orchestratePrivateReplay(
      manifest,
      options,
      injected?.dependencies ??
        createProductionDependencies(manifest, temporaryRoot),
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: false });
  }
};

const cliCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  return SAFE_CODES.has(code) ? code : 'benchmark_failed';
};

export const runReplayCli = async (
  argv: readonly string[] = process.argv.slice(2),
  injected?: Parameters<typeof runPrivateLiveReplay>[1] & {
    write?: typeof writePrivateReplayReportAtomic;
  },
) => {
  try {
    const options = parsePrivateLiveReplayOptions(argv);
    const report = await runPrivateLiveReplay(options, injected);
    (injected?.write ?? writePrivateReplayReportAtomic)(
      options.outputPath,
      report,
    );
    process.stdout.write('report written\n');
  } catch (error) {
    process.stderr.write(`${cliCode(error)}\n`);
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runReplayCli();
}
