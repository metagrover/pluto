import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { NativeEvent } from '../../electron/transcription/nativeJsonLineProcess.ts';
import {
  CommittedPreviewState,
  type MlxReplayRun,
  OnlineCommittedPrefixTracker,
  type ParakeetReplayRun,
  type PreparedMeeting,
  type PrivateReplayDependencies,
  bucketStreamEvents,
  buildGapInjections,
  buildPrivateLiveReplayComparison,
  buildQuarterSecondFrames,
  buildResourceSoakEvidence,
  deriveFirstSealedActivitySeconds,
  launchResourceProbeAfterPrepared,
  orchestratePrivateReplay,
  parsePrivateLiveReplayOptions,
  replayEvidenceDigest,
  runPrivateLiveReplay,
  runReplayCli,
  scoreRecognizerSeams,
  validateCoverageGapProbe,
  validateResourceTimeline,
} from '../../scripts/run_private_parakeet_live_replay.ts';
import type {
  PrivateLiveReplayManifest,
  PrivateLiveReplayMeeting,
} from '../../scripts/validate_private_parakeet_live_manifest.ts';
import {
  buildPrivateLiveReplayReport,
  evaluateLiveReplay,
} from '../../src/services/liveTranscriptionReplayMetrics.ts';

const fixture = () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'private-replay-core-')),
  );
  const runtimePath = path.join(root, 'runtime');
  const modelRoot = path.join(root, 'models');
  mkdirSync(modelRoot);
  writeFileSync(runtimePath, 'runtime');
  const manifestPath = path.join(root, 'manifest.json');
  writeFileSync(manifestPath, '{}');
  const meetings: PrivateLiveReplayMeeting[] = [0, 1, 2].map((index) => {
    const micPath = path.join(root, `mic-${index}.wav`);
    const systemPath = path.join(root, `system-${index}.wav`);
    const proxyTranscriptPath = path.join(root, `proxy-${index}.json`);
    writeFileSync(micPath, 'mic');
    writeFileSync(systemPath, 'system');
    writeFileSync(
      proxyTranscriptPath,
      JSON.stringify([{ text: 'stable', end: 1 }]),
    );
    return {
      id: `m${index}`,
      recordedAt: '2026-08-14T00:00:00.000Z',
      sealedDurationSeconds: 1_800,
      sealedGeneration: index + 1,
      integrity: 'sealed',
      unresolvedCaptureGap: false,
      micSource: 'independent',
      proxyTranscriptPath,
      sources: { micPath, systemPath },
    };
  });
  return {
    root,
    manifestPath,
    manifest: {
      schemaVersion: 1,
      runtime: { executablePath: runtimePath, modelRoot },
      meetings,
    } satisfies PrivateLiveReplayManifest,
  };
};

const prepare = (meeting: PrivateLiveReplayMeeting): PreparedMeeting => {
  const frames = buildQuarterSecondFrames(meeting.sealedDurationSeconds);
  return {
    meeting,
    frames: { mic: frames, system: frames },
    mlxJobs: Array.from(
      { length: Math.ceil(meeting.sealedDurationSeconds / 5) },
      (_, index) => ({
        sequence: index + 1,
        availableAtSeconds: Math.min(
          meeting.sealedDurationSeconds,
          (index + 1) * 5,
        ),
        micPath: meeting.sources.micPath,
        systemPath: meeting.sources.systemPath,
      }),
    ),
    wholePaths: meeting.sources,
  };
};

const update = (source: 'mic' | 'system', end: number): NativeEvent => ({
  schemaVersion: 1,
  kind: 'event',
  streamId: `${source}-fake`,
  source,
  generation: 1,
  revision: 1,
  event: 'stream_update',
  qualifiesPriorTentative: true,
  text: 'stable',
  confidence: 1,
  audioEndSeconds: end,
});

