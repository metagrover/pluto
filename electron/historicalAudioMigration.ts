import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { TranscriptLifecycleStatus } from '../src/utils/transcriptIntegrity';
import {
  type CaptureJournalManifestV3,
  migrateSealedCaptureJournalToV4,
  readCaptureJournalManifest,
} from './captureJournal';
import type { AudioKeyStore } from './crypto/audioKeyStore';
import { EncryptedArtifactStore } from './crypto/encryptedArtifactStore';
import {
  type EncryptedAudioContext,
  listEncryptedAudioBundleFiles,
  migrateCanonicalPlaintextWavToEncryptedBundle,
  verifyEncryptedAudioBundle,
  verifyEncryptedBundleMatchesCanonicalPlaintextWav,
} from './crypto/encryptedAudioBundle';

type HistoricalMeeting = {
  id: string | number;
  started_at?: string | null;
  created_at?: string | null;
  audio_path?: string | null;
  system_audio_path?: string | null;
  mixed_audio_path?: string | null;
  transcript_status?: TranscriptLifecycleStatus | null;
  finalization_status?: string | null;
  downstream_processing_json?: string | null;
};

type AudioColumn = 'audio_path' | 'system_audio_path' | 'mixed_audio_path';
type AudioSource = 'mic' | 'system' | 'mixed';
const FAILURE_RETRY_DELAY_MS = 6 * 60 * 60_000;

type MaterializedMigrationPlan = {
  schemaVersion: 1;
  meetingId: string;
  generation: string;
  keyId: string;
  column: AudioColumn;
  source: AudioSource;
  plaintextRelativePath: string;
  encryptedRelativePath: string;
};

const columnSources: Array<[AudioColumn, AudioSource]> = [
  ['audio_path', 'mic'],
  ['system_audio_path', 'system'],
  ['mixed_audio_path', 'mixed'],
];

const failureCode = (error: unknown) => {
  const code = error instanceof Error ? error.message.split(':', 1)[0] : '';
  return /^[a-z0-9_]+$/.test(code) ? code : 'historical_audio_migration_failed';
};

const isProcessing = (value: string | null | undefined) => {
  try {
    return JSON.parse(value || '{}')?.state === 'processing';
  } catch {
    return true;
  }
};

