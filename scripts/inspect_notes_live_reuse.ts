import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotesSource } from '../electron/llm/meetingNotesSource';
import {
  inspectLiveNotesReuse,
  savedLiveNotesSource,
} from './lib/notesLiveReuse';
import { writeOwnerOnlyPrivateFile } from './lib/privateEvaluationFile';

async function main() {
  assert.equal(
    process.argv.length,
    3,
    'usage: inspect_notes_live_reuse.ts /absolute/private/sources.json',
  );
  const inputPath = process.argv[2];
  assert.ok(path.isAbsolute(inputPath));
  const stat = fs.lstatSync(inputPath);
  assert.ok(
    stat.isFile() &&
      stat.uid === process.getuid?.() &&
      (stat.mode & 0o777) === 0o600,
  );
  const bytes = fs.readFileSync(inputPath);
  const input = JSON.parse(bytes.toString('utf8'));
  assert.equal(input.rows.length, 10);
  const rows = [];
  for (const [index, row] of input.rows.entries()) {
    const live = savedLiveNotesSource(row.transcript_json);
    const canonical = createNotesSource(row.transcript_json);
    rows.push({
      index: index + 1,
      sourceEligible:
        row.transcript_status === 'validated' &&
        row.finalization_status === 'finalized',
      ...(live
        ? await inspectLiveNotesReuse(live, canonical)
        : { mode: 'live_snapshot_unavailable', modelRequests: 0 }),
    });
  }
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-live-notes-reuse-')),
  );
  fs.chmodSync(root, 0o700);
  const hash = (value: Buffer) =>
    createHash('sha256').update(value).digest('hex');
  const report = {
    inputSha256: hash(bytes),
    codeHashes: Object.fromEntries(
      [
        'electron/llm/meetingNotesPipeline.ts',
        'electron/llm/meetingNotesStageCache.ts',
        'electron/llm/meetingNotesSource.ts',
        'electron/llm/meetingNotesTypes.ts',
        'electron/llm/meetingNotesPrompts.ts',
        'electron/llm/meetingNotesEditor.ts',
        'src/components/AudioManager.tsx',
        'scripts/lib/notesLiveReuse.ts',
      ].map((file) => [file, hash(fs.readFileSync(file))]),
    ),
    rows,
  };
  assert.equal(
    hash(fs.readFileSync(inputPath)),
    report.inputSha256,
    'source_export_changed',
  );
  writeOwnerOnlyPrivateFile(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ privateEvidence: root, ...report }));
}
void main().catch(() => {
  console.error('live_reuse_inspection_failed');
  process.exitCode = 1;
});