const fakeDependencies = (mlxAvailable: boolean, cleanupFailure = false) => {
  let wall = 1_000;
  let pending = 0;
  let maximumPending = 0;
  let releasedSourceSeconds = 0;
  const topology: string[] = [];
  const appendOrder: string[] = [];
  const mlxJobs: Array<{
    sequence: number;
    micPath: string;
    systemPath: string;
  }> = [];
  const dependencies: PrivateReplayDependencies = {
    nowWallTimeMs: () => wall,
    wait: async (milliseconds) => {
      wall += milliseconds;
    },
    observeSourceRelease: (sourceSeconds) => {
      releasedSourceSeconds = sourceSeconds;
    },
    prepareMeeting: async (meeting) => prepare(meeting),
    startParakeet: async (config, repetition) => {
      topology.push(`parakeet:${repetition}:${config}`);
      const run: ParakeetReplayRun = {
        openPair: async (meeting) => {
          topology.push(`open:${meeting.meeting.id}:mic+system`);
          return {
            mic: {
              streamId: 'mic-fake',
              source: 'mic',
              generation: meeting.meeting.sealedGeneration,
            },
            system: {
              streamId: 'system-fake',
              source: 'system',
              generation: meeting.meeting.sealedGeneration,
            },
          };
        },
        append: async (source, frame) => {
          if (frame.availableAtSeconds > releasedSourceSeconds)
            throw new Error('future_frame_exposed');
          pending += 1;
          maximumPending = Math.max(maximumPending, pending);
          appendOrder.push(`${source}:${frame.sequence}`);
          await Promise.resolve();
          pending -= 1;
          return frame.sequence % 44 === 0
            ? [update(source, frame.endSeconds)]
            : [];
        },
        flush: async () => ({
          finalPreview: 'stable',
          timedTokens: [{ token: 'stable', atSeconds: 11 }],
          degradations: [],
          events: [],
        }),
        batch: async () => ({
          status: 'available',
          text: 'stable',
          timedTokens: [{ token: 'stable', atSeconds: 11 }],
        }),
        probeGap: async (source, gap) => ({
          events: [
            {
              schemaVersion: 1,
              kind: 'event',
              streamId: `${source}-gap`,
              source,
              generation: 1,
              revision: 1,
              event: 'stream_degraded',
              reason: 'coverage_gap',
              chunkStartSeconds: gap.startSeconds,
              chunkEndSeconds: gap.endSeconds,
            },
          ],
        }),
        repair: async (_source, start, end) => ({
          status: 'available',
          text: 'stable',
          timedTokens: [{ token: 'stable', atSeconds: (start + end) / 2 }],
        }),
        sample: (sourceSeconds, expectedWallTimeMs) => ({
          sourceSeconds,
          wallTimeMs: expectedWallTimeMs,
          schedulingJitterMs: 0,
          rssGiB: 1,
          thermal: 'nominal',
        }),
        close: async () => (cleanupFailure ? 'cleanup_failed' : 'exited'),
      };
      return run;
    },
    startMlx: async (repetition) => {
      topology.push(`mlx:${repetition}`);
      if (!mlxAvailable)
        return { status: 'unavailable', reason: 'cache_missing' } as const;
      const run: MlxReplayRun = {
        transcribePair: async (job) => {
          if (job.availableAtSeconds > releasedSourceSeconds)
            throw new Error('future_mlx_job_exposed');
          mlxJobs.push(job);
          const result = {
            status: 'available' as const,
            text: 'stable',
            timedTokens: [
              { token: 'stable', atSeconds: job.availableAtSeconds },
            ],
          };
          return {
            completedAtSeconds:
              job.sequence === 1
                ? job.availableAtSeconds + 11
                : Math.max(16, job.availableAtSeconds),
            mic: result,
            system: result,
          };
        },
        batch: async () => ({
          status: 'available',
          text: 'stable',
          timedTokens: [{ token: 'stable', atSeconds: 11 }],
        }),
        sample: (sourceSeconds, expectedWallTimeMs) => ({
          sourceSeconds,
          wallTimeMs: expectedWallTimeMs,
          schedulingJitterMs: 0,
          rssGiB: 1,
          thermal: 'nominal',
        }),
        close: async () => 'exited',
      };
      return { status: 'available', run } as const;
    },
  };
  return {
    dependencies,
    topology,
    appendOrder,
    mlxJobs,
    maximumPending: () => maximumPending,
  };
};

