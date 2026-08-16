import { describe, expect, it } from 'vitest';

import {
  type CausalReplayFrame,
  runCausalReplay,
} from '../../src/services/liveTranscriptionReplay';
import {
  LIVE_REPLAY_THRESHOLDS,
  type LiveReplayRepetition,
  type LiveReplayResourceSoak,
  bootstrapConfidenceInterval,
  buildPrivateLiveReplayReport,
  evaluateLiveReplay,
  percentile,
  sanitizeLiveReplayReport,
} from '../../src/services/liveTranscriptionReplayMetrics';

const passingRepetition = (
  overrides: Partial<LiveReplayRepetition> = {},
): LiveReplayRepetition => ({
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
    {
      availableAtSeconds: 4,
      lookaheadReadyAtSeconds: 4,
      completedAtSeconds: 5,
      audioEndSeconds: 4,
      changed: true,
      activeSpeech: true,
      newTokenCount: 2,
      rollbackTokens: 0,
      volatileOperationCount: 0,
      revisionAgeSeconds: 0,
    },
  ],
  committedSnapshots: ['one two', 'one two three'],
  acceptedSequences: [0, 1],
  processedSequences: [0, 1],
  acceptedCoverage: [
    { receipt: 0, startSeconds: 0, endSeconds: 2 },
    { receipt: 1, startSeconds: 2, endSeconds: 4 },
  ],
  processedCoverage: [
    { receipt: 0, startSeconds: 0, endSeconds: 2 },
    { receipt: 1, startSeconds: 2, endSeconds: 4 },
  ],
  expectedSourceSeconds: 4,
  processedSourceSeconds: 4,
  inferenceSeconds: 1,
  seamDuplicateTokens: 0,
  seamOmittedTokens: 0,
  seamReferenceTokens: 10,
  committedSyntheticSeamDuplicateTokens: 0,
  committedSyntheticSeamOmittedTokens: 0,
  batchDiagnostic: {
    editRate: 0.1,
    precisionAt2Seconds: 0.9,
    recallAt2Seconds: 0.9,
    precisionAt5Seconds: 0.95,
    recallAt5Seconds: 0.95,
  },
  proxy: {
    disagreementRate: 0.1,
    alignedRecall: 0.95,
    mlxDisagreementRate: 0.08,
    mlxAlignedRecall: 0.93,
  },
  repair: {
    exactGapDetected: true,
    contextBeforeSeconds: 2,
    contextAfterSeconds: 2,
    outsideContextTokenChanges: 0,
    repairedTokenF1: 0.98,
  },
  captureHandoffMilliseconds: [1, 5, 10],
  rendererInferenceCallbacks: 0,
  wholeSessionAsrCalls: 0,
  analysisBeforeCanonicalCommit: 0,
  ...overrides,
});

const passingResourceSoak = {
  sourceStartSeconds: 0,
  sourceEndSeconds: 4,
  sourceDurationSeconds: 4,
  soakStartSeconds: 0,
  soakEndSeconds: 4,
  warmupEndSeconds: 0,
  sampleIntervalSeconds: 1 as const,
  realTime: true as const,
  longestSource: true as const,
  peakRssGiB: 1,
  preparedIdleRssGiB: 1,
  rssSamples: Array.from({ length: 5 }, (_, atSeconds) => ({
    atSeconds,
    rssGiB: 1,
  })),
  thermalSamples: Array.from({ length: 5 }, (_, atSeconds) => ({
    atSeconds,
    state: 'nominal' as const,
  })),
};

const passingEvidence = {
  corpusEligible: true,
  aecEvidenceAvailable: true,
  resourceEvidenceAvailable: true,
  engineOrderAlternated: true,
  mlxProductionQueueVerified: true,
  resourceSoak: passingResourceSoak,
  mlxBaseline: { firstTextP95Seconds: 1, runtimeFactor: 0.25 },
} as const;

type ReplayOverrides = Partial<LiveReplayRepetition> & {
  peakRssGiB?: number;
  preparedIdleRssGiB?: number;
  rssSamples?: LiveReplayResourceSoak['rssSamples'];
  thermalSamples?: LiveReplayResourceSoak['thermalSamples'];
  resourceSoak?: Partial<LiveReplayResourceSoak>;
};

const evaluatePassing = (
  overrides: ReplayOverrides = {},
  evidence: Parameters<typeof evaluateLiveReplay>[1] = passingEvidence,
) => {
  const {
    peakRssGiB,
    preparedIdleRssGiB,
    rssSamples,
    thermalSamples,
    resourceSoak,
    ...repetitionOverrides
  } = overrides;
  const hasSoakOverrides =
    peakRssGiB !== undefined ||
    preparedIdleRssGiB !== undefined ||
    rssSamples !== undefined ||
    thermalSamples !== undefined ||
    resourceSoak !== undefined;
  const configuredSoak = {
    ...(evidence.resourceSoak ?? passingResourceSoak),
    ...resourceSoak,
    ...(peakRssGiB === undefined ? {} : { peakRssGiB }),
    ...(preparedIdleRssGiB === undefined ? {} : { preparedIdleRssGiB }),
    ...(rssSamples === undefined ? {} : { rssSamples }),
    ...(thermalSamples === undefined ? {} : { thermalSamples }),
  } as LiveReplayResourceSoak;
  return evaluateLiveReplay(
    Array.from({ length: 3 }, () => passingRepetition(repetitionOverrides)),
    {
      ...evidence,
      ...(hasSoakOverrides || evidence.resourceSoak
        ? { resourceSoak: configuredSoak }
        : {}),
    },
  );
};

