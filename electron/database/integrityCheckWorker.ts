import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  type DatabaseIntegrityCheckRequest,
  checkDatabaseIntegrity,
  isCorruptionCode,
} from './integrityCheck';

// A read-only WAL reader sees a consistent snapshot while the app keeps
// writing on its own connection. Any error other than corruption escapes as a
// worker error, so the caller treats the check as inconclusive.
const request = workerData as DatabaseIntegrityCheckRequest;
const sqlite = new Database(request.databasePath, {
  readonly: true,
  fileMustExist: true,
});
try {
  if (request.keyHex) {
    sqlite.pragma("cipher = 'sqlcipher'");
    sqlite.pragma(`key = "x'${request.keyHex}'"`);
  }
  sqlite.pragma('busy_timeout = 5000');
  parentPort?.postMessage(checkDatabaseIntegrity(sqlite));
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (!isCorruptionCode(code)) throw error;
  parentPort?.postMessage({
    ok: false,
    failure: 'unreadable',
    sqliteCode: code,
    durationMs: 0,
  });
} finally {
  sqlite.close();
}
