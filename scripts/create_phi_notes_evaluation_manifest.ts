import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  PHI_NOTES_CORPUS_SHA256,
  PHI_NOTES_RUBRIC_SHA256,
  phiNotesExpectedRejectionCases,
  phiNotesHeldOutCases,
  phiNotesOrdinaryCapacityCases,
} from '../tests/manual/fixtures/localIntelligencePhiNotesHeldOut';
import {
  GEMMA_NOTES_CONTROL_CONFIGURATION,
  type NotesExperimentManifest,
  PHI_NOTES_EXPERIMENT_CONFIGURATION,
  buildFrozenNotesSchedule,
  notesScheduleSha256,
} from './lib/local_intelligence_evaluation';
import { writeOwnerOnlyPrivateFile } from './lib/privateEvaluationFile';

const outputPath = process.argv[2];
if (!outputPath || !path.isAbsolute(outputPath)) {
  throw new Error('evaluation_manifest_absolute_path_required');
}

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const worktreeStatus = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { encoding: 'utf8' },
).trim();
if (worktreeStatus) throw new Error('evaluation_clean_worktree_required');
const dirtyDiffSha256 = createHash('sha256')
  .update(
    execFileSync('git', ['diff', '--binary', 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  )
  .digest('hex');
const collections = {
  semantic: phiNotesHeldOutCases.map(({ id }) => id),
  ordinaryCapacity: phiNotesOrdinaryCapacityCases.map(({ id }) => id),
  expectedRejection: phiNotesExpectedRejectionCases.map(({ id }) => id),
};
const schedule = buildFrozenNotesSchedule(collections);
const configurations = [
  { ...PHI_NOTES_EXPERIMENT_CONFIGURATION },
  { ...GEMMA_NOTES_CONTROL_CONFIGURATION },
];
const manifest: NotesExperimentManifest = {
  schemaVersion: 2,
  suiteId: 'phi-notes-source-first-held-out-2026-09-07',
  privacy: 'owner_only_private',
  sourceRevision,
  dirtyDiffSha256,
  corpusSha256: PHI_NOTES_CORPUS_SHA256,
  rubricSha256: PHI_NOTES_RUBRIC_SHA256,
  scheduleSha256: notesScheduleSha256(schedule),
  partition: 'held_out',
  models: configurations.map(({ configId, tag, digest }) => ({
    configId,
    tag,
    digest,
  })),
  configurations,
  collections,
  settings: {
    seed: 41,
    temperature: 0.1,
    threads: 8,
    thinking: false,
    contextTokens: 16_384,
    writerOutputTokens: 2_048,
    editorOutputTokens: 2_048,
    stageCache: 'disabled',
  },
  schedule,
  ceilings: {
    ordinaryNotesMs: 600_000,
    longNotesMs: 1_200_000,
    chatMs: 120_000,
    dreamingMs: 180_000,
    notesPhysicalStarts: 12,
    minimumSamplesForP95: 20,
  },
};

writeOwnerOnlyPrivateFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    manifestPath: outputPath,
    sourceRevision,
    dirtyDiffSha256,
    scheduledRuns: schedule.length,
  }),
);
