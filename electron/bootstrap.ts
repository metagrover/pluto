import os from 'node:os';
import path from 'node:path';
import { app, dialog, shell } from 'electron';

import {
  PLUTO_BUNDLE_IDENTIFIER,
  PLUTO_PRODUCT_NAME,
  canOpenProductionDatabase,
  resolveProductionUserDataDir,
  resolveUserDataArgument,
  shouldAcquireProductionInstanceLock,
} from './appRuntimePolicy';
import { ApplicationKeyStore } from './crypto/applicationKeyStore';
import { hasValidRecoveryKeyFile } from './crypto/recoveryKeyFile';
import {
  initializeApplicationDatabase,
  resolveApplicationDatabasePath,
} from './database/applicationDatabase';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from './database/errors';
import { restoreLatestVerifiedSchemaBackup } from './database/migrationSafety';
import { probeSignedMacBuild } from './encryptionRollout';
import { createLogger, initializeElectronLogging } from './logger';

// Guard against broken-pipe errors (EPIPE / EIO) on stdout/stderr early in process lifetime
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') {
    return;
  }
  throw err;
});

let focusPrimaryWindow: (() => void) | null = null;
const developmentUserDataDir = resolveUserDataArgument(process.argv);
const productionUserDataDir = resolveProductionUserDataDir({
  platform: process.platform,
  homeDir: os.homedir(),
});
const developmentTargetsProduction = Boolean(
  !app.isPackaged &&
    developmentUserDataDir &&
    productionUserDataDir &&
    path.resolve(developmentUserDataDir) ===
      path.resolve(productionUserDataDir),
);
const recoveryKeyAvailable = Boolean(
  productionUserDataDir && hasValidRecoveryKeyFile(productionUserDataDir),
);
if (!app.isPackaged && developmentUserDataDir) {
  app.setPath('userData', developmentUserDataDir);
}
if (app.isPackaged) {
  app.setName(PLUTO_PRODUCT_NAME);
  if (productionUserDataDir) app.setPath('userData', productionUserDataDir);
}
initializeElectronLogging({ isPackaged: app.isPackaged });
const log = createLogger('Bootstrap');
const productionSignature = app.isPackaged
  ? probeSignedMacBuild(process.execPath, {
      expectedIdentifier: PLUTO_BUNDLE_IDENTIFIER,
    })
  : { valid: false, reason: 'development_runtime' };
const allowUnsignedPackaged = process.env.PLUTO_STRICT_SIGNATURE !== '1';
const canOpenDatabase = canOpenProductionDatabase({
  isPackaged: app.isPackaged,
  signedBuildValid: productionSignature.valid,
  targetsProductionProfile: developmentTargetsProduction,
  recoveryKeyAvailable,
  allowUnsignedPackaged,
});
const productionKeyStore =
  app.isPackaged &&
  productionSignature.valid &&
  productionSignature.identifier &&
  productionSignature.teamIdentifier
    ? new ApplicationKeyStore({
        expectedStorageBinding: {
          provider: 'electron_safe_storage',
          bundleIdentifier: productionSignature.identifier,
          teamIdentifier: productionSignature.teamIdentifier,
        },
      })
    : undefined;
const requiresLock = shouldAcquireProductionInstanceLock(app.isPackaged);
const hasLock = !requiresLock || app.requestSingleInstanceLock();

if (!canOpenDatabase) {
  void app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Signed Pluto required',
      message: 'This build cannot open your production data.',
      detail:
        'Pluto blocked database and Keychain access because this app is not signed with the expected Pluto identity. Install and launch the signed Pluto app. Your data was not changed.',
      buttons: ['Quit Pluto'],
      defaultId: 0,
    });
    app.quit();
  });
} else if (!hasLock) {
  log.warn(
    'Single instance lock acquisition failed, quitting duplicate instance',
  );
  app.quit();
} else {
  app.on('second-instance', () => focusPrimaryWindow?.());

  let initialized = false;
  while (!initialized) {
    try {
      initializeApplicationDatabase({ keyStore: productionKeyStore });
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
      const isIdentityMismatch =
        error instanceof DatabaseLifecycleError &&
        error.code === 'database_key_identity_mismatch';
      const isMigrationRecovery =
        error instanceof DatabaseLifecycleError &&
        error.code === 'database_migration_recovery_required';

      const title = isIdentityMismatch
        ? 'Database recovery required'
        : isKeyLocked || isKeyRejected
          ? 'Database Encryption Locked'
          : 'Pluto could not start';
      const detail = `${describeDatabaseStartupError(error)}\n\nYour data is preserved safely. Pluto will never replace or overwrite your encrypted database without your explicit action.`;

      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title,
        message: title,
        detail,
        buttons: isIdentityMismatch
          ? ['Open Data Folder', 'Quit Pluto']
          : isMigrationRecovery
            ? [
                'Retry',
                'Restore verified backup',
                'Open Data Folder',
                'Quit Pluto',
              ]
            : isKeyLocked
              ? ['Retry', 'Open Data Folder', 'Quit Pluto']
              : ['Retry', 'Open Data Folder', 'Quit Pluto'],
        defaultId: isIdentityMismatch ? 1 : 0,
        cancelId: isIdentityMismatch ? 1 : isMigrationRecovery ? 3 : 2,
      });

      if (isIdentityMismatch) {
        if (choice === 0) void shell.openPath(app.getPath('userData'));
        app.quit();
        break;
      }
      if (choice === 0) {
        continue;
      }
      if (isMigrationRecovery && choice === 1) {
        try {
          restoreLatestVerifiedSchemaBackup(
            resolveApplicationDatabasePath({
              userDataPath: app.getPath('userData'),
            }),
          );
          continue;
        } catch (restoreError) {
          log.error(
            'Verified database backup restoration failed:',
            restoreError,
          );
          dialog.showErrorBox(
            'Database restore failed',
            describeDatabaseStartupError(restoreError),
          );
          continue;
        }
      }
      if (isMigrationRecovery && choice === 2) {
        void shell.openPath(app.getPath('userData'));
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
