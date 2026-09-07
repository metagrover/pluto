import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { AudioKeyStore } from './crypto/audioKeyStore';

export type AudioRetentionPolicy =
  | 'after_finalization'
  | '7_days'
  | '30_days'
  | 'keep_indefinitely';

export const DEFAULT_AUDIO_RETENTION_POLICY: AudioRetentionPolicy = '7_days';

export interface AudioRetentionSweepResult {
  totalEligible: number;
  deletedCount: number;
  failedCount: number;
  failures: Array<{ meetingId: string; error: string }>;
}

export function ensureAudioRetentionColumns(sqlite: Database.Database): void {
  try {
    sqlite.exec(
      "ALTER TABLE meetings ADD COLUMN audio_retention_status TEXT DEFAULT 'retained';",
    );
  } catch {}
  try {
    sqlite.exec('ALTER TABLE meetings ADD COLUMN audio_deleted_at DATETIME;');
  } catch {}
  try {
    sqlite.exec('ALTER TABLE meetings ADD COLUMN audio_retention_error TEXT;');
  } catch {}
}

export function getAudioRetentionPolicy(
  sqlite: Database.Database,
): AudioRetentionPolicy {
  try {
    const row = sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('audio_retention_policy') as { value?: string } | undefined;

    const val = row?.value;
    if (
      val === 'after_finalization' ||
      val === '7_days' ||
      val === '30_days' ||
      val === 'keep_indefinitely'
    ) {
      return val;
    }
  } catch {}
  return DEFAULT_AUDIO_RETENTION_POLICY;
}

export function setAudioRetentionPolicy(
  sqlite: Database.Database,
  policy: AudioRetentionPolicy,
): void {
  sqlite
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('audio_retention_policy', policy);
}

export interface MeetingRetentionCandidate {
  id: string;
  finalization_status?: string | null;
  transcript_status?: string | null;
  finalization_error_category?: string | null;
  ended_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  downstream_processing_json?: string | null;
  audio_retention_status?: string | null;
  audio_path?: string | null;
  mixed_audio_path?: string | null;
  system_audio_path?: string | null;
}

export function isMeetingEligibleForRetention(
  meeting: MeetingRetentionCandidate,
  policy: AudioRetentionPolicy,
  nowMs: number = Date.now(),
): boolean {
  if (policy === 'keep_indefinitely') {
    return false;
  }

  // Audio already deleted
  if (meeting.audio_retention_status === 'deleted') {
    return false;
  }

  // Must be finalized
  if (meeting.finalization_status !== 'finalized') {
    return false;
  }

  // Never delete provisional transcripts
  if (meeting.transcript_status === 'provisional') {
    return false;
  }

  // Never delete if recovery is required
  if (meeting.finalization_error_category === 'recovery_required') {
    return false;
  }

  // Must have ended
  if (!meeting.ended_at && !meeting.started_at) {
    return false;
  }

  // Exclude active downstream processing
  if (meeting.downstream_processing_json) {
    try {
      const parsed = JSON.parse(meeting.downstream_processing_json);
      if (parsed?.state === 'processing') {
        return false;
      }
    } catch {}
  }

  if (policy === 'after_finalization') {
    return true;
  }

  const timestampStr =
    meeting.ended_at || meeting.started_at || meeting.created_at;
  if (!timestampStr) return false;

  const meetingTimeMs = new Date(timestampStr).getTime();
  if (Number.isNaN(meetingTimeMs)) return false;

  const ageMs = nowMs - meetingTimeMs;

  if (policy === '7_days') {
    return ageMs >= 7 * 24 * 60 * 60 * 1000;
  }

  if (policy === '30_days') {
    return ageMs >= 30 * 24 * 60 * 60 * 1000;
  }

  return false;
}

export interface DeleteMeetingAudioOptions {
  sqlite: Database.Database;
  audioKeyStore?: Pick<AudioKeyStore, 'deleteMeetingAudioKey'> | null;
  artifactsRootDir: string;
  isMeetingActive?: (meetingId: string) => boolean;
}

