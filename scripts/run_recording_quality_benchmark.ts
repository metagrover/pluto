import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import {
  type CandidateEligibilityFixture,
  type CaptureRecoveryFixture,
  type LiveTranscriptResponsivenessFixture,
  type RecordingFinalizationFixture,
  type RecordingQualityBenchmarkFixture,
  type RetryValidationFixture,
  type StopToValidatedLatencyFixture,
  type TranscriptValidationFixture,
  buildRecordingQualityBenchmarkReport,
  loadRecordingQualityBenchmarkManifest,
  measureRecordingQualityBenchmarkCase,
  parseRecordingQualityBenchmarkCliArgs,
  runCandidateEligibilityBenchmarkCase,
  runCaptureRecoveryBenchmarkCase,
  runLiveTranscriptResponsivenessBenchmarkCase,
  runRecordingFinalizationBenchmarkCase,
  runRetryValidationBenchmarkCase,
  runStopToValidatedLatencyBenchmarkCase,
  runTranscriptValidationBenchmarkCase,
  selectRecordingQualityBenchmarkCases,
} from '../src/services/recordingQualityBenchmark.ts';

const readJson = <T>(filePath: string): T =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const resolveFixture = (manifestPath: string, relativeFixturePath: string) =>
  path.resolve(path.dirname(manifestPath), relativeFixturePath);

const getSourceCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
};

