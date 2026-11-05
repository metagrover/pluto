import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApplicationDatabase } from '../../electron/database/applicationDatabase';
import {
  DATABASE_INTEGRITY_NOTICE,
  createBackgroundIntegrityMonitor,
} from '../../electron/database/backgroundIntegrity';
import { DatabaseLifecycleError } from '../../electron/database/errors';
import {
  integrityCheckMarkerPath,
  runIntegrityCheckInWorker,
} from '../../electron/database/integrityCheck';
import {
  type DatabaseRuntimeOptions,
  createDatabaseRuntime,
} from '../../electron/database/runtime';
import { buildTestDatabaseIntegrityWorker } from './helpers/databaseIntegrityWorker';

const migrationsFolder = path.join(process.cwd(), 'drizzle');
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const WRONG_KEY = 'f'.repeat(64);
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const roots: string[] = [];
const makeDatabasePath = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-db-integrity-'));
  roots.push(root);
  return path.join(root, 'pluto.db');
};
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

// Records the pragmas the runtime runs, to tell a full check from a probe.
const recordingOpener = (pragmas: string[]) => (databasePath: string) => {
  const sqlite = new Database(databasePath);
  const pragma = sqlite.pragma.bind(sqlite);
  sqlite.pragma = ((source: string, options?: { simple?: boolean }) => {
    pragmas.push(source);
    return pragma(source, options);
  }) as typeof sqlite.pragma;
  return sqlite;
};

const createManagedDatabase = (
  databasePath: string,
  options: Partial<DatabaseRuntimeOptions> = {},
) => {
  const runtime = createDatabaseRuntime({
    databasePath,
    migrationsFolder,
    ...options,
  });
  const sqlite = runtime.initialize();
  // Enough pages that the last ones belong to this table, not the schema.
  sqlite.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, body TEXT)');
  const insert = sqlite.prepare('INSERT INTO filler (body) VALUES (?)');
  sqlite.transaction(() => {
    for (let i = 0; i < 2000; i += 1) insert.run('x'.repeat(400));
  })();
  const pageSize = Number(sqlite.pragma('page_size', { simple: true }));
  runtime.close();
  return pageSize;
};

// Overwrites a table page near the end of the file. The schema on page 1
// still reads, so only a full check notices.
const corruptTablePage = (databasePath: string, pageSize: number) => {
  const size = fs.statSync(databasePath).size;
  const fd = fs.openSync(databasePath, 'r+');
  fs.writeSync(
    fd,
    Buffer.alloc(pageSize, 0xff),
    0,
    pageSize,
    size - pageSize * 3,
  );
  fs.closeSync(fd);
};

