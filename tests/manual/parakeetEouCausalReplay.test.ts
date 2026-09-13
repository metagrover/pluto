import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCausalReplayFrames,
  measureLiveConversationQuality,
  measureLiveFinalRecognition,
  replayAcceptanceFailures,
  replayCausalFrames,
  replayUpdateLatencyMs,
  runPrivateParakeetEouReplay,
} from '../../scripts/run_private_parakeet_eou_replay.ts';

describe('Parakeet EOU causal replay', () => {
  it('measures update latency from replay readiness rather than model preparation', () => {
    expect(replayUpdateLatencyMs(12340, 11000, 1.28)).toBe(60);
    expect(replayUpdateLatencyMs(12340, null, 1.28)).toBeNull();
  });
  it('settles failed queued appends and reports failure without unhandled rejections', async () => {
    let now = 0;
    const failure = new Error('native_append_failed');
    await expect(
      replayCausalFrames({
        frames: buildCausalReplayFrames({
          mic: { sampleRate: 8000, samples: new Float32Array(8000) },
          system: { sampleRate: 8000, samples: new Float32Array(8000) },
        }),
        clock: {
          nowMs: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
        append: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
  it('rejects a pre-cancelled replay before opening source files or starting a runtime', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled_before_start'));
    await expect(
      runPrivateParakeetEouReplay('/unavailable/private-manifest.json', {
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled_before_start');
  });
  it('reports content-free acceptance failure names', () => {
    expect(
      replayAcceptanceFailures(
        {
          preparationMs: null,
          firstPartialAfterReadyMs: null,
          firstEouAfterReadyMs: null,
          firstPartialMs: null,
          firstEouMs: null,
          p50UpdateLatencyMs: null,
          p95UpdateLatencyMs: null,
          maximumQueueDepth: 5,
          sourceCoverage: { mic: true, system: false },
          tailCoverageSeconds: { mic: 10, system: 0 },
          nativeRssPeakBytes: 0,
          thermalStates: [],
          cancellations: 0,
          failures: 1,
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
            degraded: 1,
            rowPeak: 0,
            draftPeak: 0,
            eventOrderInversions: 1,
            crossSourceDuplicatePeak: 1,
            crossSourceDuplicateUpdates: 2,
            crossSourceDuplicateVisibleMs: 2_000,
            settledCrossSourceDuplicates: 1,
          },
        },
        10,
      ),
    ).toEqual([
      'queue_depth',
      'system_coverage',
      'system_tail',
      'native_failure',
      'presentation_degraded',
      'presentation_event_order',
      'settled_cross_source_duplicate',
    ]);
  });

  it('reports sequence-aware live recall without exposing transcript content', () => {
    expect(
      measureLiveFinalRecognition(
        [
          {
            id: 'mic-1',
            source: 'mic',
            speaker: 'Me',
            text: 'alpha gamma delta',
            timestampMs: 1_000,
            confirmed: true,
          },
          {
            id: 'system-1',
            source: 'system',
            speaker: 'Them',
            text: 'remote reply',
            timestampMs: 1_200,
            confirmed: true,
          },
        ],
        {
          mic: 'alpha beta gamma delta',
          system: 'remote reply',
        },
      ),
    ).toEqual({
      mic: {
        liveUnits: 3,
        finalUnits: 4,
        matchedUnits: 3,
        liveFinalRecall: 0.75,
      },
      system: {
        liveUnits: 2,
        finalUnits: 2,
        matchedUnits: 2,
        liveFinalRecall: 1,
      },
    });
  });

  it('detects a substantial overlapping passage under both live sources', () => {
    expect(
      measureLiveConversationQuality({
        generation: 1,
        status: 'active',
        rows: [
          {
            id: 'remote',
            sourceSegmentId: 'remote',
            source: 'system',
            speaker: 'Them',
            text: 'The transcript was not working today',
            timestampMs: 1_000,
            endTimestampMs: 3_000,
            parts: [],
            display: 'speech',
          },
        ],
        draft: {
          id: 'live-conversation-draft',
          parts: [
            {
              id: 'local-draft',
              sourceSegmentId: 'local-draft',
              source: 'mic',
              text: 'Not working today why not',
              timestampMs: 1_100,
              endTimestampMs: 3_100,
            },
          ],
          collapsedParts: [],
          wordCount: 5,
          truncated: false,
        },
        metrics: {
          corrections: 0,
          restorations: 0,
          lateArrivals: 0,
          degradedReconciliations: 0,
          draftWordCount: 5,
          lastProjectionDurationMs: 0,
          mutableRows: 1,
          retainedParts: 0,
          micWatermarkMs: null,
          systemWatermarkMs: 3_000,
        },
      }),
    ).toEqual({ eventOrderInversions: 0, crossSourceDuplicates: 1 });
  });

  it('uses production 320 ms chunking and interleaves by audio watermark', () => {
    const frames = buildCausalReplayFrames({
      mic: { sampleRate: 16_000, samples: new Float32Array(16_000) },
      system: { sampleRate: 16_000, samples: new Float32Array(12_000) },
    });
    expect(
      frames.map((frame) => [frame.source, frame.audioEndSeconds]),
    ).toEqual([
      ['mic', 0.32],
      ['system', 0.32],
      ['mic', 0.64],
      ['system', 0.64],
      ['system', 0.75],
      ['mic', 0.96],
      ['mic', 1],
    ]);
    expect(
      frames
        .filter((frame) => frame.source === 'mic')
        .map((frame) => frame.sequence),
    ).toEqual([1, 2, 3, 4]);
  });

  it('paces appends against an injectable clock without exceeding four per source', async () => {
    let nowMs = 1_000;
    const appendOrder: Array<[string, number, number]> = [];
    const frames = buildCausalReplayFrames({
      mic: { sampleRate: 8_000, samples: new Float32Array(8_000) },
      system: { sampleRate: 8_000, samples: new Float32Array(8_000) },
    });
    const replay = await replayCausalFrames({
      frames,
      clock: {
        nowMs: () => nowMs,
        sleep: async (ms) => {
          nowMs += ms;
        },
      },
      append: async (frame) => {
        appendOrder.push([frame.source, frame.sequence, nowMs]);
      },
    });
    expect(appendOrder[0]).toEqual(['mic', 1, 1_320]);
    expect(appendOrder[1]).toEqual(['system', 1, 1_320]);
    expect(appendOrder.at(-1)?.[2]).toBe(2_000);
    expect(replay.maximumQueueDepth).toBeLessThanOrEqual(4);
  });

  const enabled =
    process.env.RUN_PARAKEET_EOU_CAUSAL_REPLAY === '1' &&
    process.env.PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST;
  const realReplay = enabled ? it : it.skip;

  realReplay(
    'emits content-free dual-source evidence from the local verified runtime',
    async () => {
      const manifestPath = path.resolve(
        process.env.PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST as string,
      );
      const report = await runPrivateParakeetEouReplay(manifestPath);
      expect(report.maximumQueueDepth).toBeLessThanOrEqual(4);
      expect(report.sourceCoverage).toEqual({ mic: true, system: true });
      expect(report.failures).toBe(0);
      const serialized = JSON.stringify(report);
      expect(serialized).not.toMatch(
        /path|transcript|text|word|token|sample|meeting|sha256/iu,
      );
      console.info(`[Parakeet EOU replay] ${serialized}`);
    },
    2 * 60 * 60_000,
  );
});
