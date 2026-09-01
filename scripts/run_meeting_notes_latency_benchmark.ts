import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

import {
  type MeetingNotesRunMetric,
  createMeetingNotesRunMetrics,
} from '../electron/llm/meetingNotesRunMetrics.ts';
import { createNotesSource } from '../electron/llm/meetingNotesSource.ts';
import {
  NOTES_OLLAMA_MODEL,
  NOTES_PROMPT_VERSION,
} from '../electron/llm/meetingNotesTypes.ts';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider.ts';
import {
  type MeetingNotesLatencySample,
  type PrivateMeetingNotesLatencyCase,
  aggregateMeetingNotesLatencySamples,
  assertContentFreeMeetingNotesLatencyReport,
  classifyMeetingNotesLatencyError,
  parsePrivateMeetingNotesLatencyManifest,
  summarizeMeetingNotesLatencyStages,
} from './lib/meeting_notes_latency_benchmark.ts';
import { writeOwnerOnlyPrivateFile } from './lib/privateEvaluationFile.ts';

type BenchmarkMode = 'isolated' | 'repeat-30' | 'burst';
type HierarchyAuditStrategy = 'every_node' | 'final_only';

const option = (name: string, fallback?: string): string => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const manifestPath = path.resolve(option('--manifest'));
const outputPath = path.resolve(option('--output'));
const mode = option('--mode', 'isolated') as BenchmarkMode;
if (!['isolated', 'repeat-30', 'burst'].includes(mode)) {
  throw new Error('invalid_meeting_notes_latency_mode');
}
const hierarchyAuditStrategy = option(
  '--hierarchy-audit-strategy',
  'every_node',
) as HierarchyAuditStrategy;
if (!['every_node', 'final_only'].includes(hierarchyAuditStrategy)) {
  throw new Error('invalid_meeting_notes_hierarchy_audit_strategy');
}
const manifest = parsePrivateMeetingNotesLatencyManifest(
  JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown,
);
if (!fs.statSync(manifest.databasePath).isFile()) {
  throw new Error('meeting_notes_latency_database_unavailable');
}

const database = new Database(manifest.databasePath, {
  readonly: true,
  fileMustExist: true,
});
database.pragma('query_only = ON');
const columns = new Set(
  (database.pragma('table_info(meetings)') as Array<{ name: string }>).map(
    (column) => column.name,
  ),
);
for (const required of ['id', 'transcript_json', 'duration_seconds']) {
  if (!columns.has(required)) {
    throw new Error('meeting_notes_latency_database_schema_unsupported');
  }
}

const model = process.env.OLLAMA_BENCHMARK_MODEL?.trim() || NOTES_OLLAMA_MODEL;
const contextTokens = 16_384;
const seed = Number.parseInt(process.env.OLLAMA_BENCHMARK_SEED || '42', 10);

const selectedCases = (): Array<{
  definition: PrivateMeetingNotesLatencyCase;
  runIndex: number;
}> => {
  if (mode === 'repeat-30') {
    const fixed = manifest.cases.find(
      (entry) => entry.durationBucket === '30m',
    );
    if (!fixed) throw new Error('meeting_notes_latency_30m_case_required');
    return Array.from({ length: 3 }, (_, runIndex) => ({
      definition: fixed,
      runIndex,
    }));
  }
  if (mode === 'burst') {
    if (manifest.cases.length < 4) {
      throw new Error('meeting_notes_latency_four_cases_required');
    }
    return manifest.cases.slice(0, 4).map((definition, runIndex) => ({
      definition,
      runIndex,
    }));
  }
  return manifest.cases.map((definition, runIndex) => ({
    definition,
    runIndex,
  }));
};

const runCase = async (
  definition: PrivateMeetingNotesLatencyCase,
  runIndex: number,
): Promise<
  MeetingNotesLatencySample & {
    runIndex: number;
    sourceSegmentCount: number;
    sourceCharacterCount: number;
    plannedLeafCount: number | null;
    generatedNodeCount: number;
    stageCounts: ReturnType<typeof summarizeMeetingNotesLatencyStages>;
    repairCount: number;
    repartitionCount: number;
  }