describe('single private replay orchestration core', () => {
  it('does not launch a probe when prepare is invalid', () => {
    let launches = 0;
    expect(
      launchResourceProbeAfterPrepared(
        { ok: false, liveConfigId: 'pinned-default', pid: 42 },
        'pinned-default',
        () => {
          launches += 1;
          return undefined;
        },
      ),
    ).toBeUndefined();
    expect(launches).toBe(0);
  });

  it('drives paired MLX and dual-source Parakeet through the executable path', async () => {
    const { manifest, manifestPath, root } = fixture();
    const fake = fakeDependencies(true);
    const report = await runPrivateLiveReplay(
      {
        manifestPath,
        outputPath: path.join(root, 'report.json'),
        mode: 'causal',
        repetitions: 3,
      },
      { manifest, dependencies: fake.dependencies },
    );
    expect(fake.topology.filter((entry) => entry.startsWith('mlx:'))).toEqual([
      'mlx:0',
      'mlx:1',
      'mlx:2',
    ]);
    expect(
      fake.topology.filter((entry) => entry.startsWith('parakeet:')),
    ).toEqual([
      'parakeet:0:pinned-default',
      'parakeet:0:low-latency-2s',
      'parakeet:1:low-latency-2s',
      'parakeet:1:pinned-default',
      'parakeet:2:pinned-default',
      'parakeet:2:low-latency-2s',
    ]);
    expect(fake.appendOrder.slice(0, 4)).toEqual([
      'mic:0',
      'system:0',
      'mic:1',
      'system:1',
    ]);
    expect(fake.maximumPending()).toBeLessThanOrEqual(2);
    expect(
      fake.mlxJobs.every(
        (job) =>
          job.micPath.includes('mic-') && job.systemPath.includes('system-'),
      ),
    ).toBe(true);
    expect(fake.mlxJobs.slice(0, 4).map(({ sequence }) => sequence)).toEqual([
      1, 3, 4, 5,
    ]);
    expect(report.configs.pinnedDefault.runtime.configId).toBe(
      'pinned-default-v1',
    );
    expect(report.configs.lowLatency.runtime.configId).toBe('low-latency-v1');
  }, 30_000);

  it('makes MLX cache unavailability dominate the overall comparison', async () => {
    const { manifest } = fixture();
    const fake = fakeDependencies(false);
    const report = await orchestratePrivateReplay(
      manifest,
      { mode: 'causal', repetitions: 3 },
      fake.dependencies,
    );
    expect(report.configs.pinnedDefault.engines.mlxProduction.status).toBe(
      'unavailable',
    );
    expect(report.configs.lowLatency.engines.mlxProduction.status).toBe(
      'unavailable',
    );
    expect(report.decision).toBe('unavailable');
  }, 30_000);

  it('uses the same core from the CLI and writes only a finite unavailable envelope', async () => {
    const { manifest, manifestPath, root } = fixture();
    const fake = fakeDependencies(false);
    const writes: unknown[] = [];
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      await runReplayCli(
        [
          '--manifest',
          manifestPath,
          '--mode',
          'causal',
          '--repetitions',
          '3',
          '--out',
          path.join(root, 'cli-report.json'),
        ],
        {
          manifest,
          dependencies: fake.dependencies,
          write: (_outputPath, report) => {
            writes.push(report);
          },
        },
      );
    } finally {
      stdout.mockRestore();
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ decision: 'unavailable' });
  }, 30_000);

  it('returns a finite cleanup failure when process exit cannot be proved', async () => {
    const { manifest } = fixture();
    const fake = fakeDependencies(false, true);
    await expect(
      orchestratePrivateReplay(
        manifest,
        { mode: 'causal', repetitions: 3 },
        fake.dependencies,
      ),
    ).rejects.toThrow('cleanup_failed');
  }, 30_000);

  it('fails closed when openPair does not reserve both stream identities', async () => {
    const { manifest } = fixture();
    const fake = fakeDependencies(true);
    const startParakeet = fake.dependencies.startParakeet;
    fake.dependencies.startParakeet = async (config, repetition) => {
      const run = await startParakeet(config, repetition);
      return { ...run, openPair: async () => undefined };
    };
    await expect(
      orchestratePrivateReplay(
        manifest,
        { mode: 'causal', repetitions: 3 },
        fake.dependencies,
      ),
    ).rejects.toThrow('benchmark_failed');
  }, 30_000);
});

