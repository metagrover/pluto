import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';
import {
  closeApplicationDatabase,
  initializeApplicationDatabase,
} from '../../electron/database/applicationDatabase';
import { archiveLockedProfile } from '../../electron/database/archiveLockedProfile';
import { isPlaintextSqliteDatabase } from '../../electron/database/encryptionMigration';
import { initializeDatabaseStorageSetup } from '../../electron/database/storageSetup';

const electronState = vi.hoisted(() => ({ userDataPath: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataPath,
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

const roots: string[] = [];
afterEach(() => {
  closeApplicationDatabase();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('fresh start after an encrypted database fails to open', () => {
  it('discards the failed encrypted runtime before creating a Standard database', () => {
    const profileDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-fresh-start-'),
    );
    roots.push(profileDir);
    electronState.userDataPath = profileDir;
    const databasePath = path.join(profileDir, 'pluto.db');
    fs.writeFileSync(databasePath, Buffer.alloc(128, 0x7f));
    fs.writeFileSync(path.join(profileDir, 'app-key-envelope.json'), '{locked');
    const deniedKeyStore = {
      getMasterKey: () => {
        throw new Error('key decryption failed');
      },
    } as unknown as ApplicationKeyStore;

    expect(() =>
      initializeApplicationDatabase({
        storageMode: 'encrypted',
        keyStore: deniedKeyStore,
      }),
    ).toThrow();

    const archive = archiveLockedProfile(profileDir);
    roots.push(archive);
    expect(
      initializeDatabaseStorageSetup({
        databasePath,
        chooseMode: () => 'standard',
        prepareEncryption: () => {
          throw new Error('Standard setup must not access Keychain');
        },
        initialize: (storageMode) => {
          initializeApplicationDatabase({ storageMode });
        },
      }),
    ).toBe('standard');
    expect(isPlaintextSqliteDatabase(databasePath)).toBe(true);
    expect(fs.readFileSync(path.join(archive, 'pluto.db'))).toEqual(
      Buffer.alloc(128, 0x7f),
    );
  });
});
