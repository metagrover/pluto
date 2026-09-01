import path from 'node:path';
import type Database from 'better-sqlite3';
import { app } from 'electron';
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
      runDatabaseStartupRecovery(connection);
      recovered = true;
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

const getOwner = () => {
  if (!applicationDatabase) {
    applicationDatabase = createApplicationDatabase({
      databasePath: path.join(app.getPath('userData'), 'pluto.db'),
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });
  }
  return applicationDatabase;
};

export const initializeApplicationDatabase = (): Database.Database => {
  return getOwner().initialize();
};

export const getApplicationDatabase = (): Database.Database =>
  getOwner().getConnection();

export const closeApplicationDatabase = (): void => getOwner().close();
