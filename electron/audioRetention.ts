import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { MeetingFinalizationStatus } from '../src/types';
import type { TranscriptLifecycleStatus } from '../src/utils/transcriptIntegrity';
import type { AudioKeyStore } from './crypto/audioKeyStore';
import {
  type EncryptedAudioContext,
  listEncryptedAudioBundleFiles,
} from './crypto/encryptedAudioBundle';

const GIB = 1024 ** 3;
export const AUDIO_STORAGE_BUDGET_SETTING = 'audio_storage_budget_gb';
export const DEFAULT_AUDIO_STORAGE_BUDGET_GB = 10;
export const AUDIO_STORAGE_BUDGET_OPTIONS = [2, 10, 20] as const;
export type AudioStorageBudgetGb =
  | (typeof AUDIO_STORAGE_BUDGET_OPTIONS)[number]
  | null;

export type AudioRetentionMeeting = {
  id: string | number;
  started_at?: string | null;
  created_at?: string | null;
  audio_path?: string | null;
  system_audio_path?: string | null;
  mixed_audio_path?: string | null;
  transcript_status?: TranscriptLifecycleStatus | null;
  finalization_status?: MeetingFinalizationStatus | null;
  downstream_processing_json?: string | null;
  capture_journal_generation?: string | null;
};

export type AudioRetentionSnapshot = {
  budgetGb: AudioStorageBudgetGb;
  budgetBytes: number | null;
  retainedBytes: number;
  deletedBytes: number;
  deletedMeetings: number;
  blockedMeetings: number;
  measurementComplete: boolean;
  overBudget: boolean;
};

type ArtifactSet = {
  paths: string[];
  bytes: number;
};

export const parseAudioStorageBudgetGb = (
  value: unknown,
): AudioStorageBudgetGb => {
  if (value === 'unlimited') return null;
  const parsed = Number(value);
  return AUDIO_STORAGE_BUDGET_OPTIONS.includes(parsed as 2 | 10 | 20)
    ? (parsed as 2 | 10 | 20)
    : DEFAULT_AUDIO_STORAGE_BUDGET_GB;
};

const isProcessing = (value: string | null | undefined): boolean => {
  try {
    return JSON.parse(value || '{}')?.state === 'processing';
  } catch {
    return true;
  }
};

export const audioRetentionBlockReason = (
  meeting: AudioRetentionMeeting,
  isMeetingActive = false,
  hasActiveAnalysis = false,
  hasHistoricalMigration = false,
): string | null => {
  if (isMeetingActive) return 'active_recording';
  if (hasHistoricalMigration) return 'historical_migration';
  if (meeting.finalization_status !== 'finalized')
    return 'finalization_incomplete';
  if (meeting.transcript_status !== 'validated')
    return 'transcript_not_validated';
  if (isProcessing(meeting.downstream_processing_json) || hasActiveAnalysis) {
    return 'downstream_processing';
  }
  return null;
};

const retentionFailureCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  return [
    'audio_key_unavailable',
    'artifact_path_invalid',
    'artifact_delete_incomplete',
  ].includes(code)
    ? code
    : 'audio_retention_failed';
};

const insideRoot = (rootDir: string, candidate: string): boolean => {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(candidate);
  return resolved !== root && resolved.startsWith(`${root}${path.sep}`);
};

const sourceForColumn = (column: string) =>
  column === 'audio_path'
    ? 'mic'
    : column === 'system_audio_path'
      ? 'system'
      : 'mixed';