export async function deleteMeetingAudio(
  meetingId: string,
  options: DeleteMeetingAudioOptions,
): Promise<{ success: boolean; error?: string }> {
  const { sqlite, audioKeyStore, artifactsRootDir, isMeetingActive } = options;

  if (isMeetingActive?.(meetingId)) {
    return { success: false, error: 'meeting_is_active' };
  }

  ensureAudioRetentionColumns(sqlite);

  const meetingDir = path.join(artifactsRootDir, meetingId);
  const audioFilesToDelete: string[] = [];

  if (fs.existsSync(meetingDir)) {
    const journalDir = path.join(meetingDir, 'capture-journal');
    const chunksDir = path.join(journalDir, 'chunks');
    const repairDir = path.join(journalDir, 'repair');

    // Collect all chunk audio files
    if (fs.existsSync(chunksDir)) {
      try {
        const chunkFiles = fs.readdirSync(chunksDir);
        for (const f of chunkFiles) {
          audioFilesToDelete.push(path.join(chunksDir, f));
        }
      } catch {}
    }

    // Collect all repair audio files
    if (fs.existsSync(repairDir)) {
      try {
        const repairFiles = fs.readdirSync(repairDir);
        for (const f of repairFiles) {
          audioFilesToDelete.push(path.join(repairDir, f));
        }
      } catch {}
    }

    // Collect legacy meeting root audio files
    try {
      const rootFiles = fs.readdirSync(meetingDir);
      for (const f of rootFiles) {
        if (
          f.endsWith('.wav') ||
          (f.endsWith('.enc') && f !== 'manifest.enc')
        ) {
          audioFilesToDelete.push(path.join(meetingDir, f));
        }
      }
    } catch {}
  }

  // Attempt to delete all audio files
  const failedDeletions: string[] = [];
  for (const filePath of audioFilesToDelete) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      failedDeletions.push(filePath);
    }
  }

  // If any audio file failed to delete, retain the key and retry later without marking deleted
  if (failedDeletions.length > 0) {
    const errorMsg = `Failed to delete ${failedDeletions.length} audio file(s)`;
    try {
      sqlite
        .prepare('UPDATE meetings SET audio_retention_error = ? WHERE id = ?')
        .run(errorMsg, meetingId);
    } catch {}
    return { success: false, error: errorMsg };
  }

  // Delete wrapped audio key from key store
  if (audioKeyStore) {
    try {
      audioKeyStore.deleteMeetingAudioKey(meetingId);
    } catch (keyErr) {
      const errorMsg = `Failed to delete audio key: ${keyErr instanceof Error ? keyErr.message : String(keyErr)}`;
      try {
        sqlite
          .prepare('UPDATE meetings SET audio_retention_error = ? WHERE id = ?')
          .run(errorMsg, meetingId);
      } catch {}
      return { success: false, error: errorMsg };
    }
  }

  // Update meeting record
  try {
    sqlite
      .prepare(
        `UPDATE meetings SET
          audio_retention_status = 'deleted',
          audio_deleted_at = CURRENT_TIMESTAMP,
          audio_retention_error = NULL,
          audio_path = NULL,
          mixed_audio_path = NULL,
          system_audio_path = NULL
        WHERE id = ?`,
      )
      .run(meetingId);
  } catch (dbErr) {
    return {
      success: false,
      error: `DB update failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
    };
  }

  return { success: true };
}

export async function runAudioRetentionSweep(
  options: DeleteMeetingAudioOptions & { nowMs?: number },
): Promise<AudioRetentionSweepResult> {
  const { sqlite, nowMs = Date.now() } = options;
  ensureAudioRetentionColumns(sqlite);
  const policy = getAudioRetentionPolicy(sqlite);

  const result: AudioRetentionSweepResult = {
    totalEligible: 0,
    deletedCount: 0,
    failedCount: 0,
    failures: [],
  };

  if (policy === 'keep_indefinitely') {
    return result;
  }

  const rows = sqlite
    .prepare(
      `SELECT
        id,
        finalization_status,
        transcript_status,
        finalization_error_category,
        ended_at,
        started_at,
        created_at,
        downstream_processing_json,
        audio_retention_status,
        audio_path,
        mixed_audio_path,
        system_audio_path
      FROM meetings
      WHERE audio_retention_status IS NULL OR audio_retention_status != 'deleted'`,
    )
    .all() as MeetingRetentionCandidate[];

  const eligibleMeetings = rows.filter((m) =>
    isMeetingEligibleForRetention(m, policy, nowMs),
  );
  result.totalEligible = eligibleMeetings.length;

  for (const meeting of eligibleMeetings) {
    const deleteResult = await deleteMeetingAudio(meeting.id, options);
    if (deleteResult.success) {
      result.deletedCount += 1;
    } else {
      result.failedCount += 1;
      result.failures.push({
        meetingId: meeting.id,
        error: deleteResult.error || 'unknown_error',
      });
    }
  }

  return result;
}
