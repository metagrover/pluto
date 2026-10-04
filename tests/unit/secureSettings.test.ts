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
  it('never probes or unlocks key storage when no credentials have been saved', () => {
    const backend = createSecureBackend();
    backend.isAvailable = vi.fn(() => {
      throw new Error('Unexpected Keychain access');
    });
    backend.decrypt = vi.fn(() => {
      throw new Error('Unexpected Keychain access');
    });
    const manager = createSecureSettingsManager({
      plaintext: createPlaintextStore(),
      backend,
    });
    for (const provider of [
      'openai',
      'openrouter',
      'gemini',
      'claude',
    ] as const) {
      expect(manager.status(provider)).toEqual({
        provider,
        configured: false,
        available: true,
      });
      expect(manager.get(`${provider}_api_key`)).toBeNull();
    }
    expect(manager.get('hf_token')).toBeNull();
    expect(backend.isAvailable).not.toHaveBeenCalled();
    expect(backend.decrypt).not.toHaveBeenCalled();
  });
  it('identifies the secret-backed setting keys', () => {
    expect(isSecretSettingKey('gemini_api_key')).toBe(true);
    expect(isSecretSettingKey('openai_api_key')).toBe(true);
    expect(isSecretSettingKey('openrouter_api_key')).toBe(true);
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

  it('fails closed while preserving a legacy plaintext secret when migration fails', () => {
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

    expect(manager.get('hf_token')).toBeNull();
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

  it('fails closed instead of persisting plaintext when secure writes fail', () => {
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

    expect(() => manager.set('openai_api_key', 'fallback-key')).toThrow(
      'secure_storage_write_failed',
    );

    expect(plaintext.get('openai_api_key')).toBeNull();
    expect(logFailure).toHaveBeenCalledWith(
      'openai_api_key',
      'write',
      expect.any(Error),
    );
  });

  it('reports unavailable secure storage without revealing credential data', () => {
    const manager = createSecureSettingsManager({
      plaintext: createPlaintextStore({ openrouter_api_key: 'legacy-key' }),
      backend: createSecureBackend({ available: false }),
      logFailure: vi.fn(),
    });

    expect(manager.get('openrouter_api_key')).toBeNull();
    expect(manager.status('openrouter')).toEqual({
      provider: 'openrouter',
      configured: false,
      available: false,
      error: 'secure_storage_unavailable',
    });
    expect(() => manager.set('openrouter_api_key', 'secret')).toThrow(
      'secure_storage_unavailable',
    );
  });

  it('returns only a redacted credential hint for configured providers', () => {
    const fullCredential = 'sk-or-v1-private-value-1234';
    const manager = createSecureSettingsManager({
      plaintext: createPlaintextStore(),
      backend: createSecureBackend({
        encrypted: { openrouter_api_key: `enc:${fullCredential}` },
      }),
      logFailure: vi.fn(),
    });

    const status = manager.status('openrouter');

    expect(status).toEqual({
      provider: 'openrouter',
      configured: true,
      available: true,
      maskedHint: 'sk-or-********1234',
    });
    expect(JSON.stringify(status)).not.toContain(fullCredential);
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
