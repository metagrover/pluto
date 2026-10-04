import path from 'node:path';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { ApplicationKeyStore } from '../crypto/applicationKeyStore';
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
  close(): void;
}

interface ApplicationDatabaseOptions extends DatabaseRuntimeOptions {
  createRuntime?: (options: DatabaseRuntimeOptions) => DatabaseRuntime;
}

interface InitializeApplicationDatabaseOptions {
  keyStore?: ApplicationKeyStore;
  storageMode?: 'standard' | 'encrypted';
}

export const createApplicationDatabase = (
  options: ApplicationDatabaseOptions,
): ApplicationDatabase => {
  const runtime = (options.createRuntime ?? createDatabaseRuntime)(options);
  let recovered = false;
  const initialize = () => {
    const connection = runtime.initialize();
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
  try {
    return getOwner(options).initialize();
  } catch (error) {
    // A failed encrypted open must not retain its key store if the user
    // explicitly archives that profile and starts a Standard one.
    closeApplicationDatabase();
    throw error;
  }
};

export const getApplicationDatabase = (): Database.Database =>
  getOwner().getConnection();

export const closeApplicationDatabase = (): void => {
  if (applicationDatabase) {
    applicationDatabase.close();
    applicationDatabase = null;
  }
};
