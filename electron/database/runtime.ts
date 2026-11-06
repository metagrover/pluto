import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  ApplicationKeyAccessError,
  ApplicationKeyBindingMismatchError,
  type ApplicationKeyStore,
} from '../crypto/applicationKeyStore';
import { deriveDatabaseKey } from '../crypto/keyDerivation';
import { adoptLegacyDatabase, backupLegacyDatabase } from './adoption';
import {
  type StagedDatabase,
  cleanupStagedDatabase,
  stageDatabaseArtifacts,
} from './artifacts';
import {
  DatabaseEncryptionMigrator,
  isPlaintextSqliteDatabase,
} from './encryptionMigration';
import { DatabaseLifecycleError } from './errors';
import {
  type DatabaseIntegrityCheckRequest,
  checkDatabaseIntegrity,
  probeDatabaseReadable,
} from './integrityCheck';
import {
  assertSupportedMigrationHistory,
  getPendingMigrationId,
  readAppliedMigrationHistory,
  readPackagedMigrationHistory,
  reconcileWorkspaceChatMigrationFork,
} from './migrationHistory';

export interface DatabaseRuntime {
  initialize(): Database.Database;
  getConnection(): Database.Database;
  close(): void;
  readonly state: 'new' | 'open' | 'closed';
  /**
   * Where a separate connection can run the full check of the open database,
   * or null for an in-memory or unopened database.
   */
  integrityCheckRequest?(): DatabaseIntegrityCheckRequest | null;
}

/**
 * `full` runs `quick_check` and `foreign_key_check` over the whole file before
 * returning the connection. `deferred` only proves the file opens with this key
 * and reads its schema; the caller owns running the full check later. Both run
 * the full check after applying migrations.
 */
export type DatabaseIntegrityCheckMode = 'full' | 'deferred';

export interface DatabaseRuntimeOptions {
  databasePath: string;
  migrationsFolder: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  cleanupStaged?: (staged: StagedDatabase) => void;
  openConnection?: (databasePath: string) => Database.Database;
  encryptionKeyHex?: string;
  keyStore?: ApplicationKeyStore;
  enableEncryption?: boolean;
  integrityCheck?: DatabaseIntegrityCheckMode;
}

type DatabaseKind = 'blank' | 'legacy' | 'managed';

const sqliteCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('code' in error))
    return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

const isCorruptionError = (error: unknown) => {
  const code = sqliteCode(error);
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB';
};

const prepareDirectory = (databasePath: string) => {
  if (databasePath === ':memory:') return;
  const parent = path.dirname(databasePath);
  if (!path.isAbsolute(databasePath) || path.extname(databasePath) !== '.db') {
    throw new DatabaseLifecycleError(
      'database_path_invalid',
      'Database path must be an absolute .db path.',
    );
  }
  try {
    fs.mkdirSync(parent, { recursive: true });
    if (!fs.statSync(parent).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_directory_unavailable',
      'Database directory cannot be prepared.',
      {},
      { cause: error },
    );
  }
};

