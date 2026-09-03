import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  type StagedDatabase,
  cleanupStagedDatabase,
  stageDatabaseArtifacts,
} from './artifacts';
import { DatabaseLifecycleError } from './errors';
import {
  assertSupportedMigrationHistory,
  getPendingMigrationId,
  readAppliedMigrationHistory,
  readPackagedMigrationHistory,
} from './migrationHistory';

export interface DatabaseRuntime {
  initialize(): Database.Database;
  getConnection(): Database.Database;
  close(): void;
  readonly state: 'new' | 'open' | 'closed';
}

export interface DatabaseRuntimeOptions {
  databasePath: string;
  migrationsFolder: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  cleanupStaged?: (staged: StagedDatabase) => void;
  openConnection?: (databasePath: string) => Database.Database;
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
    if (sqlite.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new Error('quick_check failed');
    }
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length !== 0) {
      throw new Error('foreign_key_check failed');
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
  const inMemory = options.databasePath === ':memory:';
  const cleanup = options.cleanupStaged ?? cleanupStagedDatabase;
  const opener =
    options.openConnection ?? ((databasePath) => new Database(databasePath));
  const packaged = () => readPackagedMigrationHistory(options.migrationsFolder);

  const closeConnection = () => {
    if (connection?.open) connection.close();
    connection = null;
  };

  const applyPendingMigrations = (sqlite: Database.Database) => {
    const packagedHistory = packaged();
    const applied = readAppliedMigrationHistory(sqlite);
    assertSupportedMigrationHistory(applied, packagedHistory);
    const pendingMigrationId = getPendingMigrationId(applied, packagedHistory);
    if (!pendingMigrationId) return;

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
  };

  const initializeFresh = () => {
    connection = openDatabase(options.databasePath, opener);
    configureConnection(connection, inMemory);
    applyPendingMigrations(connection);
    verifyHealth(connection);
    return connection;
  };

  const replaceExisting = (reason: 'legacy' | 'integrity-failed') => {
    closeConnection();
    const staged = stageDatabaseArtifacts(options.databasePath, reason);
    try {
      const sqlite = initializeFresh();
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
      try {
        connection = openDatabase(options.databasePath, opener);
        try {
          verifyHealth(connection);
        } catch (error) {
          if (
            !inMemory &&
            (isCorruptionError(error) ||
              error instanceof DatabaseLifecycleError)
          ) {
            const cause =
              error instanceof DatabaseLifecycleError ? error.cause : error;
            if (
              isCorruptionError(cause) ||
              (error instanceof DatabaseLifecycleError &&
                error.code === 'database_integrity_failed')
            ) {
              connection = replaceExisting('integrity-failed');
              currentState = 'open';
              return connection;
            }
          }
          throw error;
        }

        const kind = classifyDatabase(connection);
        if (kind === 'legacy') {
          connection = replaceExisting('legacy');
        } else {
          if (kind === 'managed') {
            assertSupportedMigrationHistory(
              readAppliedMigrationHistory(connection),
              packaged(),
            );
          }
          configureConnection(connection, inMemory);
          applyPendingMigrations(connection);
          verifyHealth(connection);
        }
        currentState = 'open';
        return connection;
      } catch (error) {
        closeConnection();
        currentState = 'closed';
        throw error;
      }
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
