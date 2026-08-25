import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import ffmpegStatic from 'ffmpeg-static';

import { ParakeetEouClient } from '../electron/transcription/parakeetEouClient.ts';
import { ParakeetFinalClient } from '../electron/transcription/parakeetFinalClient.ts';
import { makeRuntimeHost } from '../electron/transcription/parakeetRuntimeHost.ts';
import type { LiveSource } from '../src/services/liveTranscription/contracts.ts';
import {
  type EouRendererFrame,
  createEouPcmChunker,
} from '../src/services/liveTranscription/eouPcmChunker.ts';
import {
  type PrivateParakeetEouManifest,
  readPrivateParakeetEouManifest,
  validatePrivateParakeetEouManifest,
} from './validate_private_parakeet_eou_manifest.ts';

type ReplayClock = {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
};

type ReplayMetrics = {
  firstPartialMs: number | null;
  firstEouMs: number | null;
  p50UpdateLatencyMs: number | null;
  p95UpdateLatencyMs: number | null;
  maximumQueueDepth: number;
  sourceCoverage: { mic: boolean; system: boolean };
  tailCoverageSeconds: { mic: number; system: number };
  nativeRssPeakBytes: number;
  thermalStates: string[];
  cancellations: number;
  failures: number;
};

export const replayAcceptanceFailures = (
  metrics: ReplayMetrics,
  expectedDurationSeconds: number,
): string[] => {
  const failures: string[] = [];
  if (metrics.maximumQueueDepth > 4) failures.push('queue_depth');
  if (!metrics.sourceCoverage.mic) failures.push('mic_coverage');
  if (!metrics.sourceCoverage.system) failures.push('system_coverage');
  if (metrics.tailCoverageSeconds.mic < expectedDurationSeconds - 0.32) {
    failures.push('mic_tail');
  }
  if (metrics.tailCoverageSeconds.system < expectedDurationSeconds - 0.32) {
    failures.push('system_tail');
  }
  if (metrics.failures > 0) failures.push('native_failure');
  return failures;
};

const SOURCES: readonly LiveSource[] = ['mic', 'system'];

export const buildCausalReplayFrames = (
  inputs: Record<LiveSource, { sampleRate: number; samples: Float32Array }>,
): EouRendererFrame[] => {
  const frames: EouRendererFrame[] = [];
  for (const source of SOURCES) {
    const chunker = createEouPcmChunker({
      source,
      sampleRate: inputs[source].sampleRate,
      onFrame: (frame) => frames.push(frame),
    });
    const samples = inputs[source].samples;
    const feedSize = Math.max(1, Math.round(inputs[source].sampleRate * 0.137));
    for (let offset = 0; offset < samples.length; offset += feedSize) {
      chunker.append(
        samples.slice(offset, Math.min(samples.length, offset + feedSize)),
      );
    }
    chunker.flush();
  }
  return frames.sort(
    (left, right) =>
      left.audioEndSeconds - right.audioEndSeconds ||
      SOURCES.indexOf(left.source) - SOURCES.indexOf(right.source),
  );
};

const percentile = (values: number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
};

export const replayCausalFrames = async (options: {
  frames: EouRendererFrame[];
  clock: ReplayClock;
  append(frame: EouRendererFrame): Promise<void>;
  onMaximumQueueDepth?(depth: number): void;
}): Promise<{ appendLatenciesMs: number[]; maximumQueueDepth: number }> => {
  const startedAtMs = options.clock.nowMs();
  const pending: Record<LiveSource, Array<Promise<void>>> = {
    mic: [],
    system: [],
  };
  const appendLatenciesMs: number[] = [];
  let maximumQueueDepth = 0;

  for (const frame of options.frames) {
    const targetMs = startedAtMs + frame.audioEndSeconds * 1_000;
    const waitMs = targetMs - options.clock.nowMs();
    if (waitMs > 0) await options.clock.sleep(waitMs);
    const sourceQueue = pending[frame.source];
    while (sourceQueue.length >= 4) await sourceQueue.shift();
    const appendStartedAt = options.clock.nowMs();
    const operation: Promise<void> = options.append(frame).then(() => {
      appendLatenciesMs.push(
        Math.max(0, options.clock.nowMs() - appendStartedAt),
      );
      const index = sourceQueue.indexOf(operation);
      if (index >= 0) sourceQueue.splice(index, 1);
    });
    sourceQueue.push(operation);
    maximumQueueDepth = Math.max(maximumQueueDepth, sourceQueue.length);
    options.onMaximumQueueDepth?.(maximumQueueDepth);
  }
  await Promise.all([...pending.mic, ...pending.system]);
  return { appendLatenciesMs, maximumQueueDepth };
};