describe('startup integrity check mode', () => {
  it('opens without a full check in deferred mode, and keeps it in full mode', () => {
    const databasePath = makeDatabasePath();
    createManagedDatabase(databasePath);

    const deferred: string[] = [];
    createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      integrityCheck: 'deferred',
      openConnection: recordingOpener(deferred),
    })
      .initialize()
      .close();
    expect(deferred).not.toContain('quick_check');
    expect(deferred).not.toContain('foreign_key_check');
    expect(deferred).toContain('schema_version');

    const full: string[] = [];
    createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      openConnection: recordingOpener(full),
    })
      .initialize()
      .close();
    expect(full).toContain('quick_check');
    expect(full).toContain('foreign_key_check');
  });

  it('still runs the full check after applying migrations in deferred mode', () => {
    const pragmas: string[] = [];
    const runtime = createDatabaseRuntime({
      databasePath: makeDatabasePath(),
      migrationsFolder,
      integrityCheck: 'deferred',
      openConnection: recordingOpener(pragmas),
    });
    runtime.initialize();
    runtime.close();
    expect(pragmas).toContain('quick_check');
    expect(pragmas).toContain('foreign_key_check');
  });

  it('rejects a wrong key without replacing the encrypted database', () => {
    const databasePath = makeDatabasePath();
    createManagedDatabase(databasePath, { encryptionKeyHex: KEY });
    const before = fs.readFileSync(databasePath);

    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: WRONG_KEY,
      integrityCheck: 'deferred',
    });
    expect(() => runtime.initialize()).toThrowError(
      expect.objectContaining({ code: 'database_key_rejected' }),
    );
    expect(fs.readFileSync(databasePath).equals(before)).toBe(true);
  });

  it('opens a database with a damaged table page, which only the full check catches', () => {
    const databasePath = makeDatabasePath();
    corruptTablePage(databasePath, createManagedDatabase(databasePath));
    const before = fs.readFileSync(databasePath);

    const deferred = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      integrityCheck: 'deferred',
    });
    expect(deferred.initialize().open).toBe(true);
    expect(deferred.integrityCheckRequest?.()).toEqual({
      databasePath,
      keyHex: null,
    });
    deferred.close();
    expect(fs.readFileSync(databasePath).equals(before)).toBe(true);

    const encryptedPath = makeDatabasePath();
    corruptTablePage(
      encryptedPath,
      createManagedDatabase(encryptedPath, { encryptionKeyHex: KEY }),
    );
    const encryptedBefore = fs.readFileSync(encryptedPath);
    // The full check keeps failing closed for encrypted databases.
    expect(() =>
      createDatabaseRuntime({
        databasePath: encryptedPath,
        migrationsFolder,
        encryptionKeyHex: KEY,
        integrityCheck: 'full',
      }).initialize(),
    ).toThrowError(DatabaseLifecycleError);
    expect(fs.readFileSync(encryptedPath).equals(encryptedBefore)).toBe(true);
  });
});

