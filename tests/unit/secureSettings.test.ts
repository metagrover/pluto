import { describe, expect, it, vi } from 'vitest';

import {
  type PlaintextSettingsStore,
  type SecureSettingsBackend,
  createSecureSettingsManager,
  isSecretSettingKey,
} from '../../electron/secureSettings';

const createPlaintextStore = (
  initial: Record<string, string | null> = {},
): PlaintextSettingsStore => {
  const values = new Map<string, string | null>(Object.entries(initial));
  return {
    get(key) {
      return values.has(key) ? (values.get(key) ?? null) : null;
    },
    set(key, value) {
      values.set(key, value);
    },
    delete(key) {
      values.delete(key);
    },
  };
};

const createSecureBackend = ({
  available = true,
  encrypted = {},
  writeImpl,
}: {
  available?: boolean;
  encrypted?: Record<string, string>;
  writeImpl?: (next: Record<string, string>) => void;
} = {}): SecureSettingsBackend => {
  const store = { ...encrypted };
  return {
    isAvailable: () => available,
    readAll: () => ({ ...store }),
    writeAll: (next) => {
      writeImpl?.(next);
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, next);
    },
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, ''),
  };
};

describe('secureSettings', () => {
  it('identifies the secret-backed setting keys', () => {
    expect(isSecretSettingKey('gemini_api_key')).toBe(true);
    expect(isSecretSettingKey('openai_api_key')).toBe(true);
    expect(isSecretSettingKey('claude_api_key')).toBe(true);
    expect(isSecretSettingKey('hf_token')).toBe(true);
    expect(isSecretSettingKey('llm_provider')).toBe(false);
  });

  it('returns an encrypted secret value before checking plaintext storage', () => {
    const plaintext = createPlaintextStore({
      openai_api_key: 'plaintext-key',
    });
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend({
        encrypted: {
          openai_api_key: 'enc:secure-key',
        },
      }),
      logFailure: vi.fn(),
    });

    expect(manager.get('openai_api_key')).toBe('secure-key');
    expect(plaintext.get('openai_api_key')).toBe('plaintext-key');
  });

  it('migrates a plaintext secret into secure storage on first read', () => {
    const plaintext = createPlaintextStore({
      claude_api_key: 'legacy-key',
    });
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend(),
      logFailure: vi.fn(),
    });

    expect(manager.get('claude_api_key')).toBe('legacy-key');
    expect(plaintext.get('claude_api_key')).toBeNull();
    expect(manager.get('claude_api_key')).toBe('legacy-key');
  });

  it('keeps the plaintext secret when migration fails', () => {
    const plaintext = createPlaintextStore({
      hf_token: 'legacy-token',
    });
    const logFailure = vi.fn();
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend({
        writeImpl: () => {
          throw new Error('disk full');
        },
      }),
      logFailure,
    });

    expect(manager.get('hf_token')).toBe('legacy-token');
    expect(plaintext.get('hf_token')).toBe('legacy-token');
    expect(logFailure).toHaveBeenCalledWith(
      'hf_token',
      'read-migration',
      expect.any(Error),
    );
  });

  it('stores secret updates in secure storage and clears plaintext copies', () => {
    const plaintext = createPlaintextStore({
      gemini_api_key: 'legacy-gemini',
    });
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend(),
      logFailure: vi.fn(),
    });

    manager.set('gemini_api_key', 'new-gemini-key');

    expect(plaintext.get('gemini_api_key')).toBeNull();
    expect(manager.get('gemini_api_key')).toBe('new-gemini-key');
  });

  it('falls back to plaintext persistence when secure writes fail', () => {
    const plaintext = createPlaintextStore();
    const logFailure = vi.fn();
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend({
        writeImpl: () => {
          throw new Error('permission denied');
        },
      }),
      logFailure,
    });

    manager.set('openai_api_key', 'fallback-key');

    expect(plaintext.get('openai_api_key')).toBe('fallback-key');
    expect(logFailure).toHaveBeenCalledWith(
      'openai_api_key',
      'write',
      expect.any(Error),
    );
  });

  it('passes non-secret settings through the plaintext store', () => {
    const plaintext = createPlaintextStore();
    const manager = createSecureSettingsManager({
      plaintext,
      backend: createSecureBackend(),
      logFailure: vi.fn(),
    });

    manager.set('llm_provider', 'ollama');

    expect(manager.get('llm_provider')).toBe('ollama');
    expect(plaintext.get('llm_provider')).toBe('ollama');
  });
});