const main = async () => {
  const options = parseRecordingQualityBenchmarkCliArgs(
    process.argv.slice(2),
    process.cwd(),
  );
  const manifestPath = path.resolve(options.manifest);
  const manifest = loadRecordingQualityBenchmarkManifest(
    readJson(manifestPath),
  );
  const results = [];

  const selectedCases = selectRecordingQualityBenchmarkCases(
    manifest.cases,
    options.tier,
  );
  const rssSamplingIntervalMs = 10;

  for (const entry of selectedCases) {
    const fixturePath = resolveFixture(manifestPath, entry.fixture);
    const fixture = readJson<RecordingQualityBenchmarkFixture>(fixturePath);
    let runCase: () =>
      | ReturnType<typeof runRecordingFinalizationBenchmarkCase>
      | ReturnType<typeof runCandidateEligibilityBenchmarkCase>
      | ReturnType<typeof runCaptureRecoveryBenchmarkCase>
      | ReturnType<typeof runLiveTranscriptResponsivenessBenchmarkCase>
      | ReturnType<typeof runStopToValidatedLatencyBenchmarkCase>
      | ReturnType<typeof runTranscriptValidationBenchmarkCase>
      | ReturnType<typeof runRetryValidationBenchmarkCase>;
    if (fixture.type === 'capture_recovery') {
      runCase = () =>
        runCaptureRecoveryBenchmarkCase(
          entry,
          fixture as CaptureRecoveryFixture,
        );
    } else if (fixture.type === 'transcript_validation') {
      runCase = () =>
        runTranscriptValidationBenchmarkCase(
          entry,
          fixture as TranscriptValidationFixture,
        );
    } else if (fixture.type === 'recording_finalization') {
      runCase = () =>
        runRecordingFinalizationBenchmarkCase(
          entry,
          fixture as RecordingFinalizationFixture,
        );
    } else if (fixture.type === 'retry_validation') {
      runCase = () =>
        runRetryValidationBenchmarkCase(
          entry,
          fixture as RetryValidationFixture,
        );
    } else if (fixture.type === 'live_transcript_responsiveness') {
      runCase = () =>
        runLiveTranscriptResponsivenessBenchmarkCase(
          entry,
          fixture as LiveTranscriptResponsivenessFixture,
        );
    } else if (fixture.type === 'stop_to_validated_latency') {
      runCase = () =>
        runStopToValidatedLatencyBenchmarkCase(
          entry,
          fixture as StopToValidatedLatencyFixture,
        );
    } else if (fixture.type === 'candidate_eligibility') {
      runCase = () =>
        runCandidateEligibilityBenchmarkCase(
          entry,
          fixture as CandidateEligibilityFixture,
          `${process.platform}-${process.arch}`,
        );
    } else {
      throw new Error(`Unsupported fixture type in ${fixturePath}`);
    }
    results.push(
      await measureRecordingQualityBenchmarkCase(runCase, {
        monotonicNow: () => performance.now(),
        cpuUsage: () => process.cpuUsage(),
        rssBytes: () => process.memoryUsage().rss,
        startInterval: (sample, intervalMs) => setInterval(sample, intervalMs),
        clearInterval: (handle) =>
          clearInterval(handle as ReturnType<typeof setInterval>),
        samplingIntervalMs: rssSamplingIntervalMs,
      }),
    );
  }

  const baselineReportPath = path.resolve(
    path.dirname(manifestPath),
    manifest.baselineReport,
  );
  const relativeFromRepo = (filePath: string) =>
    path.relative(process.cwd(), filePath) || '.';
  const report = buildRecordingQualityBenchmarkReport({
    schemaVersion: manifest.schemaVersion,
    tier: options.tier,
    manifestPath: relativeFromRepo(manifestPath),
    baselineReportPath: relativeFromRepo(baselineReportPath),
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      measurementContractVersion: 1,
      rssSamplingIntervalMs,
    },
    sourceCommit: getSourceCommit(),
    results,
    baselineResults: readJson<{ results: typeof results }>(baselineReportPath)
      .results,
  });

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `[RecordingQualityBenchmark] tier=${report.tier} ${report.summary.passedCases}/${report.summary.totalCases} cases passed`,
  );
  const formatMeasurement = (
    measurement: (typeof report.results)[number]['measurements'] extends infer T
      ? T extends Record<string, infer M>
        ? M
        : never
      : never,
  ) => {
    if (!measurement || measurement.status === 'unavailable') {
      return `unavailable:${measurement?.reason || 'collection_failed'}`;
    }
    const suffix =
      measurement.unit === 'milliseconds'
        ? 'ms'
        : measurement.unit === 'microseconds'
          ? 'us'
          : 'B';
    return `${measurement.value}${suffix}`;
  };
  for (const result of report.results) {
    const measurements = result.measurements;
    console.log(
      `[RecordingQualityBenchmark] EVIDENCE ${result.id} elapsed=${formatMeasurement(measurements?.elapsedTime)} cpu=${formatMeasurement(measurements?.cpuTime)} peak_rss=${formatMeasurement(measurements?.peakRss)} artifacts=${formatMeasurement(measurements?.artifactBytes)}`,
    );
  }
  console.log(
    `[RecordingQualityBenchmark] capture_recovery=${report.summary.kinds.capture_recovery.passed}/${report.summary.kinds.capture_recovery.passed + report.summary.kinds.capture_recovery.failed} live_transcript_responsiveness=${report.summary.kinds.live_transcript_responsiveness.passed}/${report.summary.kinds.live_transcript_responsiveness.passed + report.summary.kinds.live_transcript_responsiveness.failed} stop_to_validated_latency=${report.summary.kinds.stop_to_validated_latency.passed}/${report.summary.kinds.stop_to_validated_latency.passed + report.summary.kinds.stop_to_validated_latency.failed} transcript_validation=${report.summary.kinds.transcript_validation.passed}/${report.summary.kinds.transcript_validation.passed + report.summary.kinds.transcript_validation.failed} retry_validation=${report.summary.kinds.retry_validation.passed}/${report.summary.kinds.retry_validation.passed + report.summary.kinds.retry_validation.failed} recording_finalization=${report.summary.kinds.recording_finalization.passed}/${report.summary.kinds.recording_finalization.passed + report.summary.kinds.recording_finalization.failed} candidate_eligibility=${report.summary.kinds.candidate_eligibility.passed}/${report.summary.kinds.candidate_eligibility.passed + report.summary.kinds.candidate_eligibility.failed}`,
  );
  console.log(
    `[RecordingQualityBenchmark] baseline stable_regressions=${report.comparisonSummary.stableRegressions} stable_improvements=${report.comparisonSummary.stableImprovements} within_tolerance=${report.comparisonSummary.stableWithinTolerance} hardware_drift=${report.comparisonSummary.hardwareDependentDrift} missing_baseline=${report.comparisonSummary.missingBaselineMetrics}`,
  );
  for (const comparison of report.comparisons) {
    if (comparison.outcome === 'stable_regression') {
      console.log(
        `[RecordingQualityBenchmark] REGRESSION ${comparison.id} ${comparison.metricName}: ${String(comparison.baselineValue)} -> ${String(comparison.currentValue)} (tol +/-${comparison.tolerance})`,
      );
      continue;
    }
    if (comparison.outcome === 'stable_improvement') {
      console.log(
        `[RecordingQualityBenchmark] IMPROVEMENT ${comparison.id} ${comparison.metricName}: ${String(comparison.baselineValue)} -> ${String(comparison.currentValue)} (tol +/-${comparison.tolerance})`,
      );
      continue;
    }
    if (comparison.outcome === 'stable_within_tolerance') {
      console.log(
        `[RecordingQualityBenchmark] WITHIN_TOLERANCE ${comparison.id} ${comparison.metricName}: ${String(comparison.baselineValue)} -> ${String(comparison.currentValue)} (tol +/-${comparison.tolerance})`,
      );
      continue;
    }
    if (comparison.outcome === 'hardware_dependent_drift') {
      console.log(
        `[RecordingQualityBenchmark] HARDWARE_DRIFT ${comparison.id} ${comparison.metricName}: ${String(comparison.baselineValue)} -> ${String(comparison.currentValue)} (tol +/-${comparison.tolerance})`,
      );
      continue;
    }
    console.log(
      `[RecordingQualityBenchmark] MISSING_BASELINE ${comparison.id} ${comparison.metricName}`,
    );
  }
  console.log(`[RecordingQualityBenchmark] wrote ${options.out}`);

  if (report.summary.failedCases > 0) {
    for (const failure of report.failures) {
      console.log(
        `[RecordingQualityBenchmark] FAIL ${failure.id}: ${(failure.failures || []).join('; ')}`,
      );
    }
    process.exitCode = 1;
  }

  if (report.comparisonSummary.stableRegressions > 0) {
    process.exitCode = 1;
  }
};

main().catch((error: Error) => {
  console.error(`[RecordingQualityBenchmark] ERROR ${error.message}`);
  process.exit(1);
});