describe('causal replay', () => {
  it('releases frames only on their virtual availability clock', async () => {
    const seen: Array<{ sequence: number; availableAtSeconds: number }> = [];
    const frames: CausalReplayFrame[] = [
      { sequence: 0, availableAtSeconds: 0.25, audioEndSeconds: 0.25 },
      { sequence: 1, availableAtSeconds: 0.5, audioEndSeconds: 0.5 },
    ];

    const result = await runCausalReplay(frames, async (frame, clock) => {
      seen.push({ sequence: frame.sequence, availableAtSeconds: clock });
      return {
        completedAtSeconds: clock + 0.1,
        observedAudioEndSeconds: frame.audioEndSeconds,
      };
    });

    expect(seen).toEqual([
      { sequence: 0, availableAtSeconds: 0.25 },
      { sequence: 1, availableAtSeconds: 0.5 },
    ]);
    expect(result.map((entry) => entry.completedAtSeconds)).toEqual([
      0.35, 0.6,
    ]);
  });

  it('rejects future samples, duplicate sequences, and regressing clocks', async () => {
    await expect(
      runCausalReplay(
        [{ sequence: 0, availableAtSeconds: 1, audioEndSeconds: 1.01 }],
        async (frame, clock) => ({
          completedAtSeconds: clock,
          observedAudioEndSeconds: frame.audioEndSeconds,
        }),
      ),
    ).rejects.toThrow('causal_replay_future_audio');

    await expect(
      runCausalReplay(
        [{ sequence: 0, availableAtSeconds: 1, audioEndSeconds: 0.25 }],
        async () => ({
          completedAtSeconds: 1.1,
          observedAudioEndSeconds: 0.26,
        }),
      ),
    ).rejects.toThrow('causal_replay_future_audio');

    await expect(
      runCausalReplay(
        [
          { sequence: 0, availableAtSeconds: 1, audioEndSeconds: 0.25 },
          { sequence: 0, availableAtSeconds: 2, audioEndSeconds: 0.5 },
        ],
        async (frame, clock) => ({
          completedAtSeconds: clock,
          observedAudioEndSeconds: frame.audioEndSeconds,
        }),
      ),
    ).rejects.toThrow('causal_replay_sequence');

    await expect(
      runCausalReplay(
        [
          { sequence: 0, availableAtSeconds: 2, audioEndSeconds: 0.25 },
          { sequence: 1, availableAtSeconds: 1, audioEndSeconds: 0.25 },
        ],
        async (frame, clock) => ({
          completedAtSeconds: clock,
          observedAudioEndSeconds: frame.audioEndSeconds,
        }),
      ),
    ).rejects.toThrow('causal_replay_clock');
  });

  it('rejects non-finite frames and completion before availability', async () => {
    await expect(
      runCausalReplay(
        [
          {
            sequence: 0,
            availableAtSeconds: Number.NaN,
            audioEndSeconds: 1,
          },
        ],
        async () => ({
          completedAtSeconds: 1,
          observedAudioEndSeconds: 1,
        }),
      ),
    ).rejects.toThrow('causal_replay_invalid_number');

    await expect(
      runCausalReplay(
        [{ sequence: 0, availableAtSeconds: 1, audioEndSeconds: 0.25 }],
        async () => ({
          completedAtSeconds: 0.9,
          observedAudioEndSeconds: 0.25,
        }),
      ),
    ).rejects.toThrow('causal_replay_completion_clock');
  });

  it('advances a monotonic causal watermark under backlog and rejects regressing observations', async () => {
    const clocks: number[] = [];
    await runCausalReplay(
      [
        { sequence: 0, availableAtSeconds: 0.25, audioEndSeconds: 0.25 },
        { sequence: 1, availableAtSeconds: 0.5, audioEndSeconds: 0.5 },
      ],
      async (frame, clock) => {
        clocks.push(clock);
        return {
          completedAtSeconds: frame.sequence === 0 ? 10 : clock + 0.1,
          observedAudioEndSeconds: frame.audioEndSeconds,
        };
      },
    );
    expect(clocks).toEqual([0.25, 10]);

    await expect(
      runCausalReplay(
        [
          { sequence: 0, availableAtSeconds: 0.25, audioEndSeconds: 0.25 },
          { sequence: 1, availableAtSeconds: 0.5, audioEndSeconds: 0.5 },
        ],
        async (frame, clock) => ({
          completedAtSeconds: clock,
          observedAudioEndSeconds: frame.sequence === 0 ? 0.25 : 0.2,
        }),
      ),
    ).rejects.toThrow('causal_replay_clock');
  });

  it('rejects replay frames larger than the 250ms causal admission slice', async () => {
    await expect(
      runCausalReplay(
        [
          { sequence: 0, availableAtSeconds: 0.25, audioEndSeconds: 0.25 },
          { sequence: 1, availableAtSeconds: 0.501, audioEndSeconds: 0.501 },
        ],
        async (frame, clock) => ({
          completedAtSeconds: clock,
          observedAudioEndSeconds: frame.audioEndSeconds,
        }),
      ),
    ).rejects.toThrow('causal_replay_frame_duration');
  });
});

describe('live replay statistics', () => {
  it('calculates deterministic percentiles without mutating input', () => {
    const values = [4, 1, 3, 2];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 0.5)).toBe(2.5);
    expect(percentile(values, 0.95)).toBeCloseTo(3.85);
    expect(percentile(values, 1)).toBe(4);
    expect(values).toEqual([4, 1, 3, 2]);
  });

  it('rejects empty, non-finite, and invalid percentile inputs', () => {
    expect(() => percentile([], 0.5)).toThrow('live_replay_empty_values');
    expect(() => percentile([1, Number.NaN], 0.5)).toThrow(
      'live_replay_invalid_number',
    );
    expect(() => percentile([1], -0.1)).toThrow(
      'live_replay_invalid_percentile',
    );
  });

  it('produces deterministic finite bootstrap bounds', () => {
    const first = bootstrapConfidenceInterval([1, 2, 3, 4], {
      seed: 7,
      samples: 200,
    });
    const second = bootstrapConfidenceInterval([1, 2, 3, 4], {
      seed: 7,
      samples: 200,
    });
    expect(first).toEqual(second);
    expect(first.lower).toBeLessThanOrEqual(first.estimate);
    expect(first.upper).toBeGreaterThanOrEqual(first.estimate);
    expect(() =>
      bootstrapConfidenceInterval([1], { seed: 1, samples: 0 }),
    ).toThrow('live_replay_invalid_bootstrap');
  });

  it('rejects custom bootstrap statistics that produce non-finite values', () => {
    expect(() =>
      bootstrapConfidenceInterval([1, 2], {
        samples: 10,
        statistic: () => Number.NaN,
      }),
    ).toThrow('live_replay_invalid_number');
  });
});

