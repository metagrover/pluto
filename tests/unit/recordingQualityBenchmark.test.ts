import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type CandidateEligibilityFixture,
  type RecordingQualityBenchmarkCaseResult,
  buildRecordingQualityBenchmarkComparisonSummary,
  buildRecordingQualityBenchmarkReport,
  evaluateCandidateDistributionEligibility,
  loadRecordingQualityBenchmarkManifest,
  measureRecordingQualityBenchmarkCase,
  parseRecordingQualityBenchmarkCliArgs,
  runCandidateEligibilityBenchmarkCase,
  runCaptureRecoveryBenchmarkCase,
  runRetryValidationBenchmarkCase,
  selectRecordingQualityBenchmarkCases,
} from '../../src/services/recordingQualityBenchmark';

const passingBenchmarkResult = (): RecordingQualityBenchmarkCaseResult => ({
  id: 'measurement-case',
  issue: 532,
  title: 'Measurement case',
  kind: 'recording_finalization',
  passed: true,
  actual: { status: 'validated' },
  expected: { status: 'validated' },
});

describe('measurement envelope', () => {
  it('collects normalized process evidence and clears sampling', async () => {
    const clock = [10.2, 12.1];
    const cpu = [
      { user: 100, system: 50 },
      { user: 325, system: 75 },
    ];
    const rss = [100.2, 140.8, 120.1];
    let cleared = false;

    const result = await measureRecordingQualityBenchmarkCase(
      async () => passingBenchmarkResult(),
      {
        monotonicNow: () => clock.shift() ?? 0,
        cpuUsage: () => cpu.shift() ?? { user: 0, system: 0 },
        rssBytes: () => rss.shift() ?? 0,
        startInterval: (sample) => {
          sample();
          return 17;
        },
        clearInterval: (handle) => {
          expect(handle).toBe(17);
          cleared = true;
        },
        samplingIntervalMs: 10,
      },
    );

    expect(cleared).toBe(true);
    expect(result.measurements).toEqual({
      elapsedTime: {
        status: 'available',
        value: 2,
        unit: 'milliseconds',
        stability: 'hardware_dependent',
        method: 'monotonic_elapsed',
      },
      cpuTime: {
        status: 'available',
        value: 250,
        unit: 'microseconds',
        stability: 'hardware_dependent',
        method: 'process_cpu_delta',
      },
      peakRss: {
        status: 'available',
        value: 141,
        unit: 'bytes',
        stability: 'hardware_dependent',
        method: 'sampled_process_rss',
      },
      artifactBytes: {
        status: 'unavailable',
        reason: 'not_applicable',
      },
    });
  });

  it('keeps functional failures and marks invalid readings unavailable', async () => {
    const functionalFailure = {
      ...passingBenchmarkResult(),
      passed: false,
      failures: ['expected functional failure'],
    };

    const result = await measureRecordingQualityBenchmarkCase(
      async () => functionalFailure,
      {
        monotonicNow: (() => {
          const values = [5, 4];
          return () => values.shift() ?? 0;
        })(),
        cpuUsage: (() => {
          const values = [
            { user: 20, system: 20 },
            { user: 10, system: 10 },
          ];
          return () => values.shift() ?? { user: 0, system: 0 };
        })(),
        rssBytes: () => Number.NaN,
        startInterval: () => 1,
        clearInterval: () => undefined,
        samplingIntervalMs: 10,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(['expected functional failure']);
    expect(result.measurements).toEqual({
      elapsedTime: { status: 'unavailable', reason: 'collection_failed' },
      cpuTime: { status: 'unavailable', reason: 'collection_failed' },
      peakRss: { status: 'unavailable', reason: 'collection_failed' },
      artifactBytes: { status: 'unavailable', reason: 'not_applicable' },
    });
  });
});

describe('parseRecordingQualityBenchmarkCliArgs', () => {
  it('accepts pnpm passthrough separators and explicit output paths', () => {
    expect(
      parseRecordingQualityBenchmarkCliArgs(
        ['--', '--out', 'tmp/recording-quality-benchmark.json'],
        '/repo',
        123,
      ),
    ).toEqual({
      manifest: '/repo/scripts/recording-quality/manifest.json',
      out: 'tmp/recording-quality-benchmark.json',
      tier: 'pr',
    });
  });

  it('accepts explicit manual and all tier selectors', () => {
    expect(
      parseRecordingQualityBenchmarkCliArgs(['--tier', 'manual'], '/repo', 123)
        .tier,
    ).toBe('manual');
    expect(
      parseRecordingQualityBenchmarkCliArgs(['--tier', 'all'], '/repo', 123)
        .tier,
    ).toBe('all');
    expect(() =>
      parseRecordingQualityBenchmarkCliArgs(
        ['--tier', 'nightly'],
        '/repo',
        123,
      ),
    ).toThrow(/unsupported benchmark tier: nightly/i);
  });
});

describe('loadRecordingQualityBenchmarkManifest', () => {
  it('accepts schema versions 2 and 3 and rejects unknown versions', () => {
    const baseManifest = {
      baselineReport: 'baselines/current-master.json',
      cases: [
        {
          id: 'schema-case',
          issue: 532,
          title: 'Schema case',
          kind: 'recording_finalization',
          fixture: 'fixtures/schema.json',
          tier: 'pr',
        },
      ],
    };

    expect(
      loadRecordingQualityBenchmarkManifest({
        ...baseManifest,
        schemaVersion: 2,
      }).schemaVersion,
    ).toBe(2);
    expect(
      loadRecordingQualityBenchmarkManifest({
        ...baseManifest,
        schemaVersion: 3,
      }).schemaVersion,
    ).toBe(3);
    expect(() =>
      loadRecordingQualityBenchmarkManifest({
        ...baseManifest,
        schemaVersion: 4,
      }),
    ).toThrow(/unsupported.*schema.*4/i);
  });

  it('rejects stable machine-dependent measurement declarations', () => {
    expect(() =>
      loadRecordingQualityBenchmarkManifest({
        schemaVersion: 3,
        baselineReport: 'baselines/current-master.json',
        cases: [
          {
            id: 'invalid-stability',
            issue: 532,
            title: 'Invalid stability',
            kind: 'recording_finalization',
            fixture: 'fixtures/invalid.json',
            tier: 'pr',
            trackedMetrics: [
              {
                name: 'measurements.elapsedTime',
                tolerance: 1,
                stability: 'stable',
              },
            ],
          },
        ],
      }),
    ).toThrow(/elapsedTime.*hardware_dependent/i);
  });

  it('loads committed benchmark cases and rejects duplicate ids', () => {
    const manifest = loadRecordingQualityBenchmarkManifest({
      schemaVersion: 1,
      baselineReport: 'baselines/current-master.json',
      cases: [
        {
          id: 'issue-476-credential-free-distribution',
          issue: 476,
          title: 'Credential-free distribution metadata gate',
          kind: 'candidate_eligibility',
          fixture: 'fixtures/issue-476-credential-free-distribution.json',
          tier: 'pr',
        },
        {
          id: 'issue-25-opening-audio',
          issue: 25,
          title: 'Opening audio is preserved',
          kind: 'transcript_validation',
          fixture: 'fixtures/issue-25-opening-audio.json',
          tier: 'pr',
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.cases[0]).toMatchObject({
      id: 'issue-476-credential-free-distribution',
      issue: 476,
      kind: 'candidate_eligibility',
      tier: 'pr',
    });
    expect(manifest.cases[1]).toMatchObject({
      id: 'issue-25-opening-audio',
      issue: 25,
      kind: 'transcript_validation',
      tier: 'pr',
    });

    expect(() =>
      loadRecordingQualityBenchmarkManifest({
        schemaVersion: 1,
        baselineReport: 'baselines/current-master.json',
        cases: [
          {
            id: 'duplicate-case',
            issue: 25,
            title: 'First copy',
            kind: 'transcript_validation',
            fixture: 'fixtures/one.json',
            tier: 'pr',
          },
          {
            id: 'duplicate-case',
            issue: 75,
            title: 'Second copy',
            kind: 'recording_finalization',
            fixture: 'fixtures/two.json',
            tier: 'pr',
          },
        ],
      }),
    ).toThrow(/duplicate benchmark case id/i);
  });

  it('accepts retry-validation benchmark cases', () => {
    const manifest = loadRecordingQualityBenchmarkManifest({
      schemaVersion: 1,
      baselineReport: 'baselines/current-master.json',
      cases: [
        {
          id: 'issue-458-missing-retry-evidence',
          issue: 458,
          title: 'Missing deterministic retry evidence fails closed',
          kind: 'retry_validation',
          fixture: 'fixtures/issue-458-missing-retry-evidence.json',
          tier: 'pr',
        },
      ],
    });

    expect(manifest.cases[0]).toMatchObject({
      id: 'issue-458-missing-retry-evidence',
      issue: 458,
      kind: 'retry_validation',
    });
  });

  it('accepts capture-recovery benchmark cases', () => {
    const manifest = loadRecordingQualityBenchmarkManifest({
      schemaVersion: 1,
      baselineReport: 'baselines/current-master.json',
      cases: [
        {
          id: 'issue-493-capture-recovery',
          issue: 493,
          title: 'Interrupted capture journals recover acknowledged evidence',
          kind: 'capture_recovery',
          fixture: 'fixtures/issue-493-capture-recovery.json',
          tier: 'pr',
        },
      ],
    });

    expect(manifest.cases[0]).toMatchObject({
      id: 'issue-493-capture-recovery',
      issue: 493,
      kind: 'capture_recovery',
      tier: 'pr',
    });
  });

  it('loads tracked metrics with tolerance and stability rules', () => {
    const manifest = loadRecordingQualityBenchmarkManifest({
      schemaVersion: 1,
      baselineReport: 'baselines/current-master.json',
      cases: [
        {
          id: 'issue-75-finalization-single-flight',
          issue: 75,
          title: 'Finalization stays single-flight',
          kind: 'recording_finalization',
          fixture: 'fixtures/issue-75-finalization-single-flight.json',
          tier: 'pr',
          trackedMetrics: [
            {
              name: 'durationSeconds',
              tolerance: 3,
              stability: 'hardware_dependent',
            },
          ],
        },
      ],
    });

    expect(manifest.cases[0].trackedMetrics).toEqual([
      {
        name: 'durationSeconds',
        tolerance: 3,
        stability: 'hardware_dependent',
      },
    ]);
  });

  it('requires every case to declare a supported tier', () => {
    const baseCase = {
      id: 'tiered-case',
      issue: 495,
      title: 'Tiered benchmark case',
      kind: 'transcript_validation',
      fixture: 'fixtures/tiered.json',
    };

    expect(() =>
      loadRecordingQualityBenchmarkManifest({
        schemaVersion: 2,
        baselineReport: 'baselines/current-master.json',
        cases: [baseCase],
      }),
    ).toThrow(/tiered-case needs a benchmark tier/i);
    expect(() =>
      loadRecordingQualityBenchmarkManifest({
        schemaVersion: 2,
        baselineReport: 'baselines/current-master.json',
        cases: [{ ...baseCase, tier: 'nightly' }],
      }),
    ).toThrow(/unsupported benchmark tier: nightly/i);
  });
});

describe('selectRecordingQualityBenchmarkCases', () => {
  const cases = [
    {
      id: 'fast',
      issue: 495,
      title: 'Fast case',
      kind: 'transcript_validation' as const,
      fixture: 'fixtures/fast.json',
      tier: 'pr' as const,
    },
    {
      id: 'long',
      issue: 495,
      title: 'Long case',
      kind: 'recording_finalization' as const,
      fixture: 'fixtures/long.json',
      tier: 'manual' as const,
    },
  ];

  it('selects PR, manual, and all cases without mixing tiers', () => {
    expect(selectRecordingQualityBenchmarkCases(cases, 'pr')).toEqual([
      cases[0],
    ]);
    expect(selectRecordingQualityBenchmarkCases(cases, 'manual')).toEqual([
      cases[1],
    ]);
    expect(selectRecordingQualityBenchmarkCases(cases, 'all')).toEqual(cases);
  });

  it('fails clearly when the selected tier is empty', () => {
    expect(() =>
      selectRecordingQualityBenchmarkCases([cases[0]], 'manual'),
    ).toThrow(/no manual benchmark cases/i);
  });
});

describe('runRetryValidationBenchmarkCase', () => {
  it('reports missing deterministic evidence as needs_attention', async () => {
    const result = await runRetryValidationBenchmarkCase(
      {
        id: 'issue-458-missing-retry-evidence',
        issue: 458,
        title: 'Missing deterministic retry evidence fails closed',
        kind: 'retry_validation',
        fixture: 'fixtures/issue-458-missing-retry-evidence.json',
        tier: 'pr',
      },
      {
        type: 'retry_validation',
        meeting: {
          id: 'retry-missing',
          title: 'Meeting',
          created_at: '2026-07-15T00:00:00.000Z',
          started_at: '2026-07-15T00:00:00.000Z',
          duration_seconds: 60,
          audio_path: '/synthetic/mic.wav',
          system_audio_path: '/synthetic/system.wav',
          mixed_audio_path: '/synthetic/mix.wav',
          transcript_status: 'needs_attention',
          transcript_json: JSON.stringify({
            segments: [
              { start: 0, end: 2, text: 'Sparse provisional local text.' },
            ],
          }),
          transcript_integrity_json: JSON.stringify({
            activityEvidenceSource: 'capture_activity_v1',
          }),
        },
        transcribeByPath: {
          '/synthetic/mic.wav': {
            segments: [
              { start: 0, end: 2, text: 'Sparse provisional local text.' },
            ],
          },
          '/synthetic/system.wav': { segments: [] },
          '/synthetic/mix.wav': {
            segments: [
              { start: 0, end: 2, text: 'Sparse provisional local text.' },
            ],
          },
        },
        probeDurationByPath: {
          '/synthetic/mic.wav': 60,
          '/synthetic/system.wav': 60,
          '/synthetic/mix.wav': 60,
        },
        expected: {
          status: 'needs_attention',
          requiredReasons: ['deterministic_retry_evidence_missing'],
          primaryMetric: {
            name: 'activityEvidenceSource',
            value: 'capture_activity_missing',
          },
        },
      },
    );

    expect(result.passed).toBe(true);
    expect(result.actual).toMatchObject({
      status: 'needs_attention',
      primaryMetric: {
        name: 'activityEvidenceSource',
        value: 'capture_activity_missing',
      },
      reasons: expect.arrayContaining(['deterministic_retry_evidence_missing']),
    });
  });
});

describe('evaluateCandidateDistributionEligibility', () => {
  it('rejects candidates that require credentials, manual terms, mutable artifacts, or unsupported platforms', () => {
    expect(
      evaluateCandidateDistributionEligibility(
        {
          candidateId: 'hf-community-one',
          acquisitionMode: 'external_hub_download',
          licenseId: 'mit',
          supportedPlatforms: ['linux-x64'],
          requiresUserCredentials: true,
          requiresManualTermsAcceptance: true,
          artifactChecksumSha256: '',
        },
        'darwin-arm64',
      ),
    ).toEqual({
      eligible: false,
      reasons: [
        'requires_user_credentials',
        'requires_manual_terms_acceptance',
        'artifact_not_pinned',
        'unsupported_platform',
        'non_pluto_distribution_channel',
      ],
    });
  });
});

describe('runCandidateEligibilityBenchmarkCase', () => {
  it('returns a deterministic eligibility verdict and redacted reasons', () => {
    const fixture: CandidateEligibilityFixture = {
      type: 'candidate_eligibility',
      candidate: {
        candidateId: 'whisperkit-bundle',
        acquisitionMode: 'bundled',
        licenseId: 'apache-2.0',
        supportedPlatforms: ['darwin-arm64'],
        requiresUserCredentials: false,
        requiresManualTermsAcceptance: false,
        artifactChecksumSha256:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      expected: {
        status: 'validated',
        eligibility: {
          eligible: true,
          reasons: [],
        },
      },
    };

    expect(
      runCandidateEligibilityBenchmarkCase(
        {
          id: 'issue-476-credential-free-distribution',
          issue: 476,
          title: 'Credential-free distribution metadata gate',
          kind: 'candidate_eligibility',
          fixture: 'fixtures/issue-476-credential-free-distribution.json',
        },
        fixture,
        'darwin-arm64',
      ),
    ).toMatchObject({
      passed: true,
      actual: {
        status: 'validated',
        eligibility: {
          eligible: true,
          reasons: [],
        },
      },
    });
  });
});

describe('runCaptureRecoveryBenchmarkCase', () => {
  it('recovers both sources while excluding and reporting a corrupt tail', async () => {
    const result = await runCaptureRecoveryBenchmarkCase(
      {
        id: 'issue-493-capture-recovery',
        issue: 493,
        title: 'Interrupted capture journals recover acknowledged evidence',
        kind: 'capture_recovery',
        fixture: 'fixtures/issue-493-capture-recovery.json',
        tier: 'pr',
      },
      {
        type: 'capture_recovery',
        meetingId: 'synthetic-recovery-case',
        startedAtMs: 1_000,
        chunks: [
          {
            source: 'mic',
            sequence: 0,
            startSec: 0,
            endSec: 2,
            data: 'synthetic-mic-0',
          },
          {
            source: 'mic',
            sequence: 1,
            startSec: 2,
            endSec: 4,
            data: 'synthetic-mic-1',
          },
          {
            source: 'system',
            sequence: 0,
            startSec: 0,
            endSec: 2,
            data: 'synthetic-system-0',
          },
          {
            source: 'system',
            sequence: 1,
            startSec: 2,
            endSec: 4,
            data: 'synthetic-system-1',
          },
        ],
        corruptAfterJournal: {
          source: 'mic',
          sequence: 1,
          replacementData: 'synthetic-mic-x',
        },
        expected: {
          status: 'needs_attention',
          requiredRecoveredSources: ['mic', 'system'],
          requiredReasons: ['checksum_mismatch:mic:1'],
          primaryMetric: {
            name: 'recoveredChunkRatio',
            value: 0.75,
          },
        },
      },
    );

    expect(result.passed).toBe(true);
    expect(result.measurements?.artifactBytes).toEqual({
      status: 'available',
      value: 51,
      unit: 'bytes',
      stability: 'stable',
      method: 'case_artifact_sum',
    });
    expect(JSON.stringify(result)).not.toContain('pluto-recording-quality');
    expect(result.actual).toEqual({
      status: 'needs_attention',
      primaryMetric: {
        name: 'recoveredChunkRatio',
        value: 0.75,
      },
      reasons: ['checksum_mismatch:mic:1'],
    });
  });
});

describe('buildRecordingQualityBenchmarkReport', () => {
  it('summarizes passed and failed committed regression cases', () => {
    const results: RecordingQualityBenchmarkCaseResult[] = [
      {
        id: 'issue-476-credential-free-distribution',
        issue: 476,
        title: 'Credential-free distribution metadata gate',
        kind: 'candidate_eligibility',
        passed: true,
        actual: {
          status: 'validated',
          eligibility: {
            eligible: true,
            reasons: [],
          },
        },
        expected: {
          status: 'validated',
          eligibility: {
            eligible: true,
            reasons: [],
          },
        },
      },
      {
        id: 'issue-25-opening-audio',
        issue: 25,
        title: 'Opening audio is preserved',
        kind: 'transcript_validation',
        passed: true,
        actual: {
          status: 'validated',
          primaryMetric: {
            name: 'localTranscriptCoveredSeconds',
            value: 12,
          },
        },
        expected: {
          status: 'validated',
        },
      },
      {
        id: 'issue-434-overlap-union',
        issue: 434,
        title: 'Overlapping transcript coverage uses a union',
        kind: 'transcript_validation',
        passed: false,
        actual: {
          status: 'validated',
          primaryMetric: {
            name: 'localTranscriptCoveredSeconds',
            value: 10,
          },
        },
        expected: {
          status: 'needs_attention',
          primaryMetric: {
            name: 'localTranscriptCoveredSeconds',
            value: 6,
          },
        },
        failures: [
          'status mismatch',
          'covered seconds exceeded expected union',
        ],
      },
      {
        id: 'issue-75-finalization-single-flight',
        issue: 75,
        title: 'Finalization is single-flight',
        kind: 'recording_finalization',
        passed: true,
        actual: {
          status: 'validated',
          primaryMetric: {
            name: 'durationSeconds',
            value: 1062,
          },
        },
        expected: {
          status: 'validated',
        },
      },
    ];

    const report = buildRecordingQualityBenchmarkReport({
      schemaVersion: 1,
      manifestPath: '/tmp/manifest.json',
      baselineReportPath: '/tmp/baselines/current-master.json',
      generatedAt: '2026-07-15T20:00:00.000Z',
      environment: {
        nodeVersion: 'v24.11.0',
        platform: 'darwin',
        arch: 'arm64',
      },
      sourceCommit: '026bdcf6',
      tier: 'pr',
      results,
    });

    expect(report.summary).toMatchObject({
      totalCases: 4,
      passedCases: 3,
      failedCases: 1,
      passRate: 0.75,
    });
    expect(report.tier).toBe('pr');
    expect(report.summary.issueCoverage).toEqual([25, 75, 434, 476]);
    expect(report.summary.kinds).toEqual({
      candidate_eligibility: { passed: 1, failed: 0 },
      capture_recovery: { passed: 0, failed: 0 },
      recording_finalization: { passed: 1, failed: 0 },
      retry_validation: { passed: 0, failed: 0 },
      transcript_validation: { passed: 1, failed: 1 },
    });
    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'issue-434-overlap-union',
        failures: [
          'status mismatch',
          'covered seconds exceeded expected union',
        ],
      }),
    ]);
    expect(report.comparisonSummary).toEqual({
      stableRegressions: 0,
      stableImprovements: 0,
      stableWithinTolerance: 0,
      hardwareDependentDrift: 0,
      missingBaselineMetrics: 0,
    });
  });
});

describe('buildRecordingQualityBenchmarkComparisonSummary', () => {
  it('compares stable artifact measurements and leaves missing v2 evidence visible', () => {
    const measuredResult: RecordingQualityBenchmarkCaseResult = {
      ...passingBenchmarkResult(),
      trackedMetrics: [
        {
          name: 'measurements.artifactBytes',
          tolerance: 0,
          stability: 'stable',
        },
      ],
      measurements: {
        elapsedTime: { status: 'unavailable', reason: 'collection_failed' },
        cpuTime: { status: 'unavailable', reason: 'collection_failed' },
        peakRss: { status: 'unavailable', reason: 'collection_failed' },
        artifactBytes: {
          status: 'available',
          value: 51,
          unit: 'bytes',
          stability: 'stable',
          method: 'case_artifact_sum',
        },
      },
    };

    const compared = buildRecordingQualityBenchmarkComparisonSummary({
      baselineResults: [
        {
          id: 'measurement-case',
          actual: { status: 'validated' },
          measurements: {
            artifactBytes: {
              status: 'available',
              value: 50,
              unit: 'bytes',
              stability: 'stable',
              method: 'case_artifact_sum',
            },
          },
        },
      ],
      results: [measuredResult],
    });
    expect(compared.counts.stableImprovements).toBe(1);
    expect(compared.comparisons[0]).toMatchObject({
      metricName: 'measurements.artifactBytes',
      baselineValue: 50,
      currentValue: 51,
      delta: 1,
    });

    const missing = buildRecordingQualityBenchmarkComparisonSummary({
      baselineResults: [
        { id: 'measurement-case', actual: { status: 'validated' } },
      ],
      results: [measuredResult],
    });
    expect(missing.comparisons[0].outcome).toBe('missing_baseline_metric');
    expect(missing.comparisons[0].currentValue).toBe(51);
  });

  it('flags stable regressions, tolerates small drift, reports hardware-dependent drift, and notes missing baselines', () => {
    const summary = buildRecordingQualityBenchmarkComparisonSummary({
      baselineResults: [
        {
          id: 'stable-regression',
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'localTranscriptCoveredSeconds',
              value: 12,
            },
          },
        },
        {
          id: 'within-tolerance',
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'localTranscriptCoveredSeconds',
              value: 10,
            },
          },
        },
        {
          id: 'hardware-drift',
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'durationSeconds',
              value: 1062,
            },
          },
        },
        {
          id: 'hardware-within-tolerance',
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'durationSeconds',
              value: 900,
            },
          },
        },
      ],
      results: [
        {
          id: 'stable-regression',
          issue: 25,
          title: 'Stable regression',
          kind: 'transcript_validation',
          passed: true,
          trackedMetrics: [
            {
              name: 'localTranscriptCoveredSeconds',
              tolerance: 1,
              stability: 'stable',
            },
          ],
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'localTranscriptCoveredSeconds',
              value: 9,
            },
          },
          expected: {
            status: 'validated',
          },
        },
        {
          id: 'within-tolerance',
          issue: 428,
          title: 'Within tolerance',
          kind: 'transcript_validation',
          passed: true,
          trackedMetrics: [
            {
              name: 'localTranscriptCoveredSeconds',
              tolerance: 2,
              stability: 'stable',
            },
          ],
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'localTranscriptCoveredSeconds',
              value: 11,
            },
          },
          expected: {
            status: 'validated',
          },
        },
        {
          id: 'hardware-drift',
          issue: 75,
          title: 'Hardware drift',
          kind: 'recording_finalization',
          passed: true,
          trackedMetrics: [
            {
              name: 'durationSeconds',
              tolerance: 2,
              stability: 'hardware_dependent',
            },
          ],
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'durationSeconds',
              value: 1058,
            },
          },
          expected: {
            status: 'validated',
          },
        },
        {
          id: 'missing-baseline',
          issue: 458,
          title: 'Missing baseline',
          kind: 'retry_validation',
          passed: true,
          trackedMetrics: [
            {
              name: 'activityEvidenceSource',
              tolerance: 0,
              stability: 'stable',
            },
          ],
          actual: {
            status: 'needs_attention',
            primaryMetric: {
              name: 'activityEvidenceSource',
              value: 'capture_activity_missing',
            },
          },
          expected: {
            status: 'needs_attention',
          },
        },
        {
          id: 'hardware-within-tolerance',
          issue: 75,
          title: 'Hardware within tolerance',
          kind: 'recording_finalization',
          passed: true,
          trackedMetrics: [
            {
              name: 'durationSeconds',
              tolerance: 2,
              stability: 'hardware_dependent',
            },
          ],
          actual: {
            status: 'validated',
            primaryMetric: {
              name: 'durationSeconds',
              value: 901,
            },
          },
          expected: {
            status: 'validated',
          },
        },
      ],
    });

    expect(summary.counts).toEqual({
      stableRegressions: 1,
      stableImprovements: 0,
      stableWithinTolerance: 2,
      hardwareDependentDrift: 1,
      missingBaselineMetrics: 1,
    });
    expect(summary.failures).toEqual([
      expect.objectContaining({
        id: 'stable-regression',
        metricName: 'localTranscriptCoveredSeconds',
        outcome: 'stable_regression',
        delta: -3,
      }),
    ]);
    expect(summary.sections.hardwareDependent).toEqual([
      expect.objectContaining({
        id: 'hardware-drift',
        metricName: 'durationSeconds',
        outcome: 'hardware_dependent_drift',
        delta: -4,
      }),
    ]);
    expect(summary.sections.missingBaseline).toEqual([
      expect.objectContaining({
        id: 'missing-baseline',
        outcome: 'missing_baseline_metric',
      }),
    ]);
    expect(summary.lines).toEqual([
      'stable regressions: stable-regression localTranscriptCoveredSeconds 12 -> 9 (tol +/-1)',
      'stable within tolerance: within-tolerance localTranscriptCoveredSeconds 10 -> 11 (tol +/-2)',
      'stable within tolerance: hardware-within-tolerance durationSeconds 900 -> 901 (tol +/-2)',
      'hardware-dependent drift: hardware-drift durationSeconds 1062 -> 1058 (tol +/-2)',
      'missing baseline metrics: missing-baseline activityEvidenceSource',
    ]);
  });
});

