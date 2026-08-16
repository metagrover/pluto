import { describe, expect, it } from 'vitest';

import {
  type CausalReplayFrame,
  runCausalReplay,
} from '../../src/services/liveTranscriptionReplay';
import {
  LIVE_REPLAY_THRESHOLDS,
  type LiveReplayRepetition,
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
      completedAtSeconds: 3,
      audioEndSeconds: 2,
      changed: true,
      newTokenCount: 2,
      rollbackTokens: 0,
      revisionAgeSeconds: 0,
    },
    {
      availableAtSeconds: 4,
      completedAtSeconds: 5,
      audioEndSeconds: 4,
      changed: true,
      newTokenCount: 2,
      rollbackTokens: 0,
      revisionAgeSeconds: 0,
    },
  ],
  committedSnapshots: ['one two', 'one two three'],
  acceptedSequences: [0, 1],
  processedSequences: [0, 1],
  expectedSourceSeconds: 4,
  processedSourceSeconds: 4,
  inferenceSeconds: 1,
  seamDuplicateTokens: 0,
  seamOmittedTokens: 0,
  seamReferenceTokens: 10,
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
  peakRssGiB: 2.5,
  preparedIdleRssGiB: 1,
  rssSamples: [
    { atSeconds: 0, rssGiB: 1 },
    { atSeconds: 3600, rssGiB: 1.0625 },
  ],
  thermalSamples: Array.from({ length: 10 }, (_, index) => ({
    atSeconds: index * 60,
    state: index === 0 ? ('fair' as const) : ('nominal' as const),
  })),
  captureHandoffMilliseconds: [1, 5, 10],
  wholeSessionAsrCalls: 0,
  analysisBeforeCanonicalCommit: 0,
  ...overrides,
});

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
        [{ sequence: 0, availableAtSeconds: 1, audioEndSeconds: 1 }],
        async () => ({
          completedAtSeconds: 1.1,
          observedAudioEndSeconds: 1.01,
        }),
      ),
    ).rejects.toThrow('causal_replay_future_audio');

    await expect(
      runCausalReplay(
        [
          { sequence: 0, availableAtSeconds: 1, audioEndSeconds: 1 },
          { sequence: 0, availableAtSeconds: 2, audioEndSeconds: 2 },
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
          { sequence: 0, availableAtSeconds: 2, audioEndSeconds: 1 },
          { sequence: 1, availableAtSeconds: 1, audioEndSeconds: 1 },
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
        [{ sequence: 0, availableAtSeconds: 1, audioEndSeconds: 1 }],
        async () => ({
          completedAtSeconds: 0.9,
          observedAudioEndSeconds: 1,
        }),
      ),
    ).rejects.toThrow('causal_replay_completion_clock');
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
    const verdict = evaluateLiveReplay([
      passingRepetition({ committedSnapshots: ['one two', 'one x'] }),
    ]);

    expect(verdict.invariants.committedPrefixViolations).toBe(1);
    expect(verdict.status).toBe('fail');
  });

  it('derives first text from first sealed activity and cadence from changed publications', () => {
    const verdict = evaluateLiveReplay([passingRepetition()]);

    expect(verdict.metrics.firstTextP50Seconds).toBe(2);
    expect(verdict.metrics.publicationCadenceP50Seconds).toBe(2);
    expect(verdict.metrics.processingLatencyP95Seconds).toBe(1);
    expect(verdict.status).toBe('pass');
  });

  it('counts missing accepted sequences and requires exact source coverage', () => {
    const verdict = evaluateLiveReplay([
      passingRepetition({
        acceptedSequences: [0, 1, 2],
        processedSequences: [0, 2],
        processedSourceSeconds: 3.999,
      }),
    ]);

    expect(verdict.invariants.missingAcceptedSequences).toBe(1);
    expect(verdict.metrics.sourceCoverage).toBeCloseTo(0.99975);
    expect(verdict.status).toBe('fail');
  });

  it('tests exact, inside, and outside first-text boundaries', () => {
    const exact = evaluateLiveReplay([
      passingRepetition({
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds: 5,
            completedAtSeconds: 6,
          },
        ],
      }),
    ]);
    const inside = evaluateLiveReplay([
      passingRepetition({
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds - 0.001,
            completedAtSeconds:
              1 + LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds - 0.001,
          },
        ],
      }),
    ]);
    const outside = evaluateLiveReplay([
      passingRepetition({
        publications: [
          {
            ...passingRepetition().publications[0],
            availableAtSeconds:
              LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds + 0.001,
            completedAtSeconds:
              1 + LIVE_REPLAY_THRESHOLDS.firstTextP50Seconds + 0.001,
          },
        ],
      }),
    ]);

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
          completedAtSeconds: 5,
        },
      ],
    });
    const slow = passingRepetition({
      publications: [
        {
          ...passingRepetition().publications[0],
          availableAtSeconds: 6,
          completedAtSeconds: 7,
        },
      ],
    });

    const verdict = evaluateLiveReplay([fast, slow]);

    expect(verdict.metrics.firstTextP50Seconds).toBe(5);
    expect(verdict.metrics.firstTextP50Upper95Seconds).toBeGreaterThan(5);
    expect(verdict.failures).toContain('first_text_p50');
  });

  it('enforces Parakeet latency and RTF non-regression against MLX', () => {
    const exact = evaluateLiveReplay([passingRepetition()], {
      mlxBaseline: { firstTextP95Seconds: 1, runtimeFactor: 0.25 },
    });
    const outside = evaluateLiveReplay([passingRepetition()], {
      mlxBaseline: { firstTextP95Seconds: 0.999, runtimeFactor: 0.2 },
    });

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
    const verdict = evaluateLiveReplay([
      passingRepetition({
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
          { atSeconds: 0, rssGiB: 1 },
          { atSeconds: 3600, rssGiB: 1.063 },
        ],
        thermalSamples: [{ atSeconds: 0, state: 'serious' }],
        captureHandoffMilliseconds: [10.01],
      }),
    ]);

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
    const verdict = evaluateLiveReplay([
      passingRepetition({
        rssSamples: [
          { atSeconds: 0, rssGiB: 1 },
          { atSeconds: 2_700, rssGiB: 2 },
          { atSeconds: 3_600, rssGiB: 1 },
        ],
      }),
    ]);

    expect(verdict.metrics.rssGrowthMiBPerHourMaximum).toBeGreaterThan(64);
    expect(verdict.failures).toContain('rss_growth');
  });

  it('cannot pass without sufficient corpus, AEC, or resource evidence', () => {
    const verdict = evaluateLiveReplay([passingRepetition()], {
      corpusEligible: false,
      aecEvidenceAvailable: false,
      resourceEvidenceAvailable: false,
    });

    expect(verdict.status).toBe('unavailable');
    expect(verdict.failures).toEqual([
      'insufficient_corpus',
      'dependency_unavailable',
      'resource_evidence_unavailable',
    ]);
  });

  it('returns a finite unavailable verdict when publication or sampling evidence is empty', () => {
    const verdict = evaluateLiveReplay([
      passingRepetition({
        publications: [],
        captureHandoffMilliseconds: [],
        rssSamples: [],
        thermalSamples: [],
      }),
    ]);

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
    const verdict = evaluateLiveReplay([passingRepetition()]);
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
        fluidAudioRevision: 'revision',
        modelId: 'model',
        configId: 'config',
      },
      mlxProduction: evaluateLiveReplay([passingRepetition()]),
      parakeetSliding: evaluateLiveReplay([passingRepetition()]),
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
    expect(sanitized.runtime.configId).toBe('config');
  });
});
