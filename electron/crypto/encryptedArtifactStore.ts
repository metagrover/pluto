import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ENVELOPE_MAGIC = Buffer.from('PENC', 'ascii'); // 4 bytes
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALGO_AES_256_GCM = 1;

export interface EncryptedArtifactHeader {
  artifactKind:
    | 'raw'
    | 'repair'
    | 'manifest'
    | 'mixed'
    | 'mic'
    | 'system'
    | 'chunk'
    | 'sidecar';
  generation: string;
  keyId: string;
  meetingId: string;
  plaintextLength: number;
  sequence: number;
  source: 'mic' | 'system' | 'mixed' | 'none';
}

export const VALID_ARTIFACT_KINDS = new Set<
  EncryptedArtifactHeader['artifactKind']
>(['raw', 'repair', 'manifest', 'mixed', 'mic', 'system', 'chunk', 'sidecar']);

export const VALID_ARTIFACT_SOURCES = new Set<
  EncryptedArtifactHeader['source']
>(['mic', 'system', 'mixed', 'none']);

export interface EncryptedEnvelope {
  header: EncryptedArtifactHeader;
  nonce: Buffer; // 12 bytes
  tag: Buffer; // 16 bytes
  ciphertext: Buffer;
  fullBuffer: Buffer;
  ciphertextSha256: string;
  plaintextSha256: string;
}

export interface DecryptedArtifact {
  header: EncryptedArtifactHeader;
  plaintext: Buffer;
  ciphertextSha256: string;
  plaintextSha256: string;
}

/**
 * Deterministically serializes canonical header with sorted keys.
 */
