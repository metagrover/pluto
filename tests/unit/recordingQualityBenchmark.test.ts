import { describe, expect, it } from 'vitest';

import {
  type RecordingQualityBenchmarkCaseResult,
  buildRecordingQualityBenchmarkReport,
  loadRecordingQualityBenchmarkManifest,
  parseRecordingQualityBenchmarkCliArgs,
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
            segments: [{ start: 0, end: 2, text: 'Sparse provisional local text.' }],
          },
          '/synthetic/system.wav': { segments: [] },
          '/synthetic/mix.wav': {
            segments: [{ start: 0, end: 2, text: 'Sparse provisional local text.' }],
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

describe('buildRecordingQualityBenchmarkReport', () => {
  it('summarizes passed and failed committed regression cases', () => {
    const results: RecordingQualityBenchmarkCaseResult[] = [
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
      totalCases: 3,
      passedCases: 2,
      failedCases: 1,
      passRate: 0.6667,
    });
    expect(report.summary.issueCoverage).toEqual([25, 75, 434]);
    expect(report.summary.kinds).toEqual({
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
  });
});
