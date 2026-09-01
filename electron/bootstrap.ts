import { app, dialog } from 'electron';

import {
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';
import { initializeApplicationDatabase } from './database/applicationDatabase';
import { describeDatabaseStartupError } from './database/errors';

let focusPrimaryWindow: (() => void) | null = null;
const developmentUserDataDir = resolveUserDataArgument(process.argv);
if (!app.isPackaged && developmentUserDataDir) {
  app.setPath('userData', developmentUserDataDir);
}
const requiresLock = shouldAcquireProductionInstanceLock(app.isPackaged);
const hasLock = !requiresLock || app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => focusPrimaryWindow?.());
  try {
    initializeApplicationDatabase();
    void import('./main').then((main) => {
      focusPrimaryWindow = main.focusPrimaryWindow;
    });
  } catch (error) {
    dialog.showErrorBox(
      'Pluto could not start',
      describeDatabaseStartupError(error),
    );
    app.quit();
  }
}
