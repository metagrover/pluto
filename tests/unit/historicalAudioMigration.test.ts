import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioKeyStore } from '../../electron/crypto/audioKeyStore';
import { EncryptedArtifactStore } from '../../electron/crypto/encryptedArtifactStore';
import {
  MigrationVerificationError,
  migrateHistoricalAudio,
} from '../../electron/crypto/historicalAudioMigration';

describe('HistoricalAudioMigration', () => {
  let tempDir: string;
  let sqlite: Database.Database;
  let audioKeyStore: AudioKeyStore;
  let audioWrappingKey: Buffer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-hist-mig-test-'));
    sqlite = new Database(':memory:');
    audioWrappingKey = randomBytes(32);
    audioKeyStore = new AudioKeyStore({
      sqlite,
      audioWrappingKey,
    });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const setupLegacyMeeting = (
    meetingId: string,
    options: {
      schemaVersion?: number;
      lifecycleState?: string;
      chunkContent?: string;
      mtimeOffsetSeconds?: number;
    } = {},
  ) => {
    const {
      schemaVersion = 3,
      lifecycleState = 'sealed',
      chunkContent = 'RIFF1234WAVEfmt mock pcm audio content',
      mtimeOffsetSeconds = 0,
    } = options;

    const meetingDir = path.join(tempDir, meetingId);
    const journalDir = path.join(meetingDir, 'capture-journal');
    const chunksDir = path.join(journalDir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });

    const rawChunkRelPath = path.join(
      'capture-journal',
      'chunks',
      'chunk-0-mic.wav',
    );
    const rawChunkFullPath = path.join(meetingDir, rawChunkRelPath);
    fs.writeFileSync(rawChunkFullPath, chunkContent, 'utf8');

    const manifest = {
      schemaVersion,
      meetingId,
      lifecycleState,
      generation: 'gen-1',
      revision: 1,
      expectedSources: ['mic'],
      sourceAvailability: { mic: 'available' },
      intervals: [
        {
          sequence: 0,
          chunkStartSec: 0,
          chunkEndSec: 1.0,
          sources: {
            mic: {
              disposition: 'captured',
              rawRelativePath: rawChunkRelPath,
              rawChecksumSha256: 'mocksha',
              repairRelativePath: rawChunkRelPath,
              repairChecksumSha256: 'mocksha',
            },
          },
        },
      ],
      transcriptCheckpoints: [],
      acceptanceFrames: [],
    };

    const manifestPath = path.join(journalDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    if (mtimeOffsetSeconds !== 0) {
      const now = Date.now() / 1000 + mtimeOffsetSeconds;
      fs.utimesSync(manifestPath, now, now);
    }

    return { meetingDir, journalDir, rawChunkFullPath, manifestPath };
  };

  it('migrates a sealed legacy v3 meeting to encrypted v4 and deletes plaintext chunk', async () => {
    const meetingId = 'meeting-123';
    const originalContent = 'RIFF1234WAVEfmt test sound';
    const { meetingDir, rawChunkFullPath, manifestPath } = setupLegacyMeeting(
      meetingId,
      {
        chunkContent: originalContent,
      },
    );

    const result = await migrateHistoricalAudio({
      artifactsRootDir: tempDir,
      audioKeyStore,
    });

    expect(result.migratedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.totalEligible).toBe(1);

    // Plaintext chunk should be unlinked
    expect(fs.existsSync(rawChunkFullPath)).toBe(false);

    // Manifest should now be locator pointing to manifest.enc
    const locator = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(locator.schemaVersion).toBe(4);
    expect(locator.envelopeVersion).toBe(1);
    expect(locator.meetingId).toBe(meetingId);
    expect(locator.encryptedManifestRelativePath).toBe(
      'capture-journal/manifest.enc',
    );

    const manifestEncFullPath = path.join(
      meetingDir,
      locator.encryptedManifestRelativePath,
    );
    expect(fs.existsSync(manifestEncFullPath)).toBe(true);

    // Verify decryption of manifest.enc and chunk
    const keyResult = audioKeyStore.getMeetingAudioKey(meetingId);
    expect(keyResult).not.toBeNull();

    const readManifest = await EncryptedArtifactStore.readEncryptedFile(
      manifestEncFullPath,
      keyResult!.meetingKey,
      { meetingId, artifactKind: 'manifest' },
    );
    const decryptedManifest = JSON.parse(
      readManifest.plaintext.toString('utf8'),
    );
    expect(decryptedManifest.schemaVersion).toBe(4);

    const encChunkRelPath =
      decryptedManifest.intervals[0].sources.mic.rawRelativePath;
    expect(encChunkRelPath.endsWith('.enc')).toBe(true);
    const encChunkFullPath = path.join(meetingDir, encChunkRelPath);
    expect(fs.existsSync(encChunkFullPath)).toBe(true);

    const readChunk = await EncryptedArtifactStore.readEncryptedFile(
      encChunkFullPath,
      keyResult!.meetingKey,
      { meetingId, artifactKind: 'raw' },
    );
    expect(readChunk.plaintext.toString('utf8')).toBe(originalContent);
  });

  it('skips unsealed/active meetings and already migrated v4 meetings', async () => {
    // Unsealed meeting
    setupLegacyMeeting('active-meeting', { lifecycleState: 'recording' });
    // Already v4 meeting
    const meetingDir = path.join(tempDir, 'already-v4', 'capture-journal');
    fs.mkdirSync(meetingDir, { recursive: true });
    fs.writeFileSync(
      path.join(meetingDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 4,
        envelopeVersion: 1,
        meetingId: 'already-v4',
        keyId: 'k1',
        encryptedManifestRelativePath: 'capture-journal/manifest.enc',
      }),
      'utf8',
    );

    const result = await migrateHistoricalAudio({
      artifactsRootDir: tempDir,
      audioKeyStore,
    });

    expect(result.migratedCount).toBe(0);
    expect(result.totalEligible).toBe(0);
    expect(result.skippedCount).toBe(2);
  });

  it('migrates newest eligible meetings first', async () => {
    setupLegacyMeeting('older-meeting', { mtimeOffsetSeconds: -100 });
    setupLegacyMeeting('newer-meeting', { mtimeOffsetSeconds: 100 });

    const order: string[] = [];
    const result = await migrateHistoricalAudio({
      artifactsRootDir: tempDir,
      audioKeyStore,
      onProgress: (p) => {
        order.push(p.meetingId);
      },
    });

    expect(result.migratedCount).toBe(2);
    expect(order).toEqual(['newer-meeting', 'older-meeting']);
  });

  it('is idempotent when run multiple times', async () => {
    setupLegacyMeeting('meeting-idem');

    const firstRun = await migrateHistoricalAudio({
      artifactsRootDir: tempDir,
      audioKeyStore,
    });
    expect(firstRun.migratedCount).toBe(1);

    const secondRun = await migrateHistoricalAudio({
      artifactsRootDir: tempDir,
      audioKeyStore,
    });
    expect(secondRun.migratedCount).toBe(0);
    expect(secondRun.skippedCount).toBe(1);
  });

  it('aborts migration, preserves plaintext, and cleans up .enc files if verification fails', async () => {
    const meetingId = 'meeting-corrupt';
    const { meetingDir, rawChunkFullPath, manifestPath } = setupLegacyMeeting(
      meetingId,
      {
        chunkContent: 'hello original',
      },
    );

    // Spy on EncryptedArtifactStore.readEncryptedFile to simulate corruption / verification failure
    const originalRead = EncryptedArtifactStore.readEncryptedFile;
    EncryptedArtifactStore.readEncryptedFile = async (...args) => {
      const actual = await originalRead.apply(EncryptedArtifactStore, args);
      return {
        ...actual,
        plaintext: Buffer.from('tampered content', 'utf8'),
      };
    };

    try {
      const result = await migrateHistoricalAudio({
        artifactsRootDir: tempDir,
        audioKeyStore,
      });

      expect(result.migratedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failures[0].meetingId).toBe(meetingId);

      // Plaintext file MUST be preserved
      expect(fs.existsSync(rawChunkFullPath)).toBe(true);
      expect(fs.readFileSync(rawChunkFullPath, 'utf8')).toBe('hello original');

      // manifest.json should NOT be migrated to schema v4 locator
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifest.schemaVersion).toBe(3);

      // No stray .enc files in chunks directory
      const chunksFiles = fs.readdirSync(
        path.join(meetingDir, 'capture-journal', 'chunks'),
      );
      const encFiles = chunksFiles.filter((f) => f.endsWith('.enc'));
      expect(encFiles.length).toBe(0);
    } finally {
      EncryptedArtifactStore.readEncryptedFile = originalRead;
    }
  });
});
