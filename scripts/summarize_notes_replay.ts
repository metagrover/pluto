import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarizeNotesReplay } from './lib/notesReplaySummary';
import { writeOwnerOnlyPrivateFile } from './lib/privateEvaluationFile';

try {
  assert.equal(process.argv.length, 3, 'one_private_replay_directory_required');
  const root = process.argv[2];
  assert.ok(path.isAbsolute(root));
  const directory = fs.lstatSync(root);
  assert.ok(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o777) === 0o700,
  );
  const read = (name: string) => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    assert.ok(
      stat.isFile() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o777) === 0o600,
    );
    return fs.readFileSync(file, 'utf8');
  };
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.schema, 'notes-production-replay-v1');
  const raw = read('events.jsonl');
  const lines = raw.split('\n');
  const incompleteTail = lines.pop() ?? '';
  const events = lines.filter(Boolean).map((line) => JSON.parse(line));
  // An unfinished append after a kill is evidence, never a fabricated terminal.
  const summary = {
    ...summarizeNotesReplay(manifest.scheduled, events),
    incompleteLedgerTail: incompleteTail.length > 0,
  };
  writeOwnerOnlyPrivateFile(
    path.join(root, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    JSON.stringify({
      privateSummary: path.join(root, 'summary.json'),
      scheduled: summary.scheduled,
      counts: summary.counts,
      physicalRequests: summary.physicalRequests,
      censoredRequests: summary.censoredRequests,
      incompleteLedgerTail: summary.incompleteLedgerTail,
    }),
  );
} catch {
  console.error('private_replay_summary_failed');
  process.exitCode = 1;
}
