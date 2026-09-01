import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupStagedDatabase,
  stageDatabaseArtifacts,
} from '../../electron/database/artifacts';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-artifacts-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('database artifact staging', () => {
  it('moves and deletes only the exact SQLite artifact set', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    for (const suffix of ['', '-journal', '-shm', '-wal', '.keep']) {
      fs.writeFileSync(`${databasePath}${suffix}`, suffix || 'database');
    }

    const staged = stageDatabaseArtifacts(databasePath, 'legacy', {
      now: () => new Date('2026-09-01T10:00:00.000Z'),
      processId: 42,
    });

    expect(
      staged.moved.map((movedPath) => path.basename(movedPath)).sort(),
    ).toEqual(['pluto.db', 'pluto.db-journal', 'pluto.db-shm', 'pluto.db-wal']);
    expect(fs.existsSync(path.join(root, 'pluto.db.keep'))).toBe(true);
    cleanupStagedDatabase(staged);
    expect(fs.existsSync(staged.directory)).toBe(false);
    expect(fs.existsSync(path.join(root, 'pluto.db.keep'))).toBe(true);
  });

  it('rolls all moved artifacts back when a later rename fails', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'database');
    fs.writeFileSync(`${databasePath}-wal`, 'wal');
    let calls = 0;

    expect(() =>
      stageDatabaseArtifacts(databasePath, 'integrity-failed', {
        now: () => new Date('2026-09-01T10:00:00.000Z'),
        processId: 42,
        rename: (from, to) => {
          calls += 1;
          if (calls === 2) throw new Error('deliberate rename failure');
          fs.renameSync(from, to);
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'database_replacement_failed' }),
    );

    expect(fs.readFileSync(databasePath, 'utf8')).toBe('database');
    expect(fs.readFileSync(`${databasePath}-wal`, 'utf8')).toBe('wal');
    expect(
      fs
        .readdirSync(root)
        .some((name) => name.startsWith('.pluto-db-replacement-')),
    ).toBe(false);
  });

  it('rejects unsafe paths and unissued cleanup targets', () => {
    expect(() => stageDatabaseArtifacts('pluto.db', 'legacy')).toThrowError(
      expect.objectContaining({ code: 'database_path_invalid' }),
    );
    expect(() =>
      cleanupStagedDatabase({
        directory: makeRoot(),
        databasePath: '/tmp/pluto.db',
        moved: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'database_cleanup_failed' }),
    );
  });
});
