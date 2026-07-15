import { describe, expect, it } from 'vitest';

import {
  buildRecordingQualityBenchmarkReport,
  loadRecordingQualityBenchmarkManifest,
  type RecordingQualityBenchmarkCaseResult,
} from '../../src/services/recordingQualityBenchmark';

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
        failures: ['status mismatch', 'covered seconds exceeded expected union'],
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
      transcript_validation: { passed: 1, failed: 1 },
    });
    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'issue-434-overlap-union',
        failures: ['status mismatch', 'covered seconds exceeded expected union'],
      }),
    ]);
  });
});
