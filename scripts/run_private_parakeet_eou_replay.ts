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
import { createEouTranscriptProjection } from '../src/services/liveTranscription/eouTranscriptProjection.ts';
import { createLiveConversationProjection } from '../src/services/liveTranscription/liveConversationProjection.ts';
import { createLiveEchoEvidence } from '../src/services/liveTranscription/liveEchoEvidence.ts';
import { reconcileLiveTranscriptReading } from '../src/services/liveTranscription/liveTranscriptReconciliation.ts';
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
  preparationMs: number | null;
  firstPartialAfterReadyMs: number | null;
  firstEouAfterReadyMs: number | null;
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
  presentation: {
    corrections: number;
    restorations: number;
    lateArrivals: number;
    degraded: number;
    rowPeak: number;
    draftPeak: number;
  };
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
  if (metrics.presentation.degraded > 0) failures.push('presentation_degraded');
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
  let failure: { error: unknown } | undefined;
  const throwIfFailed = () => {
    if (failure) throw failure.error;
  };

  try {
    for (const frame of options.frames) {
      throwIfFailed();
      const targetMs = startedAtMs + frame.audioEndSeconds * 1_000;
      const waitMs = targetMs - options.clock.nowMs();
      if (waitMs > 0) await options.clock.sleep(waitMs);
      throwIfFailed();
      const sourceQueue = pending[frame.source];
      while (sourceQueue.length >= 4) await sourceQueue.shift();
      throwIfFailed();
      const appendStartedAt = options.clock.nowMs();
      const operation: Promise<void> = options
        .append(frame)
        .then(
          () => {
            appendLatenciesMs.push(
              Math.max(0, options.clock.nowMs() - appendStartedAt),
            );
          },
          (error) => {
            failure ??= { error };
          },
        )
        .finally(() => {
          const index = sourceQueue.indexOf(operation);
          if (index >= 0) sourceQueue.splice(index, 1);
        });
      sourceQueue.push(operation);
      maximumQueueDepth = Math.max(maximumQueueDepth, sourceQueue.length);
      options.onMaximumQueueDepth?.(maximumQueueDepth);
    }
  } finally {
    await Promise.all([...pending.mic, ...pending.system]);
  }
  throwIfFailed();
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

/** Decode/prepare time is not per-update ASR latency. Unstarted replay is unknown. */
export const replayUpdateLatencyMs = (
  receivedAtMs: number,
  replayStartedAtMs: number | null,
  processedAudioSeconds: number,
): number | null =>
  replayStartedAtMs === null
    ? null
    : Math.max(
        0,
        receivedAtMs - replayStartedAtMs - processedAudioSeconds * 1000,
      );

export const runPrivateParakeetEouReplay = async (
  manifestPath: string,
  options: {
    signal?: AbortSignal;
    /** Private diagnostic observer only; callers must not publish raw content. */
    onTranscript?: (
      segments: ReturnType<
        ReturnType<typeof createEouTranscriptProjection>['apply']
      >,
    ) => void;
  } = {},
): Promise<ReplayMetrics> => {
  options.signal?.throwIfAborted();
  let manifest = readPrivateParakeetEouManifest(manifestPath);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-eou-pcm-'),
  );
  const host = makeRuntimeHost({ paths: runtimePaths(manifest) });
  const stopOwned = () => host.shutdown();
  options.signal?.addEventListener('abort', stopOwned, { once: true });
  const metrics: ReplayMetrics = {
    preparationMs: null,
    firstPartialAfterReadyMs: null,
    firstEouAfterReadyMs: null,
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
    presentation: {
      corrections: 0,
      restorations: 0,
      lateArrivals: 0,
      degraded: 0,
      rowPeak: 0,
      draftPeak: 0,
    },
  };
  const updateLatencies: number[] = [];
  const committedLengths: Record<LiveSource, number> = { mic: 0, system: 0 };
  const rawProjection = createEouTranscriptProjection();
  rawProjection.reset(1);
  const echoEvidence = createLiveEchoEvidence();
  const conversationProjection = createLiveConversationProjection({
    generation: 1,
  });
  let latestSegments: ReturnType<typeof rawProjection.apply> = [];
  const projectConversation = (reason: 'recognition' | 'echo_evidence') => {
    if (!latestSegments.length) return;
    try {
      const snapshot = conversationProjection.apply({
        generation: 1,
        reading: reconcileLiveTranscriptReading({
          segments: latestSegments,
          activityWindows: [],
          echoEvidence: echoEvidence.snapshot(),
        }),
        reason,
      });
      metrics.presentation = {
        corrections: snapshot.metrics.corrections,
        restorations: snapshot.metrics.restorations,
        lateArrivals: snapshot.metrics.lateArrivals,
        degraded: snapshot.metrics.degradedReconciliations,
        rowPeak: Math.max(metrics.presentation.rowPeak, snapshot.rows.length),
        draftPeak: Math.max(
          metrics.presentation.draftPeak,
          snapshot.draft?.wordCount ?? 0,
        ),
      };
    } catch {
      const degraded = conversationProjection.degraded(1);
      metrics.presentation.degraded = degraded.metrics.degradedReconciliations;
    }
  };
  const startedAtMs = realClock.nowMs();
  let replayStartedAtMs: number | null = null;
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
      const latency = replayUpdateLatencyMs(
        receivedAtMs,
        replayStartedAtMs,
        event.processedAudioSeconds,
      );
      if (latency !== null) updateLatencies.push(latency);
      if (
        metrics.firstPartialMs === null &&
        (event.committedText.length > 0 || event.tentativeText.length > 0)
      ) {
        metrics.firstPartialMs = receivedAtMs - startedAtMs;
        metrics.firstPartialAfterReadyMs =
          replayStartedAtMs === null ? null : receivedAtMs - replayStartedAtMs;
      }
      if (
        metrics.firstEouMs === null &&
        event.committedText.length > committedLengths[source]
      ) {
        metrics.firstEouMs = receivedAtMs - startedAtMs;
        metrics.firstEouAfterReadyMs =
          replayStartedAtMs === null ? null : receivedAtMs - replayStartedAtMs;
      }
      committedLengths[source] = event.committedText.length;
      latestSegments = rawProjection.apply(event);
      options.onTranscript?.(structuredClone(latestSegments));
      projectConversation('recognition');
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
    replayStartedAtMs = realClock.nowMs();
    metrics.preparationMs = replayStartedAtMs - startedAtMs;
    const replay = await replayCausalFrames({
      frames,
      clock: {
        nowMs: realClock.nowMs,
        sleep: async (ms) => {
          options.signal?.throwIfAborted();
          await realClock.sleep(ms);
          options.signal?.throwIfAborted();
        },
      },
      append: async (frame) => {
        options.signal?.throwIfAborted();
        const evidenceChanged = echoEvidence.append({
          source: frame.source,
          sampleRate: frame.sampleRate,
          samples: frame.samples,
          startTimeMs: frame.audioStartSeconds * 1_000,
          endTimeMs: frame.audioEndSeconds * 1_000,
        });
        if (evidenceChanged) projectConversation('echo_evidence');
        await client!.append({
          ...identities[frame.source],
          sequence: frame.sequence,
          sampleRate: frame.sampleRate,
          samples: frame.samples,
          audioStartSeconds: frame.audioStartSeconds,
          audioEndSeconds: frame.audioEndSeconds,
        });
      },
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
    options.signal?.removeEventListener('abort', stopOwned);
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
