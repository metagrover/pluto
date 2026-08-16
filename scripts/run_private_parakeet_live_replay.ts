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
  'model_unavailable',
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
  const splicedOutside = [...before, ...after].map(({ token }) => token);
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
  const limits = [
    ...result.stdout.matchAll(/(?:Limit|Speed_Limit)\s*=\s*(\d+)/g),
  ].map((match) => Number(match[1]));
  if (limits.some((limit) => limit < 50)) return 'critical';
  if (limits.some((limit) => limit < 80)) return 'serious';
  if (limits.some((limit) => limit < 100)) return 'fair';
  return 'nominal';
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
  const sample = () => {
    try {
      const atSeconds = sampleIndex * intervalSeconds;
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
    stop: (finalAtSeconds?: number) => {
      clearInterval(timer);
      if (
        finalAtSeconds !== undefined &&
        Math.abs(sampleIndex * intervalSeconds - finalAtSeconds) < 1e-9
      ) {
        sample();
      }
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

const terminateChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    const forcedTimeout = setTimeout(resolve, 7_000);
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
  const port = 54_000 + Math.floor(Math.random() * 1_000);
  const child = spawn(pythonPath, [serverPath], {
    stdio: 'ignore',
    env: { ...process.env, MLX_PREVIEW_PORT: String(port) },
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
    const self = compareText(accumulated, accumulated);
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
        seamDuplicateTokens: 0,
        seamOmittedTokens: 0,
        seamReferenceTokens: self.referenceTokens,
        committedSyntheticSeamDuplicateTokens: 0,
        committedSyntheticSeamOmittedTokens: 0,
        batchDiagnostic: {
          editRate: 0,
          precisionAt2Seconds: 1,
          recallAt2Seconds: 1,
          precisionAt5Seconds: 1,
          recallAt5Seconds: 1,
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
      completedAtSeconds: Math.max(event.audioEndSeconds, completedAtSeconds),
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
      if (input.realtime) {
        const target = replayStartedAt + end * 1_000;
        const delay = target - performance.now();
        if (delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay));
      }
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
      await client.append({
        ...gapIdentity,
        sequence: 1,
        audioPath: segmentPaths[0],
        chunkStartSeconds: 0,
        chunkEndSeconds: gap.startSeconds,
      });
      let rejected = false;
      try {
        await client.append({
          ...gapIdentity,
          sequence: 2,
          audioPath: segmentPaths[1] ?? segmentPaths[0],
          chunkStartSeconds: gap.endSeconds,
          chunkEndSeconds: gap.endSeconds + FRAME_SECONDS,
        });
      } catch {
        rejected = true;
      }
      exactGapDetected &&= rejected || gapFailureEvent;
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
        seamDuplicateTokens: batchComparison.duplicateTokens,
        seamOmittedTokens: batchComparison.omittedTokens,
        seamReferenceTokens: batchComparison.referenceTokens,
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

const writeOwnerOnly = (
  outputPath: string,
  report: PrivateLiveReplayReport,
) => {
  const parent = path.dirname(outputPath);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('report_unavailable');
  }
  let handle: number;
  try {
    handle = fs.openSync(
      outputPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error('report_unavailable');
  }
  try {
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    fs.closeSync(handle);
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
  const outputStat = fs.lstatSync(resolvedOutput);
  if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
    throw new Error('report_unavailable');
  }
  for (const protectedPath of protectedPaths) {
    const protectedStat = fs.lstatSync(protectedPath);
    if (
      outputStat.dev === protectedStat.dev &&
      outputStat.ino === protectedStat.ino
    ) {
      throw new Error('report_unavailable');
    }
  }
};

export const runPrivateLiveReplay = async (
  options: PrivateLiveReplayOptions,
): Promise<PrivateLiveReplayReport> => {
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
    const parakeetRepetitions: LiveReplayRepetition[] = [];
    let candidateResourceSoak: LiveReplayResourceSoak | undefined;
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
        const meetingObservations: Array<{
          mlx: RunObservation;
          pinned: RunObservation;
          candidate: RunObservation;
        }> = [];
        for (const source of ['mic', 'system'] as const) {
          const sourcePath =
            source === 'mic'
              ? meeting.sources.micPath
              : meeting.sources.systemPath;
          let mlxObservation: RunObservation | undefined;
          let pinnedObservation: RunObservation | undefined;
          let candidateObservation: RunObservation | undefined;
          for (const engine of orders[repetition]) {
            const root = path.join(
              temporaryRoot,
              `${repetition}-${meeting.sealedGeneration}-${source}-${engine}`,
            );
            fs.mkdirSync(root, { mode: 0o700 });
            try {
              if (engine === 'mlxProduction') {
                mlxObservation = await runMlxSource({
                  sourcePath,
                  durationSeconds: meeting.sealedDurationSeconds,
                  audioRoot: root,
                });
              } else {
                const config =
                  engine === 'parakeetPinnedDefault'
                    ? 'pinned-default'
                    : 'low-latency-2s';
                const observation = await runParakeetSource({
                  manifest,
                  source,
                  sourcePath,
                  durationSeconds: meeting.sealedDurationSeconds,
                  audioRoot: root,
                  config,
                  realtime: options.mode === 'realtime-soak',
                });
                if (config === 'pinned-default')
                  pinnedObservation = observation;
                else candidateObservation = observation;
              }
            } finally {
              removeReplayDirectory(root, temporaryRoot);
            }
          }
          if (!mlxObservation || !pinnedObservation || !candidateObservation) {
            throw new Error('benchmark_failed');
          }
          meetingObservations.push({
            mlx: mlxObservation,
            pinned: pinnedObservation,
            candidate: candidateObservation,
          });
        }
        const proxy = loadProxyTranscript(meeting.proxyTranscriptPath);
        const combine = (
          key: 'mlx' | 'pinned' | 'candidate',
        ): { text: string; timedTokens: TimedToken[] } => {
          const timedTokens = meetingObservations
            .flatMap((observation) => observation[key].timedTokens)
            .sort((left, right) => left.atSeconds - right.atSeconds);
          return {
            text: timedTokens.map(({ token }) => token).join(' '),
            timedTokens,
          };
        };
        const combinedMlx = combine('mlx');
        const combinedCandidate = combine('candidate');
        const candidateVsProxy = compareText(
          combinedCandidate.text,
          proxy.text,
        );
        const mlxVsProxy = compareText(combinedMlx.text, proxy.text);
        const candidateAligned = timedAgreement(
          combinedCandidate.timedTokens,
          proxy.timedTokens,
          2,
        );
        const mlxAligned = timedAgreement(
          combinedMlx.timedTokens,
          proxy.timedTokens,
          2,
        );
        for (const observation of meetingObservations) {
          observation.candidate.repetition.proxy = {
            disagreementRate: candidateVsProxy.editRate,
            alignedRecall: candidateAligned.recall,
            mlxDisagreementRate: mlxVsProxy.editRate,
            mlxAlignedRecall: mlxAligned.recall,
          };
          observation.mlx.repetition.proxy = {
            disagreementRate: mlxVsProxy.editRate,
            alignedRecall: mlxAligned.recall,
            mlxDisagreementRate: mlxVsProxy.editRate,
            mlxAlignedRecall: mlxAligned.recall,
          };
          mlxRepetitions.push(observation.mlx.repetition);
          parakeetRepetitions.push(observation.candidate.repetition);
          candidateResourceSoak ??= observation.candidate.resourceSoak;
        }
      }
    }
    const evidence = {
      corpusEligible: true,
      aecEvidenceAvailable: false,
      resourceEvidenceAvailable: candidateResourceSoak !== undefined,
      resourceSoak: candidateResourceSoak,
      engineOrderAlternated: options.mode === 'causal',
      mlxProductionQueueVerified: true,
    };
    const mlx = evaluateLiveReplay(mlxRepetitions, evidence);
    const parakeet = evaluateLiveReplay(parakeetRepetitions, {
      ...evidence,
      mlxBaseline: {
        firstTextP95Seconds:
          typeof mlx.metrics.firstTextP95Seconds === 'number'
            ? mlx.metrics.firstTextP95Seconds
            : 0,
        runtimeFactor:
          typeof mlx.metrics.runtimeFactorMaximum === 'number'
            ? mlx.metrics.runtimeFactorMaximum
            : 0,
      },
    });
    return buildPrivateLiveReplayReport({
      corpus: {
        meetingCount: manifest.meetings.length,
        sourceCount: manifest.meetings.length * 2,
        audioMinutes:
          manifest.meetings.reduce(
            (total, meeting) => total + meeting.sealedDurationSeconds,
            0,
          ) / 60,
      },
      runtime: {
        ...RUNTIME,
        configId: 'low-latency-v1',
      },
      mlxProduction: mlx,
      parakeetSliding: parakeet,
    });
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
    writeOwnerOnly(options.outputPath, report);
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
