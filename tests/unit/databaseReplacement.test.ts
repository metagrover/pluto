import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseRuntime } from '../../electron/database/runtime';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-replacement-'));
  roots.push(root);
  return root;
};
const baselineFolder = path.join(process.cwd(), 'drizzle');
const recoveryDirectories = (root: string) =>
  fs
    .readdirSync(root)
    .filter((name) => name.startsWith('.pluto-db-replacement-'));

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('database replacement', () => {
  it('replaces an invalid SQLite file after staging it', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'not a sqlite database');
    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder: baselineFolder,
    });
    const sqlite = runtime.initialize();
    expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    expect(recoveryDirectories(root)).toEqual([]);
    runtime.close();
  });

  it('retains staged corrupt data when the fresh migration fails', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'not a sqlite database: corrupted content');
    const migrationsFolder = path.join(root, 'failing-drizzle');
    fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, when: 100, tag: '0000_failure', breakpoints: true },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(migrationsFolder, '0000_failure.sql'),
      'CREATE TABLE marker (id INTEGER);--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
    );

    const runtime = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_migration_failed' }),
    );
    const [recovery] = recoveryDirectories(root);
    expect(recovery).toBeDefined();
    const recovered = fs.readFileSync(
      path.join(root, recovery!, 'pluto.db'),
      'utf8',
    );
    expect(recovered).toBe('not a sqlite database: corrupted content');
  });

  it('surfaces cleanup failure and retains the staged database', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'corrupted bytes to stage');
    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder: baselineFolder,
      cleanupStaged: () => {
        throw new Error('deliberate cleanup failure');
      },
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_cleanup_failed' }),
    );
    expect(recoveryDirectories(root)).toHaveLength(1);
  });

  it('retains staged data when post-migration foreign-key verification fails', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    fs.writeFileSync(databasePath, 'corrupted file before fk failure');
    const migrationsFolder = path.join(root, 'invalid-drizzle');
    fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, when: 100, tag: '0000_invalid', breakpoints: true },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(migrationsFolder, '0000_invalid.sql'),
      `CREATE TABLE parent (id INTEGER PRIMARY KEY);--> statement-breakpoint
       CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));--> statement-breakpoint
       INSERT INTO child VALUES (42);`,
    );
    const runtime = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_integrity_failed' }),
    );
    const [recovery] = recoveryDirectories(root);
    expect(recovery).toBeDefined();
    const recovered = fs.readFileSync(
      path.join(root, recovery!, 'pluto.db'),
      'utf8',
    );
    expect(recovered).toBe('corrupted file before fk failure');
  });
});
