import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type EncryptedArtifactHeader,
  EncryptedArtifactStore,
} from '../electron/crypto/encryptedArtifactStore';

function makeMinimalWav(sampleRate = 16000, sampleCount = 320): Buffer {
  // 44 bytes header + 320 samples (16-bit mono = 640 bytes)
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);

  for (let i = 0; i < sampleCount; i++) {
    const val = Math.floor(Math.sin(i * 0.1) * 10000);
    buffer.writeInt16LE(val, 44 + i * 2);
  }
  return buffer;
}

const keyHex =
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const wrongKeyHex =
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const nonceHex = 'a0a1a2a3a4a5a6a7a8a9aaab';

const key = Buffer.from(keyHex, 'hex');
const nonce = Buffer.from(nonceHex, 'hex');

// 1. Empty payload
const emptyPlaintext = Buffer.alloc(0);
const emptyHeader: Omit<EncryptedArtifactHeader, 'plaintextLength'> = {
  artifactKind: 'manifest',
  generation: 'gen-1',
  keyId: 'key-test-01',
  meetingId: 'meeting-test-01',
  sequence: 0,
  source: 'none',
};
const emptySealed = EncryptedArtifactStore.seal(
  emptyPlaintext,
  key,
  emptyHeader,
  nonce,
);

// 2. Small text payload
const smallPlaintext = Buffer.from(
  'Hello Pluto Cross-Language Canonical Envelope Test!',
  'utf8',
);
const smallHeader: Omit<EncryptedArtifactHeader, 'plaintextLength'> = {
  artifactKind: 'raw',
  generation: 'gen-1',
  keyId: 'key-test-01',
  meetingId: 'meeting-test-01',
  sequence: 1,
  source: 'mic',
};
const smallSealed = EncryptedArtifactStore.seal(
  smallPlaintext,
  key,
  smallHeader,
  nonce,
);

// 3. WAV audio payload
const wavPlaintext = makeMinimalWav(16000, 320);
const wavHeader: Omit<EncryptedArtifactHeader, 'plaintextLength'> = {
  artifactKind: 'raw',
  generation: 'gen-1',
  keyId: 'key-test-01',
  meetingId: 'meeting-test-01',
  sequence: 2,
  source: 'mic',
};
const wavSealed = EncryptedArtifactStore.seal(
  wavPlaintext,
  key,
  wavHeader,
  nonce,
);

// 4. 32 KiB payload
const k32Plaintext = Buffer.alloc(32768);
for (let i = 0; i < 32768; i++) {
  k32Plaintext[i] = (i * 31 + 17) & 0xff;
}
const k32Header: Omit<EncryptedArtifactHeader, 'plaintextLength'> = {
  artifactKind: 'raw',
  generation: 'gen-1',
  keyId: 'key-test-01',
  meetingId: 'meeting-test-01',
  sequence: 3,
  source: 'system',
};
const k32Sealed = EncryptedArtifactStore.seal(
  k32Plaintext,
  key,
  k32Header,
  nonce,
);

// Tampered cases based on smallSealed:
// a) Tampered header (byte 15 flipped)
const tamperedHeaderBuffer = Buffer.from(smallSealed.fullBuffer);
tamperedHeaderBuffer[15] ^= 0x01;

// b) Tampered tag (byte after nonce, offset 8 + headerLen + 12 + 0)
const smallHeaderLen = smallSealed.fullBuffer.readUInt16BE(6);
const tagOffset = 8 + smallHeaderLen + 12;
const tamperedTagBuffer = Buffer.from(smallSealed.fullBuffer);
tamperedTagBuffer[tagOffset] ^= 0xff;

// c) Tampered ciphertext
const ciphertextOffset = 8 + smallHeaderLen + 12 + 16;
const tamperedCiphertextBuffer = Buffer.from(smallSealed.fullBuffer);
tamperedCiphertextBuffer[ciphertextOffset] ^= 0xff;

// d) Truncated
const truncatedBuffer = smallSealed.fullBuffer.subarray(
  0,
  smallSealed.fullBuffer.length - 10,
);

const vectors = {
  keyHex,
  wrongKeyHex,
  nonceHex,
  validVectors: [
    {
      name: 'empty',
      plaintextBase64: emptyPlaintext.toString('base64'),
      header: emptySealed.header,
      sealedHex: emptySealed.fullBuffer.toString('hex'),
      plaintextSha256: createHash('sha256')
        .update(emptyPlaintext)
        .digest('hex'),
    },
    {
      name: 'small_text',
      plaintextBase64: smallPlaintext.toString('base64'),
      header: smallSealed.header,
      sealedHex: smallSealed.fullBuffer.toString('hex'),
      plaintextSha256: createHash('sha256')
        .update(smallPlaintext)
        .digest('hex'),
    },
    {
      name: 'wav_audio',
      plaintextBase64: wavPlaintext.toString('base64'),
      header: wavSealed.header,
      sealedHex: wavSealed.fullBuffer.toString('hex'),
      plaintextSha256: createHash('sha256').update(wavPlaintext).digest('hex'),
      sampleRate: 16000,
      sampleCount: 320,
    },
    {
      name: 'payload_32kib',
      plaintextBase64: k32Plaintext.toString('base64'),
      header: k32Sealed.header,
      sealedHex: k32Sealed.fullBuffer.toString('hex'),
      plaintextSha256: createHash('sha256').update(k32Plaintext).digest('hex'),
    },
  ],
  tamperedVectors: [
    {
      name: 'tampered_header',
      sealedHex: tamperedHeaderBuffer.toString('hex'),
      expectedError: 'authentication_failed',
    },
    {
      name: 'tampered_tag',
      sealedHex: tamperedTagBuffer.toString('hex'),
      expectedError: 'authentication_failed',
    },
    {
      name: 'tampered_ciphertext',
      sealedHex: tamperedCiphertextBuffer.toString('hex'),
      expectedError: 'authentication_failed',
    },
    {
      name: 'truncated',
      sealedHex: truncatedBuffer.toString('hex'),
      expectedError: 'truncated',
    },
  ],
};

const outputDir = path.join(__dirname, '../tests/fixtures/crypto');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'crossLanguageVectors.json');
fs.writeFileSync(outputPath, JSON.stringify(vectors, null, 2), 'utf8');
console.log(
  'Successfully generated cross-language test vectors at:',
  outputPath,
);
