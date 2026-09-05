import { app } from 'electron';

import {
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';
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
  void import('./main').then((main) => {
    focusPrimaryWindow = main.focusPrimaryWindow;
  });
}
