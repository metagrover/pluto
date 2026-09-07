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

  it('rejects unsupported history without changing persistent journal mode', () => {
    const root = makeRoot();
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_first',
        when: 100,
        sql: 'CREATE TABLE expected (id INTEGER);',
      },
    ]);
    const databasePath = path.join(root, 'pluto.db');
    const sqlite = new Database(databasePath);
    sqlite.exec(
      `CREATE TABLE __drizzle_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash text NOT NULL,
         created_at numeric
       );
       INSERT INTO __drizzle_migrations (hash, created_at)
       VALUES ('future-hash', 999);`,
    );
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('delete');
    sqlite.close();

    const runtime = createDatabaseRuntime({ databasePath, migrationsFolder });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_version_unsupported' }),
    );
    const inspection = new Database(databasePath);
    expect(inspection.pragma('journal_mode', { simple: true })).toBe('delete');
    inspection.close();
  });

  it('fails initialization if foreign-key enforcement cannot be restored', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const migrationsFolder = writeMigrations(root, [
      { tag: '0000_first', when: 100, sql: 'CREATE TABLE ready (id INTEGER);' },
    ]);
    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      openConnection: (filename) => {
        const sqlite = new Database(filename);
        const pragma = sqlite.pragma.bind(sqlite);
        let foreignKeysDisabled = false;
        sqlite.pragma = ((source: string, options?: { simple?: boolean }) => {
          if (source === 'foreign_keys = OFF') foreignKeysDisabled = true;
          if (source === 'foreign_keys = ON' && foreignKeysDisabled) return [];
          if (source === 'foreign_keys' && foreignKeysDisabled) return 0;
          return pragma(source, options);
        }) as typeof sqlite.pragma;
        return sqlite;
      },
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_configuration_failed' }),
    );
  });

  it('classifies schema inspection failures as lifecycle errors', () => {
    const root = makeRoot();
    const runtime = createDatabaseRuntime({
      databasePath: path.join(root, 'pluto.db'),
      migrationsFolder: writeMigrations(root, []),
      openConnection: (filename) => {
        const sqlite = new Database(filename);
        const prepare = sqlite.prepare.bind(sqlite);
        sqlite.prepare = ((source: string) => {
          if (source.includes("name NOT LIKE 'sqlite_%'")) {
            throw new Error('schema inspection failed');
          }
          return prepare(source);
        }) as typeof sqlite.prepare;
        return sqlite;
      },
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_integrity_failed' }),
    );
  });

  it('fails closed when wrong encryption key is provided and never wipes database', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const correctKey =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const wrongKey =
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_init',
        when: 100,
        sql: "CREATE TABLE secret (val TEXT);--> statement-breakpoint\nINSERT INTO secret VALUES ('classified');",
      },
    ]);

    // 1. Create an encrypted database with correctKey
    const runtime1 = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: correctKey,
      enableEncryption: true,
    });
    const db1 = runtime1.initialize();
    expect(db1.prepare('SELECT val FROM secret').all()).toEqual([
      { val: 'classified' },
    ]);
    runtime1.close();

    // 2. Open with wrongKey: MUST fail with database_key_rejected and NOT call replaceExisting
    const runtime2 = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: wrongKey,
      enableEncryption: true,
    });
    expect(() => runtime2.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_key_rejected' }),
    );

    // Verify database file was not replaced or wiped
    const stagedDirs = fs
      .readdirSync(root)
      .filter((n) => n.startsWith('.pluto-db-replacement-'));
    expect(stagedDirs).toHaveLength(0);

    // Reopen with correctKey: data is intact!
    const runtime3 = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: correctKey,
      enableEncryption: true,
    });
    const db3 = runtime3.initialize();
    expect(db3.prepare('SELECT val FROM secret').all()).toEqual([
      { val: 'classified' },
    ]);
    runtime3.close();
  });

  it('fails closed when key is missing beside existing encrypted database', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const correctKey =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const migrationsFolder = writeMigrations(root, [
      { tag: '0000_init', when: 100, sql: 'CREATE TABLE secret (val TEXT);' },
    ]);

    // 1. Create encrypted DB
    const runtime1 = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: correctKey,
      enableEncryption: true,
    });
    runtime1.initialize();
    runtime1.close();

    // 2. Open with enableEncryption=true but no key
    const runtime2 = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      enableEncryption: true,
    });
    expect(() => runtime2.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_key_unavailable' }),
    );

    // Ensure no replacement happened
    const stagedDirs = fs
      .readdirSync(root)
      .filter((n) => n.startsWith('.pluto-db-replacement-'));
    expect(stagedDirs).toHaveLength(0);
  });

  it('transparently migrates a plaintext database when encryption is enabled', () => {
    const root = makeRoot();
    const databasePath = path.join(root, 'pluto.db');
    const key =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const migrationsFolder = writeMigrations(root, [
      {
        tag: '0000_init',
        when: 100,
        sql: "CREATE TABLE notes (id INT, text TEXT);--> statement-breakpoint\nINSERT INTO notes VALUES (1, 'hello');",
      },
    ]);

    // 1. Create plaintext DB
    const runtimePlain = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
    });
    runtimePlain.initialize();
    runtimePlain.close();

    // 2. Open with encryption enabled
    const runtimeEnc = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: key,
      enableEncryption: true,
    });
    const dbEnc = runtimeEnc.initialize();
    expect(dbEnc.prepare('SELECT * FROM notes').all()).toEqual([
      { id: 1, text: 'hello' },
    ]);
    runtimeEnc.close();

    // 3. Verify plain open without key fails
    const unkeyed = new Database(databasePath);
    expect(() => unkeyed.prepare('SELECT * FROM notes').all()).toThrow(
      /file is not a database/,
    );
    unkeyed.close();
  });
});
