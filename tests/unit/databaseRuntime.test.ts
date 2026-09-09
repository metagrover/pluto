import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';
import { deriveDatabaseKey } from '../../electron/crypto/keyDerivation';
import { DatabaseLifecycleError } from '../../electron/database/errors';
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
});

describe('createDatabaseRuntime with encryption', () => {
  let tempDir: string;
  let dbPath: string;
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  const validKeyHex =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const wrongKeyHex =
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-runtime-test-'));
    dbPath = path.join(tempDir, 'pluto.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('initializes a fresh encrypted database when encryptionKeyHex is provided', () => {
    const runtime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: validKeyHex,
    });

    const conn = runtime.initialize();
    expect(conn.open).toBe(true);
    expect(conn.pragma('quick_check', { simple: true })).toBe('ok');
    expect(conn.pragma('cipher_integrity_check')).toEqual([]);
    runtime.close();

    // Verify raw file on disk is not plaintext SQLite
    const header = Buffer.alloc(16);
    const fd = fs.openSync(dbPath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    expect(header.toString('utf8')).not.toBe('SQLite format 3\0');
  });

  it('refuses to open an encrypted database without a key and does NOT replace it', () => {
    const encryptedRuntime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: validKeyHex,
    });
    encryptedRuntime.initialize();
    encryptedRuntime.close();

    const originalStat = fs.statSync(dbPath);

    // Try to open without key
    const unkeyedRuntime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      enableEncryption: true,
    });

    try {
      unkeyedRuntime.initialize();
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseLifecycleError);
      expect((err as DatabaseLifecycleError).code).toBe(
        'database_key_unavailable',
      );
    }

    // Ensure original file was NOT deleted, replaced, or modified
    const currentStat = fs.statSync(dbPath);
    expect(currentStat.size).toBe(originalStat.size);
  });

  it('refuses to open an encrypted database with the wrong key and does NOT replace it', () => {
    const encryptedRuntime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: validKeyHex,
    });
    encryptedRuntime.initialize();
    encryptedRuntime.close();

    const originalStat = fs.statSync(dbPath);

    // Try to open with wrong key
    const wrongKeyRuntime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: wrongKeyHex,
    });

    try {
      wrongKeyRuntime.initialize();
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseLifecycleError);
      expect((err as DatabaseLifecycleError).code).toBe(
        'database_key_rejected',
      );
    }

    // Ensure original file was NOT deleted, replaced, or modified
    const currentStat = fs.statSync(dbPath);
    expect(currentStat.size).toBe(originalStat.size);
  });

  it('automatically migrates an existing plaintext database when initialized with encryptionKeyHex', () => {
    const plainDb = new Database(dbPath);
    plainDb.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, text TEXT);');
    plainDb
      .prepare("INSERT INTO notes (id, text) VALUES ('n1', 'Secret Note')")
      .run();
    plainDb.close();

    const runtime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: validKeyHex,
    });

    const conn = runtime.initialize();
    expect(conn.pragma('cipher_integrity_check')).toEqual([]);

    const note = conn.prepare('SELECT * FROM notes WHERE id = ?').get('n1') as {
      text: string;
    };
    expect(note.text).toBe('Secret Note');
    runtime.close();
  });

  it('automatically upgrades an existing pre-encryption plaintext database with ApplicationKeyStore', () => {
    // Simulate pre-encryption Pluto database: exists, has data, but NO key envelope exists
    const plainDb = new Database(dbPath);
    plainDb.exec('CREATE TABLE user_notes (id TEXT PRIMARY KEY, title TEXT);');
    plainDb
      .prepare(
        "INSERT INTO user_notes (id, title) VALUES ('un-1', 'Legacy Meeting Note')",
      )
      .run();
    plainDb.close();

    const keyStore = new ApplicationKeyStore({
      storageDir: tempDir,
    });

    // Ensure no key envelope exists yet before upgrade
    expect(keyStore.hasMasterKey()).toBe(false);

    // Upgraded Pluto starts with keyStore
    const runtime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      keyStore,
    });

    const conn = runtime.initialize();
    expect(conn.open).toBe(true);
    expect(conn.pragma('cipher_integrity_check')).toEqual([]);

    // Master key was created during upgrade
    expect(keyStore.hasMasterKey()).toBe(true);

    // Data was preserved bit-for-bit in encrypted format
    const row = conn
      .prepare('SELECT * FROM user_notes WHERE id = ?')
      .get('un-1') as {
      title: string;
    };
    expect(row.title).toBe('Legacy Meeting Note');
    runtime.close();

    // Verify raw file on disk is now SQLCipher ciphertext (not plaintext)
    const header = Buffer.alloc(16);
    const fd = fs.openSync(dbPath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    expect(header.toString('utf8')).not.toBe('SQLite format 3\0');
  });

  it('fails closed with typed database_key_unavailable when Keychain is locked', () => {
    const lockedKeyStore = new ApplicationKeyStore({
      storageDir: tempDir,
      backend: {
        isEncryptionAvailable: () => false,
        encryptString: () => {
          throw new Error('OS key storage is unavailable or locked');
        },
        decryptString: () => {
          throw new Error('OS key storage is unavailable or locked');
        },
      },
    });

    const runtime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      keyStore: lockedKeyStore,
    });

    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({
        code: 'database_key_unavailable',
      }),
    );
  });

  it('allows retry after database_key_rejected and consults keyStore again', () => {
    const salt = Buffer.alloc(16, 0x12);
    const validMasterKey = Buffer.alloc(32, 0xaa);
    const badMasterKey = Buffer.alloc(32, 0xbb);
    const derivedValidHex = deriveDatabaseKey(validMasterKey, salt).toString(
      'hex',
    );

    // Initialize an encrypted database with derivedValidHex
    const initRuntime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      encryptionKeyHex: derivedValidHex,
    });
    const firstConn = initRuntime.initialize();
    firstConn.exec('CREATE TABLE sample (id TEXT);');
    initRuntime.close();

    // Now create a runtime using a mock keyStore that initially returns badMasterKey, then validMasterKey
    let currentKey = badMasterKey;
    const mockKeyStore = {
      hasMasterKey: () => true,
      getMasterKey: () => ({
        key: currentKey,
        keyId: 'mock-id',
        salt,
      }),
      getOrCreateMasterKey: () => ({
        key: currentKey,
        keyId: 'mock-id',
        salt,
      }),
    } as unknown as ApplicationKeyStore;

    const runtime = createDatabaseRuntime({
      databasePath: dbPath,
      migrationsFolder,
      keyStore: mockKeyStore,
    });

    // First attempt: key is rejected because badMasterKey is used
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({
        code: 'database_key_rejected',
      }),
    );

    // Runtime state must not be permanently closed
    expect(runtime.state).not.toBe('closed');

    // Update key in store (simulating user unlocking Keychain or entering correct password)
    currentKey = validMasterKey;

    // Retry via getConnection(): must consult keyStore again and succeed, NOT throw database_closed!
    const retryConn = runtime.getConnection();
    expect(retryConn.open).toBe(true);
    expect(runtime.state).toBe('open');
    runtime.close();
    expect(runtime.state).toBe('closed');
  });
});