describe('resource, gap, and retention evidence', () => {
  it('exposes the documented replay command', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, unknown> };
    expect(packageJson.scripts?.['replay:parakeet-live']).toContain(
      'run_private_parakeet_live_replay.ts',
    );
  });

  it('buckets native events by stream identity and retains only committed preview state', () => {
    const stream = {
      streamId: 'mic-r1-g1',
      source: 'mic' as const,
      generation: 1,
    };
    const foreign = {
      ...stream,
      streamId: 'system-r1-g1',
      source: 'system' as const,
    };
    const events = [
      { ...update('mic', 1), ...stream, text: 'tentative words' },
      {
        ...update('mic', 2),
        ...stream,
        revision: 2,
        qualifiesPriorTentative: true,
        text: 'different tentative tail',
      },
      { ...update('system', 2), ...foreign, text: 'foreign words' },
    ];
    expect(bucketStreamEvents(events, stream)).toHaveLength(2);

    const committed = new CommittedPreviewState();
    committed.observe(events[0]);
    committed.observe(events[1]);
    expect(committed.snapshot()).toBe('tentative words');
  });

  it('derives causal activity and seam scoring from recognizer boundaries', () => {
    expect(
      deriveFirstSealedActivitySeconds([
        {
          sequence: 0,
          startSeconds: 0,
          endSeconds: 0.25,
          availableAtSeconds: 0.25,
        },
        {
          sequence: 1,
          startSeconds: 0.25,
          endSeconds: 0.5,
          availableAtSeconds: 0.5,
        },
      ]),
    ).toBe(0.25);
    const seams = scoreRecognizerSeams(
      [{ token: 'one', atSeconds: 11 }],
      [{ token: 'one', atSeconds: 11 }],
      13,
    );
    expect(seams.referenceTokens).toBeGreaterThan(0);
  });

  it('parses preflight, promotion, and realtime soak stages without allowing arbitrary runs', () => {
    const paths = {
      manifestPath: '/tmp/manifest.json',
      outputPath: '/tmp/report.json',
      selectionPath: '/tmp/selection.json',
    };
    expect(
      parsePrivateLiveReplayOptions([
        '--manifest',
        paths.manifestPath,
        '--stage',
        'preflight',
        '--repetitions',
        '1',
        '--selection',
        paths.selectionPath,
      ]),
    ).toMatchObject({
      stage: 'preflight',
      repetitions: 1,
      outputPath: paths.selectionPath,
    });
    expect(() =>
      parsePrivateLiveReplayOptions([
        '--manifest',
        paths.manifestPath,
        '--out',
        paths.outputPath,
        '--stage',
        'promotion',
        '--config',
        'pinned-default',
        '--repetitions',
        '2',
      ]),
    ).toThrow('options_invalid');
  });

  it('binds selection evidence to the activated model and runtime bytes', () => {
    const { manifest } = fixture();
    const version = 'fluidaudio-0.15.5-asr-real-ctc-real-int8-verified1';
    mkdirSync(path.join(manifest.runtime.modelRoot, 'versions', version), {
      recursive: true,
    });
    writeFileSync(
      path.join(manifest.runtime.modelRoot, 'active.json'),
      JSON.stringify({ version }),
    );
    const modelFile = path.join(
      manifest.runtime.modelRoot,
      'versions',
      version,
      'model.bin',
    );
    writeFileSync(modelFile, 'model-revision-a');
    const first = replayEvidenceDigest(manifest);
    writeFileSync(modelFile, 'model-revision-a');
    expect(replayEvidenceDigest(manifest)).toBe(first);
    writeFileSync(modelFile, 'model-revision-b');
    expect(replayEvidenceDigest(manifest)).not.toBe(first);
    writeFileSync(manifest.runtime.executablePath, 'runtime-revision-b');
    expect(replayEvidenceDigest(manifest)).not.toBe(first);
    writeFileSync(manifest.meetings[0].sources.micPath, 'different-mic');
    expect(replayEvidenceDigest(manifest)).not.toBe(first);
  });

  it('requires the exact source grid, final sample, wall order, and jitter', () => {
    const valid = [0, 1, 2, 3].map((sourceSeconds) => ({
      sourceSeconds,
      wallTimeMs: sourceSeconds * 1_000,
      schedulingJitterMs: 0,
      rssGiB: 1,
      thermal: 'nominal' as const,
    }));
    expect(validateResourceTimeline(valid, 3, 1, true)).toBe(true);
    expect(validateResourceTimeline(valid.slice(1), 3, 1, true)).toBe(false);
    expect(validateResourceTimeline(valid.slice(0, -1), 3, 1, true)).toBe(
      false,
    );
    expect(
      validateResourceTimeline(
        valid.map((sample, index) =>
          index === 2 ? { ...sample, sourceSeconds: 2.5 } : sample,
        ),
        3,
        1,
        true,
      ),
    ).toBe(false);
    expect(
      validateResourceTimeline(
        valid.map((sample, index) =>
          index === 2 ? { ...sample, schedulingJitterMs: 251 } : sample,
        ),
        3,
        1,
        true,
      ),
    ).toBe(false);
    expect(
      validateResourceTimeline(
        valid.map((sample, index) =>
          index === 2 ? { ...sample, wallTimeMs: 500 } : sample,
        ),
        3,
        1,
        true,
      ),
    ).toBe(false);
    expect(
      buildResourceSoakEvidence(
        valid.map(({ thermal: _thermal, ...sample }) => sample),
        3,
        1,
        true,
      ),
    ).toBeUndefined();
  });

  it('accepts only a correlated exact eight-frame coverage gap', () => {
    const frames = buildQuarterSecondFrames(30);
    const gap = buildGapInjections(30)[1];
    const prefix = frames.filter(
      ({ sequence }) => sequence < gap.omittedSequences[0],
    );
    const suffix = frames[gap.omittedSequences[7] + 1];
    const event = {
      schemaVersion: 1,
      kind: 'event',
      streamId: 'gap',
      source: 'mic',
      generation: 1,
      revision: 1,
      event: 'stream_degraded',
      reason: 'coverage_gap',
      chunkStartSeconds: gap.startSeconds,
      chunkEndSeconds: gap.endSeconds,
    } as const;
    expect(validateCoverageGapProbe(gap, prefix, suffix, [event])).toBe(true);
    expect(
      validateCoverageGapProbe(gap, prefix, suffix, [
        { ...event, reason: 'partial_window' },
      ]),
    ).toBe(false);
    expect(
      validateCoverageGapProbe(gap, prefix, suffix, [
        { ...event, chunkEndSeconds: gap.endSeconds + 0.25 },
      ]),
    ).toBe(false);
    expect(
      validateCoverageGapProbe(
        { ...gap, omittedSequences: gap.omittedSequences.slice(1) },
        prefix,
        suffix,
        [event],
      ),
    ).toBe(false);
    expect(
      validateCoverageGapProbe(
        gap,
        prefix,
        { ...suffix, startSeconds: gap.endSeconds + 0.25 },
        [event],
      ),
    ).toBe(false);
  });

  it('keeps transcript retention bounded for a 90-minute-equivalent stream', () => {
    const tracker = new OnlineCommittedPrefixTracker();
    let cumulative = '';
    for (let sourceSeconds = 0; sourceSeconds < 90 * 60; sourceSeconds += 3) {
      cumulative += ' word';
      tracker.observe(cumulative);
    }
    expect(tracker.finish().retainedCommittedSnapshotCount).toBe(1);
    expect(tracker.finish().retainedCommittedSnapshotBytes).toBe(
      Buffer.byteLength(cumulative),
    );
    expect(tracker.finish().retainedCommittedSnapshotBytes).toBeLessThan(
      16_384,
    );
  });
});

