import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3';

// One definition of "the database is healthy", shared by the blocking startup
// check, the background worker and tests.
export type DatabaseIntegrityFailure =
  | 'quick_check'
  | 'foreign_key_check'
  | 'unreadable';

export type DatabaseIntegrityResult =
  | { ok: true; durationMs: number }
  | {
      ok: false;
      failure: DatabaseIntegrityFailure;
      sqliteCode?: string;
      durationMs: number;
    };

/** What a separate connection needs to check the open database. */
export interface DatabaseIntegrityCheckRequest {
  databasePath: string;
  keyHex: string | null;
}

const sqliteCode = (error: unknown): string | undefined => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : undefined;
};

export const isCorruptionCode = (code: string | undefined): boolean =>
  Boolean(
    code &&
      (code.startsWith('SQLITE_CORRUPT') || code.startsWith('SQLITE_NOTADB')),
  );

/**
 * Full `quick_check` plus `foreign_key_check`. Reads every page. Errors that
 * are not corruption (busy, I/O, closed) are thrown: they make the check
 * inconclusive rather than proof of damage.
 */
export const checkDatabaseIntegrity = (
  sqlite: Pick<Database.Database, 'pragma'>,
): DatabaseIntegrityResult => {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    if (sqlite.pragma('quick_check', { simple: true }) !== 'ok')
      return { ok: false, failure: 'quick_check', durationMs: elapsed() };
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length !== 0)
      return { ok: false, failure: 'foreign_key_check', durationMs: elapsed() };
    return { ok: true, durationMs: elapsed() };
  } catch (error) {
    const code = sqliteCode(error);
    if (!isCorruptionCode(code)) throw error;
    return {
      ok: false,
      failure: 'unreadable',
      sqliteCode: code,
      durationMs: elapsed(),
    };
  }
};

/**
 * Cheap open-time probe: decrypts page 1 and reads the schema. A wrong key or a
 * non-database file fails here (SQLITE_NOTADB); damage deeper in the file is
 * left to the full check.
 */
export const probeDatabaseReadable = (
  sqlite: Pick<Database.Database, 'prepare' | 'pragma'>,
): void => {
  sqlite.pragma('schema_version', { simple: true });
  sqlite.prepare('SELECT COUNT(*) FROM sqlite_schema').get();
};

// A failed background check leaves this marker beside the database so the next
// launch runs the full check before opening the window, as every launch did
// before the check moved off the critical path.
export const integrityCheckMarkerPath = (databasePath: string): string =>
  `${databasePath}.integrity-check-required`;

export const isStartupIntegrityCheckRequired = (
  databasePath: string,
): boolean =>
  databasePath !== ':memory:' &&
  fs.existsSync(integrityCheckMarkerPath(databasePath));

export const requireStartupIntegrityCheck = (
  databasePath: string,
  failure: DatabaseIntegrityFailure,
): void => {
  if (databasePath === ':memory:') return;
  fs.writeFileSync(
    integrityCheckMarkerPath(databasePath),
    `${JSON.stringify({ failure, detectedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
};

export const clearStartupIntegrityCheckRequirement = (
  databasePath: string,
): void => {
  if (databasePath === ':memory:') return;
  fs.rmSync(integrityCheckMarkerPath(databasePath), { force: true });
};

/**
 * Runs the full check on its own read-only connection in a worker thread, so
 * a large encrypted database never blocks the main process. Rejects when the
 * check was inconclusive; a damaged database resolves `ok: false`.
 */
export const runIntegrityCheckInWorker = (
  workerPath: string,
  request: DatabaseIntegrityCheckRequest,
): Promise<DatabaseIntegrityResult> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, { workerData: request });
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      settle();
      void worker.terminate();
    };
    worker.once('message', (message: DatabaseIntegrityResult) =>
      finish(() => resolve(message)),
    );
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) =>
      finish(() =>
        reject(new Error(`database_integrity_worker_exited:${code}`)),
      ),
    );
  });
