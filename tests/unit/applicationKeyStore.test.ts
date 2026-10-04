import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('binds a production envelope to the signed Pluto identity', () => {
    const binding = {
      provider: 'electron_safe_storage' as const,
      bundleIdentifier: 'com.pluto.app',
      teamIdentifier: 'PLUTOTEAM1',
    };
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
      expectedStorageBinding: binding,
    });

    store.getOrCreateMasterKey();

    const envelope = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'app-key-envelope.json'), 'utf8'),
    );
    expect(envelope).toMatchObject({
      version: 2,
      storageBinding: binding,
    });
  });

  it('creates and reuses a source profile key without exporting a recovery key', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
      sourceRuntime: true,
    });
    const first = store.getOrCreateMasterKey();
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    const original = fs.readFileSync(envelopePath);
    const reopened = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
      sourceRuntime: true,
    });
    expect(reopened.getOrCreateMasterKey()).toEqual(first);
    expect(fs.readFileSync(envelopePath)).toEqual(original);
    expect(JSON.parse(original.toString()).version).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'app-recovery-key.json'))).toBe(
      false,
    );
  });

  it('identifies unavailable Keychain access before decryption and preserves the key envelope', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });
    store.getOrCreateMasterKey();
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    const original = fs.readFileSync(envelopePath);
    const decryptString = vi.fn(mockBackend.decryptString);
    const unavailable = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: {
        ...mockBackend,
        isEncryptionAvailable: () => false,
        decryptString,
      },
    });

    expect(() => unavailable.getMasterKey()).toThrowError(
      expect.objectContaining({ stage: 'keychain_unavailable' }),
    );
    expect(decryptString).not.toHaveBeenCalled();
    expect(fs.readFileSync(envelopePath)).toEqual(original);
  });

  it('identifies failed decryption without replacing an existing key envelope', () => {
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
    });
    store.getOrCreateMasterKey();
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    const original = fs.readFileSync(envelopePath);
    const denied = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: {
        ...mockBackend,
        decryptString: () => {
          throw new Error('permission denied');
        },
      },
    });

    expect(() => denied.getMasterKey()).toThrowError(
      expect.objectContaining({ stage: 'keychain_decrypt_failed' }),
    );
    expect(fs.readFileSync(envelopePath)).toEqual(original);
  });

  it('rejects signed envelopes in source before decryption without changing them', () => {
    const signed = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: mockBackend,
      expectedStorageBinding: {
        provider: 'electron_safe_storage',
        bundleIdentifier: 'com.pluto.app',
        teamIdentifier: 'PLUTOTEAM1',
      },
    });
    signed.getOrCreateMasterKey();
    const envelopePath = path.join(tmpDir, 'app-key-envelope.json');
    const original = fs.readFileSync(envelopePath);
    const decryptString = vi.fn(mockBackend.decryptString);
    const source = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: { ...mockBackend, decryptString },
      sourceRuntime: true,
    });
    expect(() => source.getOrCreateMasterKey()).toThrow(
      'not bound to this signed Pluto identity',
    );
    expect(decryptString).not.toHaveBeenCalled();
    expect(fs.readFileSync(envelopePath)).toEqual(original);
  });

  it('rejects a legacy or mismatched binding before Keychain decryption', () => {
    const decryptString = vi.fn(() => {
      throw new Error('must not reach Keychain');
    });
    const backend: SafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: mockBackend.encryptString,
      decryptString,
    };
    fs.writeFileSync(
      path.join(tmpDir, 'app-key-envelope.json'),
      JSON.stringify({
        version: 1,
        keyId: 'legacy',
        kdfVersion: 1,
        salt: Buffer.alloc(32).toString('base64'),
        wrappedKey: Buffer.alloc(32).toString('base64'),
        createdAtMs: 1,
      }),
    );
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend,
      expectedStorageBinding: {
        provider: 'electron_safe_storage',
        bundleIdentifier: 'com.pluto.app',
        teamIdentifier: 'PLUTOTEAM1',
      },
    });

    expect(() => store.getMasterKey()).toThrow(
      'Application key envelope is not bound to this signed Pluto identity',
    );
    expect(decryptString).not.toHaveBeenCalled();
  });

  it('uses an explicit recovery key before a legacy Keychain envelope', () => {
    const decryptString = vi.fn(() => {
      throw new Error('must not reach Keychain');
    });
    fs.writeFileSync(
      path.join(tmpDir, 'app-key-envelope.json'),
      JSON.stringify({ version: 1 }),
    );
    const recoveryKey = Buffer.alloc(32, 0x31);
    const recoverySalt = Buffer.alloc(32, 0x32);
    const recoveryPath = path.join(tmpDir, 'app-recovery-key.json');
    fs.writeFileSync(
      recoveryPath,
      JSON.stringify({
        version: 1,
        purpose: 'pluto-database-recovery',
        keyId: '123e4567-e89b-42d3-a456-426614174000',
        key: recoveryKey.toString('base64'),
        salt: recoverySalt.toString('base64'),
      }),
      { mode: 0o600 },
    );
    fs.chmodSync(recoveryPath, 0o600);
    const store = new ApplicationKeyStore({
      storageDir: tmpDir,
      backend: {
        isEncryptionAvailable: () => true,
        encryptString: mockBackend.encryptString,
        decryptString,
      },
      expectedStorageBinding: {
        provider: 'electron_safe_storage',
        bundleIdentifier: 'com.pluto.app',
        teamIdentifier: 'PLUTOTEAM1',
      },
    });

    expect(store.getMasterKey()).toEqual({
      key: recoveryKey,
      keyId: '123e4567-e89b-42d3-a456-426614174000',
      salt: recoverySalt,
    });
    expect(decryptString).not.toHaveBeenCalled();
  });

  it('durably fsyncs key envelope file and parent directory on creation', () => {
    let fsyncCount = 0;
    const originalFsyncSync = fs.fsyncSync;
    fs.fsyncSync = ((fd: number) => {
      fsyncCount++;
      return originalFsyncSync(fd);
    }) as typeof fs.fsyncSync;

    try {
      const store = new ApplicationKeyStore({
        storageDir: tmpDir,
        backend: mockBackend,
      });

      store.getOrCreateMasterKey();

      // Must have fsynced the tmp file, destination file, and parent directory (at least 3 fsync calls)
      expect(fsyncCount).toBeGreaterThanOrEqual(3);
    } finally {
      fs.fsyncSync = originalFsyncSync;
    }
  });

  it('fails closed when fsync fails during key envelope creation', () => {
    const originalFsyncSync = fs.fsyncSync;
    fs.fsyncSync = (() => {
      throw new Error('Injected I/O fsync failure');
    }) as typeof fs.fsyncSync;

    try {
      const store = new ApplicationKeyStore({
        storageDir: tmpDir,
        backend: mockBackend,
      });

      expect(() => store.getOrCreateMasterKey()).toThrow(
        /Injected I\/O fsync failure/,
      );
      expect(store.hasMasterKey()).toBe(false);
    } finally {
      fs.fsyncSync = originalFsyncSync;
    }
  });
});
