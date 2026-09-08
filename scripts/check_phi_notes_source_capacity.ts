// Development-only admission check on the source-only export. The callback
// throws before provider access: reaching it means preflight, not model success.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateMeetingNotes } from '../electron/llm/meetingNotesPipeline';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import {
  MeetingNotesError,
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from '../electron/llm/meetingNotesTypes';

async function main() {
  const inputPath = process.argv[2];
  if (process.argv.length !== 3 || !path.isAbsolute(inputPath ?? ''))
    throw new Error('one_absolute_private_source_export_required');
  const stat = fs.lstatSync(inputPath);
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('private_source_export_required');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (
    input.source !== 'readonly_production_sources' ||
    !Array.isArray(input.rows)
  )
    throw new Error('source_only_export_required');
  const boundary = new Error('preflight_admitted_no_inference');
  const results: Array<{
    sourceIdSha256: string;
    sourceCharacters: number | null;
    sourceSegments: number | null;
    durationSeconds: number | null;
    plannedLeafCount: number | null;
    outcome: string;
  }> = [];
  for (const row of input.rows) {
    let source: ReturnType<typeof createNotesSource> | undefined;
    let plannedLeafCount: number | null = null;
    let outcome = 'unexpected_pipeline_completion';
    try {
      source = createNotesSource(row.transcript_json);
      await generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        sourceFirstReconciliation: true,
        source,
        context: {
          userNotes: '',
          template: 'auto',
          trustedUserTerms: [],
          entityHints: [],
        },
        generate: async () => {
          throw boundary;
        },
        provider: 'ollama',
        model: PHI_NOTES_EXPERIMENT_MODEL,
        modelDigest: PHI_NOTES_EXPERIMENT_DIGEST,
        contextTokens: 16_384,
        onPlan: (plan) => {
          plannedLeafCount = plan.plannedLeafCount;
        },
      });
    } catch (error) {
      outcome =
        error === boundary
          ? boundary.message
          : error instanceof MeetingNotesError
            ? error.code
            : 'preflight_error';
    }
    results.push({
      sourceIdSha256: createHash('sha256').update(row.id).digest('hex'),
      sourceCharacters:
        source?.segments.reduce(
          (sum, segment) => sum + segment.text.length,
          0,
        ) ?? null,
      sourceSegments: source?.segments.length ?? null,
      durationSeconds: row.duration_seconds,
      plannedLeafCount,
      outcome,
    });
  }
  const counts = Object.fromEntries(
    [...new Set(results.map((result) => result.outcome))].map((outcome) => [
      outcome,
      results.filter((result) => result.outcome === outcome).length,
    ]),
  );
  const report = {
    schema: 'phi-private-source-capacity-v1',
    partition: 'development_not_held_out',
    sourceDatabaseSha256: input.databaseSha256,
    contextTokens: 16_384,
    physicalRequests: 0,
    counts,
    results,
  };
  const outputPath = path.join(path.dirname(inputPath), 'capacity.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    JSON.stringify({ privateReport: outputPath, physicalRequests: 0, counts }),
  );
}

void main().catch(() => {
  console.error('private_source_capacity_check_failed');
  process.exitCode = 1;
});