describe('comparison envelope', () => {
  it('cannot allow Parakeet-only success when MLX is unavailable', () => {
    const unavailable = {
      status: 'unavailable' as const,
      metrics: {},
      invariants: {},
      failures: ['dependency_unavailable'],
    };
    const make = (configId: string) =>
      buildPrivateLiveReplayReport({
        corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
        runtime: {
          ...{
            fluidAudioVersion: '0.15.5',
            fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
            modelId: 'parakeet-tdt-0.6b-v3',
          },
          configId,
        },
        mlxProduction: unavailable,
        parakeetSliding: unavailable,
      });
    const pinned = make('pinned-default-v1');
    const low = make('low-latency-v1');
    expect(buildPrivateLiveReplayComparison(pinned, low).decision).toBe(
      'unavailable',
    );
    expect(() =>
      buildPrivateLiveReplayComparison(
        {
          ...pinned,
          engines: {
            ...pinned.engines,
            mlxProduction: {
              status: 'unavailable',
              metrics: { arbitraryScore: 1 },
            },
          },
        },
        low,
      ),
    ).toThrow('private_report_field');
    expect(() =>
      buildPrivateLiveReplayComparison(
        {
          ...pinned,
          engines: {
            ...pinned.engines,
            mlxProduction: {
              status: 'unavailable',
              metrics: { transcript: 'private' },
            },
          },
        },
        low,
      ),
    ).toThrow('private_report_field');
    expect(() =>
      buildPrivateLiveReplayComparison(
        { ...pinned, invariants: { unknownInvariant: 1 } },
        low,
      ),
    ).toThrow('private_report_field');
  });
});
