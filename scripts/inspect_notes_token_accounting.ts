import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectNotesTokenAccounting } from './lib/notesTokenAccounting';

// Existing private captures only. No model, database, network or file writes.
try {
  assert.equal(process.argv.length, 3);
  const root = process.argv[2];
  assert.ok(path.isAbsolute(root));
  const dir = fs.lstatSync(root);
  assert.ok(
    dir.isDirectory() &&
      dir.uid === process.getuid?.() &&
      (dir.mode & 0o777) === 0o700,
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
  const rows = fs
    .readdirSync(root)
    .filter((name) => /^case-\d+-attempt-\d+-request\.json$/.test(name))
    .sort()
    .map((name) => {
      const bytes = read(name);
      const request = JSON.parse(bytes);
      const response = read(name.replace('-request.json', '-response.ndjson'));
      let terminal: Parameters<typeof inspectNotesTokenAccounting>[1];
      let malformedLines = 0;
      for (const line of response.split('\n').filter(Boolean)) {
        try {
          const packet = JSON.parse(line);
          if (packet.done) terminal = packet;
        } catch {
          malformedLines++;
        }
      }
      return {
        attempt: name.replace('-request.json', ''),
        requestSha256: createHash('sha256').update(bytes).digest('hex'),
        responseSha256: createHash('sha256').update(response).digest('hex'),
        malformedLines,
        ...inspectNotesTokenAccounting(
          request,
          malformedLines ? undefined : terminal,
        ),
      };
    });
  console.log(JSON.stringify({ modelRequests: 0, rows }, null, 2));
} catch {
  console.error('token_accounting_inspection_failed');
  process.exitCode = 1;
}
