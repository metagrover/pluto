import { app, dialog, shell } from 'electron';

import {
  PLUTO_BUNDLE_IDENTIFIER,
  PLUTO_PRODUCT_NAME,
  canOpenProductionDatabase,
  resolveUserDataArgument,
} from './appRuntimePolicy';
import { ApplicationKeyStore } from './crypto/applicationKeyStore';
import {
  initializeApplicationDatabase,
  resolveApplicationDatabasePath,
} from './database/applicationDatabase';
import { archiveLockedProfile } from './database/archiveLockedProfile';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from './database/errors';
import { initializeDatabaseStorageSetup } from './database/storageSetup';
import { probeSignedMacBuild } from './encryptionRollout';
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
app.setName(PLUTO_PRODUCT_NAME);
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
    let startStandard = false;
    while (!initialized) {
      try {
        const mode = initializeDatabaseStorageSetup({
          databasePath,
          chooseMode: () => {
            if (startStandard) {
              startStandard = false;
              return 'standard';
            }
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

        const title = isSetupKeyUnavailable
          ? 'Encrypted setup needs permission'
          : isIdentityMismatch
            ? 'Database recovery required'
            : isKeyLocked || isKeyRejected
              ? 'Could not unlock existing database'
              : 'Pluto could not start';
        const isEncryptedKeyIssue = isKeyLocked || isKeyRejected;
        const detail = `${describeDatabaseStartupError(error)}\n\nYour data is preserved safely. Pluto will never replace or overwrite your encrypted database without your explicit action.${isEncryptedKeyIssue ? '\n\nTo start fresh, Pluto can archive the entire encrypted profile beside the current data folder and create a new Standard database. Old meetings will not appear in the new profile.' : ''}`;

        const choice = dialog.showMessageBoxSync({
          type: 'error',
          title,
          message: title,
          detail,
          buttons: isSetupKeyUnavailable
            ? ['Choose setup again', 'Quit Pluto']
            : isIdentityMismatch
              ? ['Open Data Folder', 'Quit Pluto']
              : isEncryptedKeyIssue
                ? [
                    'Retry',
                    'Archive encrypted data and start Standard',
                    'Open Data Folder',
                    'Quit Pluto',
                  ]
                : ['Retry', 'Open Data Folder', 'Quit Pluto'],
          defaultId: isIdentityMismatch ? 1 : 0,
          cancelId:
            isSetupKeyUnavailable || isIdentityMismatch
              ? 1
              : isEncryptedKeyIssue
                ? 3
                : 2,
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
        if (isEncryptedKeyIssue && choice === 1) {
          const confirmed = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Start a new Standard profile?',
            message: 'Archive the encrypted profile and start fresh?',
            detail:
              'Pluto will move the entire current profile to a sibling archive folder, including its database, key envelope, recordings, and settings. It will then create a new Standard database. The archived data will remain on disk, but its meetings will not appear in the new profile.',
            buttons: ['Cancel', 'Archive and start Standard'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (confirmed !== 1) continue;
          try {
            const archivePath = archiveLockedProfile(app.getPath('userData'));
            log.info('Encrypted profile archived before Standard setup');
            dialog.showMessageBoxSync({
              type: 'info',
              title: 'Previous profile archived',
              message: 'Your encrypted profile is preserved.',
              detail: `Archive folder: ${archivePath}\n\nPluto will now create a new Standard database.`,
              buttons: ['Continue'],
            });
            startStandard = true;
          } catch (archiveError) {
            log.error('Could not archive encrypted profile:', archiveError);
            dialog.showMessageBoxSync({
              type: 'error',
              title: 'Could not start fresh',
              message: 'Pluto could not archive the encrypted profile.',
              detail:
                'No new database was created. Check that the data folder is writable and try again. The encrypted profile remains available for recovery.',
              buttons: ['OK'],
            });
          }
          continue;
        }
        if (choice === 0) {
          continue;
        }
        if (choice === (isEncryptedKeyIssue ? 2 : 1)) {
          void shell.openPath(app.getPath('userData'));
          continue;
        }
        app.quit();
        break;
      }
    }
  });
}
