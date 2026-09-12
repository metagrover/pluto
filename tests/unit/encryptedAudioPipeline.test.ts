import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CaptureJournalManifestV4 } from '../../electron/captureJournal';
import { EncryptedArtifactStore } from '../../electron/crypto/encryptedArtifactStore';
import { createEncryptedAudioPipeline } from '../../electron/crypto/encryptedAudioPipeline';
import * as original from '../../electron/crypto/encryptedAudioPipelineImpl';
import { buildTestAudioWorker } from './helpers/encryptedAudioWorker';

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
  let workerDir: string;
  let pipeline: ReturnType<typeof createEncryptedAudioPipeline>;
  beforeAll(async () => {
    const worker = await buildTestAudioWorker();
    workerDir = worker.directory;
    pipeline = createEncryptedAudioPipeline(worker.path);
  }, 30_000);
  afterAll(async () => {
    if (workerDir) await rm(workerDir, { recursive: true, force: true });
  });

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

  const canonicalWav = (seconds: number) => {
    const frames = 16_000 * seconds;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    wav.fill(Buffer.from([0x00, 0x20]), 44);
    return wav;
  };

  it('rejects tampering, wrong keys and wrong context without stranding queued work', async () => {
    const { rootDir, meetingKey, manifest } = await setup();
    const context = { ...manifest, meetingKey };
    const filePath = join(rootDir, 'source.enc');
    await EncryptedArtifactStore.writeEncryptedFile(
      filePath,
      canonicalWav(1),
      meetingKey,
      {
        artifactKind: 'mic',
        source: 'mic',
        sequence: 0,
        ...context,
      },
    );
    const tamperedPath = join(rootDir, 'tampered.enc');
    const tampered = await readFile(filePath);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(tamperedPath, tampered);
    const requests = await Promise.allSettled([
      pipeline.sliceEncryptedAudio({
        filePath: tamperedPath,
        context,
        startSec: 0,
        durationSec: 1,
      }),
      pipeline.probeEncryptedAudioDuration(filePath, {
        ...context,
        meetingKey: randomBytes(32),
      }),
      pipeline.probeEncryptedAudioDuration(filePath, {
        ...context,
        generation: 'wrong-generation',
      }),
      pipeline.probeEncryptedAudioDuration(filePath, context),
    ]);
    expect(requests.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    expect(requests[3]).toEqual({ status: 'fulfilled', value: 1 });
    expect(await readdir(rootDir)).toEqual(['source.enc', 'tampered.enc']);
  });

  it('keeps the event loop responsive while mixing a thirty-minute recording', async () => {
    const { rootDir, meetingKey, manifest } = await setup();
    const context = { ...manifest, meetingKey };
    const inputPaths: [string, string] = [
      join(rootDir, 'mic.enc'),
      join(rootDir, 'system.enc'),
    ];
    const wav = canonicalWav(30 * 60);
    for (const [index, source] of (['mic', 'system'] as const).entries()) {
      await EncryptedArtifactStore.writeEncryptedFile(
        inputPaths[index],
        wav,
        meetingKey,
        {
          artifactKind: source,
          source,
          sequence: 0,
          ...context,
        },
      );
    }
    let ticks = 0;
    let maximumGapMs = 0;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maximumGapMs = Math.max(maximumGapMs, now - previous);
      previous = now;
      ticks += 1;
    }, 5);
    let mixedPath: string;
    try {
      mixedPath = await pipeline.mixEncryptedAudioArtifacts({
        rootDir,
        inputPaths,
        context,
      });
      maximumGapMs = Math.max(maximumGapMs, performance.now() - previous);
    } finally {
      clearInterval(timer);
    }
    // This generous budget catches whole-recording CPU work returning to the
    // main loop; output equivalence is verified separately below.
    expect(ticks).toBeGreaterThan(5);
    expect(maximumGapMs).toBeLessThan(250);
    await expect(
      pipeline.probeEncryptedAudioDuration(mixedPath!, context),
    ).resolves.toBe(1800);
  }, 30_000);

  it('rejects worker startup failures and exits instead of hanging the caller', async () => {
    const broken = createEncryptedAudioPipeline(join(workerDir, 'missing.js'));
    await expect(
      broken.probeEncryptedAudioDuration('', {} as never),
    ).rejects.toThrow();
    const exitWorker = join(workerDir, 'exit.js');
    await writeFile(exitWorker, 'process.exit(0)');
    const exiting = createEncryptedAudioPipeline(exitWorker);
    await expect(
      exiting.probeEncryptedAudioDuration('', {} as never),
    ).rejects.toThrow('encrypted_audio_worker_exited:0');
  });

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

    const repaired = await pipeline.repairEncryptedJournalRawChunk({
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
    const sourcePath = await pipeline.materializeEncryptedJournalSource({
      rootDir,
      manifest,
      source: 'mic',
      meetingKey,
    });
    expect(sourcePath).toMatch(/\.enc$/);
    expect((await readFile(sourcePath!)).toString('ascii', 0, 4)).toBe('PENC');
    await expect(
      pipeline.probeEncryptedAudioDuration(sourcePath!, context),
    ).resolves.toBe(0.75);

    const slice = await pipeline.sliceEncryptedAudio({
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
    const mixedPath = await pipeline.mixEncryptedAudioArtifacts({
      rootDir,
      inputPaths: [sourcePath!, systemPath],
      context,
    });
    const referenceMixedPath = await original.mixEncryptedAudioArtifacts({
      rootDir,
      inputPaths: [sourcePath!, systemPath],
      context,
    });
    const decrypt = async (filePath: string) =>
      EncryptedArtifactStore.open(await readFile(filePath), meetingKey, context)
        .plaintext;
    expect(await decrypt(mixedPath)).toEqual(await decrypt(referenceMixedPath));
    expect(slice).toEqual(
      await original.sliceEncryptedAudio({
        filePath: sourcePath!,
        context,
        startSec: 0.1,
        durationSec: 0.2,
      }),
    );
    await expect(
      pipeline.probeEncryptedAudioDuration(mixedPath, context),
    ).resolves.toBe(0.75);
    expect(
      (await readdir(rootDir)).every((name) => name.endsWith('.enc')),
    ).toBe(true);
  });
});
