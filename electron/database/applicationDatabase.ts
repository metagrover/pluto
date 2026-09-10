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

export interface ApplicationDatabase {
  initialize(): Database.Database;
  getConnection(): Database.Database;
  runStartupRecovery(): StartupRecoveryResult;
  close(): void;
}

interface ApplicationDatabaseOptions extends DatabaseRuntimeOptions {
  createRuntime?: (options: DatabaseRuntimeOptions) => DatabaseRuntime;
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

const getOwner = () => {
  if (!applicationDatabase) {
    const appRoot =
      typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    applicationDatabase = createApplicationDatabase({
      databasePath: resolveApplicationDatabasePath({
        userDataPath: app.getPath('userData'),
      }),
      migrationsFolder: resolveMigrationsFolder({
        isPackaged: app.isPackaged ?? false,
        appRoot,
        resourcesPath: process.resourcesPath ?? appRoot,
      }),
      keyStore: new ApplicationKeyStore(),
    });
  }
  return applicationDatabase;
};

export const initializeApplicationDatabase = (): Database.Database => {
  return getOwner().initialize();
};

export const getApplicationDatabase = (): Database.Database =>
  getOwner().getConnection();

export const closeApplicationDatabase = (): void => {
  if (applicationDatabase) {
    applicationDatabase.close();
    applicationDatabase = null;
  }
};
