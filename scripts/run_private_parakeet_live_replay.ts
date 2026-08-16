import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type {
  NativeEvent,
  NativeProcessSpawn,
} from '../electron/transcription/nativeJsonLineProcess.ts';
import type { LiveStreamSnapshot } from '../src/services/liveTranscription/contracts.ts';
import { reduceLiveStreamUpdate } from '../src/services/liveTranscription/stablePrefix.ts';
import {
  type LiveReplayPublication,
  type LiveReplayRepetition,
  type LiveReplayResourceSoak,
  type PrivateLiveReplayReport,
  buildPrivateLiveReplayReport,
  evaluateLiveReplay,
  sanitizeLiveReplayReport,
} from '../src/services/liveTranscriptionReplayMetrics.ts';
import {
  type PrivateLiveReplayManifest,
  readPrivateLiveReplayManifest,
  validatePrivateLiveReplayManifest,
} from './validate_private_parakeet_live_manifest.ts';

type ReplayMode = 'causal' | 'realtime-soak';
type Engine = 'mlxProduction' | 'parakeetPinnedDefault' | 'parakeetLowLatency';

export type PrivateLiveReplayOptions = {
  manifestPath: string;
  mode: ReplayMode;
  repetitions: number;
  outputPath: string;
};

type GapInjection = {
  label: 'early' | 'middle' | 'late';
  startSeconds: number;
  endSeconds: number;
};

const RUNTIME = Object.freeze({
  fluidAudioVersion: '0.15.5',
  fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
  modelId: 'parakeet-tdt-0.6b-v3',
});
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const DECODE_TIMEOUT_MS = 2 * 60 * 60_000;
const FRAME_SECONDS = 0.25;
const SAFE_CLI_CODES = new Set([
  'benchmark_failed',
  'decode_unavailable',
  'manifest_invalid',
  'manifest_unavailable',
  'meeting_not_recent',
  'model_unavailable',
  'mlx_cache_unavailable',
  'options_invalid',
  'private_content_not_allowed',
  'report_unavailable',
  'runtime_unavailable',
  'source_duration_mismatch',
  'source_not_independent',
  'source_unavailable',
  'insufficient_corpus',
  'integrity_not_sealed',
  'mixed_mic_source',
  'unresolved_capture_gap',
  'cleanup_failed',
]);

export const buildEngineRunOrder = (repetitions: number): Engine[][] => {
  if (!Number.isSafeInteger(repetitions) || repetitions !== 3) {
    throw new Error('options_invalid');
  }
  return Array.from({ length: repetitions }, (_, index) =>
    index % 2 === 0
      ? ['mlxProduction', 'parakeetPinnedDefault', 'parakeetLowLatency']
      : ['parakeetLowLatency', 'parakeetPinnedDefault', 'mlxProduction'],
  );
};

export const buildQuarterSecondFrames = (durationSeconds: number) => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('options_invalid');
  }
  const frames = [];
  for (let start = 0, sequence = 0; start < durationSeconds; sequence += 1) {
    const audioEndSeconds = Math.min(durationSeconds, start + FRAME_SECONDS);
    frames.push({
      sequence,
      availableAtSeconds: audioEndSeconds,
      audioEndSeconds,
    });
    start = audioEndSeconds;
  }
  return frames;
};

export const buildGapInjections = (durationSeconds: number): GapInjection[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 30) {
    throw new Error('options_invalid');
  }
  const center = (fraction: number) =>
    Math.max(2, Math.min(durationSeconds - 2, durationSeconds * fraction));
  return [
    { label: 'early', startSeconds: center(0.1), endSeconds: center(0.1) + 2 },
    {
      label: 'middle',
      startSeconds: center(0.5) - 1,
      endSeconds: center(0.5) + 1,
    },
    {
      label: 'late',
      startSeconds: center(0.9) - 2,
      endSeconds: center(0.9),
    },
  ];
};

export type ReplaySource = 'mic' | 'system';
export type QuarterSecondFrame = ReturnType<
  typeof buildQuarterSecondFrames
>[number];
type ReplayGap = ReturnType<typeof buildGapInjections>[number];
type RepairToken = { token: string; atSeconds: number };
export type MlxPairJob = {
  meetingId: string;
  sequence: number;
  availableAtSeconds: number;
  micPath: string;
  systemPath: string;
};
export type InjectedMlxProcess = {
  transcribePair(job: MlxPairJob): Promise<{ completedAtSeconds: number }>;
  resourceEvidence():
    | {
        status: 'available';
        samples: readonly { wallTimeMs: number; rssGiB: number }[];
      }
    | { status: 'unavailable' };
  terminate(): Promise<'exited' | 'cleanup_failed'>;
};

export type InjectedParakeetProcess = {
  open(source: ReplaySource): Promise<void>;
  append(source: ReplaySource, frame: QuarterSecondFrame): Promise<void>;
  flush(
    source: ReplaySource,
  ): Promise<{ finalPreview: string; degradations: readonly unknown[] }>;
  runBatchDiagnostic(
    source: ReplaySource,
  ): Promise<
    | { status: 'available'; boundaries: readonly number[] }
    | { status: 'unavailable' }
  >;
  probeGap(
    source: ReplaySource,
    gap: ReplayGap,
    prefix: readonly QuarterSecondFrame[],
    suffix: readonly QuarterSecondFrame[],
  ): Promise<
    | { status: 'detected'; startSeconds: number; endSeconds: number }
    | { status: 'unavailable' }
  >;
  repairGap(
    source: ReplaySource,
    gap: ReplayGap,
  ): Promise<
    | {
        status: 'available';
        before: readonly RepairToken[];
        repair: readonly RepairToken[];
        after: readonly RepairToken[];
        spliced: readonly RepairToken[];
      }
    | { status: 'unavailable' }
  >;
  resourceEvidence():
    | {
        status: 'available';
        processTopology: 'combined-dual-source';
        samples: readonly { wallTimeMs: number; rssGiB: number }[];
        thermal:
          | {
              status: 'available';
              state: 'nominal' | 'fair' | 'serious' | 'critical';
            }
          | { status: 'unavailable' };
      }
    | { status: 'unavailable' };
  terminate(): Promise<'exited' | 'cleanup_failed'>;
};

type InjectedReplayInput = {
  meetings: readonly {
    id: string;
    durationSeconds: number;
    micPath: string;
    systemPath: string;
  }[];
  repetitions: number;
  maximumPendingAppends: number;
  clock: { nowSeconds(): number; waitUntil(seconds: number): Promise<void> };
  createParakeet(
    config: 'pinned-default' | 'low-latency-2s',
    repetition: number,
  ): Promise<InjectedParakeetProcess>;
  createMlx(input: {
    offline: true;
    chunkSeconds: 5;
    queuePolicy: 'one-active-one-latest';
  }): Promise<
    | { status: 'available'; process: InjectedMlxProcess }
    | { status: 'unavailable'; reason: 'cache_missing' | 'runtime_unavailable' }
  >;
};

const runInjectedMlx = async (
  input: InjectedReplayInput,
): Promise<
  | {
      status: 'available';
      processedJobs: number;
      resourceStatus: 'available' | 'unavailable';
    }
  | { status: 'unavailable'; reason: 'cache_missing' | 'runtime_unavailable' }
> => {
  const created = await input.createMlx({
    offline: true,
    chunkSeconds: 5,
    queuePolicy: 'one-active-one-latest',
  });
  if (created.status === 'unavailable') return created;
  let processedJobs = 0;
  let failure: unknown;
  try {
    for (const meeting of input.meetings) {
      const segmentCount = Math.ceil(meeting.durationSeconds / 5);
      let index = 0;
      while (index < segmentCount) {
        const availableAtSeconds = Math.min(
          meeting.durationSeconds,
          (index + 1) * 5,
        );
        await input.clock.waitUntil(availableAtSeconds);
        const result = await created.process.transcribePair({
          meetingId: meeting.id,
          sequence: index + 1,
          availableAtSeconds,
          micPath: meeting.micPath,
          systemPath: meeting.systemPath,
        });
        if (
          !Number.isFinite(result.completedAtSeconds) ||
          result.completedAtSeconds < availableAtSeconds
        ) {
          throw new Error('benchmark_failed');
        }
        processedJobs += 1;
        index = nextMlxProductionQueueIndex(
          index,
          result.completedAtSeconds,
          segmentCount,
          meeting.durationSeconds,
        ).nextIndex;
      }
    }
  } catch (error) {
    failure = error;
  }
  const resource = created.process.resourceEvidence();
  if (
    resource.status === 'available' &&
    resource.samples.some(
      (sample, index, samples) =>
        !Number.isFinite(sample.wallTimeMs) ||
        !Number.isFinite(sample.rssGiB) ||
        (index > 0 && sample.wallTimeMs < samples[index - 1].wallTimeMs),
    )
  ) {
    failure = new Error('benchmark_failed');
  }
  const cleanup = await created.process
    .terminate()
    .catch(() => 'cleanup_failed' as const);
  if (cleanup !== 'exited') throw new Error('cleanup_failed');
  if (failure) throw new Error('benchmark_failed');
  return {
    status: 'available',
    processedJobs,
    resourceStatus: resource.status,
  };
};

