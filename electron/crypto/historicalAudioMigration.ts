import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AudioKeyStore } from './audioKeyStore';
import {
  type EncryptedArtifactHeader,
  EncryptedArtifactStore,
} from './encryptedArtifactStore';

export interface HistoricalAudioMigrationOptions {
  artifactsRootDir: string;
  audioKeyStore: AudioKeyStore;
  isMeetingEligible?: (meetingId: string) => boolean | Promise<boolean>;
  onProgress?: (progress: {
    meetingId: string;
    totalEligible: number;
    completed: number;
  }) => void;
}

export interface HistoricalAudioMigrationResult {
  totalScanned: number;
  totalEligible: number;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: Array<{ meetingId: string; error: string }>;
}

export class MigrationVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationVerificationError';
  }
}

function normalizeSource(source: string): 'mic' | 'system' | 'mixed' | 'none' {
  if (source === 'mic') return 'mic';
  if (source === 'system') return 'system';
  if (source === 'mix' || source === 'mixed') return 'mixed';
  return 'none';
}

export async function migrateHistoricalAudio(
  options: HistoricalAudioMigrationOptions,
): Promise<HistoricalAudioMigrationResult> {
  const { artifactsRootDir, audioKeyStore, isMeetingEligible, onProgress } =
    options;

  const result: HistoricalAudioMigrationResult = {
    totalScanned: 0,
    totalEligible: 0,
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  };

  if (!fs.existsSync(artifactsRootDir)) {
    return result;
  }

  const entries = fs.readdirSync(artifactsRootDir, { withFileTypes: true });
  const meetingDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  result.totalScanned = meetingDirs.length;

  type Candidate = {
    meetingId: string;
    meetingDir: string;
    manifestPath: string;
    manifestMtimeMs: number;
    manifest: any;
  };

  const candidates: Candidate[] = [];

  for (const meetingId of meetingDirs) {
    const meetingDir = path.join(artifactsRootDir, meetingId);
    const manifestPath = path.join(
      meetingDir,
      'capture-journal',
      'manifest.json',
    );

    if (!fs.existsSync(manifestPath)) {
      result.skippedCount += 1;
      continue;
    }

    let manifestRaw: string;
    let parsed: any;
    try {
      manifestRaw = fs.readFileSync(manifestPath, 'utf8');
      parsed = JSON.parse(manifestRaw);
    } catch {
      result.skippedCount += 1;
      continue;
    }

    // If already schema v4 or has locator, it's already migrated
    if (parsed.schemaVersion === 4 || parsed.encryptedManifestRelativePath) {
      result.skippedCount += 1;
      continue;
    }

    // Only migrate sealed/stopped journals
    const isSealed =
      parsed.lifecycleState === 'sealed' ||
      parsed.status === 'sealed' ||
      parsed.lifecycleState === 'stopped';

    if (!isSealed) {
      result.skippedCount += 1;
      continue;
    }

    // Check external eligibility callback if provided
    if (isMeetingEligible) {
      const eligible = await isMeetingEligible(meetingId);
      if (!eligible) {
        result.skippedCount += 1;
        continue;
      }
    }

    const stat = fs.statSync(manifestPath);
    candidates.push({
      meetingId,
      meetingDir,
      manifestPath,
      manifestMtimeMs: stat.mtimeMs,
      manifest: parsed,
    });
  }

  // Sort newest first
  candidates.sort((a, b) => b.manifestMtimeMs - a.manifestMtimeMs);
  result.totalEligible = candidates.length;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      await migrateSingleMeeting(candidate, audioKeyStore);
      result.migratedCount += 1;
      onProgress?.({
        meetingId: candidate.meetingId,
        totalEligible: candidates.length,
        completed: i + 1,
      });
    } catch (err) {
      result.failedCount += 1;
      result.failures.push({
        meetingId: candidate.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function migrateSingleMeeting(
  candidate: {
    meetingId: string;
    meetingDir: string;
    manifestPath: string;
    manifest: any;
  },
  audioKeyStore: AudioKeyStore,
): Promise<void> {
  const { meetingId, meetingDir, manifestPath, manifest } = candidate;
  const keyResult = audioKeyStore.getOrCreateMeetingAudioKey(meetingId);
  const meetingKey = keyResult.meetingKey;
  const keyId = keyResult.keyId;
  const generation = String(manifest.generation || 'gen-1');

  const filesToDelete: string[] = [];
  const createdEncFiles: string[] = [];

  try {
    const updatedManifest = JSON.parse(JSON.stringify(manifest));
    updatedManifest.schemaVersion = 4;
    updatedManifest.envelopeVersion = 1;
    updatedManifest.keyId = keyId;

    // Handle v2/v3 intervals
    if (Array.isArray(updatedManifest.intervals)) {
      for (const interval of updatedManifest.intervals) {
        if (!interval.sources || typeof interval.sources !== 'object') continue;
        for (const sourceKey of Object.keys(interval.sources)) {
          const sourceDisp = interval.sources[sourceKey];
          if (!sourceDisp || typeof sourceDisp !== 'object') continue;

          // Migrate raw chunk if present
          if (
            sourceDisp.rawRelativePath &&
            typeof sourceDisp.rawRelativePath === 'string'
          ) {
            const rawPlainFullPath = path.join(
              meetingDir,
              sourceDisp.rawRelativePath,
            );
            if (fs.existsSync(rawPlainFullPath)) {
              const plainData = fs.readFileSync(rawPlainFullPath);
              const encFilename = `${randomUUID()}.enc`;
              const encRelPath = path.join(
                'capture-journal',
                'chunks',
                encFilename,
              );
              const encFullPath = path.join(meetingDir, encRelPath);

              const headerInput: Omit<
                EncryptedArtifactHeader,
                'plaintextLength'
              > = {
                keyId,
                meetingId,
                generation,
                artifactKind: 'raw',
                source: normalizeSource(sourceKey),
                sequence: interval.sequence,
              };

              const writeResult =
                await EncryptedArtifactStore.writeEncryptedFile(
                  encFullPath,
                  plainData,
                  meetingKey,
                  headerInput,
                );
              createdEncFiles.push(encFullPath);

              const readBack = await EncryptedArtifactStore.readEncryptedFile(
                encFullPath,
                meetingKey,
                headerInput,
              );

              if (Buffer.compare(plainData, readBack.plaintext) !== 0) {
                throw new MigrationVerificationError(
                  `Verification failed for raw chunk ${interval.sequence} source ${sourceKey}`,
                );
              }

              sourceDisp.rawRelativePath = encRelPath;
              sourceDisp.rawCiphertextSha256 = writeResult.ciphertextSha256;
              filesToDelete.push(rawPlainFullPath);
            }
          }

          // Migrate repair chunk if present
          if (
            sourceDisp.repairRelativePath &&
            typeof sourceDisp.repairRelativePath === 'string'
          ) {
            const repairPlainFullPath = path.join(
              meetingDir,
              sourceDisp.repairRelativePath,
            );
            if (fs.existsSync(repairPlainFullPath)) {
              const plainData = fs.readFileSync(repairPlainFullPath);
              const encFilename = `${randomUUID()}.enc`;
              const encRelPath = path.join(
                'capture-journal',
                'repair',
                encFilename,
              );
              const encFullPath = path.join(meetingDir, encRelPath);

              const headerInput: Omit<
                EncryptedArtifactHeader,
                'plaintextLength'
              > = {
                keyId,
                meetingId,
                generation,
                artifactKind: 'repair',
                source: normalizeSource(sourceKey),
                sequence: interval.sequence,
              };

              const writeResult =
                await EncryptedArtifactStore.writeEncryptedFile(
                  encFullPath,
                  plainData,
                  meetingKey,
                  headerInput,
                );
              createdEncFiles.push(encFullPath);

              const readBack = await EncryptedArtifactStore.readEncryptedFile(
                encFullPath,
                meetingKey,
                headerInput,
              );

              if (Buffer.compare(plainData, readBack.plaintext) !== 0) {
                throw new MigrationVerificationError(
                  `Verification failed for repair chunk ${interval.sequence} source ${sourceKey}`,
                );
              }

              sourceDisp.repairRelativePath = encRelPath;
              sourceDisp.repairCiphertextSha256 = writeResult.ciphertextSha256;
              filesToDelete.push(repairPlainFullPath);
            }
          }
        }
      }
    }

    // Handle v1 chunks array if present
    if (Array.isArray(updatedManifest.chunks)) {
      for (const chunk of updatedManifest.chunks) {
        if (!chunk.path || typeof chunk.path !== 'string') continue;
        const plainFullPath = path.isAbsolute(chunk.path)
          ? chunk.path
          : path.join(meetingDir, chunk.path);

        if (fs.existsSync(plainFullPath)) {
          const plainData = fs.readFileSync(plainFullPath);
          const encFilename = `${randomUUID()}.enc`;
          const encRelPath = path.join(
            'capture-journal',
            'chunks',
            encFilename,
          );
          const encFullPath = path.join(meetingDir, encRelPath);

          const headerInput: Omit<EncryptedArtifactHeader, 'plaintextLength'> =
            {
              keyId,
              meetingId,
              generation,
              artifactKind: 'raw',
              source: normalizeSource(chunk.source || 'mix'),
              sequence: chunk.sequence ?? 0,
            };

          const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
            encFullPath,
            plainData,
            meetingKey,
            headerInput,
          );
          createdEncFiles.push(encFullPath);

          const readBack = await EncryptedArtifactStore.readEncryptedFile(
            encFullPath,
            meetingKey,
            headerInput,
          );

          if (Buffer.compare(plainData, readBack.plaintext) !== 0) {
            throw new MigrationVerificationError(
              `Verification failed for chunk sequence ${chunk.sequence}`,
            );
          }

          chunk.path = encRelPath;
          chunk.ciphertextSha256 = writeResult.ciphertextSha256;
          filesToDelete.push(plainFullPath);
        }
      }
    }

    // Encrypt full manifest to manifest.enc
    const manifestEncRelPath = path.join('capture-journal', 'manifest.enc');
    const manifestEncFullPath = path.join(meetingDir, manifestEncRelPath);
    const manifestPlaintext = Buffer.from(
      JSON.stringify(updatedManifest, null, 2),
      'utf8',
    );

    const manifestHeader: Omit<EncryptedArtifactHeader, 'plaintextLength'> = {
      keyId,
      meetingId,
      generation,
      artifactKind: 'manifest',
      source: 'none',
      sequence: updatedManifest.revision ?? 1,
    };

    const manifestWrite = await EncryptedArtifactStore.writeEncryptedFile(
      manifestEncFullPath,
      manifestPlaintext,
      meetingKey,
      manifestHeader,
    );
    createdEncFiles.push(manifestEncFullPath);

    // Verify manifest.enc read back
    const manifestReadBack = await EncryptedArtifactStore.readEncryptedFile(
      manifestEncFullPath,
      meetingKey,
      manifestHeader,
    );

    if (Buffer.compare(manifestPlaintext, manifestReadBack.plaintext) !== 0) {
      throw new MigrationVerificationError(
        'Verification failed for manifest.enc',
      );
    }

    // Write locator to manifest.json atomically
    const locator = {
      schemaVersion: 4,
      envelopeVersion: 1,
      meetingId,
      keyId,
      generation,
      encryptedManifestRelativePath: manifestEncRelPath,
      ciphertextSha256: manifestWrite.ciphertextSha256,
      plaintextSha256: manifestWrite.plaintextSha256,
    };

    const tempManifestPath = `${manifestPath}.tmp-${randomUUID()}`;
    fs.writeFileSync(
      tempManifestPath,
      JSON.stringify(locator, null, 2),
      'utf8',
    );
    fs.renameSync(tempManifestPath, manifestPath);

    // Now safely unlink all verified legacy plaintext audio files
    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (unlinkErr) {
        console.warn(
          `[HistoricalMigration] Failed to delete plaintext artifact: ${unlinkErr}`,
        );
      }
    }
  } catch (error) {
    // On failure, clean up any new .enc files created during this run so no partial ciphertext remains
    for (const encFile of createdEncFiles) {
      try {
        if (fs.existsSync(encFile)) {
          fs.unlinkSync(encFile);
        }
      } catch {
        // ignore cleanup errors
      }
    }
    throw error;
  }
}
