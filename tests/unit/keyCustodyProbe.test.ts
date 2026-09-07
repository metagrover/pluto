import { describe, expect, it } from 'vitest';
import {
  type SafeStorageBackend,
  probeKeyCustody,
} from '../../electron/crypto/keyCustodyProbe';

describe('keyCustodyProbe', () => {
  it('reports available and verified when backend roundtrips successfully', () => {
    const memoryStorage = new Map<string, string>();
    const mockBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => {
        const id = `enc_${plainText}`;
        memoryStorage.set(id, plainText);
        return Buffer.from(id);
      },
      decryptString: (encrypted: Buffer) => {
        const id = encrypted.toString('utf8');
        const val = memoryStorage.get(id);
        if (!val) throw new Error('Not found');
        return val;
      },
    };

    const result = probeKeyCustody(mockBackend);
    expect(result.available).toBe(true);
    expect(result.roundtripVerified).toBe(true);
    expect(result.enforceableClaim).toBe(
      'os_mediated_app_bound_key_protection',
    );
    expect(result.storageBackend).toBe('macos_keychain_safestorage');
  });

  it('reports unavailable when encryption is not available', () => {
    const mockBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    };

    const result = probeKeyCustody(mockBackend);
    expect(result.available).toBe(false);
    expect(result.roundtripVerified).toBe(false);
    expect(result.failureReason).toContain('encryption unavailable');
  });

  it('reports failure when encrypt throws', () => {
    const mockBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('Keychain locked');
      },
      decryptString: () => '',
    };

    const result = probeKeyCustody(mockBackend);
    expect(result.available).toBe(false);
    expect(result.roundtripVerified).toBe(false);
    expect(result.failureReason).toContain('Keychain locked');
  });

  it('reports failure when decrypted payload mismatches', () => {
    const mockBackend: SafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('encrypted'),
      decryptString: () => 'corrupted',
    };

    const result = probeKeyCustody(mockBackend);
    expect(result.available).toBe(false);
    expect(result.roundtripVerified).toBe(false);
    expect(result.failureReason).toContain('mismatch');
  });
});
