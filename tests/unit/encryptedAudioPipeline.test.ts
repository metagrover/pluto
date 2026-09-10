import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { CaptureJournalManifestV4 } from '../../electron/captureJournal';
import { EncryptedArtifactStore } from '../../electron/crypto/encryptedArtifactStore';
import {
  materializeEncryptedJournalSource,
  mixEncryptedAudioArtifacts,
  probeEncryptedAudioDuration,
  repairEncryptedJournalRawChunk,
  sliceEncryptedAudio,
} from '../../electron/crypto/encryptedAudioPipeline';

const floatWav = (durationSeconds: number, amplitude = 0.25) => {
  const sampleRate = 48_000;
  const frames = Math.round(sampleRate * durationSeconds);
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(32, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let index = 0; index < frames; index += 1) {
    wav.writeFloatLE(amplitude, 44 + index * 4);
  }
  return wav;
};

describe('encrypted audio pipeline', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  const setup = async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pluto-encrypted-audio-'));
    roots.push(rootDir);
    const meetingKey = randomBytes(32);
    const manifest = {
      schemaVersion: 4,
      meetingId: 'meeting-encrypted',
      generation: 'generation-1',
      keyId: 'key-1',
      intervals: [],
    } as unknown as CaptureJournalManifestV4;
    return { rootDir, meetingKey, manifest };
  };

  it('repairs encrypted raw capture bytes entirely in memory', async () => {
    const { rootDir, meetingKey, manifest } = await setup();
    const plaintext = floatWav(0.25);
    const inputPath = join(rootDir, 'raw.enc');
    await EncryptedArtifactStore.writeEncryptedFile(
      inputPath,
      plaintext,
      meetingKey,
      {
        artifactKind: 'raw',
        generation: manifest.generation,
        keyId: manifest.keyId,
        meetingId: manifest.meetingId,
        sequence: 3,
        source: 'mic',
      },
    );

    const repaired = await repairEncryptedJournalRawChunk({
      filePath: inputPath,
      manifest,
      source: 'mic',
      sequence: 3,
      expectedPlaintextSha256: createHash('sha256')
        .update(plaintext)
        .digest('hex'),
      meetingKey,
    });

    expect(repaired.toString('ascii', 0, 4)).toBe('RIFF');
    expect(await readdir(rootDir)).toEqual(['raw.enc']);
  });

  it('materializes, mixes, probes, and slices authenticated audio without plaintext files', async () => {
    const { rootDir, meetingKey, manifest } = await setup();
    const repair = floatWav(0.5);
    const repairPath = join(rootDir, 'repair.enc');
    const repairWrite = await EncryptedArtifactStore.writeEncryptedFile(
      repairPath,
      repair,
      meetingKey,
      {
        artifactKind: 'repair',
        generation: manifest.generation,
        keyId: manifest.keyId,
        meetingId: manifest.meetingId,
        sequence: 0,
        source: 'mic',
      },
    );
    manifest.intervals = [
      {
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 0.5,
        sources: {
          mic: {
            disposition: 'captured',
            rawChecksumSha256: repairWrite.plaintextSha256,
            rawRelativePath: 'unused.enc',
            repairChecksumSha256: repairWrite.plaintextSha256,
            repairRelativePath: 'repair.enc',
          },
          system: {
            disposition: 'source_unavailable',
            reason: 'not_requested',
          },
        },
      },
      {
        sequence: 1,
        chunkStartSec: 0.5,
        chunkEndSec: 0.75,
        sources: {
          mic: {
            disposition: 'verified_silence',
            reason: 'measured_silence',
          },
          system: {
            disposition: 'source_unavailable',
            reason: 'not_requested',
          },
        },
      },
    ];

    const context = {
      meetingId: manifest.meetingId,
      generation: manifest.generation,
      keyId: manifest.keyId,
      meetingKey,
    };
    const sourcePath = await materializeEncryptedJournalSource({
      rootDir,
      manifest,
      source: 'mic',
      meetingKey,
    });
    expect(sourcePath).toMatch(/\.enc$/);
    expect((await readFile(sourcePath!)).toString('ascii', 0, 4)).toBe('PENC');
    await expect(
      probeEncryptedAudioDuration(sourcePath!, context),
    ).resolves.toBe(0.75);

    const slice = await sliceEncryptedAudio({
      filePath: sourcePath!,
      context,
      startSec: 0.1,
      durationSec: 0.2,
    });
    expect(slice.toString('ascii', 0, 4)).toBe('RIFF');
    expect(slice.length).toBeGreaterThanOrEqual(44 + 3_200 * 2);
    expect(slice.length).toBeLessThanOrEqual(44 + 3_201 * 2);

    const sourcePlaintext = EncryptedArtifactStore.open(
      await readFile(sourcePath!),
      meetingKey,
      { artifactKind: 'mic', source: 'mic' },
    ).plaintext;
    const systemPath = join(rootDir, 'system.enc');
    await EncryptedArtifactStore.writeEncryptedFile(
      systemPath,
      sourcePlaintext,
      meetingKey,
      {
        artifactKind: 'system',
        generation: manifest.generation,
        keyId: manifest.keyId,
        meetingId: manifest.meetingId,
        sequence: 0,
        source: 'system',
      },
    );
    const mixedPath = await mixEncryptedAudioArtifacts({
      rootDir,
      inputPaths: [sourcePath!, systemPath],
      context,
    });
    await expect(probeEncryptedAudioDuration(mixedPath, context)).resolves.toBe(
      0.75,
    );
    expect(
      (await readdir(rootDir)).every((name) => name.endsWith('.enc')),
    ).toBe(true);
  });
});
