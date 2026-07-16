import { describe, expect, it } from 'vitest';

import {
  type CandidateEligibilityFixture,
  type RecordingQualityBenchmarkCaseResult,
  buildRecordingQualityBenchmarkReport,
  evaluateCandidateDistributionEligibility,
  loadRecordingQualityBenchmarkManifest,
  parseRecordingQualityBenchmarkCliArgs,
  runCandidateEligibilityBenchmarkCase,
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
  });
});
