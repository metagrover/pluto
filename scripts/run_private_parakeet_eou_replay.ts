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
import type { LiveTranscriptSegment } from '../src/components/features/recordingWorkspaceModel.ts';
import type { LiveSource } from '../src/services/liveTranscription/contracts.ts';
import {
  type EouRendererFrame,
  createEouPcmChunker,
} from '../src/services/liveTranscription/eouPcmChunker.ts';
import {
  type EouRendererTransport,
  createEouRendererSession,
} from '../src/services/liveTranscription/eouRendererSession.ts';
import {
  type LiveConversationSnapshot,
  buildLiveConversationTimeline,
  createLiveConversationProjection,
} from '../src/services/liveTranscription/liveConversationProjection.ts';
import type { LiveEchoEvidenceDiagnostics } from '../src/services/liveTranscription/liveEchoEvidence.ts';
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

export type ReplayMetrics = {
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
  echoEvidence: LiveEchoEvidenceDiagnostics;
  recognition: Record<
    LiveSource,
    {
      liveUnits: number;
      finalUnits: number;
      matchedUnits: number;
      liveFinalRecall: number | null;
    }
  >;
  presentation: {
    corrections: number;
    restorations: number;
    lateArrivals: number;
    degraded: number;
    rowPeak: number;
    draftPeak: number;
    eventOrderInversions: number;
    crossSourceDuplicatePeak: number;
    crossSourceDuplicateUpdates: number;
    crossSourceDuplicateVisibleMs: number;
    settledCrossSourceDuplicates: number;
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
  if (metrics.presentation.eventOrderInversions > 0) {
    failures.push('presentation_event_order');
  }
  if (metrics.presentation.settledCrossSourceDuplicates > 0) {
    failures.push('settled_cross_source_duplicate');
  }
  return failures;
};

const SOURCES: readonly LiveSource[] = ['mic', 'system'];

type VisibleSpan = {
  id: string;
  source: LiveSource;
  text: string;
  timestampMs: number;
  endTimestampMs: number;
};

const normalizedWords = (text: string): string[] =>
  text.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}']+/gu) ?? [];

const longestCommonSubsequenceLength = (
  left: string[],
  right: string[],
): number => {
  const lengths = new Array<number>(right.length + 1).fill(0);
  for (const leftWord of left) {
    let diagonal = 0;
    for (let index = 0; index < right.length; index += 1) {
      const previous = lengths[index + 1];
      lengths[index + 1] =
        leftWord === right[index]
          ? diagonal + 1
          : Math.max(lengths[index + 1], lengths[index]);
      diagonal = previous;
    }
  }
  return lengths.at(-1) ?? 0;
};

export const measureLiveFinalRecognition = (
  liveSegments: LiveTranscriptSegment[],
  finalText: Record<LiveSource, string>,
): ReplayMetrics['recognition'] =>
  Object.fromEntries(
    SOURCES.map((source) => {
      const liveWords = normalizedWords(
        liveSegments
          .filter((segment) => segment.source === source)
          .sort((left, right) => left.timestampMs - right.timestampMs)
          .map((segment) => segment.text)
          .join(' '),
      );
      const finalWords = normalizedWords(finalText[source]);
      const matchedUnits = longestCommonSubsequenceLength(
        liveWords,
        finalWords,
      );
      return [
        source,
        {
          liveUnits: liveWords.length,
          finalUnits: finalWords.length,
          matchedUnits,
          liveFinalRecall: finalWords.length
            ? matchedUnits / finalWords.length
            : null,
        },
      ];
    }),
  ) as ReplayMetrics['recognition'];

const longestCommonRun = (left: string[], right: string[]): number => {
  const lengths = new Array<number>(right.length + 1).fill(0);
  let longest = 0;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[rightIndex + 1] =
        left[leftIndex] === right[rightIndex] ? lengths[rightIndex] + 1 : 0;
      longest = Math.max(longest, lengths[rightIndex + 1]);
    }
  }
  return longest;
};

const visibleSpans = (snapshot: LiveConversationSnapshot): VisibleSpan[] => [
  ...snapshot.rows.flatMap((row) =>
    row.display === 'speech'
      ? [
          {
            id: row.id,
            source: row.source,
            text: row.text,
            timestampMs: row.timestampMs,
            endTimestampMs: row.endTimestampMs,
          },
        ]
      : [],
  ),
  ...(snapshot.draft?.parts ?? []),
];