describe('background integrity check worker', () => {
  let worker: Awaited<ReturnType<typeof buildTestDatabaseIntegrityWorker>>;
  beforeAll(async () => {
    worker = await buildTestDatabaseIntegrityWorker();
  }, 60_000);
  afterAll(() => worker?.close());

  it('passes a healthy encrypted database that the app holds open', async () => {
    const databasePath = makeDatabasePath();
    createManagedDatabase(databasePath, { encryptionKeyHex: KEY });
    const runtime = createDatabaseRuntime({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: KEY,
      integrityCheck: 'deferred',
    });
    const sqlite = runtime.initialize();
    sqlite.prepare("INSERT INTO meetings (id, title) VALUES ('m1', 'A')").run();
    const request = runtime.integrityCheckRequest?.();
    expect(request).toEqual({ databasePath, keyHex: KEY });
    await expect(
      runIntegrityCheckInWorker(worker.path, request!),
    ).resolves.toMatchObject({ ok: true });
    runtime.close();
  });

  it('reports damage in a plaintext and an encrypted database', async () => {
    const plainPath = makeDatabasePath();
    corruptTablePage(plainPath, createManagedDatabase(plainPath));
    await expect(
      runIntegrityCheckInWorker(worker.path, {
        databasePath: plainPath,
        keyHex: null,
      }),
    ).resolves.toMatchObject({ ok: false });

    const encryptedPath = makeDatabasePath();
    corruptTablePage(
      encryptedPath,
      createManagedDatabase(encryptedPath, { encryptionKeyHex: KEY }),
    );
    await expect(
      runIntegrityCheckInWorker(worker.path, {
        databasePath: encryptedPath,
        keyHex: KEY,
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('rejects, rather than reporting damage, when it cannot open the file', async () => {
    await expect(
      runIntegrityCheckInWorker(worker.path, {
        databasePath: path.join(os.tmpdir(), 'pluto-missing', 'pluto.db'),
        keyHex: null,
      }),
    ).rejects.toThrow();
  });
});

describe('application database integrity lifecycle', () => {
  const failingCheck = async () =>
    ({ ok: false, failure: 'quick_check', durationMs: 1 }) as const;

  it('defers the launch check, then requires a full check on the next launch after damage', async () => {
    const databasePath = makeDatabasePath();
    const modes: Array<DatabaseRuntimeOptions['integrityCheck']> = [];
    const createRuntime = (options: DatabaseRuntimeOptions) => {
      modes.push(options.integrityCheck);
      return createDatabaseRuntime(options);
    };

    const first = createApplicationDatabase({
      databasePath,
      migrationsFolder,
      createRuntime,
      runIntegrityCheck: failingCheck,
      logger: silent,
    });
    first.initialize();
    await expect(first.verifyIntegrity()).resolves.toMatchObject({
      ok: false,
      failure: 'quick_check',
    });
    expect(fs.existsSync(integrityCheckMarkerPath(databasePath))).toBe(true);
    first.close();

    const second = createApplicationDatabase({
      databasePath,
      migrationsFolder,
      createRuntime,
      logger: silent,
    });
    second.initialize();
    // A full startup check passed, so the marker is gone and the background
    // check has nothing left to do this launch.
    expect(fs.existsSync(integrityCheckMarkerPath(databasePath))).toBe(false);
    await expect(second.verifyIntegrity()).resolves.toBeNull();
    second.close();

    const third = createApplicationDatabase({
      databasePath,
      migrationsFolder,
      createRuntime,
      runIntegrityCheck: async () => ({ ok: true, durationMs: 1 }),
      logger: silent,
    });
    third.initialize();
    await expect(third.verifyIntegrity()).resolves.toMatchObject({ ok: true });
    third.close();

    expect(modes).toEqual(['deferred', 'full', 'deferred']);
  });

  it('keeps the marker and refuses to open an encrypted database the full check rejects', () => {
    const databasePath = makeDatabasePath();
    corruptTablePage(
      databasePath,
      createManagedDatabase(databasePath, { encryptionKeyHex: KEY }),
    );
    fs.writeFileSync(integrityCheckMarkerPath(databasePath), '{}\n');
    const before = fs.readFileSync(databasePath);

    const owner = createApplicationDatabase({
      databasePath,
      migrationsFolder,
      encryptionKeyHex: KEY,
      logger: silent,
    });
    expect(() => owner.initialize()).toThrowError(DatabaseLifecycleError);
    expect(fs.existsSync(integrityCheckMarkerPath(databasePath))).toBe(true);
    expect(fs.readFileSync(databasePath).equals(before)).toBe(true);
  });

  it('checks on the app connection when the worker cannot run', async () => {
    const databasePath = makeDatabasePath();
    corruptTablePage(databasePath, createManagedDatabase(databasePath));
    const owner = createApplicationDatabase({
      databasePath,
      migrationsFolder,
      runIntegrityCheck: async () => {
        throw new Error('worker unavailable');
      },
      logger: silent,
    });
    owner.initialize();
    await expect(owner.verifyIntegrity()).resolves.toMatchObject({
      ok: false,
    });
    expect(fs.existsSync(integrityCheckMarkerPath(databasePath))).toBe(true);
    owner.close();
  });
});

describe('background integrity monitor', () => {
  it('runs once after the window loads and reports damage to the overlay', async () => {
    const timers: Array<() => void> = [];
    const notify = vi.fn();
    let result = { ok: false, failure: 'quick_check', durationMs: 1 } as const;
    const verify = vi.fn(async () => result as { ok: boolean } as never);
    const monitor = createBackgroundIntegrityMonitor({
      verify,
      notify,
      logger: silent,
      setTimer: (run) => timers.push(run),
    });

    monitor.schedule();
    monitor.schedule();
    expect(timers).toHaveLength(1);
    expect(verify).not.toHaveBeenCalled();

    timers[0]();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(DATABASE_INTEGRITY_NOTICE);
    expect(monitor.currentFailure()).toEqual(DATABASE_INTEGRITY_NOTICE);

    // "Check Again" clears the notice once the database checks out.
    result = { ok: true, durationMs: 1 } as never;
    await expect(monitor.check()).resolves.toBe(true);
    expect(monitor.currentFailure()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('never reports damage for an inconclusive check', async () => {
    const notify = vi.fn();
    const monitor = createBackgroundIntegrityMonitor({
      verify: async () => {
        throw new Error('busy');
      },
      notify,
      logger: silent,
      setTimer: () => {},
    });
    await expect(monitor.check()).resolves.toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(monitor.currentFailure()).toBeNull();
  });
});
