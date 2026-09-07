import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ENVELOPE_MAGIC = Buffer.from('PENC', 'ascii'); // 4 bytes
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALGO_AES_256_GCM = 1;

export interface EncryptedArtifactHeader {
  keyId: string;
  meetingId: string;
  generation: string;
  artifactKind:
    | 'raw'
    | 'repair'
    | 'manifest'
    | 'mixed'
    | 'mic'
    | 'system'
    | 'chunk';
  source: 'mic' | 'system' | 'mixed' | 'none';
  sequence: number;
  plaintextLength: number;
}

export interface EncryptedEnvelope {
  header: EncryptedArtifactHeader;
  nonce: Buffer; // 12 bytes
  tag: Buffer; // 16 bytes
  ciphertext: Buffer;
  fullBuffer: Buffer;
}

export interface DecryptedArtifact {
  header: EncryptedArtifactHeader;
  plaintext: Buffer;
  ciphertextSha256: string;
  plaintextSha256: string;
}

export const EncryptedArtifactStore = {
  /**
   * Encrypts plaintext into a v1 envelope buffer.
   */
  seal(
    plaintext: Buffer,
    key: Buffer,
    headerInput: Omit<EncryptedArtifactHeader, 'plaintextLength'>,
    nonceOverride?: Buffer,
  ): EncryptedEnvelope {
    if (key.length !== 32) {
      throw new Error(
        `Invalid key length: expected 32 bytes, got ${key.length}`,
      );
    }

    const header: EncryptedArtifactHeader = {
      ...headerInput,
      plaintextLength: plaintext.length,
    };

    const headerJsonBuffer = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerJsonBuffer.length > 65535) {
      throw new Error('Header metadata exceeds maximum 64KB envelope limit');
    }

    // Fixed prefix: Magic (4) + Version (1) + Algo (1) + HeaderLength (2) = 8 bytes
    const prefix = Buffer.alloc(8);
    ENVELOPE_MAGIC.copy(prefix, 0);
    prefix.writeUInt8(ENVELOPE_VERSION, 4);
    prefix.writeUInt8(ENVELOPE_ALGO_AES_256_GCM, 5);
    prefix.writeUInt16BE(headerJsonBuffer.length, 6);

    // AAD is prefix + header JSON
    const aad = Buffer.concat([prefix, headerJsonBuffer]);

    const nonce = nonceOverride ?? randomBytes(12);
    if (nonce.length !== 12) {
      throw new Error(`Nonce must be 12 bytes, got ${nonce.length}`);
    }

    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const fullBuffer = Buffer.concat([aad, nonce, tag, ciphertext]);

    return {
      header,
      nonce,
      tag,
      ciphertext,
      fullBuffer,
    };
  },

  /**
   * Decrypts and authenticates a v1 envelope buffer.
   */
  open(
    envelopeBuffer: Buffer,
    key: Buffer,
    expected?: Partial<EncryptedArtifactHeader>,
  ): DecryptedArtifact {
    if (key.length !== 32) {
      throw new Error(
        `Invalid key length: expected 32 bytes, got ${key.length}`,
      );
    }

    if (envelopeBuffer.length < 8 + 12 + 16) {
      throw new Error('Corrupted artifact: envelope buffer is truncated');
    }

    const magic = envelopeBuffer.subarray(0, 4);
    if (!magic.equals(ENVELOPE_MAGIC)) {
      throw new Error(
        'Invalid artifact: magic mismatch (not a Pluto encrypted artifact)',
      );
    }

    const version = envelopeBuffer.readUInt8(4);
    if (version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported artifact version: ${version}`);
    }

    const algo = envelopeBuffer.readUInt8(5);
    if (algo !== ENVELOPE_ALGO_AES_256_GCM) {
      throw new Error(`Unsupported artifact algorithm: ${algo}`);
    }

    const headerLength = envelopeBuffer.readUInt16BE(6);
    const headerStart = 8;
    const headerEnd = headerStart + headerLength;
    if (envelopeBuffer.length < headerEnd + 12 + 16) {
      throw new Error('Corrupted artifact: truncated header payload');
    }

    const headerJsonBuffer = envelopeBuffer.subarray(headerStart, headerEnd);
    let header: EncryptedArtifactHeader;
    try {
      header = JSON.parse(headerJsonBuffer.toString('utf8'));
    } catch (error) {
      throw new Error(
        `Corrupted artifact: invalid header JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Validate expected bindings
    if (expected) {
      if (expected.keyId && expected.keyId !== header.keyId) {
        throw new Error(
          `Artifact keyId mismatch: expected ${expected.keyId}, got ${header.keyId}`,
        );
      }
      if (expected.meetingId && expected.meetingId !== header.meetingId) {
        throw new Error(
          `Artifact meetingId mismatch: expected ${expected.meetingId}, got ${header.meetingId}`,
        );
      }
      if (expected.generation && expected.generation !== header.generation) {
        throw new Error(
          `Artifact generation mismatch: expected ${expected.generation}, got ${header.generation}`,
        );
      }
      if (
        expected.artifactKind &&
        expected.artifactKind !== header.artifactKind
      ) {
        throw new Error(
          `Artifact kind mismatch: expected ${expected.artifactKind}, got ${header.artifactKind}`,
        );
      }
      if (expected.source && expected.source !== header.source) {
        throw new Error(
          `Artifact source mismatch: expected ${expected.source}, got ${header.source}`,
        );
      }
      if (
        expected.sequence !== undefined &&
        expected.sequence !== header.sequence
      ) {
        throw new Error(
          `Artifact sequence mismatch: expected ${expected.sequence}, got ${header.sequence}`,
        );
      }
    }

    const aad = envelopeBuffer.subarray(0, headerEnd);
    const nonce = envelopeBuffer.subarray(headerEnd, headerEnd + 12);
    const tag = envelopeBuffer.subarray(headerEnd + 12, headerEnd + 28);
    const ciphertext = envelopeBuffer.subarray(headerEnd + 28);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      if (plaintext.length !== header.plaintextLength) {
        throw new Error(
          `Plaintext length mismatch: expected ${header.plaintextLength}, got ${plaintext.length}`,
        );
      }

      const ciphertextSha256 = createHash('sha256')
        .update(ciphertext)
        .digest('hex');
      const plaintextSha256 = createHash('sha256')
        .update(plaintext)
        .digest('hex');

      return {
        header,
        plaintext,
        ciphertextSha256,
        plaintextSha256,
      };
    } catch (error) {
      throw new Error(
        `Artifact authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  /**
   * Atomically writes an encrypted envelope to disk (temp file, fsync, rename, dir fsync).
   */
  async writeEncryptedFile(
    targetFilePath: string,
    plaintext: Buffer,
    key: Buffer,
    headerInput: Omit<EncryptedArtifactHeader, 'plaintextLength'>,
  ): Promise<{
    ciphertextSha256: string;
    plaintextSha256: string;
    byteCount: number;
  }> {
    const sealed = EncryptedArtifactStore.seal(plaintext, key, headerInput);
    const targetDir = path.dirname(targetFilePath);
    await fs.promises.mkdir(targetDir, { recursive: true, mode: 0o700 });

    const tmpFilePath = `${targetFilePath}.${randomBytes(8).toString('hex')}.tmp`;
    const fd = await fs.promises.open(tmpFilePath, 'w', 0o600);
    try {
      await fd.writeFile(sealed.fullBuffer);
      await fd.sync();
    } finally {
      await fd.close();
    }

    await fs.promises.rename(tmpFilePath, targetFilePath);

    // Sync parent directory
    try {
      const dirFd = await fs.promises.open(targetDir, 'r');
      try {
        await dirFd.sync();
      } finally {
        await dirFd.close();
      }
    } catch {}

    const ciphertextSha256 = createHash('sha256')
      .update(sealed.ciphertext)
      .digest('hex');
    const plaintextSha256 = createHash('sha256')
      .update(plaintext)
      .digest('hex');

    return {
      ciphertextSha256,
      plaintextSha256,
      byteCount: sealed.fullBuffer.length,
    };
  },

  /**
   * Reads and decrypts an envelope from disk.
   */
  async readEncryptedFile(
    filePath: string,
    key: Buffer,
    expected?: Partial<EncryptedArtifactHeader>,
  ): Promise<DecryptedArtifact> {
    const buffer = await fs.promises.readFile(filePath);
    return EncryptedArtifactStore.open(buffer, key, expected);
  },
};