const validateRepairSplice = (
  evidence: Extract<
    Awaited<ReturnType<InjectedParakeetProcess['repairGap']>>,
    { status: 'available' }
  >,
  gap: ReplayGap,
): void => {
  const expectedOutside = [...evidence.before, ...evidence.after].map(
    ({ token }) => token,
  );
  const actualOutside = [
    ...evidence.spliced.slice(0, evidence.before.length),
    ...evidence.spliced.slice(evidence.spliced.length - evidence.after.length),
  ].map(({ token }) => token);
  if (editDistance(expectedOutside, actualOutside) !== 0) {
    throw new Error('benchmark_failed');
  }
  if (
    !evidence.repair.some(
      ({ atSeconds }) =>
        atSeconds >= gap.startSeconds - 2 && atSeconds <= gap.endSeconds + 2,
    )
  ) {
    throw new Error('benchmark_failed');
  }
};

const replayDualSourceMeeting = async (
  child: InjectedParakeetProcess,
  meeting: InjectedReplayInput['meetings'][number],
  maximumPending: number,
  clock: InjectedReplayInput['clock'],
): Promise<void> => {
  await Promise.all([child.open('mic'), child.open('system')]);
  const frames = buildQuarterSecondFrames(meeting.durationSeconds);
  const pending: Promise<void>[] = [];
  for (const frame of frames) {
    await clock.waitUntil(frame.availableAtSeconds);
    for (const source of ['mic', 'system'] as const) {
      if (clock.nowSeconds() < frame.availableAtSeconds)
        throw new Error('benchmark_failed');
      if (pending.length >= maximumPending) await pending.shift();
      const append = child.append(source, frame);
      pending.push(append);
    }
  }
  await Promise.all(pending);
  await Promise.all([child.flush('mic'), child.flush('system')]);
  for (const source of ['mic', 'system'] as const) {
    await child.runBatchDiagnostic(source);
    for (const gap of buildGapInjections(meeting.durationSeconds)) {
      const prefix = frames.filter(
        (frame) => frame.audioEndSeconds <= gap.startSeconds,
      );
      const suffix = frames.filter(
        (frame) => frame.audioEndSeconds - FRAME_SECONDS >= gap.endSeconds,
      );
      if (prefix.length === 0 || suffix.length === 0)
        throw new Error('benchmark_failed');
      const detected = await child.probeGap(source, gap, prefix, suffix);
      if (
        detected.status !== 'detected' ||
        detected.startSeconds !== gap.startSeconds ||
        detected.endSeconds !== gap.endSeconds ||
        detected.endSeconds - detected.startSeconds !== 2
      ) {
        throw new Error('benchmark_failed');
      }
      const repair = await child.repairGap(source, gap);
      if (repair.status === 'available') validateRepairSplice(repair, gap);
    }
  }
};

export const orchestrateInjectedPrivateReplay = async (
  input: InjectedReplayInput,
) => {
  if (
    !Number.isSafeInteger(input.repetitions) ||
    input.repetitions <= 0 ||
    !Number.isSafeInteger(input.maximumPendingAppends) ||
    input.maximumPendingAppends <= 0
  ) {
    throw new Error('options_invalid');
  }
  const mlx: Array<Awaited<ReturnType<typeof runInjectedMlx>>> = [];
  const configs: Array<{
    config: 'pinned-default' | 'low-latency-2s';
    repetition: number;
  }> = [];
  const resources: Array<{
    config: 'pinned-default' | 'low-latency-2s';
    repetition: number;
    processTopology: 'combined-dual-source';
  }> = [];
  for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
    const order =
      repetition % 2 === 0
        ? (['mlx', 'pinned-default', 'low-latency-2s'] as const)
        : (['low-latency-2s', 'pinned-default', 'mlx'] as const);
    for (const engine of order) {
      if (engine === 'mlx') {
        mlx.push(await runInjectedMlx(input));
        continue;
      }
      const config = engine;
      const child = await input.createParakeet(config, repetition);
      let failure: unknown;
      try {
        for (const meeting of input.meetings) {
          await replayDualSourceMeeting(
            child,
            meeting,
            input.maximumPendingAppends,
            input.clock,
          );
        }
        const resource = child.resourceEvidence();
        if (resource.status === 'available') {
          if (
            resource.processTopology !== 'combined-dual-source' ||
            resource.samples.some(
              (sample, index, samples) =>
                !Number.isFinite(sample.wallTimeMs) ||
                !Number.isFinite(sample.rssGiB) ||
                (index > 0 &&
                  sample.wallTimeMs < samples[index - 1].wallTimeMs),
            )
          ) {
            throw new Error('benchmark_failed');
          }
          resources.push({
            config,
            repetition,
            processTopology: resource.processTopology,
          });
        }
        configs.push({ config, repetition });
      } catch (error) {
        failure = error;
      }
      const cleanup = await child
        .terminate()
        .catch(() => 'cleanup_failed' as const);
      if (cleanup !== 'exited') throw new Error('cleanup_failed');
      if (failure) throw new Error('benchmark_failed');
    }
  }
  return { configs, mlx, resources };
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

export const buildPrivateLiveReplayComparison = (
  pinnedDefault: PrivateLiveReplayReport,
  lowLatency: PrivateLiveReplayReport,
): PrivateLiveReplayComparison => {
  if (
    pinnedDefault.runtime.configId !== 'pinned-default-v1' ||
    lowLatency.runtime.configId !== 'low-latency-v1'
  ) {
    throw new Error('benchmark_failed');
  }
  const pinned = sanitizeLiveReplayReport(pinnedDefault);
  const low = sanitizeLiveReplayReport(lowLatency);
  const statuses = [
    pinned.engines.parakeetSliding.status,
    low.engines.parakeetSliding.status,
  ];
  const decision = statuses.includes('fail')
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

const readOption = (
  argv: readonly string[],
  name: string,
  required = true,
): string | undefined => {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) {
    throw new Error('options_invalid');
  }
  return value;
};

export const parsePrivateLiveReplayOptions = (
  argv: readonly string[],
): PrivateLiveReplayOptions => {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const known = new Set(['--manifest', '--mode', '--repetitions', '--out']);
  for (let index = 0; index < normalizedArgv.length; index += 2) {
    if (!known.has(normalizedArgv[index]) || !normalizedArgv[index + 1]) {
      throw new Error('options_invalid');
    }
  }
  const manifestPath = readOption(normalizedArgv, '--manifest') as string;
  const mode = readOption(normalizedArgv, '--mode') as ReplayMode;
  const outputPath = readOption(normalizedArgv, '--out') as string;
  const repetitionsRaw = readOption(normalizedArgv, '--repetitions', false);
  const repetitions = repetitionsRaw
    ? Number(repetitionsRaw)
    : mode === 'realtime-soak'
      ? 1
      : 3;
  if (
    !path.isAbsolute(manifestPath) ||
    !path.isAbsolute(outputPath) ||
    (mode !== 'causal' && mode !== 'realtime-soak') ||
    !Number.isSafeInteger(repetitions) ||
    (mode === 'causal' ? repetitions !== 3 : repetitions !== 1)
  ) {
    throw new Error('options_invalid');
  }
  return { manifestPath, mode, repetitions, outputPath };
};

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

const compareText = (candidate: string, reference: string) => {
  const candidateTokens = tokens(candidate);
  const referenceTokens = tokens(reference);
  const distance = editDistance(candidateTokens, referenceTokens);
  const matched = Math.max(
    0,
    Math.max(candidateTokens.length, referenceTokens.length) - distance,
  );
  return {
    editRate: Math.min(1, distance / Math.max(1, referenceTokens.length)),
    precision: Math.min(1, matched / Math.max(1, candidateTokens.length)),
    recall: Math.min(1, matched / Math.max(1, referenceTokens.length)),
    duplicateTokens: Math.max(
      0,
      candidateTokens.length - referenceTokens.length,
    ),
    omittedTokens: Math.max(0, referenceTokens.length - candidateTokens.length),
    referenceTokens: referenceTokens.length,
  };
};

const decodeSegments = (
  inputPath: string,
  outputDirectory: string,
  segmentSeconds: number,
): string[] => {
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const outputPattern = path.join(outputDirectory, 'frame-%08d.wav');
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
      outputPattern,
    ],
    { stdio: 'ignore', timeout: DECODE_TIMEOUT_MS },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
  const segments = fs
    .readdirSync(outputDirectory)
    .filter((name) => /^frame-\d{8}\.wav$/.test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));
  if (segments.length === 0) throw new Error('decode_unavailable');
  return segments;
};

const decodeWholeSource = (inputPath: string, outputPath: string): void => {
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
    { stdio: 'ignore', timeout: DECODE_TIMEOUT_MS },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
};

const extractSourceWindow = (
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
): void => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-ss',
      String(startSeconds),
      '-i',
      inputPath,
      '-t',
      String(durationSeconds),
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      outputPath,
    ],
    { stdio: 'ignore', timeout: DECODE_TIMEOUT_MS },
  );
  if (result.status !== 0 || result.signal)
    throw new Error('decode_unavailable');
};

type TimedToken = { token: string; atSeconds: number };

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

export const scoreChunkBoundarySeams = (
  candidate: readonly TimedToken[],
  reference: readonly TimedToken[],
  boundaries: readonly number[],
): {
  duplicateTokens: number;
  omittedTokens: number;
  referenceTokens: number;
} => {
  let duplicateTokens = 0;
  let omittedTokens = 0;
  let referenceTokens = 0;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary) || boundary <= 0)
      throw new Error('benchmark_failed');
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
    const comparison = compareText(
      candidateWindow.join(' '),
      referenceWindow.join(' '),
    );
    duplicateTokens += comparison.duplicateTokens;
    omittedTokens += comparison.omittedTokens;
    referenceTokens += comparison.referenceTokens;
  }
  return { duplicateTokens, omittedTokens, referenceTokens };
};

