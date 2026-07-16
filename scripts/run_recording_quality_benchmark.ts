import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  type CaptureRecoveryFixture,
  type RecordingFinalizationFixture,
  type RecordingQualityBenchmarkFixture,
  type RetryValidationFixture,
  type TranscriptValidationFixture,
  buildRecordingQualityBenchmarkReport,
  loadRecordingQualityBenchmarkManifest,
  parseRecordingQualityBenchmarkCliArgs,
  runCaptureRecoveryBenchmarkCase,
  runRecordingFinalizationBenchmarkCase,
  runRetryValidationBenchmarkCase,
  runTranscriptValidationBenchmarkCase,
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

  for (const entry of manifest.cases) {
    const fixturePath = resolveFixture(manifestPath, entry.fixture);
    const fixture = readJson<RecordingQualityBenchmarkFixture>(fixturePath);
    if (fixture.type === 'capture_recovery') {
      results.push(
        await runCaptureRecoveryBenchmarkCase(
          entry,
          fixture as CaptureRecoveryFixture,
        ),
      );
      continue;
    }
    if (fixture.type === 'transcript_validation') {
      results.push(
        await runTranscriptValidationBenchmarkCase(
          entry,
          fixture as TranscriptValidationFixture,
        ),
      );
      continue;
    }
    if (fixture.type === 'recording_finalization') {
      results.push(
        runRecordingFinalizationBenchmarkCase(
          entry,
          fixture as RecordingFinalizationFixture,
        ),
      );
      continue;
    }
    if (fixture.type === 'retry_validation') {
      results.push(
        await runRetryValidationBenchmarkCase(
          entry,
          fixture as RetryValidationFixture,
        ),
      );
      continue;
    }
    throw new Error(`Unsupported fixture type in ${fixturePath}`);
  }

  const baselineReportPath = path.resolve(
    path.dirname(manifestPath),
    manifest.baselineReport,
  );
  const relativeFromRepo = (filePath: string) =>
    path.relative(process.cwd(), filePath) || '.';
  const report = buildRecordingQualityBenchmarkReport({
    schemaVersion: manifest.schemaVersion,
    manifestPath: relativeFromRepo(manifestPath),
    baselineReportPath: relativeFromRepo(baselineReportPath),
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    sourceCommit: getSourceCommit(),
    results,
    baselineResults: readJson<{ results: typeof results }>(baselineReportPath)
      .results,
  });

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `[RecordingQualityBenchmark] ${report.summary.passedCases}/${report.summary.totalCases} cases passed`,
  );
  console.log(
    `[RecordingQualityBenchmark] capture_recovery=${report.summary.kinds.capture_recovery.passed}/${report.summary.kinds.capture_recovery.passed + report.summary.kinds.capture_recovery.failed} transcript_validation=${report.summary.kinds.transcript_validation.passed}/${report.summary.kinds.transcript_validation.passed + report.summary.kinds.transcript_validation.failed} retry_validation=${report.summary.kinds.retry_validation.passed}/${report.summary.kinds.retry_validation.passed + report.summary.kinds.retry_validation.failed} recording_finalization=${report.summary.kinds.recording_finalization.passed}/${report.summary.kinds.recording_finalization.passed + report.summary.kinds.recording_finalization.failed}`,
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