describe('live replay gates', () => {
  it('fails any committed-prefix mutation in any repetition', () => {
    const verdict = evaluatePassing({
      committedSnapshots: ['one two', 'one x'],
    });

    expect(verdict.invariants.committedPrefixViolations).toBe(3);
    expect(verdict.status).toBe('fail');
  });

  it('derives first text from first sealed activity and cadence from changed publications', () => {
    const verdict = evaluatePassing();

    expect(verdict.metrics.firstTextP50Seconds).toBe(2);
    expect(verdict.metrics.publicationCadenceP50Seconds).toBe(2);
    expect(verdict.metrics.processingLatencyP95Seconds).toBe(1);
    expect(verdict.status).toBe('pass');
  });

  it('counts missing accepted sequences and requires exact source coverage', () => {
    const verdict = evaluatePassing({
      acceptedSequences: [0, 1, 2],
      processedSequences: [0, 2],
      acceptedCoverage: [
        { receipt: 0, startSeconds: 0, endSeconds: 1 },
        { receipt: 1, startSeconds: 1, endSeconds: 2 },
        { receipt: 2, startSeconds: 2, endSeconds: 4 },
      ],
      processedCoverage: [
        { receipt: 0, startSeconds: 0, endSeconds: 1 },
        { receipt: 2, startSeconds: 2, endSeconds: 4 },
      ],
      processedSourceSeconds: 3,
    });

    expect(verdict.invariants.missingAcceptedSequences).toBe(3);
    expect(verdict.metrics.sourceCoverage).toBe(0.75);
    expect(verdict.status).toBe('fail');
  });

  it('tests exact, inside, and outside first-text boundaries', () => {
    const relaxedRegressionEvidence = {
      ...passingEvidence,
      mlxBaseline: { firstTextP95Seconds: 100, runtimeFactor: 1 },
    };
    const exact = evaluatePassing(
      {
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds: 5,
            lookaheadReadyAtSeconds: 5,
            completedAtSeconds: 6,
          },
        ],
      },
      relaxedRegressionEvidence,
    );
    const inside = evaluatePassing(
      {
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds - 0.001,
            lookaheadReadyAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds - 0.001,
            completedAtSeconds:
              1 + LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds - 0.001,
          },
        ],
      },
      relaxedRegressionEvidence,
    );
    const outside = evaluatePassing(
      {
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds + 0.001,
            lookaheadReadyAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds + 0.001,
            completedAtSeconds:
              1 + LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds + 0.001,
          },
        ],
      },
      relaxedRegressionEvidence,
    );

    expect(exact.status).toBe('pass');
    expect(inside.status).toBe('pass');
    expect(outside.failures).toContain('first_text_p50');
  });

  it('uses the bootstrap upper bound for distributional gates', () => {
    const fast = passingRepetition({
      publications: [
        {
          ...passingRepetition().publications[0],
          availableAtSeconds: 4,
          lookaheadReadyAtSeconds: 4,
          completedAtSeconds: 5,
        },
      ],
    });
    const slow = passingRepetition({
      publications: [
        {
          ...passingRepetition().publications[0],
          availableAtSeconds: 6,
          lookaheadReadyAtSeconds: 6,
          completedAtSeconds: 7,
        },
      ],
    });

    const verdict = evaluateLiveReplay([fast, slow, fast], passingEvidence);

    expect(verdict.metrics.firstTextP50Seconds).toBe(4);
    expect(verdict.metrics.firstTextP50Upper95Seconds).toBeGreaterThan(4);
    expect(verdict.failures).toContain('first_text_p50');
  });

  it('enforces Parakeet latency and RTF non-regression against MLX', () => {
    const exact = evaluatePassing();
    const outside = evaluatePassing(
      {},
      {
        ...passingEvidence,
        mlxBaseline: { firstTextP95Seconds: 0.999, runtimeFactor: 0.2 },
      },
    );

    expect(exact.status).toBe('pass');
    expect(outside.failures).toEqual(
      expect.arrayContaining([
        'first_text_regression',
        'runtime_factor_regression',
      ]),
    );
  });

  it('rejects impossible clocks, negative counts, and out-of-range rates', () => {
    expect(() =>
      evaluateLiveReplay([
        passingRepetition({
          publications: [
            {
              ...passingRepetition().publications[0],
              completedAtSeconds: 1,
              availableAtSeconds: 2,
            },
          ],
        }),
      ]),
    ).toThrow('live_replay_invalid_observation');
    expect(() =>
      evaluateLiveReplay([passingRepetition({ seamDuplicateTokens: -1 })]),
    ).toThrow('live_replay_invalid_observation');
    expect(() =>
      evaluateLiveReplay([
        passingRepetition({
          batchDiagnostic: {
            ...passingRepetition().batchDiagnostic,
            editRate: 1.01,
          },
        }),
      ]),
    ).toThrow('live_replay_invalid_observation');
  });

  it('enforces resource, revision, seam, batch, proxy, repair, and thermal gates', () => {
    const verdict = evaluatePassing({
      publications: [
        {
          ...passingRepetition().publications[0],
          rollbackTokens: 4,
          revisionAgeSeconds: 6.01,
        },
      ],
      seamDuplicateTokens: 1,
      seamOmittedTokens: 1,
      seamReferenceTokens: 100,
      batchDiagnostic: {
        editRate: 0.101,
        precisionAt2Seconds: 0.899,
        recallAt2Seconds: 0.899,
        precisionAt5Seconds: 0.949,
        recallAt5Seconds: 0.949,
      },
      proxy: {
        disagreementRate: 0.101,
        alignedRecall: 0.909,
        mlxDisagreementRate: 0.08,
        mlxAlignedRecall: 0.93,
      },
      repair: {
        exactGapDetected: false,
        contextBeforeSeconds: 2.01,
        contextAfterSeconds: 2,
        outsideContextTokenChanges: 1,
        repairedTokenF1: 0.979,
      },
      peakRssGiB: 2.501,
      preparedIdleRssGiB: 0.9,
      rssSamples: [
        { atSeconds: 0, rssGiB: 2.48 },
        { atSeconds: 1, rssGiB: 2.501 },
        { atSeconds: 2, rssGiB: 2.501 },
        { atSeconds: 3, rssGiB: 2.501 },
        { atSeconds: 4, rssGiB: 2.501 },
      ],
      thermalSamples: [
        { atSeconds: 0, state: 'serious' },
        { atSeconds: 1, state: 'serious' },
        { atSeconds: 2, state: 'serious' },
        { atSeconds: 3, state: 'serious' },
        { atSeconds: 4, state: 'serious' },
      ],
      captureHandoffMilliseconds: [10.01],
    });

    expect(verdict.status).toBe('fail');
    expect(verdict.failures).toEqual(
      expect.arrayContaining([
        'volatile_rollback',
        'volatile_revision_age',
        'seam_error_rate',
        'batch_agreement',
        'proxy_non_regression',
        'repair_bounds',
        'peak_rss',
        'rss_growth',
        'thermal_state',
        'capture_handoff',
      ]),
    );
  });

  it('uses RSS regression slope rather than only the first and last sample', () => {
    const verdict = evaluatePassing({
      peakRssGiB: 2,
      rssSamples: [
        { atSeconds: 0, rssGiB: 1 },
        { atSeconds: 1, rssGiB: 2 },
        { atSeconds: 2, rssGiB: 2 },
        { atSeconds: 3, rssGiB: 2 },
        { atSeconds: 4, rssGiB: 2 },
      ],
      thermalSamples: [
        { atSeconds: 0, state: 'nominal' },
        { atSeconds: 1, state: 'nominal' },
        { atSeconds: 2, state: 'nominal' },
        { atSeconds: 3, state: 'nominal' },
        { atSeconds: 4, state: 'nominal' },
      ],
    });

    expect(verdict.metrics.rssGrowthMiBPerHourMaximum).toBeGreaterThan(64);
    expect(verdict.failures).toContain('rss_growth');
  });

  it('cannot pass without sufficient corpus, AEC, or resource evidence', () => {
    const verdict = evaluateLiveReplay(
      Array.from({ length: 3 }, () => passingRepetition()),
      {
        corpusEligible: false,
        aecEvidenceAvailable: false,
        resourceEvidenceAvailable: false,
        engineOrderAlternated: true,
        mlxProductionQueueVerified: true,
        mlxBaseline: passingEvidence.mlxBaseline,
      },
    );

    expect(verdict.status).toBe('unavailable');
    expect(verdict.failures).toEqual([
      'insufficient_corpus',
      'dependency_unavailable',
      'resource_evidence_unavailable',
    ]);
  });

  it('requires three repetitions, an alternating engine order, MLX queue proof, and a baseline', () => {
    expect(
      evaluateLiveReplay([passingRepetition()], passingEvidence),
    ).toMatchObject({
      status: 'unavailable',
      failures: expect.arrayContaining(['insufficient_repetitions']),
    });
    expect(
      evaluateLiveReplay(Array.from({ length: 3 }, () => passingRepetition())),
    ).toMatchObject({
      status: 'unavailable',
      failures: expect.arrayContaining([
        'insufficient_corpus',
        'dependency_unavailable',
        'resource_evidence_unavailable',
        'engine_order_unverified',
        'mlx_queue_unverified',
        'mlx_baseline_unavailable',
      ]),
    });
  });

  it('measures cadence only during active speech and processing from lookahead readiness', () => {
    const verdict = evaluatePassing({
      publications: [
        passingRepetition().publications[0],
        {
          ...passingRepetition().publications[1],
          activeSpeech: false,
          completedAtSeconds: 100,
        },
        {
          ...passingRepetition().publications[1],
          availableAtSeconds: 6,
          lookaheadReadyAtSeconds: 8,
          completedAtSeconds: 9,
          audioEndSeconds: 6,
        },
      ],
    });
    expect(verdict.metrics.publicationCadenceP50Seconds).toBe(6);
    expect(verdict.metrics.processingLatencyP95Seconds).toBe(1);
  });

  it('rejects scalar coverage that masks receipt gaps, overlap, or substitution', () => {
    const verdict = evaluatePassing({
      acceptedCoverage: [
        { receipt: 0, startSeconds: 0, endSeconds: 2 },
        { receipt: 1, startSeconds: 2, endSeconds: 4 },
      ],
      processedCoverage: [
        { receipt: 0, startSeconds: 0, endSeconds: 2.5 },
        { receipt: 2, startSeconds: 2.5, endSeconds: 4 },
      ],
      processedSourceSeconds: 4,
    });
    expect(verdict.invariants.incompleteSourceCoverage).toBeGreaterThan(0);
    expect(verdict.invariants.unexpectedProcessedSequences).toBeGreaterThan(0);
    expect(verdict.failures).toContain('source_coverage');
  });

  it('uses only post-warmup one-second real-time samples and derives peak RSS', () => {
    const preWarmupGrowth = evaluatePassing({
      peakRssGiB: 1,
      rssSamples: [
        { atSeconds: 0, rssGiB: 0.5 },
        { atSeconds: 1, rssGiB: 1 },
        { atSeconds: 2, rssGiB: 1 },
        { atSeconds: 3, rssGiB: 1 },
        { atSeconds: 4, rssGiB: 1 },
        { atSeconds: 5, rssGiB: 1 },
        { atSeconds: 6, rssGiB: 1 },
      ],
      thermalSamples: [
        { atSeconds: 2, state: 'nominal' },
        { atSeconds: 3, state: 'nominal' },
        { atSeconds: 4, state: 'nominal' },
        { atSeconds: 5, state: 'nominal' },
        { atSeconds: 6, state: 'nominal' },
      ],
      resourceSoak: {
        sourceStartSeconds: 2,
        sourceEndSeconds: 6,
        sourceDurationSeconds: 4,
        soakStartSeconds: 0,
        soakEndSeconds: 6,
        warmupEndSeconds: 2,
        sampleIntervalSeconds: 1,
        realTime: true,
        longestSource: true,
      },
    });
    expect(preWarmupGrowth.failures).not.toContain('rss_growth');
    expect(preWarmupGrowth.status).toBe('pass');

    expect(() => evaluatePassing({ peakRssGiB: 2 })).toThrow(
      'live_replay_invalid_observation',
    );
    expect(
      evaluatePassing({
        resourceSoak: {
          warmupEndSeconds: 0,
          sampleIntervalSeconds: 2 as 1,
          realTime: false as true,
          longestSource: false as true,
        },
      }),
    ).toMatchObject({
      status: 'unavailable',
      failures: expect.arrayContaining(['resource_evidence_unavailable']),
    });
  });

  it.each([
    {
      label: 'head',
      times: [1, 2, 3, 4],
    },
    {
      label: 'tail',
      times: [0, 1, 2, 3],
    },
    {
      label: 'interior',
      times: [0, 1, 3, 4],
    },
  ])(
    'rejects truncated $label soak evidence for the full longest source',
    ({ times }) => {
      const verdict = evaluatePassing({
        peakRssGiB: 1,
        rssSamples: times.map((atSeconds) => ({ atSeconds, rssGiB: 1 })),
        thermalSamples: times.map((atSeconds) => ({
          atSeconds,
          state: 'nominal' as const,
        })),
        resourceSoak: {
          warmupEndSeconds: 0,
          sampleIntervalSeconds: 1,
          realTime: true,
          longestSource: true,
        },
      });
      expect(verdict.status).toBe('unavailable');
      expect(verdict.failures).toContain('resource_evidence_unavailable');
    },
  );

  it('counts every volatile operation and forbids committed synthetic seam errors and renderer inference', () => {
    const verdict = evaluatePassing({
      publications: [
        {
          ...passingRepetition().publications[0],
          newTokenCount: 10,
          volatileOperationCount: 2,
        },
      ],
      committedSyntheticSeamDuplicateTokens: 1,
      rendererInferenceCallbacks: 1,
    });
    expect(verdict.metrics.volatileOperationsPerNewToken).toBe(0.2);
    expect(verdict.invariants.committedSyntheticSeamErrors).toBe(3);
    expect(verdict.invariants.rendererInferenceCallbacks).toBe(3);
    expect(verdict.failures).toEqual(
      expect.arrayContaining([
        'volatile_revision_rate',
        'committed_synthetic_seam',
        'renderer_inference',
      ]),
    );
  });

  it('serializes every aggregate used by an enforced gate', () => {
    expect(Object.keys(evaluatePassing().metrics).sort()).toEqual(
      [
        'batchEditRateMaximum',
        'batchPrecisionAt2SecondsMinimum',
        'batchPrecisionAt5SecondsMinimum',
        'batchRecallAt2SecondsMinimum',
        'batchRecallAt5SecondsMinimum',
        'captureHandoffP99Milliseconds',
        'fairThermalContinuousSecondsMaximum',
        'fairThermalFractionMaximum',
        'firstTextMaximumSeconds',
        'firstTextP50Seconds',
        'firstTextP50Upper95Seconds',
        'firstTextP95Seconds',
        'firstTextP95Upper95Seconds',
        'peakRssAboveIdleGiBMaximum',
        'peakRssGiBMaximum',
        'processingLatencyMaximumSeconds',
        'processingLatencyP95Seconds',
        'processingLatencyP95Upper95Seconds',
        'proxyDisagreementRegressionMaximum',
        'proxyRecallRegressionMaximum',
        'publicationCadenceMaximumSeconds',
        'publicationCadenceP50Seconds',
        'publicationCadenceP50Upper95Seconds',
        'publicationCadenceP95Seconds',
        'publicationCadenceP95Upper95Seconds',
        'repairContextSecondsMaximum',
        'repairTokenF1Minimum',
        'revisionMaximumAgeSeconds',
        'rollbackP95Tokens',
        'rssGrowthMiBPerHourMaximum',
        'runtimeFactorMaximum',
        'seamErrorRateMaximum',
        'sourceCoverage',
        'volatileOperationsPerNewToken',
      ].sort(),
    );
  });

  it('keeps every scalar gate inclusive at exact and inside boundaries and rejects outside', () => {
    const upper = (
      threshold: number,
      code: string,
      make: (value: number) => ReplayOverrides,
      evidence: Parameters<typeof evaluateLiveReplay>[1] = passingEvidence,
    ) => {
      expect(evaluatePassing(make(threshold), evidence).failures).not.toContain(
        code,
      );
      expect(
        evaluatePassing(make(threshold - 0.001), evidence).failures,
      ).not.toContain(code);
      expect(
        evaluatePassing(make(threshold + 0.001), evidence).failures,
      ).toContain(code);
    };
    const lower = (
      threshold: number,
      code: string,
      make: (value: number) => ReplayOverrides,
    ) => {
      expect(evaluatePassing(make(threshold)).failures).not.toContain(code);
      expect(evaluatePassing(make(threshold + 0.001)).failures).not.toContain(
        code,
      );
      expect(evaluatePassing(make(threshold - 0.001)).failures).toContain(code);
    };
    const firstText = (value: number): Partial<LiveReplayRepetition> => ({
      publications: [
        {
          ...passingRepetition().publications[0],
          availableAtSeconds: value,
          lookaheadReadyAtSeconds: value,
          completedAtSeconds: value + 1,
        },
      ],
    });
    const relaxed = {
      ...passingEvidence,
      mlxBaseline: { firstTextP95Seconds: 100, runtimeFactor: 1 },
    };
    upper(
      LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds,
      'first_text_p50',
      firstText,
      relaxed,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.firstTextP95Seconds,
      'first_text_p95',
      firstText,
      relaxed,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.firstTextMaximumSeconds,
      'first_text_max',
      firstText,
      relaxed,
    );

    const cadence = (value: number): Partial<LiveReplayRepetition> => ({
      publications: [
        passingRepetition().publications[0],
        {
          ...passingRepetition().publications[1],
          availableAtSeconds: 2,
          lookaheadReadyAtSeconds: 2,
          completedAtSeconds: 3 + value,
        },
      ],
    });
    upper(
      LIVE_REPLAY_THRESHOLDS.publicationCadenceP50Seconds,
      'publication_cadence_p50',
      cadence,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.publicationCadenceP95Seconds,
      'publication_cadence_p95',
      cadence,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.publicationCadenceMaximumSeconds,
      'publication_cadence_max',
      cadence,
    );

    const processing = (value: number): Partial<LiveReplayRepetition> => ({
      publications: [
        {
          ...passingRepetition().publications[0],
          completedAtSeconds: 2 + value,
        },
      ],
    });
    upper(
      LIVE_REPLAY_THRESHOLDS.processingLatencyP95Seconds,
      'processing_latency_p95',
      processing,
      relaxed,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.processingLatencyMaximumSeconds,
      'processing_latency_max',
      processing,
      relaxed,
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.runtimeFactor,
      'runtime_factor',
      (value) => ({ inferenceSeconds: value * 4 }),
      {
        ...passingEvidence,
        mlxBaseline: { firstTextP95Seconds: 1, runtimeFactor: 1 },
      },
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.captureHandoffP99Milliseconds,
      'capture_handoff',
      (value) => ({ captureHandoffMilliseconds: [value] }),
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.revisionMaximumAgeSeconds,
      'volatile_revision_age',
      (value) => ({
        publications: passingRepetition().publications.map((publication) => ({
          ...publication,
          revisionAgeSeconds: value,
        })),
      }),
    );
    upper(LIVE_REPLAY_THRESHOLDS.peakRssGiB, 'peak_rss', (value) => ({
      peakRssGiB: value,
      preparedIdleRssGiB: value,
      rssSamples: [
        { atSeconds: 0, rssGiB: value },
        { atSeconds: 1, rssGiB: value },
      ],
    }));
    upper(LIVE_REPLAY_THRESHOLDS.rssAboveIdleGiB, 'peak_rss', (value) => ({
      peakRssGiB: 1 + value,
      preparedIdleRssGiB: 1,
      rssSamples: [
        { atSeconds: 0, rssGiB: 1 + value },
        { atSeconds: 1, rssGiB: 1 + value },
      ],
    }));
    upper(LIVE_REPLAY_THRESHOLDS.seamErrorRate, 'seam_error_rate', (value) => ({
      seamDuplicateTokens: Math.round(value * 1_000_000),
      seamReferenceTokens: 1_000_000,
    }));
    upper(LIVE_REPLAY_THRESHOLDS.batchEditRate, 'batch_agreement', (value) => ({
      batchDiagnostic: {
        ...passingRepetition().batchDiagnostic,
        editRate: value,
      },
    }));
    lower(
      LIVE_REPLAY_THRESHOLDS.batchPrecisionAt2Seconds,
      'batch_agreement',
      (value) => ({
        batchDiagnostic: {
          ...passingRepetition().batchDiagnostic,
          precisionAt2Seconds: value,
        },
      }),
    );
    lower(
      LIVE_REPLAY_THRESHOLDS.batchRecallAt2Seconds,
      'batch_agreement',
      (value) => ({
        batchDiagnostic: {
          ...passingRepetition().batchDiagnostic,
          recallAt2Seconds: value,
        },
      }),
    );
    lower(
      LIVE_REPLAY_THRESHOLDS.batchPrecisionAt5Seconds,
      'batch_agreement',
      (value) => ({
        batchDiagnostic: {
          ...passingRepetition().batchDiagnostic,
          precisionAt5Seconds: value,
        },
      }),
    );
    lower(
      LIVE_REPLAY_THRESHOLDS.batchRecallAt5Seconds,
      'batch_agreement',
      (value) => ({
        batchDiagnostic: {
          ...passingRepetition().batchDiagnostic,
          recallAt5Seconds: value,
        },
      }),
    );
    upper(
      LIVE_REPLAY_THRESHOLDS.repairContextSeconds,
      'repair_bounds',
      (value) => ({
        repair: { ...passingRepetition().repair, contextBeforeSeconds: value },
      }),
    );
    lower(LIVE_REPLAY_THRESHOLDS.repairTokenF1, 'repair_bounds', (value) => ({
      repair: { ...passingRepetition().repair, repairedTokenF1: value },
    }));
  });

  it('covers exact, inside, and outside boundaries for stability, soak, proxy, and MLX gates', () => {
    const rates = [15, 14, 16].map((volatileOperationCount) =>
      evaluatePassing({
        publications: [
          {
            ...passingRepetition().publications[0],
            newTokenCount: 100,
            volatileOperationCount,
          },
        ],
      }),
    );
    expect(rates[0].failures).not.toContain('volatile_revision_rate');
    expect(rates[1].failures).not.toContain('volatile_revision_rate');
    expect(rates[2].failures).toContain('volatile_revision_rate');

    const rollbacks = [3, 2, 4].map((rollbackTokens) =>
      evaluatePassing({
        publications: passingRepetition().publications.map((publication) => ({
          ...publication,
          rollbackTokens,
        })),
      }),
    );
    expect(rollbacks[0].failures).not.toContain('volatile_rollback');
    expect(rollbacks[1].failures).not.toContain('volatile_rollback');
    expect(rollbacks[2].failures).toContain('volatile_rollback');

    const rss = [64, 63.999, 64.001].map((growth) => {
      const end = 1 + growth / (1024 * 3600);
      return evaluatePassing({
        peakRssGiB: end,
        preparedIdleRssGiB: 1,
        rssSamples: [
          { atSeconds: 0, rssGiB: 1 },
          { atSeconds: 1, rssGiB: end },
        ],
      });
    });
    expect(rss[0].failures).not.toContain('rss_growth');
    expect(rss[1].failures).not.toContain('rss_growth');
    expect(rss[2].failures).toContain('rss_growth');

    const thermal = (fairCount: number, nominalCount: number) =>
      Array.from({ length: nominalCount + fairCount }, (_, atSeconds) => ({
        atSeconds,
        state:
          atSeconds < nominalCount ? ('nominal' as const) : ('fair' as const),
      }));
    const thermalRuns = [
      evaluatePassing({ thermalSamples: thermal(301, 2709) }),
      evaluatePassing({ thermalSamples: thermal(300, 2700) }),
      evaluatePassing({ thermalSamples: thermal(302, 2718) }),
    ];
    expect(thermalRuns[0].failures).not.toContain('thermal_state');
    expect(thermalRuns[1].failures).not.toContain('thermal_state');
    expect(thermalRuns[2].failures).toContain('thermal_state');

    const proxy = (disagreement: number, recallRegression: number) =>
      evaluatePassing({
        proxy: {
          disagreementRate: 0.08 + disagreement,
          alignedRecall: 0.93 - recallRegression,
          mlxDisagreementRate: 0.08,
          mlxAlignedRecall: 0.93,
        },
      });
    expect(proxy(0.02, 0.02).failures).not.toContain('proxy_non_regression');
    expect(proxy(0.019, 0.019).failures).not.toContain('proxy_non_regression');
    expect(proxy(0.021, 0.021).failures).toContain('proxy_non_regression');

    const mlxLatency = (latency: number) =>
      evaluatePassing({
        publications: [
          {
            ...passingRepetition().publications[0],
            completedAtSeconds: 1 + latency,
          },
        ],
      });
    expect(mlxLatency(2).failures).not.toContain('first_text_regression');
    expect(mlxLatency(1.999).failures).not.toContain('first_text_regression');
    expect(mlxLatency(2.001).failures).toContain('first_text_regression');

    const mlxRuntime = (runtimeFactor: number) =>
      evaluatePassing({ inferenceSeconds: runtimeFactor * 4 });
    expect(mlxRuntime(0.3).failures).not.toContain('runtime_factor_regression');
    expect(mlxRuntime(0.299).failures).not.toContain(
      'runtime_factor_regression',
    );
    expect(mlxRuntime(0.301).failures).toContain('runtime_factor_regression');
  });

  it('returns a finite unavailable verdict when publication or sampling evidence is empty', () => {
    const verdict = evaluatePassing({
      publications: [],
      captureHandoffMilliseconds: [],
      rssSamples: [],
      thermalSamples: [],
    });

    expect(verdict.status).toBe('unavailable');
    expect(verdict.failures).toEqual(
      expect.arrayContaining([
        'first_text_missing',
        'resource_evidence_unavailable',
      ]),
    );
    expect(
      Object.values(verdict.metrics).every(
        (value) => typeof value !== 'number' || Number.isFinite(value),
      ),
    ).toBe(true);
  });
});