> => {
  const row = database
    .prepare(
      'SELECT transcript_json, duration_seconds FROM meetings WHERE id = ?',
    )
    .get(definition.meetingId) as
    | { transcript_json: string; duration_seconds: number | null }
    | undefined;
  if (!row)
    throw new Error(`meeting_notes_latency_case_missing:${definition.caseKey}`);
  const source = createNotesSource(row.transcript_json);
  const startedAtMs = Date.now();
  const metrics = createMeetingNotesRunMetrics({
    reason: 'manual',
    sourceSegmentCount: source.segments.length,
    sourceCharacterCount: source.segments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    ),
    startedAtMs,
  });
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: model,
    ollama_structured_thinking: false,
    ollama_seed: seed,
  });
  let status: MeetingNotesLatencySample['status'] = 'published';
  let errorCode: string | undefined;
  let runMetric: MeetingNotesRunMetric;
  let generatedNodeCount = 0;
  try {
    const analysis = await provider.generateStructuredAnalysis('', '', 'auto', {
      source,
      contextTokens,
      hierarchyAuditStrategy,
      onStageEvent: metrics.observe,
      onPlan: ({ plannedLeafCount }) =>
        metrics.setPlannedLeafCount(plannedLeafCount),
      onRepair: () => metrics.recordRepair(),
      onRepartition: () => metrics.recordRepartition(),
    });
    generatedNodeCount = analysis.generation_metadata?.hierarchy?.nodes ?? 1;
    metrics.setGeneratedNodeCount(generatedNodeCount);
    runMetric = metrics.snapshot('published', Date.now());
  } catch (error) {
    status =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'cancelled'
        : 'failed';
    errorCode = classifyMeetingNotesLatencyError(error);
    runMetric = metrics.snapshot(status, Date.now());
  }
  return {
    caseKey: definition.caseKey,
    runIndex,
    durationBucket: definition.durationBucket,
    status,
    totalMs: runMetric.totalMs,
    queueMs: runMetric.queueMs,
    modelMs: runMetric.modelMs,
    modelCallCount: runMetric.stages.length,
    sourceSegmentCount: runMetric.sourceSegmentCount,
    sourceCharacterCount: runMetric.sourceCharacterCount,
    plannedLeafCount: runMetric.plannedLeafCount,
    generatedNodeCount,
    stageCounts: summarizeMeetingNotesLatencyStages(runMetric.stages),
    repairCount: runMetric.repairCount,
    repartitionCount: runMetric.repartitionCount,
    ...(errorCode ? { errorCode } : {}),
  };
};

const main = async () => {
  const cases = selectedCases();
  const startedAt = Date.now();
  const samples =
    mode === 'burst'
      ? await Promise.all(
          cases.map(({ definition, runIndex }) =>
            runCase(definition, runIndex),
          ),
        )
      : await cases.reduce<Promise<Awaited<ReturnType<typeof runCase>>[]>>(
          async (pending, { definition, runIndex }) => [
            ...(await pending),
            await runCase(definition, runIndex),
          ],
          Promise.resolve([]),
        );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    configuration: {
      provider: 'ollama',
      model,
      promptVersion: NOTES_PROMPT_VERSION,
      contextTokens,
      seed,
      structuredThinking: false,
      hierarchyAuditStrategy,
      fixtureOrderSha256: createHash('sha256')
        .update(cases.map(({ definition }) => definition.caseKey).join('\n'))
        .digest('hex'),
    },
    wallMs: Date.now() - startedAt,
    samples,
    aggregate: aggregateMeetingNotesLatencySamples(samples),
  };
  assertContentFreeMeetingNotesLatencyReport(report, [
    manifest.databasePath,
    ...manifest.cases.map((entry) => entry.meetingId),
  ]);
  writeOwnerOnlyPrivateFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      mode,
      sampleCount: samples.length,
      publishedCount: report.aggregate.publishedCount,
      failedCount: report.aggregate.failedCount,
      medianTotalMs: report.aggregate.medianTotalMs,
      output: path.basename(outputPath),
    }),
  );
  if (report.aggregate.failedCount > 0) process.exitCode = 1;
};

void main().finally(() => database.close());
