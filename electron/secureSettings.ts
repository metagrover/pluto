import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

export type PlaintextSettingsStore = {
  get(key: string): string | null;
  set(key: string, value: string): unknown;
  delete(key: string): unknown;
};

export type SecureSettingsBackend = {
  isAvailable(): boolean;
  readAll(): Record<string, string>;
  writeAll(next: Record<string, string>): void;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

const SECRET_SETTING_KEYS = new Set([
  'gemini_api_key',
  'openai_api_key',
  'openrouter_api_key',
  'claude_api_key',
  'hf_token',
]);

export function isSecretSettingKey(key: string) {
  return SECRET_SETTING_KEYS.has(key);
}

function getSecureSettingsPath() {
  return path.join(app.getPath('userData'), 'secure-settings.json');
}

function readSecureSettingsFile(filePath = getSecureSettingsPath()) {
  if (!fs.existsSync(filePath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeSecureSettingsFile(
  next: Record<string, string>,
  filePath = getSecureSettingsPath(),
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(next, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
}

export function createElectronSecureSettingsBackend(): SecureSettingsBackend {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    readAll: () => readSecureSettingsFile(),
    writeAll: (next) => writeSecureSettingsFile(next),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
  };
}

export function createSecureSettingsManager({
  plaintext,
  backend = createElectronSecureSettingsBackend(),
  logFailure = (key, phase, error) => {
    console.warn(`[SecureSettings] ${phase} failed for ${key}:`, error);
  },
}: {
  plaintext: PlaintextSettingsStore;
  backend?: SecureSettingsBackend;
  logFailure?: (key: string, phase: string, error: unknown) => void;
}) {
  const getSecureValue = (key: string) => {
    const encrypted = backend.readAll()[key];
    return encrypted ? backend.decrypt(encrypted) : null;
  };

  const writeSecureValue = (key: string, value: string) => {
    const next = backend.readAll();
    next[key] = backend.encrypt(value);
    backend.writeAll(next);
  };

  const deleteSecureValue = (key: string) => {
    const next = backend.readAll();
    if (!Object.hasOwn(next, key)) return;
    delete next[key];
    backend.writeAll(next);
  };

  return {
    get(key: string) {
      if (!isSecretSettingKey(key)) return plaintext.get(key);

      let secureValue: string | null;
      try {
        secureValue = getSecureValue(key);
      } catch (error) {
        logFailure(key, 'read', error);
        return null;
      }
      if (secureValue !== null) return secureValue;

      const plaintextValue = plaintext.get(key);
      if (plaintextValue === null) return null;
      if (!backend.isAvailable()) {
        logFailure(
          key,
          'read-unavailable',
          new Error('Encryption unavailable'),
        );
        return null;
      }

      try {
        writeSecureValue(key, plaintextValue);
        plaintext.delete(key);
      } catch (error) {
        logFailure(key, 'read-migration', error);
        return null;
      }

      return plaintextValue;
    },

    set(key: string, value: string) {
      if (!isSecretSettingKey(key)) return plaintext.set(key, value);

      if (!value) {
        deleteSecureValue(key);
        return plaintext.delete(key);
      }

      if (!backend.isAvailable()) {
        logFailure(
          key,
          'write-unavailable',
          new Error('Encryption unavailable'),
        );
        throw new Error('secure_storage_unavailable');
      }

      try {
        writeSecureValue(key, value);
        return plaintext.delete(key);
      } catch (error) {
        logFailure(key, 'write', error);
        throw new Error('secure_storage_write_failed');
      }
    },
  };
}
