import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_WRAP_KEY_INFO,
  DATABASE_KEY_INFO,
  deriveAudioWrappingKey,
  deriveDatabaseKey,
  deriveKey,
} from '../../electron/crypto/keyDerivation';

describe('keyDerivation', () => {
  it('derives deterministic 32-byte keys from identical masterKey and salt', () => {
    const masterKey = randomBytes(32);
    const salt = randomBytes(32);

    const dbKey1 = deriveDatabaseKey(masterKey, salt);
    const dbKey2 = deriveDatabaseKey(masterKey, salt);
    expect(dbKey1).toHaveLength(32);
    expect(dbKey1.equals(dbKey2)).toBe(true);

    const audioKey1 = deriveAudioWrappingKey(masterKey, salt);
    const audioKey2 = deriveAudioWrappingKey(masterKey, salt);
    expect(audioKey1).toHaveLength(32);
    expect(audioKey1.equals(audioKey2)).toBe(true);

    // Domain separation: dbKey and audioKey MUST NOT be equal
    expect(dbKey1.equals(audioKey1)).toBe(false);
  });

  it('generates different keys for different salts', () => {
    const masterKey = randomBytes(32);
    const salt1 = randomBytes(32);
    const salt2 = randomBytes(32);

    const key1 = deriveDatabaseKey(masterKey, salt1);
    const key2 = deriveDatabaseKey(masterKey, salt2);
    expect(key1.equals(key2)).toBe(false);
  });

  it('rejects invalid key or salt lengths', () => {
    const validKey = randomBytes(32);
    const shortKey = randomBytes(16);
    const validSalt = randomBytes(16);
    const shortSalt = randomBytes(8);

    expect(() => deriveKey(shortKey, validSalt, 'info')).toThrow(/32 bytes/);
    expect(() => deriveKey(validKey, shortSalt, 'info')).toThrow(
      /at least 16 bytes/,
    );
  });
});
