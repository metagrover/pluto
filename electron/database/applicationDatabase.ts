import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { ApplicationKeyStore } from '../crypto/applicationKeyStore';
import { resolveUnpackedExecutablePath } from '../packagedExecutablePath';
import {
  type DatabaseIntegrityCheckRequest,
  type DatabaseIntegrityResult,
  checkDatabaseIntegrity,
  clearStartupIntegrityCheckRequirement,
  isStartupIntegrityCheckRequired,
  requireStartupIntegrityCheck,
  runIntegrityCheckInWorker,
} from './integrityCheck';
import {
  type DatabaseRuntime,
  type DatabaseRuntimeOptions,
  createDatabaseRuntime,
} from './runtime';
import {
  type StartupRecoveryResult,
  runDatabaseStartupRecovery,
} from './startupRecovery';
import { resolveDatabaseStorageMode } from './storageSetup';

export interface ApplicationDatabase {
  initialize(): Database.Database;
  getConnection(): Database.Database;
  runStartupRecovery(): StartupRecoveryResult;
  /**
   * Full integrity check of the open database, off the main thread when
   * possible. A failure is remembered so the next launch checks before opening
   * the window. Resolves null when no check applies (in-memory, or the full
   * check already ran during this startup).
   */
  verifyIntegrity(): Promise<DatabaseIntegrityResult | null>;
  close(): void;
}

interface ApplicationDatabaseOptions extends DatabaseRuntimeOptions {
  createRuntime?: (options: DatabaseRuntimeOptions) => DatabaseRuntime;
  runIntegrityCheck?: (
    request: DatabaseIntegrityCheckRequest,
  ) => Promise<DatabaseIntegrityResult>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const defaultIntegrityWorkerPath = () =>
  resolveUnpackedExecutablePath(
    path.join(currentDir, 'databaseIntegrityWorker.js'),
  );

interface InitializeApplicationDatabaseOptions {
  keyStore?: ApplicationKeyStore;
  storageMode?: 'standard' | 'encrypted';
}

export const createApplicationDatabase = (
  options: ApplicationDatabaseOptions,
): ApplicationDatabase => {
  // Every launch used to run the full check before the window showed. Now it
  // runs in the background, unless an earlier background check found damage.
  const startupCheckRequired = isStartupIntegrityCheckRequired(
    options.databasePath,
  );
  const integrityCheck =
    options.integrityCheck ?? (startupCheckRequired ? 'full' : 'deferred');
  const runtime = (options.createRuntime ?? createDatabaseRuntime)({
    ...options,
    integrityCheck,
  });
  const log = options.logger ?? console;
  let recovered = false;
  let checkedAtStartup = false;
  const initialize = () => {
    const connection = runtime.initialize();
    if (integrityCheck === 'full' && !checkedAtStartup) {
      checkedAtStartup = true;
      if (startupCheckRequired)
        clearStartupIntegrityCheckRequirement(options.databasePath);
    }
    if (!recovered) {
      try {
        runDatabaseStartupRecovery(connection);
        recovered = true;
      } catch (error) {
        runtime.close();
        throw error;
      }
    }
    return connection;
  };
  return {
    initialize,
    getConnection: initialize,
    runStartupRecovery: () =>
      runDatabaseStartupRecovery(runtime.getConnection()),
    verifyIntegrity: async () => {
      if (runtime.state !== 'open' || integrityCheck === 'full') return null;
      const request = runtime.integrityCheckRequest?.();
      if (!request) return null;
      let result: DatabaseIntegrityResult;
      try {
        result = await (
          options.runIntegrityCheck ??
          ((input) =>
            runIntegrityCheckInWorker(defaultIntegrityWorkerPath(), input))
        )(request);
      } catch (error) {
        // An inconclusive worker must not drop the guarantee: check on the
        // app's own connection instead, accepting a main-thread pause.
        log.warn('Background database check unavailable; checking inline.', {
          name: error instanceof Error ? error.name : typeof error,
        });
        if (runtime.state !== 'open') return null;
        try {
          result = checkDatabaseIntegrity(runtime.getConnection());
        } catch (inlineError) {
          log.warn('Database integrity check was inconclusive.', {
            name:
              inlineError instanceof Error
                ? inlineError.name
                : typeof inlineError,
          });
          return null;
        }
      }
      if (result.ok)
        clearStartupIntegrityCheckRequirement(options.databasePath);
      else requireStartupIntegrityCheck(options.databasePath, result.failure);
      return result;
    },
    close: () => runtime.close(),
  };
};

let applicationDatabase: ApplicationDatabase | null = null;

export const resolveApplicationDatabasePath = (input: {
  userDataPath: string;
}): string => path.join(input.userDataPath, 'pluto.db');

export const resolveMigrationsFolder = (input: {
  isPackaged: boolean;
  appRoot: string;
  resourcesPath: string;
}): string =>
  path.join(input.isPackaged ? input.resourcesPath : input.appRoot, 'drizzle');

const getOwner = (options: InitializeApplicationDatabaseOptions = {}) => {
  if (!applicationDatabase) {
    const appRoot =
      typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    const databasePath = resolveApplicationDatabasePath({
      userDataPath: app.getPath('userData'),
    });
    const storedMode = resolveDatabaseStorageMode(databasePath);
    // Older unit tests construct an isolated database before onboarding runs.
    // Keep that test fixture explicit while packaged and development profiles
    // still require the user's saved choice.
    const storageMode =
      options.storageMode ??
      storedMode ??
      (process.env.VITEST === 'true' ? 'standard' : null);
    if (!storageMode || (storedMode && storedMode !== storageMode)) {
      throw new Error(
        'Database storage setup is required or does not match this profile',
      );
    }
    applicationDatabase = createApplicationDatabase({
      databasePath,
      migrationsFolder: resolveMigrationsFolder({
        isPackaged: app.isPackaged ?? false,
        appRoot,
        resourcesPath: process.resourcesPath ?? appRoot,
      }),
      keyStore:
        storageMode === 'encrypted'
          ? (options.keyStore ?? new ApplicationKeyStore())
          : undefined,
    });
  }
  return applicationDatabase;
};

export const initializeApplicationDatabase = (
  options: InitializeApplicationDatabaseOptions = {},
): Database.Database => {
  return getOwner(options).initialize();
};

export const getApplicationDatabase = (): Database.Database =>
  getOwner().getConnection();

export const verifyApplicationDatabaseIntegrity =
  (): Promise<DatabaseIntegrityResult | null> =>
    applicationDatabase
      ? applicationDatabase.verifyIntegrity()
      : Promise.resolve(null);

export const closeApplicationDatabase = (): void => {
  if (applicationDatabase) {
    applicationDatabase.close();
    applicationDatabase = null;
  }
};