describe('benchmark:recording-quality CLI', () => {
  it('runs the committed benchmark corpus successfully', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'recording-quality-benchmark-'),
    );
    const outputPath = path.join(outputDir, 'report.json');
    const repoRoot = path.resolve(__dirname, '../..');

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/run_recording_quality_benchmark.ts',
        '--',
        '--out',
        outputPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    expect({
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    }).toMatchObject({
      status: 0,
      stdout: expect.stringContaining('tier=pr 8/8 cases passed'),
    });
    expect(result.stdout).toContain(
      'EVIDENCE issue-493-capture-recovery elapsed=',
    );
    expect(result.stdout).toContain('artifacts=51B');
    expect(fs.existsSync(outputPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(report).toMatchObject({
      schemaVersion: 3,
      tier: 'pr',
      environment: {
        measurementContractVersion: 1,
        rssSamplingIntervalMs: 10,
      },
      summary: {
        totalCases: 8,
        issueCoverage: expect.arrayContaining([493]),
        kinds: {
          capture_recovery: { passed: 1, failed: 0 },
        },
      },
    });
    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'issue-493-capture-recovery',
          measurements: expect.objectContaining({
            elapsedTime: expect.objectContaining({
              status: 'available',
              unit: 'milliseconds',
            }),
            cpuTime: expect.objectContaining({
              status: 'available',
              unit: 'microseconds',
            }),
            peakRss: expect.objectContaining({
              status: 'available',
              unit: 'bytes',
            }),
            artifactBytes: expect.objectContaining({
              status: 'available',
              value: 51,
              unit: 'bytes',
            }),
          }),
        }),
      ]),
    );
    expect(
      report.results.every(
        (entry: RecordingQualityBenchmarkCaseResult) =>
          entry.measurements &&
          Object.keys(entry.measurements).length === 4,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(
      'pluto-recording-quality-recovery-',
    );
  });

  it('runs all declared tiers and fails clearly when manual has no cases', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const run = (tier: string) =>
      spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          'scripts/run_recording_quality_benchmark.ts',
          '--',
          '--tier',
          tier,
          '--out',
          path.join(os.tmpdir(), `recording-quality-${tier}.json`),
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      );

    const all = run('all');
    expect(all.status).toBe(0);
    expect(all.stdout).toContain('tier=all 8/8 cases passed');

    const manual = run('manual');
    expect(manual.status).toBe(1);
    expect(manual.stderr).toContain(
      'ERROR No manual benchmark cases are declared in the manifest.',
    );
  });
});
