import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type InjectedParakeetProcess,
  type ReplaySource,
  buildPrivateLiveReplayComparison,
  orchestrateInjectedPrivateReplay,
  writePrivateReplayReportAtomic,
} from '../../scripts/run_private_parakeet_live_replay.ts';
import type { PrivateLiveReplayReport } from '../../src/services/liveTranscriptionReplayMetrics.ts';
import {
  buildPrivateLiveReplayReport,
  evaluateLiveReplay,
} from '../../src/services/liveTranscriptionReplayMetrics.ts';

const report = (configId: string): PrivateLiveReplayReport => {
  const repetition = {
    firstSealedActivitySeconds: 1,
    publications: [
      {
        availableAtSeconds: 2,
        lookaheadReadyAtSeconds: 2,
        completedAtSeconds: 3,
        audioEndSeconds: 2,
        changed: true,
        activeSpeech: true,
        newTokenCount: 2,
        rollbackTokens: 0,
        volatileOperationCount: 0,
        revisionAgeSeconds: 0,
      },
    ],
    committedSnapshots: ['stable'],
    acceptedSequences: [1],
    processedSequences: [1],
    acceptedCoverage: [{ receipt: 1, startSeconds: 0, endSeconds: 2 }],
    processedCoverage: [{ receipt: 1, startSeconds: 0, endSeconds: 2 }],
    expectedSourceSeconds: 2,
    processedSourceSeconds: 2,
    inferenceSeconds: 0.5,
    seamDuplicateTokens: 0,
    seamOmittedTokens: 0,
    seamReferenceTokens: 1,
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
      exactGapDetected: true,
      contextBeforeSeconds: 2,
      contextAfterSeconds: 2,
      outsideContextTokenChanges: 0,
      repairedTokenF1: 1,
    },
    captureHandoffMilliseconds: [1],
    rendererInferenceCallbacks: 0,
    wholeSessionAsrCalls: 0,
    analysisBeforeCanonicalCommit: 0,
  };
  const resourceSoak = {
    sourceStartSeconds: 0,
    sourceEndSeconds: 2,
    sourceDurationSeconds: 2,
    soakStartSeconds: 0,
    soakEndSeconds: 2,
    warmupEndSeconds: 0,
    sampleIntervalSeconds: 1 as const,
    realTime: true as const,
    longestSource: true as const,
    preparedIdleRssGiB: 1,
    peakRssGiB: 1,
    rssSamples: [
      { atSeconds: 0, rssGiB: 1 },
      { atSeconds: 1, rssGiB: 1 },
      { atSeconds: 2, rssGiB: 1 },
    ],
    thermalSamples: [
      { atSeconds: 0, state: 'nominal' as const },
      { atSeconds: 1, state: 'nominal' as const },
      { atSeconds: 2, state: 'nominal' as const },
    ],
  };
  const verdict = evaluateLiveReplay([repetition, repetition, repetition], {
    corpusEligible: true,
    aecEvidenceAvailable: true,
    resourceEvidenceAvailable: true,
    engineOrderAlternated: true,
    mlxProductionQueueVerified: true,
    resourceSoak,
    mlxBaseline: { firstTextP95Seconds: 1, runtimeFactor: 0.25 },
  });
  return buildPrivateLiveReplayReport({
    corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
    runtime: {
      fluidAudioVersion: '0.15.5',
      fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
      modelId: 'parakeet-tdt-0.6b-v3',
      configId,
    },
    mlxProduction: verdict,
    parakeetSliding: verdict,
  });
};

