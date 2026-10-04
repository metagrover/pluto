import fs from 'node:fs';
import path from 'node:path';
import electron, { app } from 'electron';
import type { ProviderCredentialStatus } from './llm/inferenceTypes';
import { credentialSettingKey } from './llm/providerCatalog';

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

const CREDENTIAL_DISPLAY_PREFIX: Record<
  ProviderCredentialStatus['provider'],
  string
> = {
  openai: 'sk-',
  openrouter: 'sk-or-',
  gemini: 'AIza',
  claude: 'sk-ant-',
};

function maskCredentialForDisplay(
  provider: ProviderCredentialStatus['provider'],
  value: string,
) {
  const trimmed = value.trim();
  const suffix = trimmed.length >= 8 ? trimmed.slice(-4) : '';
  return `${CREDENTIAL_DISPLAY_PREFIX[provider]}********${suffix}`;
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
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function createElectronSecureSettingsBackend(): SecureSettingsBackend {
  return {
    isAvailable: () => electron.safeStorage.isEncryptionAvailable(),
    readAll: () => readSecureSettingsFile(),
    writeAll: (next) => writeSecureSettingsFile(next),
    encrypt: (value) =>
      electron.safeStorage.encryptString(value).toString('base64'),
    decrypt: (value) =>
      electron.safeStorage.decryptString(Buffer.from(value, 'base64')),
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
  const hasCredential = (key: string) =>
    Boolean(backend.readAll()[key]) || plaintext.get(key) !== null;

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
      try {
        if (!hasCredential(key)) return null;
        if (!backend.isAvailable()) return null;
        const secureValue = getSecureValue(key);
        if (secureValue !== null) return secureValue;
        const plaintextValue = plaintext.get(key);
        if (plaintextValue === null) return null;
        writeSecureValue(key, plaintextValue);
        plaintext.delete(key);
        return plaintextValue;
      } catch (error) {
        logFailure(key, 'read-migration', error);
        return null;
      }
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

    delete(key: string) {
      if (!isSecretSettingKey(key)) return plaintext.delete(key);
      deleteSecureValue(key);
      return plaintext.delete(key);
    },

    status(
      provider: ProviderCredentialStatus['provider'],
    ): ProviderCredentialStatus {
      const key = credentialSettingKey(provider);
      try {
        // Empty credential checks do not need to unlock or probe Keychain.
        // Availability is verified when a credential is saved or accessed.
        if (!hasCredential(key)) {
          return { provider, configured: false, available: true };
        }
        if (!backend.isAvailable()) {
          return {
            provider,
            configured: false,
            available: false,
            error: 'secure_storage_unavailable',
          };
        }
        let credential = getSecureValue(key);
        if (credential === null) {
          const legacyValue = plaintext.get(key);
          if (legacyValue !== null) {
            writeSecureValue(key, legacyValue);
            plaintext.delete(key);
            credential = legacyValue;
          }
        }
        return {
          provider,
          configured: credential !== null,
          available: true,
          maskedHint:
            credential === null
              ? undefined
              : maskCredentialForDisplay(provider, credential),
        };
      } catch (error) {
        logFailure(key, 'status', error);
        return {
          provider,
          configured: false,
          available: true,
          error: 'credential_unreadable',
        };
      }
    },
  };
}
