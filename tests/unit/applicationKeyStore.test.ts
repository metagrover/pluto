import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';
import type { SafeStorageBackend } from '../../electron/crypto/keyCustodyProbe';

describe('ApplicationKeyStore', () => {
  let tmpDir: string;
  let mockBackend: SafeStorageBackend;
  let mockStore: Map<string, string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-key-store-test-'));
    mockStore = new Map();
    mockBackend = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => {
        const id = `enc_${plainText}`;
        mockStore.set(id, plainText);
        return Buffer.from(id);
      },
      decryptString: (encrypted: Buffer) => {
        const id = encrypted.toString('utf8');
        const val = mockStore.get(id);
        if (!val) throw new Error('Decryption failed');
        return val;
      },
    };
  });

  it('creates and persists a new master key envelope when none exists', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });

    expect(store.hasMasterKey()).toBe(false);
    expect(store.getMasterKey()).toBeNull();

    const result = store.getOrCreateMasterKey();
    expect(result.key).toHaveLength(32);
    expect(result.salt.length).toBeGreaterThanOrEqual(16);
    expect(result.keyId).toBeDefined();

    expect(store.hasMasterKey()).toBe(true);

    // Verify envelope file on disk
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    expect(fs.existsSync(envelopePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    expect(content.version).toBe(1);
    expect(content.keyId).toBe(result.keyId);
    expect(content.wrappedKey).toBeDefined();

    // Verify reload from disk returns the same master key
    const reloaded = store.getMasterKey();
    expect(reloaded).not.toBeNull();
    expect(reloaded?.key.equals(result.key)).toBe(true);
    expect(reloaded?.salt.equals(result.salt)).toBe(true);
    expect(reloaded?.keyId).toBe(result.keyId);
  });

  it('fails closed when encryption is unavailable', () => {
    const disabledBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    };

    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: disabledBackend,
    });

    expect(() => store.getOrCreateMasterKey()).toThrow(
      /OS key storage is unavailable/,
    );
  });

  it('fails closed when envelope is corrupted or invalid', () => {
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    fs.writeFileSync(envelopePath, 'invalid json', 'utf8');

    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });

    expect(store.hasMasterKey()).toBe(true);
    expect(() => store.getMasterKey()).toThrow(/Malformed key envelope/);
  });

  it('fails closed when decryption throws', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });
    store.getOrCreateMasterKey();

    // Now make backend fail to decrypt
    const brokenBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: mockBackend.encryptString,
      decryptString: () => {
        throw new Error('Keychain item access denied');
      },
    };

    const failingStore = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: brokenBackend,
    });

    expect(() => failingStore.getMasterKey()).toThrow(
      /Failed to decrypt application root key/,
    );
  });
});
