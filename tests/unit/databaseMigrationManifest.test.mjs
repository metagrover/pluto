import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMigrationManifest } from '../../scripts/check_migrations.mjs';

const directories = [];
const tags = ['0000_baseline', '0001_more'];

function migrationFolder(entries = tags.map((tag, idx) => ({ tag, idx }))) {
  const folder = mkdtempSync(join(tmpdir(), 'pluto-migration-manifest-'));
  directories.push(folder);
  mkdirSync(join(folder, 'meta'));
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ entries }),
  );
  for (const tag of tags)
    writeFileSync(join(folder, `${tag}.sql`), 'SELECT 1;');
  return folder;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('migration SQL and journal check', () => {
  it('accepts matching SQL files and journal entries', () => {
    expect(() => validateMigrationManifest(migrationFolder())).not.toThrow();
  });

  it('rejects an SQL file missing from the journal', () => {
    const folder = migrationFolder();
    writeFileSync(join(folder, '0002_unlisted.sql'), 'SELECT 2;');
    expect(() => validateMigrationManifest(folder)).toThrow(
      /SQL files missing from migration journal: 0002_unlisted/,
    );
  });

  it('rejects a journal entry missing its SQL file', () => {
    const folder = migrationFolder([
      ...tags.map((tag, idx) => ({ tag, idx })),
      { tag: '0002_missing', idx: 2 },
    ]);
    expect(() => validateMigrationManifest(folder)).toThrow(
      /Migration journal entries missing SQL files: 0002_missing/,
    );
  });

  it('rejects duplicate tags and incorrect indexes or order', () => {
    expect(() =>
      validateMigrationManifest(
        migrationFolder([
          { tag: tags[0], idx: 0 },
          { tag: tags[0], idx: 1 },
        ]),
      ),
    ).toThrow(/Duplicate migration journal tag/);
    expect(() =>
      validateMigrationManifest(
        migrationFolder([
          { tag: tags[0], idx: 1 },
          { tag: tags[1], idx: 0 },
        ]),
      ),
    ).toThrow(/expected 0/);
    expect(() =>
      validateMigrationManifest(
        migrationFolder([
          { tag: tags[1], idx: 0 },
          { tag: tags[0], idx: 1 },
        ]),
      ),
    ).toThrow(/out of order/);
  });
});