export const createHistoricalAudioMigrationManager = (options: {
  rootDir: string;
  sqlite: Database.Database;
  listMeetings: () => HistoricalMeeting[];
  audioKeyStore: Pick<
    AudioKeyStore,
    'getOrCreateMeetingAudioKey' | 'getMeetingAudioKey'
  >;
  isMeetingActive?: (meetingId: string) => boolean;
  acquireMigrationLease?: (meetingId: string) => (() => void) | null;
  signal?: AbortSignal;
}) => {
  const rootDir = path.resolve(options.rootDir);
  const resolveManagedPath = (candidate: string) => {
    const resolved = path.resolve(candidate);
    if (resolved === rootDir || !resolved.startsWith(`${rootDir}${path.sep}`)) {
      throw new Error('historical_audio_path_invalid');
    }
    return resolved;
  };
  const relativeManagedPath = (candidate: string) =>
    path.relative(rootDir, resolveManagedPath(candidate));
  const assertManagedFile = async (candidate: string) => {
    const resolved = resolveManagedPath(candidate);
    const [file, realRoot, realFile] = await Promise.all([
      fs.promises.lstat(resolved),
      fs.promises.realpath(rootDir),
      fs.promises.realpath(resolved),
    ]);
    if (
      file.isSymbolicLink() ||
      !file.isFile() ||
      (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`))
    ) {
      throw new Error('historical_audio_path_invalid');
    }
    return { path: resolved, stat: file };
  };
  const writeStatus = (
    meetingId: string,
    status: 'migrating' | 'complete' | 'blocked' | 'failed',
    migratedBytes: number,
    lastFailureCode: string | null,
  ) => {
    const now = new Date().toISOString();
    options.sqlite
      .prepare(
        `INSERT INTO meeting_audio_migrations (
          meeting_id, status, migrated_bytes, last_failure_code,
          started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id) DO UPDATE SET
          status = excluded.status,
          migrated_bytes = excluded.migrated_bytes,
          last_failure_code = excluded.last_failure_code,
          started_at = COALESCE(meeting_audio_migrations.started_at, excluded.started_at),
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        meetingId,
        status,
        migratedBytes,
        lastFailureCode,
        now,
        status === 'complete' ? now : null,
        now,
      );
  };
  const isEligible = (meeting: HistoricalMeeting) =>
    meeting.finalization_status === 'finalized' &&
    meeting.transcript_status === 'validated' &&
    !isProcessing(meeting.downstream_processing_json) &&
    !options.isMeetingActive?.(String(meeting.id));

  const migrateMaterialized = async (args: {
    meeting: HistoricalMeeting;
    manifest: CaptureJournalManifestV3;
    context: EncryptedAudioContext;
  }) => {
    let migratedBytes = 0;
    const meetingId = String(args.meeting.id);
    const meetingRoot = path.join(rootDir, meetingId);
    await fs.promises.mkdir(meetingRoot, { recursive: true });
    for (const [column, source] of columnSources) {
      const planPath = path.join(
        meetingRoot,
        `.historical-${source}-migration.enc`,
      );
      const planHeader = {
        meetingId,
        generation: args.manifest.generation,
        keyId: args.context.keyId,
        artifactKind: 'sidecar' as const,
        source: 'none' as const,
        sequence: columnSources.findIndex(
          ([candidate]) => candidate === column,
        ),
      };
      let plan: MaterializedMigrationPlan | null = null;
      try {
        const opened = await EncryptedArtifactStore.readEncryptedFile(
          planPath,
          args.context.meetingKey,
          planHeader,
        );
        plan = JSON.parse(opened.plaintext.toString('utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (plan) {
        if (
          plan.schemaVersion !== 1 ||
          plan.meetingId !== meetingId ||
          plan.generation !== args.manifest.generation ||
          plan.keyId !== args.context.keyId ||
          plan.column !== column ||
          plan.source !== source
        ) {
          throw new Error('historical_audio_plan_invalid');
        }
        const oldPath = resolveManagedPath(
          path.join(rootDir, plan.plaintextRelativePath),
        );
        const newPath = resolveManagedPath(
          path.join(rootDir, plan.encryptedRelativePath),
        );
        await assertManagedFile(newPath);
        const current = options.sqlite
          .prepare(`SELECT ${column} AS value FROM meetings WHERE id = ?`)
          .get(meetingId) as { value?: string | null } | undefined;
        if (current?.value === oldPath) {
          await assertManagedFile(oldPath);
          await verifyEncryptedBundleMatchesCanonicalPlaintextWav({
            plaintextPath: oldPath,
            encryptedPath: newPath,
            source,
            context: args.context,
            signal: options.signal,
          });
          options.sqlite
            .prepare(
              `UPDATE meetings SET ${column} = ? WHERE id = ? AND ${column} = ?`,
            )
            .run(newPath, meetingId, oldPath);
        } else if (current?.value === newPath) {
          await verifyEncryptedAudioBundle({
            encryptedPath: newPath,
            source,
            context: args.context,
            signal: options.signal,
          });
        } else {
          throw new Error('historical_audio_source_changed');
        }
        await fs.promises.rm(oldPath, { force: true });
        await fs.promises.rm(planPath, { force: true });
        continue;
      }

      const rawPath = args.meeting[column];
      if (!rawPath || rawPath.endsWith('.enc')) continue;
      const { path: oldPath, stat: oldStat } = await assertManagedFile(rawPath);
      const bundleRoot = path.join(meetingRoot, `.historical-${source}-bundle`);
      // A missing plan means no prior bundle was committed to the database.
      // Remove only this deterministic ciphertext staging directory so a
      // process exit before plan durability cannot leak orphaned bundles.
      await fs.promises.rm(bundleRoot, { recursive: true, force: true });
      await fs.promises.mkdir(bundleRoot, { recursive: true });
      const newPath = await migrateCanonicalPlaintextWavToEncryptedBundle({
        filePath: oldPath,
        rootDir: bundleRoot,
        source,
        context: args.context,
        signal: options.signal,
      });
      const migrationPlan: MaterializedMigrationPlan = {
        schemaVersion: 1,
        meetingId,
        generation: args.manifest.generation,
        keyId: args.context.keyId,
        column,
        source,
        plaintextRelativePath: relativeManagedPath(oldPath),
        encryptedRelativePath: relativeManagedPath(newPath),
      };
      try {
        await EncryptedArtifactStore.writeEncryptedFile(
          planPath,
          Buffer.from(JSON.stringify(migrationPlan), 'utf8'),
          args.context.meetingKey,
          planHeader,
          { directoryReady: true },
        );
        const update = options.sqlite
          .prepare(
            `UPDATE meetings SET ${column} = ? WHERE id = ? AND ${column} = ?`,
          )
          .run(newPath, meetingId, oldPath);
        if (update.changes !== 1) {
          throw new Error('historical_audio_source_changed');
        }
        await fs.promises.rm(oldPath, { force: true });
        await fs.promises.rm(planPath, { force: true });
        migratedBytes += oldStat.size;
      } catch (error) {
        // Once the plan exists it is the durable source for resumption. Before
        // that point, remove only the unreferenced ciphertext bundle.
        if (!fs.existsSync(planPath)) {
          for (const bundlePath of await listEncryptedAudioBundleFiles({
            filePath: newPath,
            context: args.context,
            source,
          }).catch(() => [newPath])) {
            await fs.promises.rm(bundlePath, { force: true }).catch(() => {});
          }
        }
        throw error;
      }
    }
    return migratedBytes;
  };

  let operation: Promise<unknown> = Promise.resolve();
  const sweepOne = () => {
    const result = operation.then(async () => {
      const candidates = options
        .listMeetings()
        .filter(isEligible)
        .sort((left, right) => {
          const timestamp = (meeting: HistoricalMeeting) =>
            Date.parse(meeting.started_at || meeting.created_at || '') || 0;
          return timestamp(right) - timestamp(left);
        });
      for (const meeting of candidates) {
        const meetingId = String(meeting.id);
        const existing = options.sqlite
          .prepare(
            `SELECT status, updated_at AS updatedAt
             FROM meeting_audio_migrations WHERE meeting_id = ?`,
          )
          .get(meetingId) as
          | { status?: string; updatedAt?: string }
          | undefined;
        if (existing?.status === 'complete') continue;
        if (
          existing?.status === 'failed' &&
          Date.now() - Date.parse(existing.updatedAt || '') <
            FAILURE_RETRY_DELAY_MS
        ) {
          continue;
        }
        const release = options.acquireMigrationLease?.(meetingId);
        if (options.acquireMigrationLease && !release) {
          writeStatus(meetingId, 'blocked', 0, 'audio_consumer_active');
          continue;
        }
        let migratedBytes = 0;
        try {
          writeStatus(meetingId, 'migrating', 0, null);
          const key =
            options.audioKeyStore.getOrCreateMeetingAudioKey(meetingId);
          const manifest = await readCaptureJournalManifest(
            rootDir,
            meetingId,
            {
              meetingKey: key.meetingKey,
            },
          );
          if (manifest.schemaVersion === 4) {
            await migrateSealedCaptureJournalToV4(rootDir, {
              meetingId,
              keyId: key.keyId,
              meetingKey: key.meetingKey,
            });
          } else if (
            manifest.schemaVersion === 3 &&
            manifest.lifecycleState === 'sealed'
          ) {
            migratedBytes = await migrateMaterialized({
              meeting,
              manifest,
              context: {
                meetingId,
                generation: manifest.generation,
                keyId: key.keyId,
                meetingKey: key.meetingKey,
              },
            });
            await migrateSealedCaptureJournalToV4(rootDir, {
              meetingId,
              keyId: key.keyId,
              meetingKey: key.meetingKey,
            });
          } else {
            throw new Error('historical_audio_journal_ineligible');
          }
          writeStatus(meetingId, 'complete', migratedBytes, null);
          return { status: 'migrated' as const, meetingId, migratedBytes };
        } catch (error) {
          const code = failureCode(error);
          writeStatus(meetingId, 'failed', migratedBytes, code);
          return { status: 'failed' as const, meetingId, reason: code };
        } finally {
          release?.();
        }
      }
      return { status: 'idle' as const };
    });
    operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return { sweepOne };
};
