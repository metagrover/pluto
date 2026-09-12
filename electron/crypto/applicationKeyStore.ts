import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as electron from 'electron';
import type { SafeStorageBackend } from './keyCustodyProbe';

export interface ApplicationKeyEnvelope {
  version: 1 | 2;
  keyId: string;
  kdfVersion: 1;
  salt: string; // base64 encoded
  wrappedKey: string; // base64 encoded safeStorage ciphertext
  createdAtMs: number;
  storageBinding?: ApplicationKeyStorageBinding;
}

export interface ApplicationKeyStorageBinding {
  provider: 'electron_safe_storage';
  bundleIdentifier: string;
  teamIdentifier: string;
}

export class ApplicationKeyBindingMismatchError extends Error {
  constructor() {
    super(
      'Application key envelope is not bound to this signed Pluto identity',
    );
    this.name = 'ApplicationKeyBindingMismatchError';
  }
}

export interface MasterKeyResult {
  key: Buffer;
  keyId: string;
  salt: Buffer;
}

export interface ApplicationKeyStoreOptions {
  storageDir?: string;
  backend?: SafeStorageBackend;
  envelopeFileName?: string;
  expectedStorageBinding?: ApplicationKeyStorageBinding;
}

export class ApplicationKeyStore {
  private readonly storageDir: string;
  private readonly backend: SafeStorageBackend;
  private readonly envelopePath: string;
  private readonly expectedStorageBinding?: ApplicationKeyStorageBinding;

  constructor(options: ApplicationKeyStoreOptions = {}) {
    const defaultStorageDir =
      typeof electron.app?.getPath === 'function'
        ? electron.app.getPath('userData')
        : '';
    this.storageDir = options.storageDir ?? defaultStorageDir;

    let safeStorageFromElectron: SafeStorageBackend | undefined;
    try {
      safeStorageFromElectron = (electron as Record<string, unknown>)
        .safeStorage as SafeStorageBackend | undefined;
    } catch {
      safeStorageFromElectron = undefined;
    }

    const defaultBackend: SafeStorageBackend =
      safeStorageFromElectron ??
      (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)
        ? {
            isEncryptionAvailable: () => true,
            encryptString: (str: string) => Buffer.from(`test_enc_${str}`),
            decryptString: (buf: Buffer) => {
              const s = buf.toString('utf8');
              return s.startsWith('test_enc_')
                ? s.slice('test_enc_'.length)
                : s;
            },
          }
        : {
            isEncryptionAvailable: () => false,
            encryptString: () => {
              throw new Error('OS key storage is unavailable');
            },
            decryptString: () => {
              throw new Error('OS key storage is unavailable');
            },
          });

    this.backend = options.backend ?? defaultBackend;
    this.envelopePath = path.join(
      this.storageDir,
      options.envelopeFileName ?? 'app-key-envelope.json',
    );
    this.expectedStorageBinding = options.expectedStorageBinding;
  }

  hasMasterKey(): boolean {
    return fs.existsSync(this.envelopePath);
  }

  getMasterKey(): MasterKeyResult | null {
    if (!this.hasMasterKey()) return null;

    if (!this.backend || !this.backend.isEncryptionAvailable()) {
      throw new Error('OS key storage is unavailable or locked');
    }

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(this.envelopePath, 'utf8');
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Malformed key envelope: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const envelope = parsed as Partial<ApplicationKeyEnvelope>;
    if (
      (envelope.version !== 1 && envelope.version !== 2) ||
      !envelope.keyId ||
      !envelope.salt ||
      !envelope.wrappedKey
    ) {
      throw new Error(
        'Key envelope contains invalid or unsupported version metadata',
      );
    }
    if (this.expectedStorageBinding) {
      const binding = envelope.storageBinding;
      if (
        envelope.version !== 2 ||
        binding?.provider !== this.expectedStorageBinding.provider ||
        binding.bundleIdentifier !==
          this.expectedStorageBinding.bundleIdentifier ||
        binding.teamIdentifier !== this.expectedStorageBinding.teamIdentifier
      ) {
        throw new ApplicationKeyBindingMismatchError();
      }
    }

    let keyBuffer: Buffer;
    try {
      const ciphertext = Buffer.from(envelope.wrappedKey, 'base64');
      const decryptedBase64 = this.backend.decryptString(ciphertext);
      keyBuffer = Buffer.from(decryptedBase64, 'base64');
      if (keyBuffer.length !== 32) {
        throw new Error(
          `Decrypted key has invalid length: ${keyBuffer.length}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to decrypt application root key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const saltBuffer = Buffer.from(envelope.salt, 'base64');
    if (saltBuffer.length < 16) {
      throw new Error(
        `Salt in key envelope is too short: ${saltBuffer.length}`,
      );
    }

    return {
      key: keyBuffer,
      keyId: envelope.keyId,
      salt: saltBuffer,
    };
  }

  getOrCreateMasterKey(): MasterKeyResult {
    const existing = this.getMasterKey();
    if (existing) return existing;

    if (!this.backend || !this.backend.isEncryptionAvailable()) {
      throw new Error(
        'OS key storage is unavailable; cannot create master key',
      );
    }

    const key = randomBytes(32);
    const salt = randomBytes(32);
    const keyId = randomUUID();
    const createdAtMs = Date.now();

    const wrapped = this.backend.encryptString(key.toString('base64'));
    const envelope: ApplicationKeyEnvelope = {
      version: this.expectedStorageBinding ? 2 : 1,
      keyId,
      kdfVersion: 1,
      salt: salt.toString('base64'),
      wrappedKey: wrapped.toString('base64'),
      createdAtMs,
      ...(this.expectedStorageBinding
        ? { storageBinding: this.expectedStorageBinding }
        : {}),
    };

    this.writeEnvelope(envelope);

    return {
      key,
      keyId,
      salt,
    };
  }

  private writeEnvelope(envelope: ApplicationKeyEnvelope) {
    if (!this.storageDir) {
      throw new Error('Storage directory is not configured');
    }
    fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });

    const tmpPath = `${this.envelopePath}.${randomUUID()}.tmp`;
    const payload = JSON.stringify(envelope, null, 2);

    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, this.envelopePath);

    const destFd = fs.openSync(this.envelopePath, 'r');
    try {
      fs.fsyncSync(destFd);
    } finally {
      fs.closeSync(destFd);
    }

    const dirFd = fs.openSync(this.storageDir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  }
}
