import type { DatabaseIntegrityResult } from './integrityCheck';

export interface DatabaseRecoveryNotice {
  errorCode: 'database_integrity_failed';
  errorMessage: string;
}

export const DATABASE_INTEGRITY_NOTICE: DatabaseRecoveryNotice = {
  errorCode: 'database_integrity_failed',
  errorMessage:
    'A background check found damage in the Pluto database. Pluto has not changed it. Open the data folder and copy pluto.db somewhere safe, then quit and reopen Pluto to run the full startup check.',
};

/** Delay after the window first loads, so the check never competes with it. */
export const BACKGROUND_INTEGRITY_DELAY_MS = 5_000;

interface BackgroundIntegrityMonitorOptions {
  verify: () => Promise<DatabaseIntegrityResult | null>;
  notify: (notice: DatabaseRecoveryNotice) => void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  delayMs?: number;
  setTimer?: (run: () => void, delayMs: number) => void;
}

/**
 * Runs the full database check once per launch after the window has loaded,
 * and reports damage through the database recovery overlay.
 */
export const createBackgroundIntegrityMonitor = (
  options: BackgroundIntegrityMonitorOptions,
) => {
  const log = options.logger ?? console;
  const setTimer =
    options.setTimer ??
    ((run: () => void, delayMs: number) => {
      setTimeout(run, delayMs).unref?.();
    });
  let scheduled = false;
  let failure: DatabaseRecoveryNotice | null = null;
  let running: Promise<boolean> | null = null;

  /** Resolves true unless the check found damage. */
  const check = (): Promise<boolean> => {
    running ??= (async () => {
      try {
        const result = await options.verify();
        if (result && !result.ok) {
          failure = DATABASE_INTEGRITY_NOTICE;
          log.error('Database integrity check failed.', {
            failure: result.failure,
            sqliteCode: result.sqliteCode,
          });
          options.notify(failure);
          return false;
        }
        if (!result) return failure === null;
        failure = null;
        log.info(`Database integrity ok in ${result.durationMs}ms.`);
        return true;
      } catch (error) {
        // Inconclusive: keep any earlier finding, never invent one.
        log.warn('Database integrity check did not complete.', {
          name: error instanceof Error ? error.name : typeof error,
        });
        return failure === null;
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    /** Starts the launch check once; later calls are no-ops. */
    schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimer(() => {
        void check();
      }, options.delayMs ?? BACKGROUND_INTEGRITY_DELAY_MS);
    },
    check,
    currentFailure: () => failure,
  };
};