const openDatabase = (
  databasePath: string,
  opener: (databasePath: string) => Database.Database,
) => {
  try {
    return opener(databasePath);
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_open_failed',
      'SQLite could not open the database.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

const configureConnection = (sqlite: Database.Database, inMemory: boolean) => {
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = FULL');
    sqlite.pragma('busy_timeout = 5000');
    const journalMode = sqlite.pragma('journal_mode', { simple: true });
    if (
      sqlite.pragma('foreign_keys', { simple: true }) !== 1 ||
      (inMemory ? journalMode !== 'memory' : journalMode !== 'wal') ||
      sqlite.pragma('synchronous', { simple: true }) !== 2 ||
      sqlite.pragma('busy_timeout', { simple: true }) !== 5000
    ) {
      throw new Error('SQLite did not accept the required connection policy.');
    }
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_configuration_failed',
      'SQLite connection policy could not be applied.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

const verifyHealth = (sqlite: Database.Database) => {
  try {
    const result = checkDatabaseIntegrity(sqlite);
    if (!result.ok) {
      throw Object.assign(new Error(`${result.failure} failed`), {
        code: result.sqliteCode,
      });
    }
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_integrity_failed',
      'SQLite health verification failed.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

const verifyReadable = (sqlite: Database.Database) => {
  try {
    probeDatabaseReadable(sqlite);
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_integrity_failed',
      'SQLite could not read the database schema.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

const classifyDatabase = (sqlite: Database.Database): DatabaseKind => {
  try {
    const tableNames = (
      sqlite
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    if (tableNames.includes('__drizzle_migrations')) return 'managed';
    return tableNames.length === 0 ? 'blank' : 'legacy';
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_integrity_failed',
      'SQLite schema inspection failed.',
      { sqliteCode: sqliteCode(error) },
      { cause: error },
    );
  }
};

export const createDatabaseRuntime = (
  options: DatabaseRuntimeOptions,
): DatabaseRuntime => {
  let currentState: DatabaseRuntime['state'] = 'new';
  let connection: Database.Database | null = null;
  let connectionKeyHex: string | null = null;
  const inMemory = options.databasePath === ':memory:';
  const deferIntegrityCheck = options.integrityCheck === 'deferred';
  const cleanup = options.cleanupStaged ?? cleanupStagedDatabase;
  const opener =
    options.openConnection ?? ((databasePath) => new Database(databasePath));
  const packaged = () => readPackagedMigrationHistory(options.migrationsFolder);

  const closeConnection = () => {
    if (connection?.open) connection.close();
    connection = null;
    connectionKeyHex = null;
  };

  const preflightMigrationHistory = (sqlite: Database.Database) => {
    const packagedHistory = packaged();
    reconcileWorkspaceChatMigrationFork(
      sqlite,
      options.migrationsFolder,
      packagedHistory,
    );
    assertSupportedMigrationHistory(
      readAppliedMigrationHistory(sqlite),
      packagedHistory,
    );
  };

  const applyPendingMigrations = (sqlite: Database.Database) => {
    const packagedHistory = packaged();
    reconcileWorkspaceChatMigrationFork(
      sqlite,
      options.migrationsFolder,
      packagedHistory,
    );
    const applied = readAppliedMigrationHistory(sqlite);
    assertSupportedMigrationHistory(applied, packagedHistory);
    const pendingMigrationId = getPendingMigrationId(applied, packagedHistory);
    if (!pendingMigrationId) return false;

    let migrationFailure: DatabaseLifecycleError | undefined;
    try {
      sqlite.pragma('foreign_keys = OFF');
      migrate(drizzle(sqlite), { migrationsFolder: options.migrationsFolder });
    } catch (error) {
      migrationFailure = new DatabaseLifecycleError(
        'database_migration_failed',
        'A packaged database migration failed.',
        { migrationId: pendingMigrationId, sqliteCode: sqliteCode(error) },
        { cause: error },
      );
    }
    let restorationFailure: DatabaseLifecycleError | undefined;
    try {
      sqlite.pragma('foreign_keys = ON');
      if (sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new Error('SQLite did not restore foreign-key enforcement.');
      }
    } catch (error) {
      restorationFailure = new DatabaseLifecycleError(
        'database_configuration_failed',
        'SQLite foreign-key enforcement could not be restored.',
        { sqliteCode: sqliteCode(error) },
        { cause: error },
      );
    }
    if (migrationFailure) throw migrationFailure;
    if (restorationFailure) throw restorationFailure;
    assertSupportedMigrationHistory(
      readAppliedMigrationHistory(sqlite),
      packagedHistory,
    );
    return true;
  };

  const isEncryptedDatabaseTarget = (
    databasePath: string,
    isEncryptionConfigured: boolean,
  ): boolean => {
    if (databasePath === ':memory:') return false;
    if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) {
      return false;
    }
    if (isPlaintextSqliteDatabase(databasePath)) {
      return false;
    }
    if (isEncryptionConfigured) {
      return true;
    }
    const envelopePath = path.join(
      path.dirname(databasePath),
      'app-key-envelope.json',
    );
    return fs.existsSync(envelopePath);
  };

  const resolveEncryptionKeyHex = (): string | null => {
    if (options.encryptionKeyHex) return options.encryptionKeyHex;
    if (options.keyStore) {
      try {
        const exists =
          !inMemory &&
          fs.existsSync(options.databasePath) &&
          fs.statSync(options.databasePath).size > 0;
        if (!exists) {
          const master = options.keyStore.getOrCreateMasterKey();
          return deriveDatabaseKey(master.key, master.salt).toString('hex');
        }

        const isPlaintext = isPlaintextSqliteDatabase(options.databasePath);
        if (isPlaintext) {
          const master =
            options.keyStore.getMasterKey() ??
            options.keyStore.getOrCreateMasterKey();
          return deriveDatabaseKey(master.key, master.salt).toString('hex');
        }

        const master = options.keyStore.getMasterKey();
        if (!master) {
          throw new DatabaseLifecycleError(
            'database_key_unavailable',
            'Database encryption key envelope is missing beside existing database.',
            { keyAccessStage: 'missing_envelope' },
          );
        }
        return deriveDatabaseKey(master.key, master.salt).toString('hex');
      } catch (error) {
        if (error instanceof DatabaseLifecycleError) throw error;
        if (error instanceof ApplicationKeyBindingMismatchError) {
          throw new DatabaseLifecycleError(
            'database_key_identity_mismatch',
            'Database key belongs to a legacy or differently signed application identity.',
            {},
            { cause: error },
          );
        }
        if (error instanceof ApplicationKeyAccessError) {
          throw new DatabaseLifecycleError(
            'database_key_unavailable',
            'Database encryption key cannot be accessed.',
            { keyAccessStage: error.stage },
            { cause: error },
          );
        }
        throw new DatabaseLifecycleError(
          'database_key_unavailable',
          'Database encryption key is unavailable or locked in macOS Keychain.',
          {},
          { cause: error },
        );
      }
    }
    return null;
  };

  const openWithKey = (dbPath: string, keyHex: string | null) => {
    const sqlite = openDatabase(dbPath, opener);
    if (keyHex && dbPath !== ':memory:') {
      try {
        sqlite.pragma("cipher = 'sqlcipher'");
        sqlite.pragma(`key = "x'${keyHex}'"`);
      } catch (error) {
        sqlite.close();
        throw new DatabaseLifecycleError(
          'database_cipher_unsupported',
          'Could not apply cipher to database connection.',
          { sqliteCode: sqliteCode(error) },
          { cause: error },
        );
      }
    }
    connectionKeyHex = keyHex;
    return sqlite;
  };

  const initializeFresh = (keyHex: string | null) => {
    connection = openWithKey(options.databasePath, keyHex);
    preflightMigrationHistory(connection);
    configureConnection(connection, inMemory);
    applyPendingMigrations(connection);
    verifyHealth(connection);
    return connection;
  };

  const replaceExisting = (
    reason: 'integrity-failed',
    keyHex: string | null,
  ) => {
    closeConnection();
    const staged = stageDatabaseArtifacts(options.databasePath, reason);
    try {
      const sqlite = initializeFresh(keyHex);
      try {
        cleanup(staged);
      } catch (error) {
        throw error instanceof DatabaseLifecycleError
          ? error
          : new DatabaseLifecycleError(
              'database_cleanup_failed',
              'Could not delete verified staged database artifacts.',
              {},
              { cause: error },
            );
      }
      return sqlite;
    } catch (error) {
      closeConnection();
      throw error;
    }
  };

  return {
    get state() {
      return currentState;
    },
    initialize() {
      if (currentState === 'closed') {
        throw new DatabaseLifecycleError(
          'database_closed',
          'Database runtime is closed.',
        );
      }
      if (connection) return connection;

      prepareDirectory(options.databasePath);
      const fileExists =
        !inMemory &&
        fs.existsSync(options.databasePath) &&
        fs.statSync(options.databasePath).size > 0;
      let keyHex: string | null = null;
      const encryptionConfigured = Boolean(
        options.enableEncryption ||
          options.keyStore ||
          options.encryptionKeyHex,
      );
      if (encryptionConfigured) {
        keyHex = resolveEncryptionKeyHex();
      }

      if (
        fileExists &&
        keyHex &&
        isPlaintextSqliteDatabase(options.databasePath)
      ) {
        const migrator = new DatabaseEncryptionMigrator({
          databasePath: options.databasePath,
          rawDatabaseKeyHex: keyHex,
          logger: options.logger,
        });
        migrator.migrate();
      }

      const isEncrypted = isEncryptedDatabaseTarget(
        options.databasePath,
        encryptionConfigured,
      );
      if (isEncrypted && !keyHex) {
        throw new DatabaseLifecycleError(
          'database_key_unavailable',
          'Database is encrypted but no encryption key is available.',
        );
      }

      try {
        connection = openWithKey(options.databasePath, keyHex);
        try {
          if (deferIntegrityCheck) verifyReadable(connection);
          else verifyHealth(connection);
        } catch (error) {
          const cause =
            error instanceof DatabaseLifecycleError ? error.cause : error;
          const code = sqliteCode(cause);

          if (isEncrypted) {
            // Encrypted database must NEVER reach replaceExisting!
            if (code === 'SQLITE_NOTADB') {
              throw new DatabaseLifecycleError(
                keyHex ? 'database_key_rejected' : 'database_key_unavailable',
                keyHex
                  ? 'Database encryption key was rejected or database is corrupted.'
                  : 'Database is encrypted but no encryption key is available.',
                { sqliteCode: code },
                { cause },
              );
            }
            throw error;
          }

          if (
            !inMemory &&
            (isCorruptionError(error) ||
              error instanceof DatabaseLifecycleError)
          ) {
            if (
              isCorruptionError(cause) ||
              (error instanceof DatabaseLifecycleError &&
                error.code === 'database_integrity_failed')
            ) {
              connection = replaceExisting('integrity-failed', keyHex);
              currentState = 'open';
              return connection;
            }
          }
          throw error;
        }

        const kind = classifyDatabase(connection);
        if (kind === 'legacy') {
          backupLegacyDatabase(options.databasePath);
          adoptLegacyDatabase({
            sqlite: connection,
            migrationsFolder: options.migrationsFolder,
            packagedHistory: packaged(),
          });
        }
        preflightMigrationHistory(connection);
        configureConnection(connection, inMemory);
        const migrated = applyPendingMigrations(connection);
        // Migrations run with foreign keys off, so always prove them after.
        if (migrated || !deferIntegrityCheck) verifyHealth(connection);
        currentState = 'open';
        return connection;
      } catch (error) {
        closeConnection();
        throw error;
      }
    },
    integrityCheckRequest() {
      if (inMemory || !connection || currentState !== 'open') return null;
      return { databasePath: options.databasePath, keyHex: connectionKeyHex };
    },
    getConnection() {
      if (currentState === 'closed') {
        throw new DatabaseLifecycleError(
          'database_closed',
          'Database runtime is closed.',
        );
      }
      if (!connection) return this.initialize();
      return connection;
    },
    close() {
      if (currentState === 'closed') return;
      closeConnection();
      currentState = 'closed';
    },
  };
};