export const nextMlxProductionQueueIndex = (
  currentIndex: number,
  completedAtSeconds: number,
  segmentCount: number,
  sourceDurationSeconds: number,
): { nextIndex: number; admittedThroughIndex: number } => {
  if (
    !Number.isSafeInteger(currentIndex) ||
    !Number.isSafeInteger(segmentCount) ||
    currentIndex < 0 ||
    segmentCount <= currentIndex ||
    !Number.isFinite(completedAtSeconds) ||
    !Number.isFinite(sourceDurationSeconds)
  ) {
    throw new Error('benchmark_failed');
  }
  let latestQueued = currentIndex;
  while (
    latestQueued + 1 < segmentCount &&
    Math.min(sourceDurationSeconds, (latestQueued + 2) * 5) <=
      completedAtSeconds
  ) {
    latestQueued += 1;
  }
  return {
    nextIndex: latestQueued > currentIndex ? latestQueued : currentIndex + 1,
    admittedThroughIndex: latestQueued,
  };
};

const tokenF1 = (candidate: string, reference: string): number => {
  const comparison = compareText(candidate, reference);
  if (comparison.precision === 0 || comparison.recall === 0) return 0;
  return (
    (2 * comparison.precision * comparison.recall) /
    (comparison.precision + comparison.recall)
  );
};

export const proveTargetedRepair = (
  reference: readonly TimedToken[],
  repairText: string,
  repairStartSeconds: number,
  repairEndSeconds: number,
  spliced: readonly TimedToken[] = reference,
): { repairedTokenF1: number; outsideContextTokenChanges: number } => {
  if (
    !Number.isFinite(repairStartSeconds) ||
    !Number.isFinite(repairEndSeconds) ||
    repairStartSeconds < 0 ||
    repairEndSeconds <= repairStartSeconds
  ) {
    throw new Error('benchmark_failed');
  }
  const before = reference.filter(
    ({ atSeconds }) => atSeconds < repairStartSeconds,
  );
  const region = reference.filter(
    ({ atSeconds }) =>
      atSeconds >= repairStartSeconds && atSeconds <= repairEndSeconds,
  );
  const after = reference.filter(
    ({ atSeconds }) => atSeconds > repairEndSeconds,
  );
  const outsideBefore = [...before, ...after].map(({ token }) => token);
  const splicedOutside = spliced
    .filter(
      ({ atSeconds }) =>
        atSeconds < repairStartSeconds || atSeconds > repairEndSeconds,
    )
    .map(({ token }) => token);
  return {
    repairedTokenF1: tokenF1(
      repairText,
      region.map(({ token }) => token).join(' '),
    ),
    outsideContextTokenChanges: editDistance(outsideBefore, splicedOutside),
  };
};

const loadProxyTranscript = (
  proxyPath: string,
): { text: string; timedTokens: TimedToken[] } => {
  const stat = fs.lstatSync(proxyPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 10 * 1024 * 1024) {
    throw new Error('benchmark_failed');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(proxyPath, 'utf8')) as unknown;
  } catch {
    throw new Error('benchmark_failed');
  }
  const entries = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === 'object' &&
        Array.isArray((raw as { segments?: unknown }).segments)
      ? (raw as { segments: unknown[] }).segments
      : undefined;
  if (!entries) throw new Error('benchmark_failed');
  const textParts: string[] = [];
  const timedTokens: TimedToken[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('benchmark_failed');
    }
    const segment = entry as Record<string, unknown>;
    if (typeof segment.text !== 'string') throw new Error('benchmark_failed');
    const end =
      typeof segment.endTime === 'number'
        ? segment.endTime
        : typeof segment.end === 'number'
          ? segment.end
          : undefined;
    if (end === undefined || !Number.isFinite(end) || end < 0) {
      throw new Error('benchmark_failed');
    }
    textParts.push(segment.text);
    timedTokens.push(
      ...tokens(segment.text).map((token) => ({ token, atSeconds: end })),
    );
  }
  return { text: textParts.join(' '), timedTokens };
};

type RunObservation = {
  repetition: LiveReplayRepetition;
  finalText: string;
  timedTokens: TimedToken[];
  resourceSoak?: LiveReplayResourceSoak;
};

const sampleRssGiB = (pid: number): number => {
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const rssKiB = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isFinite(rssKiB) || rssKiB < 0) {
    throw new Error('benchmark_failed');
  }
  return rssKiB / 1024 / 1024;
};

const sampleThermalState = (): 'nominal' | 'fair' | 'serious' | 'critical' => {
  const result = spawnSync('pmset', ['-g', 'therm'], {
    encoding: 'utf8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) throw new Error('benchmark_failed');
  if (
    result.stdout.includes('No thermal warning level has been recorded') &&
    result.stdout.includes('No performance warning level has been recorded')
  ) {
    return 'nominal';
  }
  throw new Error('benchmark_failed');
};

const startResourceSampling = (
  pid: number,
  intervalSeconds: 0.25 | 1,
  includeThermal: boolean,
) => {
  const rssSamples: Array<{ atSeconds: number; rssGiB: number }> = [];
  const thermalSamples: Array<{
    atSeconds: number;
    state: 'nominal' | 'fair' | 'serious' | 'critical';
  }> = [];
  let sampleIndex = 0;
  let samplingFailed = false;
  const wallStartedAt = performance.now();
  const sample = () => {
    try {
      const atSeconds = (performance.now() - wallStartedAt) / 1_000;
      rssSamples.push({ atSeconds, rssGiB: sampleRssGiB(pid) });
      if (includeThermal) {
        thermalSamples.push({ atSeconds, state: sampleThermalState() });
      }
      sampleIndex += 1;
    } catch {
      samplingFailed = true;
    }
  };
  sample();
  if (rssSamples.length === 0) throw new Error('benchmark_failed');
  const timer = setInterval(sample, intervalSeconds * 1_000);
  return {
    preparedIdleRssGiB: rssSamples[0].rssGiB,
    stop: (_finalAtSeconds?: number) => {
      clearInterval(timer);
      sample();
      return { rssSamples, thermalSamples, samplingFailed };
    },
  };
};

const waitForMlx = async (port: number, child: ChildProcess): Promise<void> => {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error('benchmark_failed');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The local server is still warming its model.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('benchmark_failed');
};

export const hasPreparedMlxMediumCache = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => {
  const huggingFaceHome = environment.HF_HOME
    ? path.resolve(environment.HF_HOME)
    : path.join(os.homedir(), '.cache', 'huggingface');
  const modelRoot = path.join(
    huggingFaceHome,
    'hub',
    'models--mlx-community--whisper-medium-mlx',
  );
  try {
    const stat = fs.lstatSync(modelRoot);
    const canonical = fs.realpathSync(modelRoot);
    const snapshots = path.join(canonical, 'snapshots');
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      canonical === modelRoot &&
      fs.lstatSync(snapshots).isDirectory() &&
      fs.readdirSync(snapshots).length > 0
    );
  } catch {
    return false;
  }
};

const terminateChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    const forcedTimeout = setTimeout(
      () => reject(new Error('cleanup_failed')),
      7_000,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      clearTimeout(forcedTimeout);
      resolve();
    });
  });
};