export function serializeCanonicalHeader(
  header: EncryptedArtifactHeader,
): Buffer {
  const ordered = {
    artifactKind: header.artifactKind,
    generation: header.generation,
    keyId: header.keyId,
    meetingId: header.meetingId,
    plaintextLength: header.plaintextLength,
    sequence: header.sequence,
    source: header.source,
  };
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

export const EncryptedArtifactStore = {
  /**
   * Encrypts plaintext into a canonical v1 envelope buffer.
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
    if (!VALID_ARTIFACT_KINDS.has(headerInput.artifactKind)) {
      throw new Error(`Invalid artifactKind: ${headerInput.artifactKind}`);
    }
    if (!VALID_ARTIFACT_SOURCES.has(headerInput.source)) {
      throw new Error(`Invalid source: ${headerInput.source}`);
    }
    if (
      !headerInput.generation ||
      typeof headerInput.generation !== 'string' ||
      !headerInput.generation.trim()
    ) {
      throw new Error('Invalid generation: must be non-empty string');
    }
    if (
      !headerInput.keyId ||
      typeof headerInput.keyId !== 'string' ||
      !headerInput.keyId.trim()
    ) {
      throw new Error('Invalid keyId: must be non-empty string');
    }
    if (
      !headerInput.meetingId ||
      typeof headerInput.meetingId !== 'string' ||
      !headerInput.meetingId.trim()
    ) {
      throw new Error('Invalid meetingId: must be non-empty string');
    }
    if (
      typeof headerInput.sequence !== 'number' ||
      !Number.isInteger(headerInput.sequence) ||
      headerInput.sequence < 0
    ) {
      throw new Error('Invalid sequence: must be non-negative integer');
    }

    const header: EncryptedArtifactHeader = {
      artifactKind: headerInput.artifactKind,
      generation: headerInput.generation,
      keyId: headerInput.keyId,
      meetingId: headerInput.meetingId,
      plaintextLength: plaintext.length,
      sequence: headerInput.sequence,
      source: headerInput.source,
    };

    const headerJsonBuffer = serializeCanonicalHeader(header);
    if (headerJsonBuffer.length > 65535) {
      throw new Error('Header metadata exceeds maximum 64KB envelope limit');
    }

    // Fixed prefix: Magic (4) + Version (1) + Algo (1) + HeaderLength (2) = 8 bytes
    const prefix = Buffer.alloc(8);
    ENVELOPE_MAGIC.copy(prefix, 0);
    prefix.writeUInt8(ENVELOPE_VERSION, 4);
    prefix.writeUInt8(ENVELOPE_ALGO_AES_256_GCM, 5);
    prefix.writeUInt16BE(headerJsonBuffer.length, 6);

    // AAD is prefix + header JSON (8 + H bytes)
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
    const ciphertextSha256 = createHash('sha256')
      .update(ciphertext)
      .digest('hex');
    const plaintextSha256 = createHash('sha256')
      .update(plaintext)
      .digest('hex');

    return {
      header,
      nonce,
      tag,
      ciphertext,
      fullBuffer,
      ciphertextSha256,
      plaintextSha256,
    };
  },

  /**
   * Authenticates and decrypts a canonical v1 envelope buffer.
   */
  open(
    buffer: Buffer,
    key: Buffer,
    expected?: {
      meetingId?: string;
      sequence?: number;
      generation?: string;
      artifactKind?: string;
      keyId?: string;
      source?: string;
    },
  ): DecryptedArtifact {
    if (key.length !== 32) {
      throw new Error(
        `Invalid key length: expected 32 bytes, got ${key.length}`,
      );
    }

    // Minimum size: 8 prefix + 0 header + 12 nonce + 16 tag = 36 bytes
    if (buffer.length < 36) {
      throw new Error(
        'Envelope buffer is too short to be a valid PENC artifact',
      );
    }

    if (!buffer.subarray(0, 4).equals(ENVELOPE_MAGIC)) {
      throw new Error('Invalid magic bytes: expected PENC');
    }

    const version = buffer.readUInt8(4);
    if (version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported envelope version: ${version}`);
    }

    const algo = buffer.readUInt8(5);
    if (algo !== ENVELOPE_ALGO_AES_256_GCM) {
      throw new Error(`Unsupported envelope algorithm: ${algo}`);
    }

    const headerLength = buffer.readUInt16BE(6);
    const headerEnd = 8 + headerLength;
    if (buffer.length < headerEnd + 28) {
      throw new Error('Envelope is truncated before header/nonce/tag boundary');
    }

    const headerJsonBuffer = buffer.subarray(8, headerEnd);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(headerJsonBuffer.toString('utf8'));
    } catch {
      throw new Error('Malformed UTF-8 or JSON in envelope header');
    }

    if (
      typeof parsed.artifactKind !== 'string' ||
      !VALID_ARTIFACT_KINDS.has(
        parsed.artifactKind as EncryptedArtifactHeader['artifactKind'],
      )
    ) {
      throw new Error(
        `Invalid or missing artifactKind in envelope header: ${String(parsed.artifactKind)}`,
      );
    }
    if (typeof parsed.generation !== 'string' || !parsed.generation.trim()) {
      throw new Error('Invalid or missing generation in envelope header');
    }
    if (typeof parsed.keyId !== 'string' || !parsed.keyId.trim()) {
      throw new Error('Invalid or missing keyId in envelope header');
    }
    if (typeof parsed.meetingId !== 'string' || !parsed.meetingId.trim()) {
      throw new Error('Invalid or missing meetingId in envelope header');
    }
    if (
      typeof parsed.sequence !== 'number' ||
      !Number.isInteger(parsed.sequence) ||
      parsed.sequence < 0
    ) {
      throw new Error(
        'Invalid sequence in envelope header: must be non-negative integer',
      );
    }
    if (
      typeof parsed.source !== 'string' ||
      !VALID_ARTIFACT_SOURCES.has(
        parsed.source as EncryptedArtifactHeader['source'],
      )
    ) {
      throw new Error(
        `Invalid or missing source in envelope header: ${String(parsed.source)}`,
      );
    }
    if (
      typeof parsed.plaintextLength !== 'number' ||
      !Number.isInteger(parsed.plaintextLength) ||
      parsed.plaintextLength < 0
    ) {
      throw new Error(
        'Invalid plaintextLength in envelope header: must be non-negative integer',
      );
    }

    const header: EncryptedArtifactHeader = {
      artifactKind:
        parsed.artifactKind as EncryptedArtifactHeader['artifactKind'],
      generation: parsed.generation,
      keyId: parsed.keyId,
      meetingId: parsed.meetingId,
      plaintextLength: parsed.plaintextLength,
      sequence: parsed.sequence,
      source: parsed.source as EncryptedArtifactHeader['source'],
    };

    const canonicalHeaderBytes = serializeCanonicalHeader(header);
    if (!headerJsonBuffer.equals(canonicalHeaderBytes)) {
      throw new Error(
        'Envelope header JSON is not in canonical byte-for-byte format',
      );
    }

    if (expected?.keyId && header.keyId !== expected.keyId) {
      throw new Error('Key ID mismatch in encrypted artifact');
    }
    if (expected?.meetingId && header.meetingId !== expected.meetingId) {
      throw new Error('Meeting ID mismatch in encrypted artifact');
    }
    if (
      expected?.sequence !== undefined &&
      header.sequence !== expected.sequence
    ) {
      throw new Error('Sequence mismatch in encrypted artifact');
    }
    if (expected?.generation && header.generation !== expected.generation) {
      throw new Error('Generation mismatch in encrypted artifact');
    }
    if (
      expected?.artifactKind &&
      header.artifactKind !== expected.artifactKind
    ) {
      throw new Error('Artifact kind mismatch in encrypted artifact');
    }
    if (expected?.source && header.source !== expected.source) {
      throw new Error('Source mismatch in encrypted artifact');
    }

    const aad = buffer.subarray(0, headerEnd);
    const nonce = buffer.subarray(headerEnd, headerEnd + 12);
    const tag = buffer.subarray(headerEnd + 12, headerEnd + 28);
    const ciphertext = buffer.subarray(headerEnd + 28);

    if (ciphertext.length !== header.plaintextLength) {
      throw new Error(
        'Ciphertext length does not match header plaintextLength',
      );
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      if (plaintext.length !== header.plaintextLength) {
        throw new Error('Decrypted plaintext length mismatch');
      }

      const plaintextSha256 = createHash('sha256')
        .update(plaintext)
        .digest('hex');
      const ciphertextSha256 = createHash('sha256')
        .update(ciphertext)
        .digest('hex');

      return {
        header,
        plaintext,
        ciphertextSha256,
        plaintextSha256,
      };
    } catch (error) {
      throw new Error(
        `Encrypted artifact authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  /**
   * Durably writes an encrypted artifact file using atomic write + fsync.
   */
  async writeEncryptedFile(
    filePath: string,
    plaintext: Buffer,
    key: Buffer,
    headerInput: Omit<EncryptedArtifactHeader, 'plaintextLength'>,
  ): Promise<EncryptedEnvelope> {
    const envelope = this.seal(plaintext, key, headerInput);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    const fd = await fs.promises.open(tmpPath, 'w', 0o600);
    try {
      await fd.writeFile(envelope.fullBuffer);
      await fd.sync();
    } finally {
      await fd.close();
    }

    await fs.promises.rename(tmpPath, filePath);

    // Sync parent directory
    const dirFd = await fs.promises.open(dir, 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }

    return envelope;
  },

  /**
   * Reads and decrypts an encrypted artifact file.
   */
  async readEncryptedFile(
    filePath: string,
    key: Buffer,
    expected?: {
      meetingId?: string;
      sequence?: number;
      generation?: string;
      artifactKind?: string;
      keyId?: string;
      source?: string;
    },
  ): Promise<DecryptedArtifact> {
    const buffer = await fs.promises.readFile(filePath);
    return this.open(buffer, key, expected);
  },
};
