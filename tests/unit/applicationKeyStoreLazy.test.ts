import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const keychain = vi.hoisted(() => ({ access: vi.fn(), encrypt: vi.fn() }));
vi.mock('electron', () => ({
  default: {
    app: { getPath: () => '' },
    get safeStorage() {
      keychain.access();
      return {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => {
          keychain.encrypt();
          return Buffer.from(value);
        },
        decryptString: (value: Buffer) => value.toString(),
      };
    },
  },
}));
import { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('lazy OS key storage', () => {
  it('does not access Electron safeStorage when constructing stores or checking absent keys', () => {
    const storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-lazy-key-'),
    );
    roots.push(storageDir);
    const store = new ApplicationKeyStore({ storageDir });
    expect(store.hasMasterKey()).toBe(false);
    expect(store.getMasterKey()).toBeNull();
    expect(keychain.access).not.toHaveBeenCalled();

    store.getOrCreateMasterKey();
    expect(keychain.access).toHaveBeenCalled();
    expect(keychain.encrypt).toHaveBeenCalledOnce();
  });
});