const runMlxSource = async (input: {
  sourcePath: string;
  durationSeconds: number;
  audioRoot: string;
}): Promise<RunObservation> => {
  if (!hasPreparedMlxMediumCache()) throw new Error('mlx_cache_unavailable');
  const pythonPath = path.resolve('python/venv/bin/python');
  const serverPath = path.resolve('python/mlx_transcription_server.py');
  for (const required of [pythonPath, serverPath]) {
    const stat = fs.lstatSync(required);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('runtime_unavailable');
    }
  }
  const segmentPaths = decodeSegments(
    input.sourcePath,
    path.join(input.audioRoot, 'mlx-five-second'),
    5,
  );
  const wholeSourcePath = path.join(input.audioRoot, 'mlx-whole.wav');
  decodeWholeSource(input.sourcePath, wholeSourcePath);
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
  const publications: LiveReplayPublication[] = [];
  const committedSnapshots: string[] = [];
  const acceptedSequences: number[] = [];
  const processedSequences: number[] = [];
  const acceptedCoverage = [];
  const processedCoverage = [];
  const handoffs: number[] = [];
  let accumulated = '';
  const observedTimedTokens: TimedToken[] = [];
  let inferenceSeconds = 0;
  let resourceSampling: ReturnType<typeof startResourceSampling> | undefined;
  try {
    await waitForMlx(port, child);
    if (!child.pid) throw new Error('benchmark_failed');
    const warm = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        audio_path: segmentPaths[0],
        model: 'medium',
        device: 'mlx',
        compute_type: 'float16',
        language: 'en',
        word_timestamps: true,
      }),
    });
    if (!warm.ok) throw new Error('benchmark_failed');
    await warm.arrayBuffer();
    resourceSampling = startResourceSampling(child.pid, 0.25, false);
    let virtualEngineAvailableAt = 0;
    let index = 0;
    const admitted = new Set<number>();
    const admit = (segmentIndex: number) => {
      if (admitted.has(segmentIndex)) return;
      admitted.add(segmentIndex);
      const start = segmentIndex * 5;
      const end = Math.min(input.durationSeconds, (segmentIndex + 1) * 5);
      acceptedSequences.push(segmentIndex + 1);
      acceptedCoverage.push({
        receipt: segmentIndex + 1,
        startSeconds: start,
        endSeconds: end,
      });
    };
    while (index < segmentPaths.length) {
      const end = Math.min(input.durationSeconds, (index + 1) * 5);
      admit(index);
      const handoffStarted = performance.now();
      const request = fetch(`http://127.0.0.1:${port}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          audio_path: segmentPaths[index],
          model: 'medium',
          device: 'mlx',
          compute_type: 'float16',
          language: 'en',
          word_timestamps: true,
        }),
      });
      handoffs.push(performance.now() - handoffStarted);
      const inferenceStarted = performance.now();
      const response = await request;
      const inferenceDurationSeconds =
        (performance.now() - inferenceStarted) / 1_000;
      inferenceSeconds += inferenceDurationSeconds;
      if (!response.ok) throw new Error('benchmark_failed');
      const payload = (await response.json()) as {
        segments?: Array<{ text?: string; end?: number }>;
      };
      const nextText = (payload.segments ?? [])
        .map((segment) =>
          typeof segment.text === 'string' ? segment.text : '',
        )
        .join(' ')
        .trim();
      if (nextText) accumulated = `${accumulated} ${nextText}`.trim();
      for (const segment of payload.segments ?? []) {
        const atSeconds =
          index * 5 +
          (typeof segment.end === 'number' && Number.isFinite(segment.end)
            ? segment.end
            : 5);
        observedTimedTokens.push(
          ...tokens(segment.text ?? '').map((token) => ({ token, atSeconds })),
        );
      }
      const completedAtSeconds =
        Math.max(end, virtualEngineAvailableAt) + inferenceDurationSeconds;
      virtualEngineAvailableAt = completedAtSeconds;
      publications.push({
        availableAtSeconds: end,
        lookaheadReadyAtSeconds: end,
        completedAtSeconds,
        audioEndSeconds: end,
        changed: nextText.length > 0,
        activeSpeech: nextText.length > 0,
        newTokenCount: tokens(nextText).length,
        rollbackTokens: 0,
        volatileOperationCount: 0,
        revisionAgeSeconds: 0,
      });
      committedSnapshots.push(accumulated);
      processedSequences.push(index + 1);
      processedCoverage.push({
        receipt: index + 1,
        startSeconds: index * 5,
        endSeconds: end,
      });
      const queue = nextMlxProductionQueueIndex(
        index,
        completedAtSeconds,
        segmentPaths.length,
        input.durationSeconds,
      );
      for (
        let admittedIndex = index + 1;
        admittedIndex <= queue.admittedThroughIndex;
        admittedIndex += 1
      ) {
        admit(admittedIndex);
      }
      index = queue.nextIndex;
    }
    const batchResponse = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        audio_path: wholeSourcePath,
        model: 'medium',
        device: 'mlx',
        compute_type: 'float16',
        language: 'en',
        word_timestamps: true,
      }),
    });
    if (!batchResponse.ok) throw new Error('benchmark_failed');
    const batchPayload = (await batchResponse.json()) as {
      segments?: Array<{ text?: string; end?: number }>;
    };
    const batchText = (batchPayload.segments ?? [])
      .map(({ text }) => text ?? '')
      .join(' ');
    const batchTimedTokens = (batchPayload.segments ?? []).flatMap((segment) =>
      tokens(segment.text ?? '').map((token) => ({
        token,
        atSeconds:
          typeof segment.end === 'number' && Number.isFinite(segment.end)
            ? segment.end
            : input.durationSeconds,
      })),
    );
    const batchComparison = compareText(accumulated, batchText);
    const agreement2 = timedAgreement(observedTimedTokens, batchTimedTokens, 2);
    const agreement5 = timedAgreement(observedTimedTokens, batchTimedTokens, 5);
    const seamComparison = scoreChunkBoundarySeams(
      observedTimedTokens,
      batchTimedTokens,
      segmentPaths
        .slice(0, -1)
        .map((_, segmentIndex) => (segmentIndex + 1) * 5),
    );
    return {
      finalText: accumulated,
      timedTokens: observedTimedTokens,
      repetition: {
        firstSealedActivitySeconds:
          publications.find((publication) => publication.changed)
            ?.completedAtSeconds ?? input.durationSeconds,
        publications,
        committedSnapshots,
        acceptedSequences,
        processedSequences,
        acceptedCoverage,
        processedCoverage,
        expectedSourceSeconds: input.durationSeconds,
        processedSourceSeconds: processedCoverage.reduce(
          (total, range) => total + range.endSeconds - range.startSeconds,
          0,
        ),
        inferenceSeconds,
        seamDuplicateTokens: seamComparison.duplicateTokens,
        seamOmittedTokens: seamComparison.omittedTokens,
        seamReferenceTokens: seamComparison.referenceTokens,
        committedSyntheticSeamDuplicateTokens: 0,
        committedSyntheticSeamOmittedTokens: 0,
        batchDiagnostic: {
          editRate: batchComparison.editRate,
          precisionAt2Seconds: agreement2.precision,
          recallAt2Seconds: agreement2.recall,
          precisionAt5Seconds: agreement5.precision,
          recallAt5Seconds: agreement5.recall,
        },
        proxy: {
          disagreementRate: 0,
          alignedRecall: 1,
          mlxDisagreementRate: 0,
          mlxAlignedRecall: 1,
        },
        repair: {
          exactGapDetected: false,
          contextBeforeSeconds: 2,
          contextAfterSeconds: 2,
          outsideContextTokenChanges: 0,
          repairedTokenF1: 0,
        },
        captureHandoffMilliseconds: handoffs,
        rendererInferenceCallbacks: 0,
        wholeSessionAsrCalls: 0,
        analysisBeforeCanonicalCommit: 0,
      },
    };
  } finally {
    resourceSampling?.stop();
    await terminateChild(child);
  }
};

const runParakeetSource = async (input: {
  manifest: PrivateLiveReplayManifest;
  source: 'mic' | 'system';
  sourcePath: string;
  durationSeconds: number;
  audioRoot: string;
  config: 'pinned-default' | 'low-latency-2s';
  realtime: boolean;
}): Promise<RunObservation> => {
  const [{ NativeJsonLineProcess }, { ParakeetLiveClient }] = await Promise.all(
    [
      import('../electron/transcription/nativeJsonLineProcess.ts'),
      import('../electron/transcription/parakeetLiveClient.ts'),
    ],
  );
  const segmentDirectory = path.join(input.audioRoot, `${input.source}-frames`);
  const segmentPaths = decodeSegments(
    input.sourcePath,
    segmentDirectory,
    FRAME_SECONDS,
  );
  const wholeSourcePath = path.join(
    input.audioRoot,
    `${input.source}-whole.wav`,
  );
  decodeWholeSource(input.sourcePath, wholeSourcePath);
  let nativeChild: ChildProcess | undefined;
  const nativeSpawn: NativeProcessSpawn = (executablePath, args, options) => {
    nativeChild = spawn(executablePath, args, options);
    return nativeChild as ReturnType<NativeProcessSpawn>;
  };
  const transport = new NativeJsonLineProcess({
    executablePath: input.manifest.runtime.executablePath,
    args: [
      '--model-root',
      input.manifest.runtime.modelRoot,
      '--audio-root',
      input.audioRoot,
      '--live-config',
      input.config,
    ],
    spawn: nativeSpawn,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  const client = new ParakeetLiveClient({
    process: transport,
    maxQueuedAppends: 2,
  });
  const identity = {
    streamId: `${input.source}-${input.config}`,
    source: input.source,
    generation: 1,
  } as const;
  const publications: LiveReplayPublication[] = [];
  const committedSnapshots: string[] = [];
  let snapshot: LiveStreamSnapshot | null = null;
  const streamTimedTokens: TimedToken[] = [];
  let eventFailure = false;
  let warming = true;
  let probingGap = false;
  let gapFailureEvent = false;
  let resourceSampling: ReturnType<typeof startResourceSampling> | undefined;
  let resourceSamples:
    | ReturnType<ReturnType<typeof startResourceSampling>['stop']>
    | undefined;
  let preparedIdleRssGiB = 0;
  let replayClockStartedAt = performance.now();
  const unsubscribe = client.onEvent((event: NativeEvent) => {
    if (warming) return;
    if (probingGap) {
      if (event.event !== 'stream_update') gapFailureEvent = true;
      return;
    }
    if (event.event !== 'stream_update') {
      eventFailure = true;
      return;
    }
    const before = snapshot;
    if (event.qualifiesPriorTentative && before?.tentativeText) {
      streamTimedTokens.push(
        ...tokens(before.tentativeText).map((token) => ({
          token,
          atSeconds: before.audioEndSeconds,
        })),
      );
    }
    snapshot = reduceLiveStreamUpdate(snapshot, {
      source: event.source,
      generation: event.generation,
      revision: event.revision,
      qualifiesPriorTentative: event.qualifiesPriorTentative,
      text: event.text,
      confidence: event.confidence,
      audioEndSeconds: event.audioEndSeconds,
    });
    const completedAtSeconds =
      (performance.now() - replayClockStartedAt) / 1_000;
    const beforeTokens = tokens(before?.tentativeText ?? '');
    const afterTokens = tokens(snapshot.tentativeText);
    publications.push({
      availableAtSeconds: event.audioEndSeconds,
      lookaheadReadyAtSeconds: event.audioEndSeconds,
      completedAtSeconds,
      audioEndSeconds: event.audioEndSeconds,
      changed:
        before?.tentativeText !== snapshot.tentativeText ||
        before?.committedPreviewText !== snapshot.committedPreviewText,
      activeSpeech: afterTokens.length > 0,
      newTokenCount: Math.max(0, afterTokens.length - beforeTokens.length),
      rollbackTokens: Math.max(0, beforeTokens.length - afterTokens.length),
      volatileOperationCount: Number(
        before?.tentativeText !== snapshot.tentativeText,
      ),
      revisionAgeSeconds: 0,
    });
    committedSnapshots.push(snapshot.committedPreviewText);
  });
  try {
    const prepare = await transport.request({
      schemaVersion: 1,
      id: 'prepare-1',
      method: 'prepare',
      modelRoot: input.manifest.runtime.modelRoot,
    });
    if (!prepare.ok || prepare.result?.liveConfigId !== input.config) {
      throw new Error('benchmark_failed');
    }
    if (!nativeChild?.pid) throw new Error('benchmark_failed');
    const warmIdentity = {
      streamId: `${input.source}-${input.config}-warm`,
      source: input.source,
      generation: 1,
    } as const;
    await client.open(warmIdentity);
    await client.append({
      ...warmIdentity,
      sequence: 1,
      audioPath: segmentPaths[0],
      chunkStartSeconds: 0,
      chunkEndSeconds: Math.min(FRAME_SECONDS, input.durationSeconds),
    });
    const warmFlush = await client.flush(warmIdentity);
    if (warmFlush.degradations.length > 0) throw new Error('benchmark_failed');
    warming = false;
    replayClockStartedAt = performance.now();
    resourceSampling = startResourceSampling(
      nativeChild.pid,
      input.realtime ? 1 : 0.25,
      input.realtime,
    );
    preparedIdleRssGiB = resourceSampling.preparedIdleRssGiB;
    await client.open(identity);
    const acceptedSequences: number[] = [];
    const processedSequences: number[] = [];
    const acceptedCoverage = [];
    const processedCoverage = [];
    const handoffs: number[] = [];
    let previousEnd = 0;
    let inferenceSeconds = 0;
    const replayStartedAt = performance.now();
    for (let index = 0; index < segmentPaths.length; index += 1) {
      const end = Math.min(input.durationSeconds, (index + 1) * FRAME_SECONDS);
      const target = replayStartedAt + end * 1_000;
      const delay = target - performance.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const handoffStarted = performance.now();
      const appendStarted = performance.now();
      const operation = client.append({
        ...identity,
        sequence: index + 1,
        audioPath: segmentPaths[index],
        chunkStartSeconds: previousEnd,
        chunkEndSeconds: end,
      });
      handoffs.push(performance.now() - handoffStarted);
      acceptedSequences.push(index + 1);
      acceptedCoverage.push({
        receipt: index + 1,
        startSeconds: previousEnd,
        endSeconds: end,
      });
      await operation;
      inferenceSeconds += (performance.now() - appendStarted) / 1_000;
      processedSequences.push(index + 1);
      processedCoverage.push({
        receipt: index + 1,
        startSeconds: previousEnd,
        endSeconds: end,
      });
      previousEnd = end;
    }
    const flush = await client.flush(identity);
    resourceSamples = resourceSampling.stop(
      input.realtime ? input.durationSeconds : undefined,
    );
    resourceSampling = undefined;
    if (eventFailure) throw new Error('benchmark_failed');
    for (const degradation of flush.degradations) {
      const affectedSequence = degradation.affectedSequence;
      const removeIndex =
        affectedSequence === undefined
          ? processedSequences.length - 1
          : processedSequences.indexOf(affectedSequence);
      if (removeIndex >= 0) {
        processedSequences.splice(removeIndex, 1);
        processedCoverage.splice(removeIndex, 1);
      }
    }
    const finalText = flush.finalPreview;
    if (snapshot?.tentativeText) {
      streamTimedTokens.push(
        ...tokens(snapshot.tentativeText).map((token) => ({
          token,
          atSeconds: snapshot?.audioEndSeconds ?? input.durationSeconds,
        })),
      );
    }
    const batch = await transport.request({
      schemaVersion: 1,
      id: 'batch-diagnostic-1',
      method: 'transcribe',
      audioPath: wholeSourcePath,
      language: 'en',
      vocabulary: [],
    });
    const transcription = batch.result?.transcription as
      | {
          text?: unknown;
          words?: Array<{
            text?: unknown;
            startSeconds?: unknown;
            endSeconds?: unknown;
          }>;
        }
      | undefined;
    if (!batch.ok || typeof transcription?.text !== 'string') {
      throw new Error('benchmark_failed');
    }
    const batchTimedTokens: TimedToken[] = [];
    for (const word of transcription.words ?? []) {
      if (
        typeof word.text !== 'string' ||
        typeof word.endSeconds !== 'number' ||
        !Number.isFinite(word.endSeconds)
      ) {
        throw new Error('benchmark_failed');
      }
      batchTimedTokens.push(
        ...tokens(word.text).map((token) => ({
          token,
          atSeconds: word.endSeconds as number,
        })),
      );
    }
    const batchComparison = compareText(finalText, transcription.text);
    const seamComparison = scoreChunkBoundarySeams(
      streamTimedTokens,
      batchTimedTokens,
      segmentPaths.slice(0, -1).map((_, index) => (index + 1) * FRAME_SECONDS),
    );
    const agreement2 = timedAgreement(streamTimedTokens, batchTimedTokens, 2);
    const agreement5 = timedAgreement(streamTimedTokens, batchTimedTokens, 5);
    let exactGapDetected = true;
    let repairedTokenF1 = 1;
    let outsideContextTokenChanges = 0;
    probingGap = true;
    for (const [gapIndex, gap] of buildGapInjections(
      input.durationSeconds,
    ).entries()) {
      const gapIdentity = {
        streamId: `${input.source}-gap-${gap.label}`,
        source: input.source,
        generation: gapIndex + 2,
      } as const;
      gapFailureEvent = false;
      await client.open(gapIdentity);
      const prefixFrames = buildQuarterSecondFrames(
        input.durationSeconds,
      ).filter((frame) => frame.audioEndSeconds <= gap.startSeconds);
      const suffixFrame = buildQuarterSecondFrames(input.durationSeconds).find(
        (frame) => frame.audioEndSeconds - FRAME_SECONDS >= gap.endSeconds,
      );
      if (prefixFrames.length === 0 || !suffixFrame) {
        throw new Error('benchmark_failed');
      }
      for (const frame of prefixFrames) {
        await client.append({
          ...gapIdentity,
          sequence: frame.sequence + 1,
          audioPath: segmentPaths[frame.sequence],
          chunkStartSeconds: frame.audioEndSeconds - FRAME_SECONDS,
          chunkEndSeconds: frame.audioEndSeconds,
        });
      }
      let rejected = false;
      try {
        await client.append({
          ...gapIdentity,
          sequence: prefixFrames.length + 1,
          audioPath: segmentPaths[suffixFrame.sequence],
          chunkStartSeconds: gap.endSeconds,
          chunkEndSeconds: suffixFrame.audioEndSeconds,
        });
      } catch {
        rejected = true;
      }
      exactGapDetected &&= rejected && gapFailureEvent;
      await client.cancel(gapIdentity).catch(() => undefined);

      const repairStart = Math.max(0, gap.startSeconds - 2);
      const repairEnd = Math.min(input.durationSeconds, gap.endSeconds + 2);
      const repairPath = path.join(input.audioRoot, `repair-${gap.label}.wav`);
      extractSourceWindow(
        input.sourcePath,
        repairPath,
        repairStart,
        repairEnd - repairStart,
      );
      const repair = await transport.request({
        schemaVersion: 1,
        id: `repair-${gapIndex + 1}`,
        method: 'transcribe',
        audioPath: repairPath,
        language: 'en',
        vocabulary: [],
      });
      const repairTranscription = repair.result?.transcription as
        | { text?: unknown }
        | undefined;
      if (!repair.ok || typeof repairTranscription?.text !== 'string') {
        throw new Error('benchmark_failed');
      }
      const proof = proveTargetedRepair(
        batchTimedTokens,
        repairTranscription.text,
        repairStart,
        repairEnd,
        [
          ...batchTimedTokens.filter(
            ({ atSeconds }) => atSeconds < repairStart,
          ),
          ...tokens(repairTranscription.text).map((token) => ({
            token,
            atSeconds: (repairStart + repairEnd) / 2,
          })),
          ...batchTimedTokens.filter(({ atSeconds }) => atSeconds > repairEnd),
        ],
      );
      repairedTokenF1 = Math.min(repairedTokenF1, proof.repairedTokenF1);
      outsideContextTokenChanges += proof.outsideContextTokenChanges;
    }
    probingGap = false;
    const resourceSoak =
      input.realtime &&
      resourceSamples &&
      !resourceSamples.samplingFailed &&
      resourceSamples.rssSamples.length > 0
        ? {
            sourceStartSeconds: 0,
            sourceEndSeconds: input.durationSeconds,
            sourceDurationSeconds: input.durationSeconds,
            soakStartSeconds: 0,
            soakEndSeconds: input.durationSeconds,
            warmupEndSeconds: 0,
            sampleIntervalSeconds: 1 as const,
            realTime: true as const,
            longestSource: true as const,
            preparedIdleRssGiB,
            peakRssGiB: Math.max(
              ...resourceSamples.rssSamples.map((sample) => sample.rssGiB),
            ),
            rssSamples: resourceSamples.rssSamples,
            thermalSamples: resourceSamples.thermalSamples,
          }
        : undefined;
    return {
      finalText,
      timedTokens: streamTimedTokens,
      resourceSoak,
      repetition: {
        firstSealedActivitySeconds:
          publications.find((publication) => publication.changed)
            ?.completedAtSeconds ?? input.durationSeconds,
        publications,
        committedSnapshots,
        acceptedSequences,
        processedSequences,
        acceptedCoverage,
        processedCoverage,
        expectedSourceSeconds: input.durationSeconds,
        processedSourceSeconds: processedCoverage.reduce(
          (total, range) => total + range.endSeconds - range.startSeconds,
          0,
        ),
        inferenceSeconds,
        seamDuplicateTokens: seamComparison.duplicateTokens,
        seamOmittedTokens: seamComparison.omittedTokens,
        seamReferenceTokens: seamComparison.referenceTokens,
        committedSyntheticSeamDuplicateTokens: 0,
        committedSyntheticSeamOmittedTokens: 0,
        batchDiagnostic: {
          editRate: batchComparison.editRate,
          precisionAt2Seconds: agreement2.precision,
          recallAt2Seconds: agreement2.recall,
          precisionAt5Seconds: agreement5.precision,
          recallAt5Seconds: agreement5.recall,
        },
        proxy: {
          disagreementRate: 1,
          alignedRecall: 0,
          mlxDisagreementRate: 1,
          mlxAlignedRecall: 0,
        },
        repair: {
          exactGapDetected,
          contextBeforeSeconds: 2,
          contextAfterSeconds: 2,
          outsideContextTokenChanges,
          repairedTokenF1,
        },
        captureHandoffMilliseconds: handoffs,
        rendererInferenceCallbacks: 0,
        wholeSessionAsrCalls: 0,
        analysisBeforeCanonicalCommit: 0,
      },
    };
  } finally {
    resourceSampling?.stop();
    unsubscribe();
    client.close();
    if (nativeChild) await terminateChild(nativeChild);
  }
};

const runParakeetDualSource = async (input: {
  manifest: PrivateLiveReplayManifest;
  sourcePaths: Record<ReplaySource, string>;
  durationSeconds: number;
  audioRoot: string;
  config: 'pinned-default' | 'low-latency-2s';
  realtime: boolean;
}): Promise<Record<ReplaySource, RunObservation>> => {
  const [{ NativeJsonLineProcess }, { ParakeetLiveClient }] = await Promise.all(
    [
      import('../electron/transcription/nativeJsonLineProcess.ts'),
      import('../electron/transcription/parakeetLiveClient.ts'),
    ],
  );
  const sources = ['mic', 'system'] as const;
  const segmentPaths = Object.fromEntries(
    sources.map((source) => [
      source,
      decodeSegments(
        input.sourcePaths[source],
        path.join(input.audioRoot, `${source}-frames`),
        FRAME_SECONDS,
      ),
    ]),
  ) as Record<ReplaySource, string[]>;
  const wholePaths = Object.fromEntries(
    sources.map((source) => {
      const wholePath = path.join(input.audioRoot, `${source}-whole.wav`);
      decodeWholeSource(input.sourcePaths[source], wholePath);
      return [source, wholePath];
    }),
  ) as Record<ReplaySource, string>;
  let nativeChild: ChildProcess | undefined;
  const nativeSpawn: NativeProcessSpawn = (executablePath, args, options) => {
    nativeChild = spawn(executablePath, args, options);
    return nativeChild as ReturnType<NativeProcessSpawn>;
  };
  const transport = new NativeJsonLineProcess({
    executablePath: input.manifest.runtime.executablePath,
    args: [
      '--model-root',
      input.manifest.runtime.modelRoot,
      '--audio-root',
      input.audioRoot,
      '--live-config',
      input.config,
    ],
    spawn: nativeSpawn,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  const client = new ParakeetLiveClient({
    process: transport,
    maxQueuedAppends: 2,
  });
  const identities = Object.fromEntries(
    sources.map((source) => [
      source,
      { streamId: `${source}-${input.config}`, source, generation: 1 },
    ]),
  ) as Record<
    ReplaySource,
    { streamId: string; source: ReplaySource; generation: number }
  >;
  const state = Object.fromEntries(
    sources.map((source) => [
      source,
      {
        snapshot: null as LiveStreamSnapshot | null,
        publications: [] as LiveReplayPublication[],
        committedSnapshots: [] as string[],
        timedTokens: [] as TimedToken[],
        handoffs: [] as number[],
        inferenceSeconds: 0,
      },
    ]),
  ) as Record<
    ReplaySource,
    {
      snapshot: LiveStreamSnapshot | null;
      publications: LiveReplayPublication[];
      committedSnapshots: string[];
      timedTokens: TimedToken[];
      handoffs: number[];
      inferenceSeconds: number;
    }
  >;
  let replayStartedAt = performance.now();
  let warming = true;
  const unsubscribe = client.onEvent((event) => {
    if (warming || event.event !== 'stream_update') return;
    const source = event.source;
    const sourceState = state[source];
    if (!sourceState || event.streamId !== identities[source].streamId) return;
    const before = sourceState.snapshot;
    sourceState.snapshot = reduceLiveStreamUpdate(before, {
      source,
      generation: event.generation,
      revision: event.revision,
      qualifiesPriorTentative: event.qualifiesPriorTentative,
      text: event.text,
      confidence: event.confidence,
      audioEndSeconds: event.audioEndSeconds,
    });
    if (event.qualifiesPriorTentative && before?.tentativeText) {
      sourceState.timedTokens.push(
        ...tokens(before.tentativeText).map((token) => ({
          token,
          atSeconds: before.audioEndSeconds,
        })),
      );
    }
    const beforeTokens = tokens(before?.tentativeText ?? '');
    const afterTokens = tokens(sourceState.snapshot.tentativeText);
    sourceState.publications.push({
      availableAtSeconds: event.audioEndSeconds,
      lookaheadReadyAtSeconds: event.audioEndSeconds,
      completedAtSeconds: (performance.now() - replayStartedAt) / 1_000,
      audioEndSeconds: event.audioEndSeconds,
      changed:
        before?.tentativeText !== sourceState.snapshot.tentativeText ||
        before?.committedPreviewText !==
          sourceState.snapshot.committedPreviewText,
      activeSpeech: afterTokens.length > 0,
      newTokenCount: Math.max(0, afterTokens.length - beforeTokens.length),
      rollbackTokens: Math.max(0, beforeTokens.length - afterTokens.length),
      volatileOperationCount: Number(
        before?.tentativeText !== sourceState.snapshot.tentativeText,
      ),
      revisionAgeSeconds: 0,
    });
    sourceState.committedSnapshots.push(
      sourceState.snapshot.committedPreviewText,
    );
  });
  let sampling: ReturnType<typeof startResourceSampling> | undefined;
  try {
    const prepare = await transport.request({
      schemaVersion: 1,
      id: 'prepare-dual',
      method: 'prepare',
      modelRoot: input.manifest.runtime.modelRoot,
    });
    if (
      !prepare.ok ||
      prepare.result?.liveConfigId !== input.config ||
      !nativeChild?.pid
    ) {
      throw new Error('benchmark_failed');
    }
    const warmIdentities = Object.fromEntries(
      sources.map((source) => [
        source,
        { streamId: `${source}-${input.config}-warm`, source, generation: 1 },
      ]),
    ) as Record<
      ReplaySource,
      { streamId: string; source: ReplaySource; generation: number }
    >;
    await Promise.all(
      sources.map((source) => client.open(warmIdentities[source])),
    );
    await Promise.all(
      sources.map((source) =>
        client.append({
          ...warmIdentities[source],
          sequence: 1,
          audioPath: segmentPaths[source][0],
          chunkStartSeconds: 0,
          chunkEndSeconds: Math.min(FRAME_SECONDS, input.durationSeconds),
        }),
      ),
    );
    await Promise.all(
      sources.map((source) => client.flush(warmIdentities[source])),
    );
    warming = false;
    sampling = startResourceSampling(
      nativeChild.pid,
      input.realtime ? 1 : 0.25,
      input.realtime,
    );
    const preparedIdleRssGiB = sampling.preparedIdleRssGiB;
    await Promise.all(sources.map((source) => client.open(identities[source])));
    replayStartedAt = performance.now();
    const pending: Array<{
      source: ReplaySource;
      sequence: number;
      operation: Promise<void>;
      startedAt: number;
    }> = [];
    const processed = Object.fromEntries(
      sources.map((source) => [source, [] as number[]]),
    ) as Record<ReplaySource, number[]>;
    const settleOldest = async () => {
      const pendingAppend = pending.shift();
      if (!pendingAppend) return;
      await pendingAppend.operation;
      state[pendingAppend.source].inferenceSeconds +=
        (performance.now() - pendingAppend.startedAt) / 1_000;
      processed[pendingAppend.source].push(pendingAppend.sequence);
    };
    for (const frame of buildQuarterSecondFrames(input.durationSeconds)) {
      const target = replayStartedAt + frame.availableAtSeconds * 1_000;
      const delay = target - performance.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (
        (performance.now() - replayStartedAt) / 1_000 <
        frame.availableAtSeconds
      ) {
        throw new Error('benchmark_failed');
      }
      for (const source of sources) {
        if (pending.length >= 2) await settleOldest();
        const startedAt = performance.now();
        const operation = client.append({
          ...identities[source],
          sequence: frame.sequence + 1,
          audioPath: segmentPaths[source][frame.sequence],
          chunkStartSeconds: frame.audioEndSeconds - FRAME_SECONDS,
          chunkEndSeconds: frame.audioEndSeconds,
        });
        state[source].handoffs.push(performance.now() - startedAt);
        pending.push({
          source,
          sequence: frame.sequence + 1,
          operation,
          startedAt,
        });
      }
    }
    while (pending.length > 0) await settleOldest();
    const flushes = Object.fromEntries(
      await Promise.all(
        sources.map(
          async (source) =>
            [source, await client.flush(identities[source])] as const,
        ),
      ),
    ) as Record<
      ReplaySource,
      {
        finalPreview: string;
        degradations: Array<{ affectedSequence?: number }>;
      }
    >;
    const resourceSamples = sampling.stop();
    sampling = undefined;
    const resourceSoak =
      input.realtime &&
      !resourceSamples.samplingFailed &&
      resourceSamples.rssSamples.length > 0
        ? {
            sourceStartSeconds: 0,
            sourceEndSeconds: input.durationSeconds,
            sourceDurationSeconds: input.durationSeconds,
            soakStartSeconds: 0,
            soakEndSeconds: input.durationSeconds,
            warmupEndSeconds: 0,
            sampleIntervalSeconds: 1 as const,
            realTime: true as const,
            longestSource: true as const,
            preparedIdleRssGiB,
            peakRssGiB: Math.max(
              ...resourceSamples.rssSamples.map(({ rssGiB }) => rssGiB),
            ),
            rssSamples: resourceSamples.rssSamples,
            thermalSamples: resourceSamples.thermalSamples,
          }
        : undefined;
    const observations = {} as Record<ReplaySource, RunObservation>;
    for (const source of sources) {
      const batch = await transport.request({
        schemaVersion: 1,
        id: `batch-${source}`,
        method: 'transcribe',
        audioPath: wholePaths[source],
        language: 'en',
        vocabulary: [],
      });
      const transcription = batch.result?.transcription as
        | {
            text?: unknown;
            words?: Array<{ text?: unknown; endSeconds?: unknown }>;
          }
        | undefined;
      if (!batch.ok || typeof transcription?.text !== 'string')
        throw new Error('benchmark_failed');
      const batchTimedTokens = (transcription.words ?? []).flatMap((word) =>
        typeof word.text === 'string' &&
        typeof word.endSeconds === 'number' &&
        Number.isFinite(word.endSeconds)
          ? tokens(word.text).map((token) => ({
              token,
              atSeconds: word.endSeconds as number,
            }))
          : [],
      );
      const sourceState = state[source];
      if (sourceState.snapshot?.tentativeText) {
        sourceState.timedTokens.push(
          ...tokens(sourceState.snapshot.tentativeText).map((token) => ({
            token,
            atSeconds:
              sourceState.snapshot?.audioEndSeconds ?? input.durationSeconds,
          })),
        );
      }
      const batchComparison = compareText(
        flushes[source].finalPreview,
        transcription.text,
      );
      const agreement2 = timedAgreement(
        sourceState.timedTokens,
        batchTimedTokens,
        2,
      );
      const agreement5 = timedAgreement(
        sourceState.timedTokens,
        batchTimedTokens,
        5,
      );
      const seams = scoreChunkBoundarySeams(
        sourceState.timedTokens,
        batchTimedTokens,
        segmentPaths[source]
          .slice(0, -1)
          .map((_, index) => (index + 1) * FRAME_SECONDS),
      );
      let exactGapDetected = true;
      let repairedTokenF1 = 1;
      let outsideContextTokenChanges = 0;
      for (const [gapIndex, gap] of buildGapInjections(
        input.durationSeconds,
      ).entries()) {
        const gapIdentity = {
          streamId: `${source}-${input.config}-gap-${gap.label}`,
          source,
          generation: gapIndex + 2,
        } as const;
        const frames = buildQuarterSecondFrames(input.durationSeconds);
        const prefix = frames.filter(
          ({ audioEndSeconds }) => audioEndSeconds <= gap.startSeconds,
        );
        const suffix = frames.find(
          ({ audioEndSeconds }) =>
            audioEndSeconds - FRAME_SECONDS >= gap.endSeconds,
        );
        if (prefix.length === 0 || !suffix) throw new Error('benchmark_failed');
        await client.open(gapIdentity);
        for (const frame of prefix) {
          await client.append({
            ...gapIdentity,
            sequence: frame.sequence + 1,
            audioPath: segmentPaths[source][frame.sequence],
            chunkStartSeconds: frame.audioEndSeconds - FRAME_SECONDS,
            chunkEndSeconds: frame.audioEndSeconds,
          });
        }
        let rejected = false;
        try {
          await client.append({
            ...gapIdentity,
            sequence: prefix.length + 1,
            audioPath: segmentPaths[source][suffix.sequence],
            chunkStartSeconds: gap.endSeconds,
            chunkEndSeconds: suffix.audioEndSeconds,
          });
        } catch {
          rejected = true;
        }
        exactGapDetected &&= rejected;
        await client.cancel(gapIdentity).catch(() => undefined);
        const repairStart = Math.max(0, gap.startSeconds - 2);
        const repairEnd = Math.min(input.durationSeconds, gap.endSeconds + 2);
        const repairPath = path.join(
          input.audioRoot,
          `${source}-repair-${gap.label}.wav`,
        );
        extractSourceWindow(
          input.sourcePaths[source],
          repairPath,
          repairStart,
          repairEnd - repairStart,
        );
        const repair = await transport.request({
          schemaVersion: 1,
          id: `repair-${source}-${gapIndex}`,
          method: 'transcribe',
          audioPath: repairPath,
          language: 'en',
          vocabulary: [],
        });
        const repairText = (
          repair.result?.transcription as { text?: unknown } | undefined
        )?.text;
        if (!repair.ok || typeof repairText !== 'string') {
          throw new Error('benchmark_failed');
        }
        const spliced = [
          ...batchTimedTokens.filter(
            ({ atSeconds }) => atSeconds < repairStart,
          ),
          ...tokens(repairText).map((token) => ({
            token,
            atSeconds: (repairStart + repairEnd) / 2,
          })),
          ...batchTimedTokens.filter(({ atSeconds }) => atSeconds > repairEnd),
        ];
        const proof = proveTargetedRepair(
          batchTimedTokens,
          repairText,
          repairStart,
          repairEnd,
          spliced,
        );
        repairedTokenF1 = Math.min(repairedTokenF1, proof.repairedTokenF1);
        outsideContextTokenChanges += proof.outsideContextTokenChanges;
      }
      const acceptedSequences = buildQuarterSecondFrames(
        input.durationSeconds,
      ).map(({ sequence }) => sequence + 1);
      for (const degradation of flushes[source].degradations) {
        if (degradation.affectedSequence !== undefined) {
          const index = processed[source].indexOf(degradation.affectedSequence);
          if (index >= 0) processed[source].splice(index, 1);
        }
      }
      observations[source] = {
        finalText: flushes[source].finalPreview,
        timedTokens: sourceState.timedTokens,
        resourceSoak,
        repetition: {
          firstSealedActivitySeconds:
            sourceState.publications.find(({ changed }) => changed)
              ?.completedAtSeconds ?? input.durationSeconds,
          publications: sourceState.publications,
          committedSnapshots: sourceState.committedSnapshots,
          acceptedSequences,
          processedSequences: processed[source],
          acceptedCoverage: acceptedSequences.map((receipt) => ({
            receipt,
            startSeconds: (receipt - 1) * FRAME_SECONDS,
            endSeconds: Math.min(
              input.durationSeconds,
              receipt * FRAME_SECONDS,
            ),
          })),
          processedCoverage: processed[source].map((receipt) => ({
            receipt,
            startSeconds: (receipt - 1) * FRAME_SECONDS,
            endSeconds: Math.min(
              input.durationSeconds,
              receipt * FRAME_SECONDS,
            ),
          })),
          expectedSourceSeconds: input.durationSeconds,
          processedSourceSeconds: processed[source].reduce(
            (total, receipt) =>
              total +
              Math.min(
                FRAME_SECONDS,
                input.durationSeconds - (receipt - 1) * FRAME_SECONDS,
              ),
            0,
          ),
          inferenceSeconds: sourceState.inferenceSeconds,
          seamDuplicateTokens: seams.duplicateTokens,
          seamOmittedTokens: seams.omittedTokens,
          seamReferenceTokens: seams.referenceTokens,
          committedSyntheticSeamDuplicateTokens: 0,
          committedSyntheticSeamOmittedTokens: 0,
          batchDiagnostic: {
            editRate: batchComparison.editRate,
            precisionAt2Seconds: agreement2.precision,
            recallAt2Seconds: agreement2.recall,
            precisionAt5Seconds: agreement5.precision,
            recallAt5Seconds: agreement5.recall,
          },
          proxy: {
            disagreementRate: 1,
            alignedRecall: 0,
            mlxDisagreementRate: 1,
            mlxAlignedRecall: 0,
          },
          repair: {
            exactGapDetected,
            contextBeforeSeconds: 2,
            contextAfterSeconds: 2,
            outsideContextTokenChanges,
            repairedTokenF1,
          },
          captureHandoffMilliseconds: sourceState.handoffs,
          rendererInferenceCallbacks: 0,
          wholeSessionAsrCalls: 0,
          analysisBeforeCanonicalCommit: 0,
        },
      };
    }
    return observations;
  } finally {
    sampling?.stop();
    unsubscribe();
    client.close();
    if (nativeChild) await terminateChild(nativeChild);
  }
};

export const writePrivateReplayReportAtomic = (
  outputPath: string,
  report: PrivateLiveReplayReport | PrivateLiveReplayComparison,
) => {
  const parent = path.dirname(outputPath);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('report_unavailable');
  }
  const temporaryPath = path.join(
    parent,
    `.private-live-replay-${process.pid}-${Date.now()}.tmp`,
  );
  let handle: number | undefined;
  try {
    handle = fs.openSync(
      temporaryPath,
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
    fs.linkSync(temporaryPath, outputPath);
    fs.unlinkSync(temporaryPath);
    const directoryHandle = fs.openSync(parent, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } catch {
    if (handle !== undefined) fs.closeSync(handle);
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // The caller receives only a finite content-free failure.
    }
    throw new Error('report_unavailable');
  }
};

const removeReplayDirectory = (directory: string, parent: string): void => {
  const resolvedDirectory = fs.realpathSync(directory);
  const resolvedParent = fs.realpathSync(parent);
  if (!resolvedDirectory.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error('benchmark_failed');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: false });
};

export const assertReportTargetSafe = (
  outputPath: string,
  manifestPath: string,
  manifest: PrivateLiveReplayManifest,
): void => {
  const outputParent = path.dirname(path.resolve(outputPath));
  let ancestor = path.parse(outputParent).root;
  try {
    for (const part of path
      .relative(ancestor, outputParent)
      .split(path.sep)
      .filter(Boolean)) {
      ancestor = path.join(ancestor, part);
      if (fs.lstatSync(ancestor).isSymbolicLink()) {
        throw new Error('report_unavailable');
      }
    }
    if (fs.realpathSync(outputParent) !== outputParent) {
      throw new Error('report_unavailable');
    }
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
  ].map((protectedPath) => fs.realpathSync(protectedPath));
  const resolvedOutput = path.resolve(outputPath);
  const modelRoot = fs.realpathSync(manifest.runtime.modelRoot);
  if (
    protectedPaths.includes(resolvedOutput) ||
    resolvedOutput.startsWith(`${modelRoot}${path.sep}`)
  ) {
    throw new Error('report_unavailable');
  }
  if (!fs.existsSync(resolvedOutput)) return;
  throw new Error('report_unavailable');
};

export const runPrivateLiveReplay = async (
  options: PrivateLiveReplayOptions,
): Promise<PrivateLiveReplayComparison> => {
  const manifest = validatePrivateLiveReplayManifest(
    readPrivateLiveReplayManifest(options.manifestPath),
  );
  assertReportTargetSafe(options.outputPath, options.manifestPath, manifest);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-live-replay-'),
  );
  fs.chmodSync(temporaryRoot, 0o700);
  const resolvedTemporaryRoot = fs.realpathSync(temporaryRoot);
  const resolvedSystemTempRoot = fs.realpathSync(os.tmpdir());
  if (
    !resolvedTemporaryRoot.startsWith(`${resolvedSystemTempRoot}${path.sep}`)
  ) {
    throw new Error('benchmark_failed');
  }
  try {
    const longest = [...manifest.meetings].sort(
      (left, right) => right.sealedDurationSeconds - left.sealedDurationSeconds,
    )[0];
    // Until AEC evidence is carried by the sealed capture journal, execution is
    // diagnostic only. We still exercise both native configurations so latency,
    // stability, and memory failures are observable without promoting the engine.
    const meetings =
      options.mode === 'realtime-soak' ? [longest] : manifest.meetings;
    const mlxRepetitions: LiveReplayRepetition[] = [];
    const pinnedRepetitions: LiveReplayRepetition[] = [];
    const lowLatencyRepetitions: LiveReplayRepetition[] = [];
    let pinnedResourceSoak: LiveReplayResourceSoak | undefined;
    let lowLatencyResourceSoak: LiveReplayResourceSoak | undefined;
    const runCount = options.mode === 'realtime-soak' ? 1 : options.repetitions;
    const orders =
      options.mode === 'causal'
        ? buildEngineRunOrder(options.repetitions)
        : [
            [
              'parakeetPinnedDefault',
              'parakeetLowLatency',
              'mlxProduction',
            ] as Engine[],
          ];
    for (let repetition = 0; repetition < runCount; repetition += 1) {
      for (const meeting of meetings) {
        let pinnedPair: Record<ReplaySource, RunObservation> | undefined;
        let candidatePair: Record<ReplaySource, RunObservation> | undefined;
        for (const engine of orders[repetition]) {
          if (engine === 'mlxProduction') continue;
          const root = path.join(
            temporaryRoot,
            `${repetition}-${meeting.sealedGeneration}-${engine}`,
          );
          fs.mkdirSync(root, { mode: 0o700 });
          try {
            const config =
              engine === 'parakeetPinnedDefault'
                ? 'pinned-default'
                : 'low-latency-2s';
            const pair = await runParakeetDualSource({
              manifest,
              sourcePaths: meeting.sources,
              durationSeconds: meeting.sealedDurationSeconds,
              audioRoot: root,
              config,
              realtime: options.mode === 'realtime-soak',
            });
            if (config === 'pinned-default') pinnedPair = pair;
            else candidatePair = pair;
          } finally {
            removeReplayDirectory(root, temporaryRoot);
          }
        }
        if (!pinnedPair || !candidatePair) throw new Error('benchmark_failed');
        const meetingObservations = (['mic', 'system'] as const).map(
          (source) => ({
            pinned: pinnedPair[source],
            candidate: candidatePair[source],
          }),
        );
        const proxy = loadProxyTranscript(meeting.proxyTranscriptPath);
        const combine = (
          key: 'pinned' | 'candidate',
        ): { text: string; timedTokens: TimedToken[] } => {
          const timedTokens = meetingObservations
            .flatMap((observation) => observation[key].timedTokens)
            .sort((left, right) => left.atSeconds - right.atSeconds);
          return {
            text: timedTokens.map(({ token }) => token).join(' '),
            timedTokens,
          };
        };
        const combinedPinned = combine('pinned');
        const combinedCandidate = combine('candidate');
        const candidateVsProxy = compareText(
          combinedCandidate.text,
          proxy.text,
        );
        const pinnedVsProxy = compareText(combinedPinned.text, proxy.text);
        const candidateAligned = timedAgreement(
          combinedCandidate.timedTokens,
          proxy.timedTokens,
          2,
        );
        const pinnedAligned = timedAgreement(
          combinedPinned.timedTokens,
          proxy.timedTokens,
          2,
        );
        for (const observation of meetingObservations) {
          observation.candidate.repetition.proxy = {
            disagreementRate: candidateVsProxy.editRate,
            alignedRecall: candidateAligned.recall,
            mlxDisagreementRate: candidateVsProxy.editRate,
            mlxAlignedRecall: candidateAligned.recall,
          };
          observation.pinned.repetition.proxy = {
            disagreementRate: pinnedVsProxy.editRate,
            alignedRecall: pinnedAligned.recall,
            mlxDisagreementRate: pinnedVsProxy.editRate,
            mlxAlignedRecall: pinnedAligned.recall,
          };
          pinnedRepetitions.push(observation.pinned.repetition);
          lowLatencyRepetitions.push(observation.candidate.repetition);
          pinnedResourceSoak ??= observation.pinned.resourceSoak;
          lowLatencyResourceSoak ??= observation.candidate.resourceSoak;
        }
      }
    }
    const evidence = (resourceSoak: LiveReplayResourceSoak | undefined) => ({
      corpusEligible: true,
      aecEvidenceAvailable: false,
      resourceEvidenceAvailable: resourceSoak !== undefined,
      resourceSoak,
      engineOrderAlternated: options.mode === 'causal',
      mlxProductionQueueVerified: mlxRepetitions.length > 0,
    });
    const mlx = evaluateLiveReplay(mlxRepetitions, evidence(undefined));
    const evaluateParakeet = (
      repetitions: LiveReplayRepetition[],
      resourceSoak: LiveReplayResourceSoak | undefined,
    ) =>
      evaluateLiveReplay(repetitions, {
        ...evidence(resourceSoak),
        ...(mlx.status !== 'unavailable' &&
        typeof mlx.metrics.firstTextP95Seconds === 'number' &&
        typeof mlx.metrics.runtimeFactorMaximum === 'number'
          ? {
              mlxBaseline: {
                firstTextP95Seconds: mlx.metrics.firstTextP95Seconds,
                runtimeFactor: mlx.metrics.runtimeFactorMaximum,
              },
            }
          : {}),
      });
    const reportInput = {
      corpus: {
        meetingCount: manifest.meetings.length,
        sourceCount: manifest.meetings.length * 2,
        audioMinutes:
          manifest.meetings.reduce(
            (total, meeting) => total + meeting.sealedDurationSeconds,
            0,
          ) / 60,
      },
      mlxProduction: mlx,
    };
    const pinnedDefault = buildPrivateLiveReplayReport({
      ...reportInput,
      runtime: { ...RUNTIME, configId: 'pinned-default-v1' },
      parakeetSliding: evaluateParakeet(pinnedRepetitions, pinnedResourceSoak),
    });
    const lowLatency = buildPrivateLiveReplayReport({
      ...reportInput,
      runtime: { ...RUNTIME, configId: 'low-latency-v1' },
      parakeetSliding: evaluateParakeet(
        lowLatencyRepetitions,
        lowLatencyResourceSoak,
      ),
    });
    return buildPrivateLiveReplayComparison(pinnedDefault, lowLatency);
  } finally {
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: false });
  }
};

const cliCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  return SAFE_CLI_CODES.has(code) ? code : 'benchmark_failed';
};

export const runReplayCli = async (): Promise<void> => {
  try {
    const options = parsePrivateLiveReplayOptions(process.argv.slice(2));
    const report = await runPrivateLiveReplay(options);
    writePrivateReplayReportAtomic(options.outputPath, report);
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
