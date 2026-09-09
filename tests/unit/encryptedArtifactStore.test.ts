import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type EncryptedArtifactHeader,
  EncryptedArtifactStore,
} from '../../electron/crypto/encryptedArtifactStore';

interface CrossLanguageFixture {
  keyHex: string;
  wrongKeyHex: string;
  nonceHex: string;
  validVectors: Array<{
    name: string;
    plaintextBase64: string;
    header: EncryptedArtifactHeader;
    sealedHex: string;
    plaintextSha256: string;
  }>;
  tamperedVectors: Array<{
    name: string;
    sealedHex: string;
    expectedError: string;
  }>;
}

describe('EncryptedArtifactStore', () => {
  let key: Buffer;
  let tmpDir: string;
  let vectors: CrossLanguageFixture;

  beforeEach(() => {
    key = randomBytes(32);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-artifact-test-'));
    const fixturePath = path.join(
      __dirname,
      '../fixtures/crypto/crossLanguageVectors.json',
    );
    vectors = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  });

  it('seals and opens plaintext with bit-identity', () => {
    const plaintext = Buffer.from(
      'hello world - sensitive audio bytes 1234567890',
    );
    const headerInput = {
      artifactKind: 'raw' as const,
      generation: 'gen-1',
      keyId: randomUUID(),
      meetingId: 'meeting-123',
      sequence: 42,
      source: 'mic' as const,
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
      artifactKind: 'raw',
      generation: 'g1',
      keyId: randomUUID(),
      meetingId: 'm1',
      sequence: 1,
      source: 'mic',
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
      artifactKind: 'raw',
      generation: 'g1',
      keyId: randomUUID(),
      meetingId: 'm1',
      sequence: 1,
      source: 'mic',
    });

    // Modify a byte in the header region
    const tampered = Buffer.from(sealed.fullBuffer);
    tampered[15] ^= 0x01;

    expect(() => EncryptedArtifactStore.open(tampered, key)).toThrow();
  });

  it('fails authentication when opened with wrong key', () => {
    const plaintext = Buffer.from('confidential meeting');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      artifactKind: 'manifest',
      generation: 'g1',
      keyId: randomUUID(),
      meetingId: 'm1',
      sequence: 0,
      source: 'none',
    });

    const wrongKey = randomBytes(32);
    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, wrongKey),
    ).toThrow(/authentication failed/);
  });

  it('rejects envelope when expected meetingId or generation mismatches', () => {
    const plaintext = Buffer.from('content');
    const sealed = EncryptedArtifactStore.seal(plaintext, key, {
      artifactKind: 'raw',
      generation: 'gen-expected',
      keyId: 'key-1',
      meetingId: 'meeting-expected',
      sequence: 5,
      source: 'mic',
    });

    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, key, {
        meetingId: 'meeting-mismatch',
      }),
    ).toThrow(/Meeting ID mismatch/);

    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, key, {
        generation: 'gen-mismatch',
      }),
    ).toThrow(/Generation mismatch/);

    expect(() =>
      EncryptedArtifactStore.open(sealed.fullBuffer, key, {
        sequence: 999,
      }),
    ).toThrow(/Sequence mismatch/);
  });

  it('rejects envelope when header JSON is not in byte-for-byte canonical format (unsorted keys)', () => {
    const unsortedHeader = JSON.stringify({
      source: 'mic',
      sequence: 1,
      plaintextLength: 4,
      meetingId: 'm1',
      keyId: 'k1',
      generation: 'gen-1',
      artifactKind: 'raw',
    });
    const headerBuf = Buffer.from(unsortedHeader, 'utf8');
    const prefix = Buffer.alloc(8);
    Buffer.from('PENC').copy(prefix, 0);
    prefix.writeUInt8(1, 4);
    prefix.writeUInt8(1, 5);
    prefix.writeUInt16BE(headerBuf.length, 6);
    const aad = Buffer.concat([prefix, headerBuf]);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from('test')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([aad, nonce, tag, ciphertext]);

    expect(() => EncryptedArtifactStore.open(envelope, key)).toThrow(
      /canonical byte-for-byte format/,
    );
  });

  it('rejects envelope when header JSON has extra fields', () => {
    const extraFieldHeader = JSON.stringify({
      artifactKind: 'raw',
      extraField: 'not-allowed',
      generation: 'gen-1',
      keyId: 'k1',
      meetingId: 'm1',
      plaintextLength: 4,
      sequence: 1,
      source: 'mic',
    });
    const headerBuf = Buffer.from(extraFieldHeader, 'utf8');
    const prefix = Buffer.alloc(8);
    Buffer.from('PENC').copy(prefix, 0);
    prefix.writeUInt8(1, 4);
    prefix.writeUInt8(1, 5);
    prefix.writeUInt16BE(headerBuf.length, 6);
    const aad = Buffer.concat([prefix, headerBuf]);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from('test')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([aad, nonce, tag, ciphertext]);

    expect(() => EncryptedArtifactStore.open(envelope, key)).toThrow(
      /canonical byte-for-byte format/,
    );
  });

  it('rejects seal and open with invalid schema values', () => {
    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'invalid_kind' as any,
        generation: 'gen-1',
        keyId: 'k1',
        meetingId: 'm1',
        sequence: 0,
        source: 'mic',
      }),
    ).toThrow(/Invalid artifactKind/);

    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'raw',
        generation: 'gen-1',
        keyId: 'k1',
        meetingId: 'm1',
        sequence: -1,
        source: 'mic',
      }),
    ).toThrow(/Invalid sequence/);

    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'raw',
        generation: '   ',
        keyId: 'k1',
        meetingId: 'm1',
        sequence: 0,
        source: 'mic',
      }),
    ).toThrow(/Invalid generation/);

    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'raw',
        generation: 'gen-1',
        keyId: '',
        meetingId: 'm1',
        sequence: 0,
        source: 'mic',
      }),
    ).toThrow(/Invalid keyId/);

    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'raw',
        generation: 'gen-1',
        keyId: 'k1',
        meetingId: '',
        sequence: 0,
        source: 'mic',
      }),
    ).toThrow(/Invalid meetingId/);

    expect(() =>
      EncryptedArtifactStore.seal(Buffer.from('test'), key, {
        artifactKind: 'raw',
        generation: 'gen-1',
        keyId: 'k1',
        meetingId: 'm1',
        sequence: 0,
        source: 'invalid_source' as any,
      }),
    ).toThrow(/Invalid source/);
  });

  it('durably writes and reads encrypted files', async () => {
    const filePath = path.join(tmpDir, 'chunk-001.enc');
    const plaintext = Buffer.from('audio file chunk bytes on disk');
    const headerInput = {
      artifactKind: 'chunk' as const,
      generation: 'gen-1',
      keyId: 'k1',
      meetingId: 'm1',
      sequence: 1,
      source: 'mic' as const,
    };

    await EncryptedArtifactStore.writeEncryptedFile(
      filePath,
      plaintext,
      key,
      headerInput,
    );

    expect(fs.existsSync(filePath)).toBe(true);
    const decrypted = await EncryptedArtifactStore.readEncryptedFile(
      filePath,
      key,
      { meetingId: 'm1', sequence: 1 },
    );

    expect(decrypted.plaintext.equals(plaintext)).toBe(true);
    expect(decrypted.header.artifactKind).toBe('chunk');
  });

  describe('cross-language vector suite', () => {
    it('verifies all valid test vectors decrypt to bit-identical plaintext', () => {
      const vectorKey = Buffer.from(vectors.keyHex, 'hex');

      for (const vec of vectors.validVectors) {
        const envelopeBuffer = Buffer.from(vec.sealedHex, 'hex');
        const expectedPlaintext = Buffer.from(vec.plaintextBase64, 'base64');

        const decrypted = EncryptedArtifactStore.open(
          envelopeBuffer,
          vectorKey,
          {
            meetingId: vec.header.meetingId,
            sequence: vec.header.sequence,
          },
        );

        expect(
          decrypted.plaintext.equals(expectedPlaintext),
          `Vector ${vec.name} plaintext mismatch`,
        ).toBe(true);

        expect(decrypted.plaintextSha256).toBe(vec.plaintextSha256);
        expect(decrypted.header).toEqual(vec.header);
      }
    });

    it('verifies deterministic re-sealing with fixed nonce produces bit-identical envelope bytes', () => {
      const vectorKey = Buffer.from(vectors.keyHex, 'hex');
      const fixedNonce = Buffer.from(vectors.nonceHex, 'hex');

      for (const vec of vectors.validVectors) {
        const plaintext = Buffer.from(vec.plaintextBase64, 'base64');
        const sealed = EncryptedArtifactStore.seal(
          plaintext,
          vectorKey,
          vec.header,
          fixedNonce,
        );

        expect(
          sealed.fullBuffer.toString('hex'),
          `Vector ${vec.name} re-seal hex mismatch`,
        ).toBe(vec.sealedHex);
      }
    });

    it('verifies wrong key fails closed on all valid vectors', () => {
      const wrongKey = Buffer.from(vectors.wrongKeyHex, 'hex');

      for (const vec of vectors.validVectors) {
        const envelopeBuffer = Buffer.from(vec.sealedHex, 'hex');
        expect(() =>
          EncryptedArtifactStore.open(envelopeBuffer, wrongKey),
        ).toThrow(/authentication failed/);
      }
    });

    it('verifies all tampered and truncated vectors fail closed', () => {
      const vectorKey = Buffer.from(vectors.keyHex, 'hex');

      for (const vec of vectors.tamperedVectors) {
        const envelopeBuffer = Buffer.from(vec.sealedHex, 'hex');
        expect(
          () => EncryptedArtifactStore.open(envelopeBuffer, vectorKey),
          `Tampered vector ${vec.name} should fail`,
        ).toThrow();
      }
    });
  });
});
