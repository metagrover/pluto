import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationKeyStore } from '../../electron/crypto/applicationKeyStore';
import type { SafeStorageBackend } from '../../electron/crypto/keyCustodyProbe';

describe('ApplicationKeyStore', () => {
  let tmpDir: string;
  let mockBackend: SafeStorageBackend;
  let storageMap: Map<string, string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-app-key-test-'));
    storageMap = new Map<string, string>();
    mockBackend = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => {
        const id = `enc_${plainText}`;
        storageMap.set(id, plainText);
        return Buffer.from(id);
      },
      decryptString: (encrypted: Buffer) => {
        const id = encrypted.toString('utf8');
        const val = storageMap.get(id);
        if (!val) throw new Error('Decryption failed');
        return val;
      },
    };
  });

  it('creates and persists a new master key envelope on first call', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });

    expect(store.hasMasterKey()).toBe(false);
    expect(store.getMasterKey()).toBeNull();

    const result = store.getOrCreateMasterKey();
    expect(result.key).toHaveLength(32);
    expect(result.keyId).toBeDefined();
    expect(result.salt.length).toBeGreaterThanOrEqual(16);

    expect(store.hasMasterKey()).toBe(true);

    // Reading it again returns identical key and id
    const second = store.getMasterKey();
    expect(second).not.toBeNull();
    expect(second!.key.equals(result.key)).toBe(true);
    expect(second!.keyId).toBe(result.keyId);
    expect(second!.salt.equals(result.salt)).toBe(true);
  });

  it('fails closed when encryption is unavailable', () => {
    const unavailableBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    };

    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: unavailableBackend,
    });

    expect(() => store.getOrCreateMasterKey()).toThrow(/unavailable/);
  });

  it('fails closed when envelope file is malformed or corrupted', () => {
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    fs.writeFileSync(envelopePath, 'not-valid-json', 'utf8');

    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });

    expect(store.hasMasterKey()).toBe(true);
    expect(() => store.getMasterKey()).toThrow(/Malformed key envelope/);
  });

  it('fails closed when envelope has invalid version', () => {
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    fs.writeFileSync(
      envelopePath,
      JSON.stringify({
        version: 99,
        keyId: 'abc',
        salt: Buffer.alloc(16).toString('base64'),
        wrappedKey: Buffer.alloc(32).toString('base64'),
      }),
      'utf8',
    );

    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });

    expect(() => store.getMasterKey()).toThrow(/unsupported version/);
  });
});