const decodeWav = (audioPath: string, outputPath: string) => {
  if (!ffmpegStatic) throw new Error('decoder_unavailable');
  const decoded = spawnSync(
    ffmpegStatic,
    [
      '-v',
      'error',
      '-i',
      audioPath,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'f32le',
      outputPath,
    ],
    { timeout: 30 * 60_000, stdio: 'ignore' },
  );
  if (decoded.status !== 0) throw new Error('audio_decode_failed');
  const bytes = fs.readFileSync(outputPath);
  if (bytes.length === 0 || bytes.length % 4 !== 0) {
    throw new Error('audio_decode_failed');
  }
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};

const runtimePaths = (manifest: PrivateParakeetEouManifest) => ({
  executablePath:
    process.env.PLUTO_E2E_PARAKEET_RUNTIME ||
    path.join(
      process.cwd(),
      'native/parakeet-runtime/.build/arm64-apple-macosx/debug/parakeet-runtime',
    ),
  modelRoot:
    process.env.PLUTO_E2E_PARAKEET_MODEL_ROOT ||
    path.join(
      os.homedir(),
      'Library/Application Support/pluto/models/transcription/parakeet',
    ),
  audioRoot: manifest.approvedPrivateRoot,
});

const sampleNativeRss = () => {
  const result = spawnSync('/bin/ps', ['-axo', 'rss=,command='], {
    encoding: 'utf8',
    timeout: 2_000,
  });
  if (result.status !== 0) return 0;
  return (
    result.stdout
      .split('\n')
      .filter((line) => line.includes('parakeet-runtime'))
      .reduce(
        (total, line) => total + (Number(line.trim().split(/\s+/u)[0]) || 0),
        0,
      ) * 1024
  );
};

const sampleThermalState = () => {
  const result = spawnSync('/usr/bin/pmset', ['-g', 'therm'], {
    encoding: 'utf8',
    timeout: 2_000,
  });
  if (result.status !== 0) return 'unknown';
  const speed = result.stdout.match(/CPU_Speed_Limit\s*=\s*(\d+)/u);
  return speed && Number(speed[1]) < 100 ? 'throttled' : 'nominal';
};

const realClock: ReplayClock = {
  nowMs: Date.now,
  sleep: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
};

