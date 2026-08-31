import { app } from 'electron';

import {
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';

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
  void import('./main').then((main) => {
    focusPrimaryWindow = main.focusPrimaryWindow;
  });
}
