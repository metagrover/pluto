import { app, dialog } from 'electron';

import {
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';
import { initializeApplicationDatabase } from './database/applicationDatabase';
import { describeDatabaseStartupError } from './database/errors';
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
  try {
    initializeApplicationDatabase();
    void import('./main').then((main) => {
      focusPrimaryWindow = main.focusPrimaryWindow;
    });
  } catch (error) {
    log.error('Database startup failed:', error);
    dialog.showErrorBox(
      'Pluto could not start',
      describeDatabaseStartupError(error),
    );
    app.quit();
  }
}
