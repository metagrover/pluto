import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';
import {
  type ApplicationDatabase,
  createApplicationDatabase,
} from '../../electron/database/applicationDatabase';
import { isPlaintextSqliteDatabase } from '../../electron/database/encryptionMigration';
import {
  type DatabaseStorageMode,
  initializeDatabaseStorageSetup,
  resolveDatabaseStorageMode,
} from '../../electron/database/storageSetup';

describe('one-time database storage setup', () => {
  let root: string;
  let databasePath: string;
  const owners: ApplicationDatabase[] = [];
  const backend = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`wrapped:${value}`)),
    decryptString: vi.fn((value: Buffer) =>
      value.toString().slice('wrapped:'.length),
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-storage-setup-'));
    databasePath = path.join(root, 'pluto.db');
  });
  afterEach(() => {
    for (const owner of owners.splice(0)) owner.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const keyStore = () => new ApplicationKeyStore({ storageDir: root, backend });
  const open = (mode: DatabaseStorageMode) => {
    const owner = createApplicationDatabase({
      databasePath,
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
      keyStore: mode === 'encrypted' ? keyStore() : undefined,
    });
    owners.push(owner);
    return owner.initialize();
  };
  const setup = (chooseMode: () => DatabaseStorageMode | null) =>
    initializeDatabaseStorageSetup({
      databasePath,
      chooseMode,
      prepareEncryption: () => {
        keyStore().getOrCreateMasterKey();
      },
      initialize: (mode) => {
        open(mode);
      },
    });

  it('creates a standard profile without touching key storage and skips the choice on relaunch', () => {
    const choose = vi.fn(() => 'standard' as const);
    expect(setup(choose)).toBe('standard');
    expect(isPlaintextSqliteDatabase(databasePath)).toBe(true);
    expect(backend.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(backend.encryptString).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'app-key-envelope.json'))).toBe(false);
    owners.pop()!.close();
    expect(setup(choose)).toBe('standard');
    expect(choose).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, 'database-storage.json'), 'utf8'),
      ),
    ).toEqual({ version: 1, mode: 'standard', initialized: true });
  });

  it('asks before unlocking key storage, creates encryption, and preserves key/data on relaunch', () => {
    const choose = vi.fn(() => {
      expect(backend.encryptString).not.toHaveBeenCalled();
      expect(fs.existsSync(databasePath)).toBe(false);
      return 'encrypted' as const;
    });
    expect(setup(choose)).toBe('encrypted');
    expect(isPlaintextSqliteDatabase(databasePath)).toBe(false);
    expect(backend.encryptString).toHaveBeenCalledOnce();
    const envelope = fs.readFileSync(path.join(root, 'app-key-envelope.json'));
    const connection = owners[0].getConnection();
    connection
      .prepare(
        "INSERT INTO meetings (id, title) VALUES ('fictional', 'Sample meeting')",
      )
      .run();
    owners.pop()!.close();
    expect(setup(choose)).toBe('encrypted');
    expect(choose).toHaveBeenCalledOnce();
    expect(
      owners[0]
        .getConnection()
        .prepare("SELECT title FROM meetings WHERE id = 'fictional'")
        .get(),
    ).toEqual({ title: 'Sample meeting' });
    expect(fs.readFileSync(path.join(root, 'app-key-envelope.json'))).toEqual(
      envelope,
    );
    expect(backend.encryptString).toHaveBeenCalledOnce();
  });

  it('does not commit or create a database when key permission is denied, allowing standard setup', () => {
    backend.encryptString.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });
    expect(() => setup(() => 'encrypted')).toThrowError(
      expect.objectContaining({ code: 'database_setup_key_unavailable' }),
    );
    expect(fs.existsSync(databasePath)).toBe(false);
    expect(fs.existsSync(path.join(root, 'database-storage.json'))).toBe(false);
    expect(resolveDatabaseStorageMode(databasePath)).toBeNull();
    expect(setup(() => 'standard')).toBe('standard');
  });

  it('leaves setup untouched when the welcome step is cancelled', () => {
    expect(setup(() => null)).toBeNull();
    expect(fs.readdirSync(root)).toEqual([]);
    expect(backend.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it.each(['standard', 'encrypted'] as const)(
    'preserves an existing %s database without a choice or conversion',
    (mode) => {
      open(mode)
        .prepare(
          "INSERT INTO meetings (id, title) VALUES ('legacy', 'Existing meeting')",
        )
        .run();
      owners.pop()!.close();
      const choose = vi.fn(() => null);
      backend.isEncryptionAvailable.mockClear();
      expect(setup(choose)).toBe(mode);
      expect(choose).not.toHaveBeenCalled();
      expect(isPlaintextSqliteDatabase(databasePath)).toBe(mode === 'standard');
      expect(
        owners[0]
          .getConnection()
          .prepare("SELECT title FROM meetings WHERE id = 'legacy'")
          .get(),
      ).toEqual({ title: 'Existing meeting' });
      if (mode === 'standard')
        expect(backend.isEncryptionAvailable).not.toHaveBeenCalled();
    },
  );

  it('preserves an existing encrypted database when its key is missing', () => {
    open('encrypted');
    owners.pop()!.close();
    fs.unlinkSync(path.join(root, 'app-key-envelope.json'));
    const original = fs.readFileSync(databasePath);
    const choose = vi.fn(() => 'standard' as const);
    expect(() => setup(choose)).toThrowError(
      expect.objectContaining({ code: 'database_key_unavailable' }),
    );
    expect(choose).not.toHaveBeenCalled();
    expect(fs.readFileSync(databasePath)).toEqual(original);
    expect(backend.encryptString).toHaveBeenCalledOnce();
  });

  it('keeps the selected mode when first-run database initialization is interrupted', () => {
    expect(() =>
      initializeDatabaseStorageSetup({
        databasePath,
        chooseMode: () => 'standard',
        prepareEncryption: vi.fn(),
        initialize: () => {
          throw new Error('interrupted before database creation');
        },
      }),
    ).toThrow('interrupted');
    const choose = vi.fn(() => 'encrypted' as const);
    expect(setup(choose)).toBe('standard');
    expect(choose).not.toHaveBeenCalled();
  });

  it('allows choosing again after interruption before encryption permission, but retains an obtained key', () => {
    fs.writeFileSync(
      path.join(root, 'database-storage.json'),
      JSON.stringify({ version: 1, mode: 'encrypted', initialized: false }),
    );
    expect(resolveDatabaseStorageMode(databasePath)).toBeNull();
    keyStore().getOrCreateMasterKey();
    expect(resolveDatabaseStorageMode(databasePath)).toBe('encrypted');
    const choose = vi.fn(() => 'standard' as const);
    expect(setup(choose)).toBe('encrypted');
    expect(choose).not.toHaveBeenCalled();
    expect(backend.encryptString).toHaveBeenCalledOnce();
  });

  it('does not create a database when the storage choice cannot be durably saved', () => {
    const sync = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    try {
      expect(() => setup(() => 'standard')).toThrow('disk full');
      expect(fs.existsSync(databasePath)).toBe(false);
      expect(fs.existsSync(path.join(root, 'database-storage.json'))).toBe(
        false,
      );
      expect(backend.encryptString).not.toHaveBeenCalled();
    } finally {
      sync.mockRestore();
    }
    expect(setup(() => 'standard')).toBe('standard');
  });

  it('fails closed if a completed profile loses its database', () => {
    setup(() => 'standard');
    owners.pop()!.close();
    fs.unlinkSync(databasePath);
    const choose = vi.fn(() => 'standard' as const);
    expect(() => setup(choose)).toThrowError(
      expect.objectContaining({ code: 'database_restore_failed' }),
    );
    expect(choose).not.toHaveBeenCalled();
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it.each([
    'app-key-envelope.json',
    'app-recovery-key.json',
    'pluto.db-wal',
    'pluto.db.migration-journal.json',
    'meetings',
  ])('does not mistake orphaned %s for a fresh profile', (artifact) => {
    fs.writeFileSync(path.join(root, artifact), 'preserved');
    const choose = vi.fn(() => 'standard' as const);
    expect(() => setup(choose)).toThrowError(
      expect.objectContaining({ code: 'database_restore_failed' }),
    );
    expect(choose).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, artifact), 'utf8')).toBe(
      'preserved',
    );
  });

  it('rejects changing the recorded choice rather than converting the existing database', () => {
    setup(() => 'standard');
    owners.pop()!.close();
    const original = fs.readFileSync(databasePath);
    fs.writeFileSync(
      path.join(root, 'database-storage.json'),
      JSON.stringify({ version: 1, mode: 'encrypted', initialized: true }),
    );
    expect(() => setup(() => 'encrypted')).toThrowError(
      expect.objectContaining({ code: 'database_configuration_failed' }),
    );
    expect(fs.readFileSync(databasePath)).toEqual(original);
    expect(backend.encryptString).not.toHaveBeenCalled();
  });

  it('fails closed for malformed choice files and incomplete databases', () => {
    fs.writeFileSync(path.join(root, 'database-storage.json'), '{');
    expect(() => setup(() => 'standard')).toThrowError(
      expect.objectContaining({ code: 'database_configuration_failed' }),
    );
    fs.unlinkSync(path.join(root, 'database-storage.json'));
    fs.writeFileSync(databasePath, '');
    expect(() => setup(() => 'standard')).toThrowError(
      expect.objectContaining({ code: 'database_integrity_failed' }),
    );
  });
});
