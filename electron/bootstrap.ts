import { app, dialog, shell } from 'electron';

import {
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';
import { initializeApplicationDatabase } from './database/applicationDatabase';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from './database/errors';
import { createLogger, initializeElectronLogging } from './logger';

// Guard against broken-pipe errors (EPIPE / EIO) on stdout/stderr early in process lifetime
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') {
    return;
  }
  throw err;
});

initializeElectronLogging({ isPackaged: app.isPackaged });
const log = createLogger('Bootstrap');

let focusPrimaryWindow: (() => void) | null = null;
const developmentUserDataDir = resolveUserDataArgument(process.argv);
if (!app.isPackaged && developmentUserDataDir) {
  app.setPath('userData', developmentUserDataDir);
}
const requiresLock = shouldAcquireProductionInstanceLock(app.isPackaged);
const hasLock = !requiresLock || app.requestSingleInstanceLock();

if (!hasLock) {
  log.warn(
    'Single instance lock acquisition failed, quitting duplicate instance',
  );
  app.quit();
} else {
  app.on('second-instance', () => focusPrimaryWindow?.());

  let initialized = false;
  while (!initialized) {
    try {
      initializeApplicationDatabase();
      initialized = true;
      void import('./main').then((main) => {
        focusPrimaryWindow = main.focusPrimaryWindow;
      });
    } catch (error) {
      log.error('Database startup failed:', error);
      const isKeyLocked =
        error instanceof DatabaseLifecycleError &&
        error.code === 'database_key_unavailable';
      const isKeyRejected =
        error instanceof DatabaseLifecycleError &&
        error.code === 'database_key_rejected';

      const title =
        isKeyLocked || isKeyRejected
          ? 'Database Encryption Locked'
          : 'Pluto could not start';
      const detail = `${describeDatabaseStartupError(error)}\n\nYour data is preserved safely. Pluto will never replace or overwrite your encrypted database without your explicit action.`;

      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title,
        message: title,
        detail,
        buttons: isKeyLocked
          ? ['Retry Keychain Access', 'Open Data Folder', 'Quit Pluto']
          : ['Retry', 'Open Data Folder', 'Quit Pluto'],
        defaultId: 0,
        cancelId: 2,
      });

      if (choice === 0) {
        continue;
      }
      if (choice === 1) {
        void shell.openPath(app.getPath('userData'));
        continue;
      }
      app.quit();
      break;
    }
  }
}
