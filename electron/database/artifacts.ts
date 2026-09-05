import fs from 'node:fs';
import path from 'node:path';
import { DatabaseLifecycleError } from './errors';

export type ReplacementReason = 'legacy' | 'integrity-failed';

export interface StagedDatabase {
  readonly directory: string;
  readonly databasePath: string;
  readonly moved: readonly string[];
}

interface StagingOptions {
  now?: () => Date;
  processId?: number;
  rename?: (from: string, to: string) => void;
}

const SQLITE_SUFFIXES = ['', '-journal', '-shm', '-wal'] as const;
const issuedStagingRecords = new WeakSet<StagedDatabase>();

const assertSafeDatabasePath = (databasePath: string) => {
  const parent = path.dirname(databasePath);
  if (
    !path.isAbsolute(databasePath) ||
    path.extname(databasePath) !== '.db' ||
    parent === path.parse(databasePath).root ||
    path.basename(databasePath) === '.db'
  ) {
    throw new DatabaseLifecycleError(
      'database_path_invalid',
      'Database path must be an absolute, non-root .db path.',
    );
  }
};

const safeTimestamp = (date: Date) =>
  date.toISOString().replace(/[^0-9A-Za-z]/g, '-');

export const stageDatabaseArtifacts = (
  databasePath: string,
  reason: ReplacementReason,
  options: StagingOptions = {},
): StagedDatabase => {
  assertSafeDatabasePath(databasePath);
  const parent = path.dirname(databasePath);
  const directory = path.join(
    parent,
    `.pluto-db-replacement-${reason}-${safeTimestamp((options.now ?? (() => new Date()))())}-${options.processId ?? process.pid}`,
  );
  const rename = options.rename ?? fs.renameSync;
  const movedPairs: Array<{ source: string; destination: string }> = [];

  try {
    fs.mkdirSync(directory);
    for (const suffix of SQLITE_SUFFIXES) {
      const source = `${databasePath}${suffix}`;
      if (!fs.existsSync(source)) continue;
      const destination = path.join(directory, path.basename(source));
      rename(source, destination);
      movedPairs.push({ source, destination });
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const pair of movedPairs.reverse()) {
      try {
        fs.renameSync(pair.destination, pair.source);
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed) {
      try {
        fs.rmdirSync(directory);
      } catch {
        // The directory is retained if an unexpected entry prevents safe removal.
      }
    }
    throw new DatabaseLifecycleError(
      'database_replacement_failed',
      'Could not stage database artifacts.',
      {},
      { cause: error },
    );
  }

  const staged: StagedDatabase = Object.freeze({
    directory,
    databasePath,
    moved: Object.freeze(movedPairs.map(({ destination }) => destination)),
  });
  issuedStagingRecords.add(staged);
  return staged;
};

export const cleanupStagedDatabase = (staged: StagedDatabase): void => {
  if (!issuedStagingRecords.has(staged)) {
    throw new DatabaseLifecycleError(
      'database_cleanup_failed',
      'Cleanup target was not issued by the staging operation.',
    );
  }
  try {
    fs.rmSync(staged.directory, { recursive: true });
    issuedStagingRecords.delete(staged);
  } catch (error) {
    throw new DatabaseLifecycleError(
      'database_cleanup_failed',
      'Could not remove staged database artifacts.',
      {},
      { cause: error },
    );
  }
};
