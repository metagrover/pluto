import fs from 'node:fs';
import os from 'node:os';
import { app, dialog, shell } from 'electron';

import {
  PLUTO_BUNDLE_IDENTIFIER,
  PLUTO_DEVELOPMENT_PRODUCT_NAME,
  PLUTO_PRODUCT_NAME,
  canOpenProductionDatabase,
  resolveProductionUserDataDir,
  resolveSourceUserDataDir,
  resolveUserDataArgument,
} from './appRuntimePolicy';
import { initializeCommitmentNotificationBridge } from './commitmentReminderNotifications';
import { ApplicationKeyStore } from './crypto/applicationKeyStore';
import {
  initializeApplicationDatabase,
  resolveApplicationDatabasePath,
} from './database/applicationDatabase';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from './database/errors';
import { initializeDatabaseStorageSetup } from './database/storageSetup';
import { probeSignedMacBuild } from './encryptionRollout';
import { setLocalModelMemoryProbeReader } from './llm/localModelMemoryProbe';
import { createLogger, initializeElectronLogging } from './logger';

// Guard against broken-pipe errors (EPIPE / EIO) on stdout/stderr early in process lifetime
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') {
    return;
  }
  throw err;
});

let focusPrimaryWindow: (() => void) | null = null;
const explicitUserDataDir =
  resolveUserDataArgument(process.argv) ||
  process.env.PLUTO_USER_DATA_DIR?.trim();
const userDataDir = app.isPackaged
  ? explicitUserDataDir
  : resolveSourceUserDataDir({
      explicit: explicitUserDataDir,
      tempDir: os.tmpdir(),
      productionDir:
        resolveProductionUserDataDir({
          platform: process.platform,
          homeDir: os.homedir(),
        }) ?? undefined,
    });
if (userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  app.setPath('userData', userDataDir);
}
app.setName(
  app.isPackaged ? PLUTO_PRODUCT_NAME : PLUTO_DEVELOPMENT_PRODUCT_NAME,
);
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
  allowUnsignedPackaged,
});
const createProductionKeyStore = () =>
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
    : new ApplicationKeyStore({ sourceRuntime: !app.isPackaged });
// Every profile has one writer, including source checkouts and explicit overrides.
const hasLock = app.requestSingleInstanceLock();

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
  const nativeBridge = initializeCommitmentNotificationBridge();
  setLocalModelMemoryProbeReader(
    typeof nativeBridge?.memoryPressureSample === 'function'
      ? nativeBridge.memoryPressureSample.bind(nativeBridge)
      : undefined,
  );
  app.on('second-instance', () => focusPrimaryWindow?.());

  void app.whenReady().then(() => {
    const databasePath = resolveApplicationDatabasePath({
      userDataPath: app.getPath('userData'),
    });
    let productionKeyStore: ApplicationKeyStore | undefined;
    const getKeyStore = () => {
      productionKeyStore ??= createProductionKeyStore();
      return productionKeyStore;
    };
    let initialized = false;
    while (!initialized) {
      try {
        const mode = initializeDatabaseStorageSetup({
          databasePath,
          chooseMode: () => {
            const choice = dialog.showMessageBoxSync({
              type: 'question',
              title: 'Welcome to Pluto',
              message: 'Choose how to store your local meeting data',
              detail:
                'Standard setup stores your database without app-level encryption. Encrypted setup protects the database containing transcripts, notes, and people, and macOS may ask for Keychain permission now or on later launches. Recording files have separate protection.\n\nThis is a one-time choice for this profile and cannot be changed in Settings. Saving cloud-provider API keys may require separate Keychain permission with either setup.',
              buttons: ['Standard setup', 'Encrypted setup', 'Quit'],
              defaultId: 0,
              cancelId: 2,
              noLink: true,
            });
            return choice === 0
              ? 'standard'
              : choice === 1
                ? 'encrypted'
                : null;
          },
          prepareEncryption: () => {
            getKeyStore().getOrCreateMasterKey();
          },
          initialize: (storageMode) => {
            initializeApplicationDatabase({
              storageMode,
              keyStore: storageMode === 'encrypted' ? getKeyStore() : undefined,
            });
          },
        });
        if (mode === null) {
          app.quit();
          break;
        }
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
        const isSetupKeyUnavailable =
          error instanceof DatabaseLifecycleError &&
          error.code === 'database_setup_key_unavailable';
        const needsNewerBuild =
          error instanceof DatabaseLifecycleError &&
          error.details.migrationHistoryReason === 'newer_build_required';

        const title = isSetupKeyUnavailable
          ? 'Encrypted setup needs permission'
          : isIdentityMismatch
            ? 'Database recovery required'
            : isKeyLocked || isKeyRejected
              ? 'Could not unlock existing database'
              : 'Pluto could not start';
        const detail = `${describeDatabaseStartupError(error)}\n\nYour data is preserved safely. Pluto will never replace or overwrite your encrypted database without your explicit action.`;

        const choice = dialog.showMessageBoxSync({
          type: 'error',
          title,
          message: title,
          detail,
          buttons: isSetupKeyUnavailable
            ? ['Choose setup again', 'Quit Pluto']
            : isIdentityMismatch
              ? ['Open Data Folder', 'Quit Pluto']
              : needsNewerBuild
                ? ['Get compatible Pluto', 'Open Data Folder', 'Quit Pluto']
                : ['Retry', 'Open Data Folder', 'Quit Pluto'],
          defaultId: isIdentityMismatch ? 1 : 0,
          cancelId: isSetupKeyUnavailable || isIdentityMismatch ? 1 : 2,
        });

        if (isSetupKeyUnavailable) {
          if (choice === 0) continue;
          app.quit();
          break;
        }
        if (isIdentityMismatch) {
          if (choice === 0) void shell.openPath(app.getPath('userData'));
          app.quit();
          break;
        }
        if (choice === 0) {
          if (needsNewerBuild) {
            void shell.openExternal(
              'https://github.com/metagrover/pluto/releases',
            );
            app.quit();
            break;
          }
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
  });
}