describe('private live replay injected orchestration', () => {
  it('uses one dual-source child per config/run, causal interleaving, bounded backpressure, diagnostics, and cleanup', async () => {
    let virtualNow = 0;
    const children: Array<{
      config: string;
      opens: ReplaySource[];
      appends: Array<{
        source: ReplaySource;
        availableAtSeconds: number;
        observedAtSeconds: number;
      }>;
      maximumPending: number;
      batches: ReplaySource[];
      gaps: Array<{
        source: ReplaySource;
        skippedStartSeconds: number;
        skippedEndSeconds: number;
        prefixCount: number;
        suffixCount: number;
      }>;
      terminated: boolean;
    }> = [];
    const createParakeet = async (
      config: string,
    ): Promise<InjectedParakeetProcess> => {
      const state = {
        config,
        opens: [] as ReplaySource[],
        appends: [] as Array<{
          source: ReplaySource;
          availableAtSeconds: number;
          observedAtSeconds: number;
        }>,
        maximumPending: 0,
        batches: [] as ReplaySource[],
        gaps: [] as Array<{
          source: ReplaySource;
          skippedStartSeconds: number;
          skippedEndSeconds: number;
          prefixCount: number;
          suffixCount: number;
        }>,
        terminated: false,
      };
      children.push(state);
      let pending = 0;
      return {
        open: async (source) => {
          state.opens.push(source);
        },
        append: async (source, frame) => {
          pending += 1;
          state.maximumPending = Math.max(state.maximumPending, pending);
          state.appends.push({
            source,
            availableAtSeconds: frame.availableAtSeconds,
            observedAtSeconds: virtualNow,
          });
          await Promise.resolve();
          pending -= 1;
        },
        flush: async () => ({ finalPreview: '', degradations: [] }),
        runBatchDiagnostic: async (source) => {
          state.batches.push(source);
          return { status: 'available', boundaries: [5, 10] };
        },
        probeGap: async (source, gap, prefix, suffix) => {
          state.gaps.push({
            source,
            skippedStartSeconds: gap.startSeconds,
            skippedEndSeconds: gap.endSeconds,
            prefixCount: prefix.length,
            suffixCount: suffix.length,
          });
          return {
            status: 'detected',
            startSeconds: gap.startSeconds,
            endSeconds: gap.endSeconds,
          };
        },
        repairGap: async (_source, gap) => ({
          status: 'available',
          before: [
            { token: 'before', atSeconds: Math.max(0, gap.startSeconds - 3) },
          ],
          repair: [{ token: 'fixed', atSeconds: gap.startSeconds + 1 }],
          after: [{ token: 'after', atSeconds: gap.endSeconds + 3 }],
          spliced: [
            { token: 'before', atSeconds: Math.max(0, gap.startSeconds - 3) },
            { token: 'fixed', atSeconds: gap.startSeconds + 1 },
            { token: 'after', atSeconds: gap.endSeconds + 3 },
          ],
        }),
        resourceEvidence: () => ({
          status: 'available',
          processTopology: 'combined-dual-source',
          samples: [{ wallTimeMs: 100, rssGiB: 1 }],
          thermal: { status: 'unavailable' },
        }),
        terminate: async () => {
          state.terminated = true;
          return 'exited';
        },
      };
    };

    const result = await orchestrateInjectedPrivateReplay({
      meetings: [
        {
          id: 'm1',
          durationSeconds: 30,
          micPath: '/mic',
          systemPath: '/system',
        },
      ],
      repetitions: 1,
      maximumPendingAppends: 2,
      clock: {
        nowSeconds: () => virtualNow,
        waitUntil: async (seconds) => {
          virtualNow = seconds;
        },
      },
      createParakeet,
      createMlx: async ({ offline }) => ({
        status: 'unavailable',
        reason: offline ? 'cache_missing' : 'runtime_unavailable',
      }),
    });

    expect(children).toHaveLength(2);
    expect(children.map((child) => child.config)).toEqual([
      'pinned-default',
      'low-latency-2s',
    ]);
    for (const child of children) {
      expect(child.opens).toEqual(['mic', 'system']);
      expect(
        child.appends.every(
          (entry) => entry.observedAtSeconds >= entry.availableAtSeconds,
        ),
      ).toBe(true);
      expect(child.appends.slice(0, 4).map((entry) => entry.source)).toEqual([
        'mic',
        'system',
        'mic',
        'system',
      ]);
      expect(child.maximumPending).toBeLessThanOrEqual(2);
      expect(child.batches).toEqual(['mic', 'system']);
      expect(child.gaps).toHaveLength(6);
      expect(
        child.gaps.every(
          (gap) =>
            gap.skippedEndSeconds - gap.skippedStartSeconds === 2 &&
            gap.prefixCount > 0 &&
            gap.suffixCount > 0,
        ),
      ).toBe(true);
      expect(child.terminated).toBe(true);
    }
    expect(result.configs.map((entry) => entry.config)).toEqual([
      'pinned-default',
      'low-latency-2s',
    ]);
    expect(result.mlx).toEqual([
      { status: 'unavailable', reason: 'cache_missing' },
    ]);
    expect(
      result.resources.every(
        (entry) => entry.processTopology === 'combined-dual-source',
      ),
    ).toBe(true);
  });

  it('returns a finite cleanup failure when a forced child cannot prove exit', async () => {
    await expect(
      orchestrateInjectedPrivateReplay({
        meetings: [
          {
            id: 'm1',
            durationSeconds: 30,
            micPath: '/mic',
            systemPath: '/system',
          },
        ],
        repetitions: 1,
        maximumPendingAppends: 2,
        clock: { nowSeconds: () => 0, waitUntil: async () => undefined },
        createParakeet: async () => ({
          open: async () => undefined,
          append: async () => {
            throw new Error('arbitrary private failure');
          },
          flush: async () => ({ finalPreview: '', degradations: [] }),
          runBatchDiagnostic: async () => ({ status: 'unavailable' }),
          probeGap: async (_source, gap) => ({
            status: 'detected',
            startSeconds: gap.startSeconds,
            endSeconds: gap.endSeconds,
          }),
          repairGap: async () => ({ status: 'unavailable' }),
          resourceEvidence: () => ({ status: 'unavailable' }),
          terminate: async () => 'cleanup_failed',
        }),
        createMlx: async () => ({
          status: 'unavailable',
          reason: 'cache_missing',
        }),
      }),
    ).rejects.toThrowError('cleanup_failed');
  });

  it('uses one offline MLX server for paired five-second latest-wins jobs', async () => {
    let createCount = 0;
    let mlxTerminated = false;
    const jobs: Array<{
      micPath: string;
      systemPath: string;
      sequence: number;
    }> = [];
    const inertParakeet = (): InjectedParakeetProcess => ({
      open: async () => undefined,
      append: async () => undefined,
      flush: async () => ({ finalPreview: '', degradations: [] }),
      runBatchDiagnostic: async () => ({ status: 'unavailable' }),
      probeGap: async (_source, gap) => ({
        status: 'detected',
        startSeconds: gap.startSeconds,
        endSeconds: gap.endSeconds,
      }),
      repairGap: async () => ({ status: 'unavailable' }),
      resourceEvidence: () => ({ status: 'unavailable' }),
      terminate: async () => 'exited',
    });

    const result = await orchestrateInjectedPrivateReplay({
      meetings: [
        {
          id: 'm1',
          durationSeconds: 30,
          micPath: '/mic',
          systemPath: '/system',
        },
      ],
      repetitions: 1,
      maximumPendingAppends: 2,
      clock: { nowSeconds: () => 30, waitUntil: async () => undefined },
      createParakeet: async () => inertParakeet(),
      createMlx: async ({ offline, chunkSeconds, queuePolicy }) => {
        createCount += 1;
        expect({ offline, chunkSeconds, queuePolicy }).toEqual({
          offline: true,
          chunkSeconds: 5,
          queuePolicy: 'one-active-one-latest',
        });
        return {
          status: 'available',
          process: {
            transcribePair: async (job) => {
              jobs.push(job);
              return {
                completedAtSeconds:
                  job.sequence === 1 ? 16 : job.availableAtSeconds,
              };
            },
            resourceEvidence: () => ({
              status: 'available',
              samples: [{ wallTimeMs: 1, rssGiB: 1 }],
            }),
            terminate: async () => {
              mlxTerminated = true;
              return 'exited';
            },
          },
        };
      },
    });

    expect(createCount).toBe(1);
    expect(
      jobs.every(
        (job) => job.micPath === '/mic' && job.systemPath === '/system',
      ),
    ).toBe(true);
    expect(jobs.map(({ sequence }) => sequence)).toEqual([1, 3, 4, 5, 6]);
    expect(mlxTerminated).toBe(true);
    expect(result.mlx).toEqual([
      expect.objectContaining({ status: 'available', processedJobs: 5 }),
    ]);
  });
});

