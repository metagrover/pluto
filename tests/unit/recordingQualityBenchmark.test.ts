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
  parseRecordingQualityBenchmarkCliArgs,
  runCandidateEligibilityBenchmarkCase,
  runRetryValidationBenchmarkCase,
} from '../../src/services/recordingQualityBenchmark';

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
    });
  });
});

describe('loadRecordingQualityBenchmarkManifest', () => {
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
        },
        {
          id: 'issue-25-opening-audio',
          issue: 25,
          title: 'Opening audio is preserved',
          kind: 'transcript_validation',
          fixture: 'fixtures/issue-25-opening-audio.json',
        },
      ],
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.cases[0]).toMatchObject({
      id: 'issue-476-credential-free-distribution',
      issue: 476,
      kind: 'candidate_eligibility',
    });
    expect(manifest.cases[1]).toMatchObject({
      id: 'issue-25-opening-audio',
      issue: 25,
      kind: 'transcript_validation',
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
          },
          {
            id: 'duplicate-case',
            issue: 75,
            title: 'Second copy',
            kind: 'recording_finalization',
            fixture: 'fixtures/two.json',
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
        },
      ],
    });

    expect(manifest.cases[0]).toMatchObject({
      id: 'issue-458-missing-retry-evidence',
      issue: 458,
      kind: 'retry_validation',
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
      results,
    });

    expect(report.summary).toMatchObject({
      totalCases: 4,
      passedCases: 3,
      failedCases: 1,
      passRate: 0.75,
    });
    expect(report.summary.issueCoverage).toEqual([25, 75, 434, 476]);
    expect(report.summary.kinds).toEqual({
      candidate_eligibility: { passed: 1, failed: 0 },
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
    });
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
