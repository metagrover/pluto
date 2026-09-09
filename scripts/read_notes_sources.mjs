// Usage: node scripts/read_notes_sources.mjs /absolute/source/pluto.db
// Only source rows are exported. No production app is launched or modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReadonlyMeetingSources } from './lib/notes_readonly_sources.mjs';

try {
  if (process.argv.length !== 3)
    throw new Error('one_explicit_source_database_required');
  const result = readReadonlyMeetingSources(process.argv[2], undefined, {
    latestTen: true,
  });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-notes-readonly-sources-')),
  );
  fs.chmodSync(root, 0o700);
  fs.writeFileSync(
    path.join(root, 'sources.json'),
    `${JSON.stringify(result)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      privateOutput: root,
      selectedMeetings: result.rows.length,
      databaseSha256: result.databaseSha256,
    }),
  );
} catch (error) {
  // Only fixed diagnostic codes; never propagate source content to the terminal.
  const code =
    error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? error.message
      : 'readonly_source_export_failed';
  console.error(code);
  process.exitCode = 1;
}