describe('private live replay comparison envelope', () => {
  it('retains both exact config reports and emits only a finite decision', () => {
    const pinned = report('pinned-default-v1');
    const low = report('low-latency-v1');
    const comparison = buildPrivateLiveReplayComparison(pinned, low);
    expect(comparison.configs).toEqual({
      pinnedDefault: pinned,
      lowLatency: low,
    });
    expect(comparison.decision).toBe(pinned.engines.parakeetSliding.status);
  });

  it('sanitizes a deliberately unavailable MLX engine without invented scores', () => {
    const pinned = report('pinned-default-v1');
    const low = report('low-latency-v1');
    const unavailablePinned = {
      ...pinned,
      engines: {
        ...pinned.engines,
        mlxProduction: { status: 'unavailable' as const, metrics: {} },
      },
      failures: ['dependency_unavailable'],
    };

    expect(() =>
      buildPrivateLiveReplayComparison(unavailablePinned, low),
    ).not.toThrow();
  });

  it('rejects unavailable metric smuggling and incomplete pass claims', () => {
    const pinned = report('pinned-default-v1');
    const low = report('low-latency-v1');
    const mutateMlx = (
      status: 'pass' | 'unavailable',
      metrics: Record<string, unknown>,
    ) => ({
      ...pinned,
      engines: {
        ...pinned.engines,
        mlxProduction: { status, metrics },
      },
      failures: status === 'unavailable' ? ['dependency_unavailable'] : [],
    });

    expect(() =>
      buildPrivateLiveReplayComparison(
        mutateMlx('unavailable', { arbitraryScore: 1 }) as never,
        low,
      ),
    ).toThrow('private_report_field');
    expect(() =>
      buildPrivateLiveReplayComparison(
        mutateMlx('unavailable', { transcript: 'private' }) as never,
        low,
      ),
    ).toThrow('private_report_field');
    expect(() =>
      buildPrivateLiveReplayComparison(
        mutateMlx('pass', { firstTextP95Seconds: 1 }) as never,
        low,
      ),
    ).toThrow('private_report_field');
  });

  it('writes the protected comparison atomically with owner-only permissions', () => {
    const directory = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'pluto-private-report-')),
    );
    const outputPath = path.join(directory, 'report.json');
    const comparison = buildPrivateLiveReplayComparison(
      report('pinned-default-v1'),
      report('low-latency-v1'),
    );

    writePrivateReplayReportAtomic(outputPath, comparison);

    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(comparison);
    expect(readdirSync(directory)).toEqual(['report.json']);
  });
});
