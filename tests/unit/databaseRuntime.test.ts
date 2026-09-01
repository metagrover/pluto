import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseRuntime } from '../../electron/database/runtime';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-runtime-'));
  roots.push(root);
  return root;
};

const writeMigrations = (
  root: string,
  migrations: Array<{ tag: string; when: number; sql: string }>,
) => {
  const folder = path.join(root, 'drizzle');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: migrations.map(({ tag, when }, idx) => ({
        idx,
        version: '6',
        when,
        tag,
        breakpoints: true,
      })),
    }),
  );
  for (const migration of migrations) {
    fs.writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }
  return folder;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('database runtime', () => {
  it('initializes one configured file connection and closes idempotently', () => {
    const root = makeRoot();
    const runtime = createDatabaseRuntime({
      databasePath: path.join(root, 'pluto.db'),
      migrationsFolder: writeMigrations(root, [
        {
          tag: '0000_first',
          when: 100,
          sql: 'CREATE TABLE ordered (value INTEGER NOT NULL);--> statement-breakpoint\nINSERT INTO ordered VALUES (1);',
        },
      ]),
    });

    const first = runtime.initialize();
    expect(runtime.initialize()).toBe(first);
    expect(first.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(first.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(first.pragma('synchronous', { simple: true })).toBe(2);
    expect(first.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(first.prepare('SELECT value FROM ordered').all()).toEqual([
      { value: 1 },
    ]);
    runtime.close();
    runtime.close();
    expect(runtime.state).toBe('closed');
    expect(() => runtime.getConnection()).toThrowError(
      expect.objectContaining({ code: 'database_closed' }),
    );
  });

  it('supports the documented in-memory journal mode', () => {
    const root = makeRoot();
    const runtime = createDatabaseRuntime({
      databasePath: ':memory:',
      migrationsFolder: writeMigrations(root, [
        {
          tag: '0000_first',
          when: 100,
          sql: 'CREATE TABLE ready (id INTEGER);',
        },
      ]),
    });
    const sqlite = runtime.initialize();
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    runtime.close();
  });

  it('reports an unavailable database directory', () => {
    const root = makeRoot();
    const parentFile = path.join(root, 'not-a-directory');
    fs.writeFileSync(parentFile, 'file');
    const runtime = createDatabaseRuntime({
      databasePath: path.join(parentFile, 'pluto.db'),
      migrationsFolder: writeMigrations(root, []),
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_directory_unavailable' }),
    );
  });

  it('applies ordered migrations exactly once across reopen', () => {
    const root = makeRoot();
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_first',
        when: 100,
        sql: 'CREATE TABLE ordered (value INTEGER NOT NULL);--> statement-breakpoint\nINSERT INTO ordered VALUES (1);',
      },
      {
        tag: '0001_second',
        when: 200,
        sql: 'INSERT INTO ordered VALUES (2);',
      },
    ]);
    const databasePath = path.join(root, 'pluto.db');
    const first = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(
      first
        .initialize()
        .prepare('SELECT value FROM ordered ORDER BY value')
        .all(),
    ).toEqual([{ value: 1 }, { value: 2 }]);
    first.close();
    const second = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(
      second
        .initialize()
        .prepare('SELECT value FROM ordered ORDER BY value')
        .all(),
    ).toEqual([{ value: 1 }, { value: 2 }]);
    second.close();
  });

  it('rolls back and identifies a failing migration', () => {
    const root = makeRoot();
    const runtime = createDatabaseRuntime({
      databasePath: path.join(root, 'pluto.db'),
      migrationsFolder: writeMigrations(root, [
        {
          tag: '0000_failure',
          when: 100,
          sql: 'CREATE TABLE deliberate_failure_marker (id INTEGER PRIMARY KEY);--> statement-breakpoint\nINSERT INTO missing_table (id) VALUES (1);',
        },
      ]),
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({
        code: 'database_migration_failed',
        details: expect.objectContaining({ migrationId: '0000_failure' }),
      }),
    );
  });

  it('rejects divergent applied history without mutating the database', () => {
    const root = makeRoot();
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_first',
        when: 100,
        sql: 'CREATE TABLE durable_marker (value TEXT);',
      },
    ]);
    const databasePath = path.join(root, 'pluto.db');
    const first = createDatabaseRuntime({ databasePath, migrationsFolder });
    first
      .initialize()
      .prepare('INSERT INTO durable_marker VALUES (?)')
      .run('preserved');
    first.close();

    fs.writeFileSync(
      path.join(migrationsFolder, '0000_first.sql'),
      'CREATE TABLE changed_history (value TEXT);',
    );
    const second = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(() => second.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_version_unsupported' }),
    );
    const inspection = new Database(databasePath, { readonly: true });
    expect(
      inspection.prepare('SELECT value FROM durable_marker').get(),
    ).toEqual({
      value: 'preserved',
    });
    inspection.close();
  });

  it('does not reset an established database when a later migration fails', () => {
    const root = makeRoot();
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_first',
        when: 100,
        sql: 'CREATE TABLE durable_marker (value TEXT);',
      },
    ]);
    const databasePath = path.join(root, 'pluto.db');
    const first = createDatabaseRuntime({ databasePath, migrationsFolder });
    first
      .initialize()
      .prepare('INSERT INTO durable_marker VALUES (?)')
      .run('preserved');
    first.close();
    writeMigrations(root, [
      {
        tag: '0000_first',
        when: 100,
        sql: 'CREATE TABLE durable_marker (value TEXT);',
      },
      {
        tag: '0001_failure',
        when: 200,
        sql: 'CREATE TABLE rolled_back_marker (id INTEGER);--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
      },
    ]);

    const second = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(() => second.initialize()).toThrowError(
      expect.objectContaining({
        code: 'database_migration_failed',
        details: expect.objectContaining({ migrationId: '0001_failure' }),
      }),
    );
    expect(
      fs
        .readdirSync(root)
        .filter((name) => name.startsWith('.pluto-db-replacement-')),
    ).toEqual([]);
    const inspection = new Database(databasePath, { readonly: true });
    expect(
      inspection.prepare('SELECT value FROM durable_marker').get(),
    ).toEqual({
      value: 'preserved',
    });
    expect(
      inspection
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE name = 'rolled_back_marker'",
        )
        .get(),
    ).toBeUndefined();
    inspection.close();
  });
});
