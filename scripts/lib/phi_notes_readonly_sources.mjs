// Explicit operator-authorized source reading. Never initialize the app DB,
// checkpoint production WAL, migrate, or copy production settings into a run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sql = `PRAGMA query_only=ON;
SELECT json_group_array(json_object(
  'id', id, 'transcript_json', transcript_json,
  'transcript_status', transcript_status, 'finalization_status', finalization_status,
  'transcript_integrity_json', transcript_integrity_json, 'duration_seconds', duration_seconds
)) FROM (SELECT id, transcript_json, transcript_status, finalization_status,
       transcript_integrity_json, duration_seconds
FROM meetings
WHERE transcript_status = 'validated' AND finalization_status = 'finalized'
  AND transcript_json IS NOT NULL
ORDER BY id);`;

export function readReadonlyMeetingSources(
  databasePath,
  query = (uri, statement) =>
    execFileSync(
      '/usr/bin/sqlite3',
      ['-readonly', '-noheader', '-batch', uri, statement],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  { latestTen = false } = {},
) {
  assert.ok(databasePath.startsWith('/'), 'absolute_source_database_required');
  assert.equal(
    fs.realpathSync(databasePath),
    databasePath,
    'canonical_source_database_required',
  );
  const requireQuiescent = () => {
    for (const suffix of ['-wal', '-journal']) {
      const file = `${databasePath}${suffix}`;
      assert.ok(
        !fs.existsSync(file) || fs.statSync(file).size === 0,
        'source_has_uncheckpointed_writes_use_existing_consistent_snapshot',
      );
    }
  };
  requireQuiescent();
  const before = fs.statSync(databasePath);
  assert.ok(before.isFile(), 'source_database_must_be_file');
  const databaseSha256 = sha256(fs.readFileSync(databasePath));
  const uri = pathToFileURL(databasePath);
  uri.search = '?mode=ro&immutable=1';
  // immutable prevents even a shared-memory sidecar from being created. It is
  // safe here only for a stable, fully checkpointed source; verify it again
  // before releasing any rows. Active/WAL sources fail closed, not checkpoint.
  let output;
  try {
    output = query(
      uri.href,
      latestTen
        ? sql.replace(
            /WHERE transcript_status[\s\S]*ORDER BY id/,
            'ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 10',
          )
        : sql,
    );
  } catch {
    // Child-process exceptions can contain partial private stdout/stderr.
    throw new Error('readonly_source_query_failed');
  }
  requireQuiescent();
  const after = fs.statSync(databasePath);
  assert.ok(
    before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      databaseSha256 === sha256(fs.readFileSync(databasePath)),
    'source_changed_during_read',
  );
  let rows;
  try {
    rows = JSON.parse(output || '[]');
  } catch {
    throw new Error('source_query_invalid');
  }
  assert.ok(Array.isArray(rows), 'source_query_invalid');
  for (const row of rows) {
    assert.equal(typeof row.id, 'string');
    if (!latestTen) {
      assert.equal(typeof row.transcript_json, 'string');
      assert.equal(row.transcript_status, 'validated');
      assert.equal(row.finalization_status, 'finalized');
    }
  }
  return { source: 'readonly_production_sources', databaseSha256, rows };
}