describe('live replay report privacy', () => {
  it('builds the exact allowlisted content-free report shape', () => {
    const verdict = evaluatePassing();
    const report = buildPrivateLiveReplayReport({
      corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 92 },
      runtime: {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'low-latency-v1',
      },
      mlxProduction: verdict,
      parakeetSliding: verdict,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.corpus.audioMinutesRoundedTo5).toBe(90);
    expect(report.referencePolicy.batchParakeet).toBe(
      'consistency_diagnostic_not_ground_truth',
    );
    expect(report.engines.parakeetSliding.status).toBe('pass');
    expect(() => sanitizeLiveReplayReport(report)).not.toThrow();
  });

  it.each([
    { transcript: 'private' },
    { audioPath: '/private/a.wav' },
    { meetings: [{}] },
    { safe: { TokenText: 'private' } },
    { safe: [{ stderr: 'private' }] },
    { safe: { identity: 'private' } },
    { safe: { recordingPath: '/private/a.wav' } },
    { safe: { tentativeText: 'private' } },
  ])('refuses unsafe report fields recursively: $unsafe', (unsafe) => {
    expect(() => sanitizeLiveReplayReport(unsafe)).toThrow(
      'private_report_field',
    );
  });

  it('rejects arbitrary fields, strings, non-finite numbers, and mutation after sanitizing', () => {
    const report = buildPrivateLiveReplayReport({
      corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
      runtime: {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'low-latency-v1',
      },
      mlxProduction: evaluatePassing(),
      parakeetSliding: evaluatePassing(),
    });
    expect(() =>
      sanitizeLiveReplayReport({ ...report, arbitrary: true }),
    ).toThrow('private_report_field');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        runtime: { ...report.runtime, modelId: '/private/model' },
      }),
    ).toThrow('private_report_value');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        corpus: {
          ...report.corpus,
          audioMinutesRoundedTo5: Number.POSITIVE_INFINITY,
        },
      }),
    ).toThrow('private_report_value');

    const sanitized = sanitizeLiveReplayReport(report);
    report.runtime.configId = 'changed';
    expect(sanitized.runtime.configId).toBe('low-latency-v1');
  });

  it('rejects incomplete schemas, invalid pins, negative corpus values, and inconsistent pass reports', () => {
    const verdict = evaluatePassing();
    const report = buildPrivateLiveReplayReport({
      corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
      runtime: {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'pinned-default-v1',
      },
      mlxProduction: verdict,
      parakeetSliding: verdict,
    });
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        engines: {
          ...report.engines,
          mlxProduction: { status: 'pass', metrics: {} },
        },
      }),
    ).toThrow('private_report_field');
    expect(() =>
      sanitizeLiveReplayReport({ ...report, invariants: {} }),
    ).toThrow('private_report_field');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        corpus: { ...report.corpus, meetingCount: -1 },
      }),
    ).toThrow('private_report_value');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        runtime: { ...report.runtime, fluidAudioRevision: 'SecretWords' },
      }),
    ).toThrow('private_report_value');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        failures: ['first_text_p50'],
      }),
    ).toThrow('private_report_consistency');
  });

  it.each([
    { fluidAudioVersion: '0.15.6' },
    { fluidAudioRevision: '29600a485baa4998812e4654b70d2bab8f2c9949' },
  ])(
    'rejects plausible but unapproved FluidAudio pins: $runtime',
    (runtime) => {
      const verdict = evaluatePassing();
      expect(() =>
        buildPrivateLiveReplayReport({
          corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
          runtime: {
            fluidAudioVersion: '0.15.5',
            fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
            modelId: 'parakeet-tdt-0.6b-v3',
            configId: 'pinned-default-v1',
            ...runtime,
          },
          mlxProduction: verdict,
          parakeetSliding: verdict,
        }),
      ).toThrow('private_report_value');
    },
  );

  it('requires PASS corpus minima and exact dual-source consistency', () => {
    const verdict = evaluatePassing();
    for (const corpus of [
      { meetingCount: 0, sourceCount: 0, audioMinutes: 0 },
      { meetingCount: 2, sourceCount: 6, audioMinutes: 90 },
      { meetingCount: 3, sourceCount: 5, audioMinutes: 90 },
      { meetingCount: 3, sourceCount: 6, audioMinutes: 89 },
      { meetingCount: 4, sourceCount: 6, audioMinutes: 90 },
    ]) {
      expect(() =>
        buildPrivateLiveReplayReport({
          corpus,
          runtime: {
            fluidAudioVersion: '0.15.5',
            fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
            modelId: 'parakeet-tdt-0.6b-v3',
            configId: 'pinned-default-v1',
          },
          mlxProduction: verdict,
          parakeetSliding: verdict,
        }),
      ).toThrow('private_report_consistency');
    }
  });

  it('requires an unavailable reason exactly when at least one engine is unavailable', () => {
    const pass = evaluatePassing();
    const unavailable = {
      ...pass,
      status: 'unavailable' as const,
      failures: ['dependency_unavailable'],
    };
    const base = buildPrivateLiveReplayReport({
      corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
      runtime: {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'pinned-default-v1',
      },
      mlxProduction: unavailable,
      parakeetSliding: pass,
    });
    expect(() => sanitizeLiveReplayReport(base)).not.toThrow();
    expect(() => sanitizeLiveReplayReport({ ...base, failures: [] })).toThrow(
      'private_report_consistency',
    );
    expect(() =>
      sanitizeLiveReplayReport({
        ...base,
        engines: {
          mlxProduction: { ...base.engines.mlxProduction, status: 'pass' },
          parakeetSliding: { ...base.engines.parakeetSliding, status: 'pass' },
        },
      }),
    ).toThrow('private_report_consistency');

    expect(() =>
      buildPrivateLiveReplayReport({
        corpus: { meetingCount: 0, sourceCount: 0, audioMinutes: 0 },
        runtime: {
          fluidAudioVersion: '0.15.5',
          fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
          modelId: 'parakeet-tdt-0.6b-v3',
          configId: 'pinned-default-v1',
        },
        mlxProduction: {
          ...unavailable,
          failures: ['insufficient_corpus'],
        },
        parakeetSliding: {
          ...unavailable,
          failures: ['insufficient_corpus'],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ['pass/fail', true],
    ['fail/fail', false],
  ] as const)(
    'rejects insufficient corpus with $label engine statuses in builder and sanitizer',
    (_label, includePass) => {
      const pass = evaluatePassing();
      const fail = evaluatePassing({ seamDuplicateTokens: 1 });
      const runtime = {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'pinned-default-v1',
      } as const;
      expect(() =>
        buildPrivateLiveReplayReport({
          corpus: { meetingCount: 2, sourceCount: 4, audioMinutes: 60 },
          runtime,
          mlxProduction: includePass ? pass : fail,
          parakeetSliding: fail,
        }),
      ).toThrow('private_report_consistency');

      const eligible = buildPrivateLiveReplayReport({
        corpus: { meetingCount: 3, sourceCount: 6, audioMinutes: 90 },
        runtime,
        mlxProduction: includePass ? pass : fail,
        parakeetSliding: fail,
      });
      expect(() =>
        sanitizeLiveReplayReport({
          ...eligible,
          corpus: {
            meetingCount: 2,
            sourceCount: 4,
            audioMinutesRoundedTo5: 60,
          },
        }),
      ).toThrow('private_report_consistency');
    },
  );

  it('requires insufficient corpus to serialize unavailable status and its exact reason', () => {
    const pass = evaluatePassing();
    const unavailable = {
      ...pass,
      status: 'unavailable' as const,
      failures: ['dependency_unavailable'],
    };
    const report = buildPrivateLiveReplayReport({
      corpus: { meetingCount: 0, sourceCount: 0, audioMinutes: 0 },
      runtime: {
        fluidAudioVersion: '0.15.5',
        fluidAudioRevision: '19600a485baa4998812e4654b70d2bab8f2c9949',
        modelId: 'parakeet-tdt-0.6b-v3',
        configId: 'pinned-default-v1',
      },
      mlxProduction: {
        ...unavailable,
        failures: ['insufficient_corpus'],
      },
      parakeetSliding: {
        ...unavailable,
        failures: ['insufficient_corpus'],
      },
    });
    expect(() => sanitizeLiveReplayReport(report)).not.toThrow();
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        failures: ['dependency_unavailable'],
      }),
    ).toThrow('private_report_consistency');
    expect(() =>
      sanitizeLiveReplayReport({
        ...report,
        engines: {
          mlxProduction: { ...report.engines.mlxProduction, status: 'fail' },
          parakeetSliding: {
            ...report.engines.parakeetSliding,
            status: 'fail',
          },
        },
      }),
    ).toThrow('private_report_consistency');
  });
});