export const measureLiveConversationQuality = (
  snapshot: LiveConversationSnapshot,
): { eventOrderInversions: number; crossSourceDuplicates: number } => {
  const timeline = buildLiveConversationTimeline(
    snapshot.rows,
    snapshot.draft?.parts ?? [],
  );
  let eventOrderInversions = 0;
  for (let index = 1; index < timeline.length; index += 1) {
    if (timeline[index].timestampMs < timeline[index - 1].timestampMs) {
      eventOrderInversions += 1;
    }
  }

  const spans = visibleSpans(snapshot);
  let crossSourceDuplicates = 0;
  for (let leftIndex = 0; leftIndex < spans.length; leftIndex += 1) {
    const left = spans[leftIndex];
    const leftWords = normalizedWords(left.text);
    if (leftWords.length < 3) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < spans.length;
      rightIndex += 1
    ) {
      const right = spans[rightIndex];
      if (
        left.source === right.source ||
        Math.max(left.timestampMs, right.timestampMs) >
          Math.min(left.endTimestampMs, right.endTimestampMs) + 1_250
      ) {
        continue;
      }
      const rightWords = normalizedWords(right.text);
      if (rightWords.length < 3) continue;
      const common = longestCommonRun(leftWords, rightWords);
      if (
        common >= 6 ||
        (common >= 3 &&
          common / Math.min(leftWords.length, rightWords.length) >= 0.6)
      ) {
        crossSourceDuplicates += 1;
      }
    }
  }
  return { eventOrderInversions, crossSourceDuplicates };
};

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
    onTranscript?: (segments: LiveTranscriptSegment[]) => void;
  } = {},
): Promise<ReplayMetrics> => {
  options.signal?.throwIfAborted();
  let manifest = readPrivateParakeetEouManifest(manifestPath);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pluto-eou-pcm-'),
  );
  const host = makeRuntimeHost({
    paths: runtimePaths(manifest),
  });
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
    echoEvidence: {
      analyzedWindows: 0,
      completeMicWindows: 0,
      lagComparisons: 0,
      insufficientActivityComparisons: 0,
      independentMicComparisons: 0,
      degenerateComparisons: 0,
      lowSimilarityComparisons: 0,
      similarityQualifiedComparisons: 0,
      candidateWindows: 0,
      compatibleCandidatePairs: 0,
      retainedWindows: 0,
    },
    recognition: {
      mic: {
        liveUnits: 0,
        finalUnits: 0,
        matchedUnits: 0,
        liveFinalRecall: null,
      },
      system: {
        liveUnits: 0,
        finalUnits: 0,
        matchedUnits: 0,
        liveFinalRecall: null,
      },
    },
    presentation: {
      corrections: 0,
      restorations: 0,
      lateArrivals: 0,
      degraded: 0,
      rowPeak: 0,
      draftPeak: 0,
      eventOrderInversions: 0,
      crossSourceDuplicatePeak: 0,
      crossSourceDuplicateUpdates: 0,
      crossSourceDuplicateVisibleMs: 0,
      settledCrossSourceDuplicates: 0,
    },
  };
  const updateLatencies: number[] = [];
  const committedLengths: Record<LiveSource, number> = { mic: 0, system: 0 };
  const conversationProjection = createLiveConversationProjection({
    generation: 1,
  });
  let latestSnapshot = conversationProjection.snapshot();
  let latestSegments: LiveTranscriptSegment[] = [];
  let lastQualityAtMs: number | null = null;
  let lastCrossSourceDuplicates = 0;
  const projectConversation = (
    segments: LiveTranscriptSegment[],
    echoEvidence: Parameters<
      typeof reconcileLiveTranscriptReading
    >[0]['echoEvidence'],
    reason: 'recognition' | 'echo_evidence',
  ) => {
    if (!segments.length) return;
    try {
      const snapshot = conversationProjection.apply({
        generation: 1,
        reading: reconcileLiveTranscriptReading({
          segments,
          activityWindows: [],
          echoEvidence,
        }),
        reason,
      });
      latestSnapshot = snapshot;
      const quality = measureLiveConversationQuality(snapshot);
      const observedAtMs = realClock.nowMs();
      const duplicateVisibleMs =
        metrics.presentation.crossSourceDuplicateVisibleMs +
        (lastQualityAtMs !== null && lastCrossSourceDuplicates > 0
          ? Math.max(0, observedAtMs - lastQualityAtMs)
          : 0);
      lastQualityAtMs = observedAtMs;
      lastCrossSourceDuplicates = quality.crossSourceDuplicates;
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
        eventOrderInversions: Math.max(
          metrics.presentation.eventOrderInversions,
          quality.eventOrderInversions,
        ),
        crossSourceDuplicatePeak: Math.max(
          metrics.presentation.crossSourceDuplicatePeak,
          quality.crossSourceDuplicates,
        ),
        crossSourceDuplicateUpdates:
          metrics.presentation.crossSourceDuplicateUpdates +
          (quality.crossSourceDuplicates > 0 ? 1 : 0),
        crossSourceDuplicateVisibleMs: duplicateVisibleMs,
        settledCrossSourceDuplicates:
          metrics.presentation.settledCrossSourceDuplicates,
      };
    } catch {
      const degraded = conversationProjection.degraded(1);
      metrics.presentation.degraded = degraded.metrics.degradedReconciliations;
    }
  };
  const startedAtMs = realClock.nowMs();
  let replayStartedAtMs: number | null = null;
  let client: ParakeetEouClient | null = null;
  let rendererSession: ReturnType<typeof createEouRendererSession> | null =
    null;
  const finalClient = new ParakeetFinalClient({
    paths: runtimePaths(manifest),
    runtimeHost: host,
  });
  let finalText: Record<LiveSource, string> = { mic: '', system: '' };
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
    const meetingId = 'private-replay';
    const identities = {
      mic: {
        streamId: `eou-${meetingId}-mic`,
        source: 'mic' as const,
        generation: 1,
      },
      system: {
        streamId: `eou-${meetingId}-system`,
        source: 'system' as const,
        generation: 1,
      },
    };
    const updateListeners = new Set<(payload: unknown) => void>();
    const unavailableListeners = new Set<(payload: unknown) => void>();
    const terminalCodes = new Set<string>();
    let transportOutstanding = 0;
    client.onTerminalFailure((code) => {
      if (!terminalCodes.has(code)) {
        terminalCodes.add(code);
        if (code === 'parakeet_cancelled') metrics.cancellations += 1;
        else metrics.failures += 1;
      }
      for (const listener of unavailableListeners) {
        listener({ meetingId, generation: 1, code });
      }
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
      for (const listener of updateListeners) {
        listener({ meetingId, generation: 1, event });
      }
      metrics.nativeRssPeakBytes = Math.max(
        metrics.nativeRssPeakBytes,
        sampleNativeRss(),
      );
    });
    const transport: EouRendererTransport = {
      async invoke(channel, rawPayload) {
        if (channel === 'PARAKEET_EOU_START') {
          await Promise.all(
            SOURCES.map((source) => client!.open(identities[source])),
          );
          return {};
        }
        if (channel === 'PARAKEET_EOU_FINISH') {
          await Promise.all(
            SOURCES.map((source) => client!.finish(identities[source])),
          );
          return {};
        }
        if (channel === 'PARAKEET_EOU_CANCEL') {
          await Promise.allSettled(
            SOURCES.map((source) => client!.cancel(identities[source])),
          );
          return {};
        }
        if (channel !== 'PARAKEET_EOU_APPEND') {
          throw new Error('replay_transport_invalid');
        }
        const payload = rawPayload as EouRendererFrame;
        transportOutstanding += 1;
        metrics.maximumQueueDepth = Math.max(
          metrics.maximumQueueDepth,
          transportOutstanding,
        );
        try {
          await client!.append({
            ...identities[payload.source],
            sequence: payload.sequence,
            sampleRate: payload.sampleRate,
            samples: payload.samples,
            audioStartSeconds: payload.audioStartSeconds,
            audioEndSeconds: payload.audioEndSeconds,
          });
        } finally {
          transportOutstanding -= 1;
        }
        return {};
      },
      onUpdate(listener) {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
      },
      onUnavailable(listener) {
        unavailableListeners.add(listener);
        return () => unavailableListeners.delete(listener);
      },
    };
    rendererSession = createEouRendererSession({
      meetingId,
      generation: 1,
      sampleRates: { mic: 16_000, system: 16_000 },
      transport,
      nowSeconds: () =>
        replayStartedAtMs === null
          ? 0
          : Math.max(0, (realClock.nowMs() - replayStartedAtMs) / 1_000),
      onSegments: (segments, echoEvidence, reason) => {
        latestSegments = segments;
        if (reason === 'recognition') {
          options.onTranscript?.(structuredClone(segments));
        }
        projectConversation(segments, echoEvidence, reason);
      },
      onUnavailable: (code) => {
        if (terminalCodes.has(code)) return;
        terminalCodes.add(code);
        if (code === 'parakeet_cancelled') metrics.cancellations += 1;
        else metrics.failures += 1;
      },
    });
    await rendererSession.start();
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
        rendererSession!.append(frame.source, frame.samples, {
          captureStartSeconds: frame.audioStartSeconds,
        });
      },
    });
    metrics.maximumQueueDepth = Math.max(
      metrics.maximumQueueDepth,
      replay.maximumQueueDepth,
    );
    metrics.thermalStates.push(sampleThermalState());
    await rendererSession.finish();
    metrics.echoEvidence = rendererSession.diagnostics().echoEvidence;
    if (lastQualityAtMs !== null && lastCrossSourceDuplicates > 0) {
      metrics.presentation.crossSourceDuplicateVisibleMs += Math.max(
        0,
        realClock.nowMs() - lastQualityAtMs,
      );
    }
    metrics.presentation.settledCrossSourceDuplicates =
      measureLiveConversationQuality(latestSnapshot).crossSourceDuplicates;
    await client.close();
    client = null;
    finalText = Object.fromEntries(
      await Promise.all(
        SOURCES.map(async (source) => {
          const result = await finalClient.transcribe({
            meetingId: 'private-replay-reference',
            role: 'final_validation',
            source,
            audioPath: manifest.sources[source].path,
            language: 'en',
            signal: options.signal,
          });
          return [
            source,
            result.segments.map((segment) => segment.text).join(' '),
          ];
        }),
      ),
    ) as Record<LiveSource, string>;
    metrics.recognition = measureLiveFinalRecognition(
      latestSegments,
      finalText,
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
