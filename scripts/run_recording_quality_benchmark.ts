import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  type RecordingFinalizationFixture,
  type RecordingQualityBenchmarkFixture,
  type RecordingQualityBenchmarkReport,
  type RetryValidationFixture,
  type TranscriptValidationFixture,
  buildRecordingQualityBenchmarkReport,
  compareRecordingQualityBenchmarkToBaseline,
  formatRecordingQualityBenchmarkComparisonSummary,
  loadRecordingQualityBenchmarkManifest,
  parseRecordingQualityBenchmarkCliArgs,
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
  });
  const baselineReport =
    readJson<RecordingQualityBenchmarkReport>(baselineReportPath);
  const comparison = compareRecordingQualityBenchmarkToBaseline({
    report,
    baselineReport,
  });
  const finalReport: RecordingQualityBenchmarkReport = {
    ...report,
    baselineComparison: comparison,
  };

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(
    options.out,
    `${JSON.stringify(finalReport, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `[RecordingQualityBenchmark] ${report.summary.passedCases}/${report.summary.totalCases} cases passed`,
  );
  console.log(
    `[RecordingQualityBenchmark] transcript_validation=${report.summary.kinds.transcript_validation.passed}/${report.summary.kinds.transcript_validation.passed + report.summary.kinds.transcript_validation.failed} retry_validation=${report.summary.kinds.retry_validation.passed}/${report.summary.kinds.retry_validation.passed + report.summary.kinds.retry_validation.failed} recording_finalization=${report.summary.kinds.recording_finalization.passed}/${report.summary.kinds.recording_finalization.passed + report.summary.kinds.recording_finalization.failed}`,
  );
  console.log(formatRecordingQualityBenchmarkComparisonSummary(comparison));
  console.log(`[RecordingQualityBenchmark] wrote ${options.out}`);

  if (
    report.summary.failedCases > 0 ||
    comparison.summary.stableRegressions > 0 ||
    comparison.summary.missingBaselineCases > 0 ||
    comparison.summary.missingBaselineMetrics > 0
  ) {
    for (const failure of report.failures) {
      console.log(
        `[RecordingQualityBenchmark] FAIL ${failure.id}: ${(failure.failures || []).join('; ')}`,
      );
    }
    for (const regression of comparison.stableRegressions) {
      console.log(
        `[RecordingQualityBenchmark] REGRESSION ${regression.caseId}.${regression.metricName}: baseline=${String(regression.baselineValue)} current=${String(regression.currentValue)} tolerance=${regression.tolerance}`,
      );
    }
    for (const caseId of comparison.missingBaselineCases) {
      console.log(
        `[RecordingQualityBenchmark] FAIL missing baseline case ${caseId}`,
      );
    }
    for (const entry of comparison.missingBaselineMetrics) {
      console.log(
        `[RecordingQualityBenchmark] FAIL missing baseline metric ${entry.caseId}.${entry.metricName}`,
      );
    }
    process.exitCode = 1;
  }
};

main().catch((error: Error) => {
  console.error(`[RecordingQualityBenchmark] ERROR ${error.message}`);
  process.exit(1);
});
