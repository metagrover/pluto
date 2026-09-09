import { hkdfSync } from 'node:crypto';

export const DATABASE_KEY_INFO = 'pluto:database:v1';
export const AUDIO_WRAP_KEY_INFO = 'pluto:audio-wrap:v1';

export function deriveKey(
  masterKey: Buffer,
  salt: Buffer,
  info: string,
  keyLength = 32,
): Buffer {
  if (masterKey.length !== 32) {
    throw new Error(
      `Master key must be exactly 32 bytes, got ${masterKey.length}`,
    );
  }
  if (salt.length < 16) {
    throw new Error(`Salt must be at least 16 bytes, got ${salt.length}`);
  }
  const derived = hkdfSync(
    'sha256',
    masterKey,
    salt,
    Buffer.from(info, 'utf8'),
    keyLength,
  );
  return Buffer.from(derived);
}

export function deriveDatabaseKey(masterKey: Buffer, salt: Buffer): Buffer {
  return deriveKey(masterKey, salt, DATABASE_KEY_INFO, 32);
}

export function deriveAudioWrappingKey(
  masterKey: Buffer,
  salt: Buffer,
): Buffer {
  return deriveKey(masterKey, salt, AUDIO_WRAP_KEY_INFO, 32);
}