export const createAudioRetentionManager = (options: {
  rootDir: string;
  sqlite: Database.Database;
  listMeetings: () => AudioRetentionMeeting[];
  getSetting: (key: string) => string | null;
  audioKeyStore: Pick<
    AudioKeyStore,
    'getMeetingAudioKey' | 'deleteMeetingAudioKey'
  > | null;
  isMeetingActive?: (meetingId: string) => boolean;
  isHistoricalMigrationBlocked?: (meetingId: string) => boolean;
  acquireDeletionLease?: (meetingId: string) => (() => void) | null;
}) => {
  const rootDir = path.resolve(options.rootDir);
  const writeStatus = (
    meetingId: string,
    status: 'retained' | 'blocked' | 'deleting' | 'deleted' | 'failed',
    retainedBytes: number,
    lastFailureCode: string | null,
  ) => {
    options.sqlite
      .prepare(
        `INSERT INTO meeting_audio_retention (
          meeting_id, status, retained_bytes, last_failure_code, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id) DO UPDATE SET
          status = excluded.status,
          retained_bytes = excluded.retained_bytes,
          last_failure_code = excluded.last_failure_code,
          updated_at = excluded.updated_at`,
      )
      .run(
        meetingId,
        status,
        retainedBytes,
        lastFailureCode,
        new Date().toISOString(),
      );
  };

  const resolveArtifacts = async (
    meeting: AudioRetentionMeeting,
  ): Promise<ArtifactSet> => {
    const meetingId = String(meeting.id);
    const paths = new Set<string>();
    const captureRoot = path.join(rootDir, meetingId);
    const captureAudioRoots = ['chunks', 'repair']
      .map((directory) => path.join(captureRoot, directory))
      .filter(
        (candidate) =>
          insideRoot(rootDir, candidate) && fs.existsSync(candidate),
      );
    for (const captureAudioRoot of captureAudioRoots) {
      paths.add(captureAudioRoot);
    }
    const generation = meeting.capture_journal_generation?.trim();
    const keyResult =
      options.audioKeyStore?.getMeetingAudioKey(meetingId) ?? null;
    for (const [column, rawPath] of [
      ['audio_path', meeting.audio_path],
      ['system_audio_path', meeting.system_audio_path],
      ['mixed_audio_path', meeting.mixed_audio_path],
    ] as const) {
      if (!rawPath) continue;
      if (!insideRoot(rootDir, rawPath)) {
        throw new Error('artifact_path_invalid');
      }
      if (!fs.existsSync(rawPath)) continue;
      if (
        captureAudioRoots.some((captureAudioRoot) =>
          path.resolve(rawPath).startsWith(`${captureAudioRoot}${path.sep}`),
        )
      ) {
        continue;
      }
      if (rawPath.endsWith('.enc')) {
        if (!keyResult || !generation) throw new Error('audio_key_unavailable');
        const context: EncryptedAudioContext = {
          meetingId,
          generation,
          keyId: keyResult.keyId,
          meetingKey: keyResult.meetingKey,
        };
        for (const bundlePath of await listEncryptedAudioBundleFiles({
          filePath: rawPath,
          context,
          source: sourceForColumn(column),
        })) {
          if (!insideRoot(rootDir, bundlePath))
            throw new Error('artifact_path_invalid');
          paths.add(bundlePath);
        }
      } else {
        paths.add(rawPath);
      }
    }
    let bytes = 0;
    for (const artifactPath of paths) {
      const stat = await fs.promises.lstat(artifactPath);
      if (stat.isSymbolicLink()) throw new Error('artifact_path_invalid');
      if (stat.isDirectory()) {
        const stack = [artifactPath];
        while (stack.length > 0) {
          const directory = stack.pop()!;
          for (const entry of await fs.promises.readdir(directory, {
            withFileTypes: true,
          })) {
            const child = path.join(directory, entry.name);
            if (entry.isSymbolicLink())
              throw new Error('artifact_path_invalid');
            if (entry.isDirectory()) stack.push(child);
            else if (entry.isFile())
              bytes += (await fs.promises.stat(child)).size;
          }
        }
      } else if (stat.isFile()) {
        bytes += stat.size;
      }
    }
    return { paths: [...paths], bytes };
  };

  const runDeleteMeetingAudio = async (meeting: AudioRetentionMeeting) => {
    const meetingId = String(meeting.id);
    const hasActiveAnalysis = Boolean(
      options.sqlite
        .prepare(
          `SELECT 1 FROM meeting_analysis_runs
           WHERE meeting_id = ?
             AND (notes_status = 'running' OR secondary_status = 'running')
           LIMIT 1`,
        )
        .get(meetingId),
    );
    const reason = audioRetentionBlockReason(
      meeting,
      options.isMeetingActive?.(meetingId) ?? false,
      hasActiveAnalysis,
      options.isHistoricalMigrationBlocked?.(meetingId) ?? false,
    );
    if (reason) {
      writeStatus(meetingId, 'blocked', 0, reason);
      return { status: 'blocked' as const, reason, deletedBytes: 0 };
    }
    const releaseDeletion = options.acquireDeletionLease?.(meetingId);
    if (options.acquireDeletionLease && !releaseDeletion) {
      writeStatus(meetingId, 'blocked', 0, 'active_recording');
      return {
        status: 'blocked' as const,
        reason: 'active_recording',
        deletedBytes: 0,
      };
    }
    let artifacts: ArtifactSet = { paths: [], bytes: 0 };
    try {
      artifacts = await resolveArtifacts(meeting);
      writeStatus(meetingId, 'deleting', artifacts.bytes, null);
      for (const artifactPath of artifacts.paths) {
        await fs.promises.rm(artifactPath, { recursive: true, force: true });
      }
      if (artifacts.paths.some((artifactPath) => fs.existsSync(artifactPath))) {
        throw new Error('artifact_delete_incomplete');
      }
      options.sqlite.transaction(() => {
        options.sqlite
          .prepare(
            'UPDATE meetings SET audio_path = NULL, system_audio_path = NULL, mixed_audio_path = NULL WHERE id = ?',
          )
          .run(meetingId);
        options.audioKeyStore?.deleteMeetingAudioKey(meetingId);
        writeStatus(meetingId, 'deleted', 0, null);
      })();
      return { status: 'deleted' as const, deletedBytes: artifacts.bytes };
    } catch (error) {
      const code = retentionFailureCode(error);
      writeStatus(meetingId, 'failed', artifacts.bytes, code);
      return { status: 'failed' as const, reason: code, deletedBytes: 0 };
    } finally {
      releaseDeletion?.();
    }
  };

  const runSweep = async (
    enforceBudget: boolean,
  ): Promise<AudioRetentionSnapshot> => {
    const budgetGb = parseAudioStorageBudgetGb(
      options.getSetting(AUDIO_STORAGE_BUDGET_SETTING),
    );
    const budgetBytes = budgetGb === null ? null : budgetGb * GIB;
    const candidates: AudioRetentionMeeting[] = [];
    let retainedBytes = 0;
    let blockedMeetings = 0;
    let measurementComplete = true;
    for (const meeting of options.listMeetings()) {
      try {
        const artifacts = await resolveArtifacts(meeting);
        retainedBytes += artifacts.bytes;
        if (artifacts.bytes === 0) continue;
        const reason = audioRetentionBlockReason(
          meeting,
          options.isMeetingActive?.(String(meeting.id)) ?? false,
          Boolean(
            options.sqlite
              .prepare(
                `SELECT 1 FROM meeting_analysis_runs
                 WHERE meeting_id = ?
                   AND (notes_status = 'running' OR secondary_status = 'running')
                 LIMIT 1`,
              )
              .get(String(meeting.id)),
          ),
          options.isHistoricalMigrationBlocked?.(String(meeting.id)) ?? false,
        );
        if (reason) {
          blockedMeetings += 1;
          writeStatus(String(meeting.id), 'blocked', artifacts.bytes, reason);
        } else {
          writeStatus(String(meeting.id), 'retained', artifacts.bytes, null);
          candidates.push(meeting);
        }
      } catch (error) {
        blockedMeetings += 1;
        measurementComplete = false;
        writeStatus(
          String(meeting.id),
          'failed',
          0,
          retentionFailureCode(error),
        );
      }
    }
    let deletedBytes = 0;
    let deletedMeetings = 0;
    if (enforceBudget && budgetBytes !== null && retainedBytes > budgetBytes) {
      candidates.sort((left, right) => {
        const timestamp = (meeting: AudioRetentionMeeting) =>
          Date.parse(meeting.started_at || meeting.created_at || '') || 0;
        return timestamp(left) - timestamp(right);
      });
      for (const candidate of candidates) {
        if (retainedBytes - deletedBytes <= budgetBytes) break;
        const result = await runDeleteMeetingAudio(candidate);
        if (result.status === 'deleted') {
          deletedBytes += result.deletedBytes;
          deletedMeetings += 1;
        }
      }
    }
    return {
      budgetGb,
      budgetBytes,
      retainedBytes: Math.max(0, retainedBytes - deletedBytes),
      deletedBytes,
      deletedMeetings,
      blockedMeetings,
      measurementComplete,
      overBudget:
        budgetBytes !== null &&
        (!measurementComplete || retainedBytes - deletedBytes > budgetBytes),
    };
  };

  let operationTail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  let pendingSweep: Promise<AudioRetentionSnapshot> | null = null;
  const sweep = (): Promise<AudioRetentionSnapshot> => {
    if (!pendingSweep) {
      pendingSweep = enqueue(() => runSweep(true)).finally(() => {
        pendingSweep = null;
      });
    }
    return pendingSweep;
  };

  const deleteMeetingAudio = (meeting: AudioRetentionMeeting) =>
    enqueue(() => runDeleteMeetingAudio(meeting));

  const inspect = () => enqueue(() => runSweep(false));

  return { inspect, sweep, deleteMeetingAudio };
};