export const runPrivateParakeetEouReplay = async (
  manifestPath: string,
): Promise<ReplayMetrics> => {
  let manifest = readPrivateParakeetEouManifest(manifestPath);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-eou-pcm-'),
  );
  const host = makeRuntimeHost({ paths: runtimePaths(manifest) });
  const metrics: ReplayMetrics = {
    firstPartialMs: null,
    firstEouMs: null,
    p50UpdateLatencyMs: null,
    p95UpdateLatencyMs: null,
    maximumQueueDepth: 0,
    sourceCoverage: { mic: false, system: false },
    tailCoverageSeconds: { mic: 0, system: 0 },
    nativeRssPeakBytes: 0,
    thermalStates: [],
    cancellations: 0,
    failures: 0,
  };
  const updateLatencies: number[] = [];
  const committedLengths: Record<LiveSource, number> = { mic: 0, system: 0 };
  const startedAtMs = realClock.nowMs();
  let client: ParakeetEouClient | null = null;
  const finalClient = new ParakeetFinalClient({
    paths: runtimePaths(manifest),
    runtimeHost: host,
  });
  try {
    const inputs = Object.fromEntries(
      SOURCES.map((source) => [
        source,
        {
          sampleRate: 16_000,
          samples: decodeWav(
            manifest.sources[source].path,
            path.join(temporaryRoot, `${source}.f32le`),
          ),
        },
      ]),
    ) as Record<LiveSource, { sampleRate: number; samples: Float32Array }>;
    manifest = validatePrivateParakeetEouManifest(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    );
    await finalClient.prepare();
    const lease = await host.startRecordingLive();
    client = new ParakeetEouClient({
      runtimeHost: host,
      runtimeLease: lease,
      maxOutstandingPerSource: 4,
    });
    client.onTerminalFailure((code) => {
      if (code === 'parakeet_cancelled') metrics.cancellations += 1;
      else metrics.failures += 1;
    });
    client.onUpdate((event) => {
      const source = event.source;
      const receivedAtMs = realClock.nowMs();
      metrics.sourceCoverage[source] = true;
      metrics.tailCoverageSeconds[source] = Math.max(
        metrics.tailCoverageSeconds[source],
        event.processedAudioSeconds,
      );
      const latency = Math.max(
        0,
        receivedAtMs - startedAtMs - event.processedAudioSeconds * 1_000,
      );
      updateLatencies.push(latency);
      if (
        metrics.firstPartialMs === null &&
        (event.committedText.length > 0 || event.tentativeText.length > 0)
      ) {
        metrics.firstPartialMs = receivedAtMs - startedAtMs;
      }
      if (
        metrics.firstEouMs === null &&
        event.committedText.length > committedLengths[source]
      ) {
        metrics.firstEouMs = receivedAtMs - startedAtMs;
      }
      committedLengths[source] = event.committedText.length;
      metrics.nativeRssPeakBytes = Math.max(
        metrics.nativeRssPeakBytes,
        sampleNativeRss(),
      );
    });
    const identities = {
      mic: {
        streamId: 'private-eou-mic',
        source: 'mic' as const,
        generation: 1,
      },
      system: {
        streamId: 'private-eou-system',
        source: 'system' as const,
        generation: 1,
      },
    };
    await Promise.all(
      SOURCES.map((source) => client!.open(identities[source])),
    );
    const frames = buildCausalReplayFrames(inputs);
    const replay = await replayCausalFrames({
      frames,
      clock: realClock,
      append: async (frame) =>
        await client!.append({
          ...identities[frame.source],
          sequence: frame.sequence,
          sampleRate: frame.sampleRate,
          samples: frame.samples,
          audioStartSeconds: frame.audioStartSeconds,
          audioEndSeconds: frame.audioEndSeconds,
        }),
    });
    metrics.maximumQueueDepth = replay.maximumQueueDepth;
    metrics.thermalStates.push(sampleThermalState());
    await Promise.all(
      SOURCES.map((source) => client!.finish(identities[source])),
    );
    metrics.p50UpdateLatencyMs = percentile(updateLatencies, 0.5);
    metrics.p95UpdateLatencyMs = percentile(updateLatencies, 0.95);
    const acceptanceFailures = replayAcceptanceFailures(
      metrics,
      manifest.expectedDurationSeconds,
    );
    if (acceptanceFailures.length > 0) {
      throw new Error(
        `replay_acceptance_failed:${acceptanceFailures.join(',')}`,
      );
    }
    return metrics;
  } finally {
    await client?.close().catch(() => undefined);
    finalClient.close();
    host.shutdown();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isCli) {
  const manifestIndex = process.argv.indexOf('--manifest');
  const manifestPath = process.argv[manifestIndex + 1];
  if (manifestIndex < 0 || !manifestPath || !path.isAbsolute(manifestPath)) {
    process.stdout.write(
      `${JSON.stringify({ passed: false, error: 'manifest_unavailable' })}\n`,
    );
    process.exitCode = 1;
  } else {
    runPrivateParakeetEouReplay(manifestPath).then(
      (metrics) =>
        process.stdout.write(
          `${JSON.stringify({ passed: true, ...metrics })}\n`,
        ),
      () => {
        process.stdout.write(
          `${JSON.stringify({ passed: false, error: 'replay_failed' })}\n`,
        );
        process.exitCode = 1;
      },
    );
  }
}
