import * as electron from 'electron';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type KeyCustodyProbeResult = {
  available: boolean;
  enforceableClaim: 'os_mediated_app_bound_key_protection';
  storageBackend: 'macos_keychain_safestorage' | 'unsupported';
  roundtripVerified: boolean;
  failureReason?: string;
};

export function probeKeyCustody(
  backend?: SafeStorageBackend,
): KeyCustodyProbeResult {
  let fromElectron: SafeStorageBackend | undefined;
  try {
    fromElectron = (electron as Record<string, unknown>).safeStorage as
      | SafeStorageBackend
      | undefined;
  } catch {
    fromElectron = undefined;
  }
  const effectiveBackend = backend ?? fromElectron;
  if (
    !effectiveBackend ||
    typeof effectiveBackend.isEncryptionAvailable !== 'function'
  ) {
    return {
      available: false,
      enforceableClaim: 'os_mediated_app_bound_key_protection',
      storageBackend: 'unsupported',
      roundtripVerified: false,
      failureReason: 'SafeStorage backend not present',
    };
  }

  try {
    const isAvailable = backend.isEncryptionAvailable();
    if (!isAvailable) {
      return {
        available: false,
        enforceableClaim: 'os_mediated_app_bound_key_protection',
        storageBackend: 'unsupported',
        roundtripVerified: false,
        failureReason: 'SafeStorage reports encryption unavailable',
      };
    }

    const testPayload = 'pluto-key-custody-probe-check';
    const encrypted = backend.encryptString(testPayload);
    const decrypted = backend.decryptString(encrypted);
    if (decrypted !== testPayload) {
      return {
        available: false,
        enforceableClaim: 'os_mediated_app_bound_key_protection',
        storageBackend: 'macos_keychain_safestorage',
        roundtripVerified: false,
        failureReason: 'Decrypted payload mismatch',
      };
    }

    return {
      available: true,
      enforceableClaim: 'os_mediated_app_bound_key_protection',
      storageBackend: 'macos_keychain_safestorage',
      roundtripVerified: true,
    };
  } catch (error) {
    return {
      available: false,
      enforceableClaim: 'os_mediated_app_bound_key_protection',
      storageBackend: 'macos_keychain_safestorage',
      roundtripVerified: false,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}
