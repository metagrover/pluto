import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EncryptedArtifactStore } from '../../electron/crypto/encryptedArtifactStore';

describe('EncryptedArtifactStore', () => {
  let key: Buffer;
  let tmpDir: string;

  beforeEach(() => {
    key = randomBytes(32);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-artifact-test-'));
  });

  it('seals and opens plaintext with bit-identity', () => {
    const plaintext = Buffer.from(
      'hello world - sensitive audio bytes 1234567890',
    );
    const headerInput = {
      keyId: randomUUID(),
      meetingId: 'meeting-123',
      generation: 'gen-1',
      artifactKind: 'raw' as const,
      source: 'mic' as const,
      sequence: 42,
    };

    const sealed = EncryptedArtifactStore.seal(plaintext, key, headerInput);
    expect(sealed.fullBuffer.length).toBeGreaterThan(plaintext.length);

    const decrypted = EncryptedArtifactStore.open(sealed.fullBuffer, key, {
      meetingId: 'meeting-123',
      sequence: 42,
    });

    expect(decrypted.plaintext.equals(plaintext)).toBe(true);
    expect(decrypted.header.keyId).toBe(headerInput.keyId);
    expect(decrypted.header.sequence).toBe(42);
    expect(decrypted.plaintextSha256).toBeDefined();
    expect(decrypted.ciphertextSha256).toBeDefined();
  });

  it('fails authentication if ciphertext is tampered with', () => {
    const plaintext = Buffer.from('unaltered audio data');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      keyId: randomUUID(),
      meetingId: 'm1',
      generation: 'g1',
      artifactKind: 'raw',
      source: 'mic',
      sequence: 1,
    });

    // Tamper with the last byte of ciphertext
    const tampered = Buffer.from(sealed.fullBuffer);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => EncryptedArtifactStore.open(tampered, key)).toThrow(
      /authentication failed/,
    );
  });

  it('fails authentication if header (AAD) is modified', () => {
    const plaintext = Buffer.from('unaltered audio data');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      keyId: randomUUID(),
      meetingId: 'm1',
      generation: 'g1',
      artifactKind: 'raw',
      source: 'mic',
      sequence: 1,
    });

    // Modify a byte in the header region (e.g. sequence number or meetingId)
    const tampered = Buffer.from(sealed.fullBuffer);
    tampered[15] ^= 0x01;

    expect(() => EncryptedArtifactStore.open(tampered, key)).toThrow();
  });

  it('fails authentication when opened with wrong key', () => {
    const plaintext = Buffer.from('confidential meeting');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      keyId: randomUUID(),
      meetingId: 'm1',
      generation: 'g1',
      artifactKind: 'manifest',
      source: 'none',
      sequence: 0,
    });

    const wrongKey = randomBytes(32);
    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, wrongKey),
    ).toThrow(/authentication failed/);
  });

  it('rejects envelope when expected meetingId or generation mismatches', () => {
    const plaintext = Buffer.from('audio');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      keyId: randomUUID(),
      meetingId: 'meeting-correct',
      generation: 'gen-correct',
      artifactKind: 'repair',
      source: 'system',
      sequence: 5,
    });

    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, key, {
        meetingId: 'meeting-wrong',
      }),
    ).toThrow(/meetingId mismatch/);

    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, key, {
        generation: 'gen-wrong',
      }),
    ).toThrow(/generation mismatch/);
  });

  it('writes and reads encrypted files to disk atomically', async () => {
    const filePath = path.join(tmpDir, 'chunk-001.enc');
    const plaintext = randomBytes(16000); // 16 KB audio
    const headerInput = {
      keyId: randomUUID(),
      meetingId: 'm-disk',
      generation: 'g-1',
      artifactKind: 'raw' as const,
      source: 'mic' as const,
      sequence: 1,
    };

    const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
      filePath,
      plaintext,
      key,
      headerInput,
    );

    expect(fs.existsSync(filePath)).toBe(true);
    expect(writeResult.byteCount).toBeGreaterThan(16000);

    const readResult = await EncryptedArtifactStore.readEncryptedFile(
      filePath,
      key,
      { meetingId: 'm-disk' },
    );

    expect(readResult.plaintext.equals(plaintext)).toBe(true);
    expect(readResult.ciphertextSha256).toBe(writeResult.ciphertextSha256);
    expect(readResult.plaintextSha256).toBe(writeResult.plaintextSha256);
  });
});
