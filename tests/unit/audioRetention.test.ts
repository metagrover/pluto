import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteMeetingAudio,
  ensureAudioRetentionColumns,
  getAudioRetentionPolicy,
  isMeetingEligibleForRetention,
  runAudioRetentionSweep,
  setAudioRetentionPolicy,
} from '../../electron/audioRetention';
import { AudioKeyStore } from '../../electron/crypto/audioKeyStore';

describe('AudioRetention', () => {
  let tempDir: string;
  let sqlite: Database.Database;
  let audioKeyStore: AudioKeyStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-retention-test-'));
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        finalization_status TEXT DEFAULT 'finalized',
        transcript_status TEXT DEFAULT 'final',
        finalization_error_category TEXT,
        ended_at DATETIME,
        started_at DATETIME,
        created_at DATETIME,
        downstream_processing_json TEXT,
        audio_retention_status TEXT DEFAULT 'retained',
        audio_deleted_at DATETIME,
        audio_retention_error TEXT,
        audio_path TEXT,
        mixed_audio_path TEXT,
        system_audio_path TEXT
      );
    `);
    audioKeyStore = new AudioKeyStore({
      sqlite,
      audioWrappingKey: randomBytes(32),
    });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('gets default policy and persists updated policy', () => {
    expect(getAudioRetentionPolicy(sqlite)).toBe('7_days');

    setAudioRetentionPolicy(sqlite, 'after_finalization');
    expect(getAudioRetentionPolicy(sqlite)).toBe('after_finalization');

    setAudioRetentionPolicy(sqlite, '30_days');
    expect(getAudioRetentionPolicy(sqlite)).toBe('30_days');

    setAudioRetentionPolicy(sqlite, 'keep_indefinitely');
    expect(getAudioRetentionPolicy(sqlite)).toBe('keep_indefinitely');
  });

  describe('isMeetingEligibleForRetention', () => {
    const baseMeeting = {
      id: 'm1',
      finalization_status: 'finalized',
      transcript_status: 'final',
      ended_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    };

    it('returns false for keep_indefinitely', () => {
      expect(
        isMeetingEligibleForRetention(baseMeeting, 'keep_indefinitely'),
      ).toBe(false);
    });

    it('returns false if already deleted', () => {
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, audio_retention_status: 'deleted' },
          '7_days',
        ),
      ).toBe(false);
    });

    it('returns false if not finalized', () => {
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, finalization_status: 'processing' },
          'after_finalization',
        ),
      ).toBe(false);
    });

    it('returns false if transcript is provisional', () => {
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, transcript_status: 'provisional' },
          'after_finalization',
        ),
      ).toBe(false);
    });

    it('returns false if recovery_required', () => {
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, finalization_error_category: 'recovery_required' },
          'after_finalization',
        ),
      ).toBe(false);
    });

    it('returns false if downstream processing is active', () => {
      expect(
        isMeetingEligibleForRetention(
          {
            ...baseMeeting,
            downstream_processing_json: JSON.stringify({ state: 'processing' }),
          },
          'after_finalization',
        ),
      ).toBe(false);
    });

    it('returns true for after_finalization when finalized', () => {
      expect(
        isMeetingEligibleForRetention(baseMeeting, 'after_finalization'),
      ).toBe(true);
    });

    it('evaluates 7_days and 30_days thresholds correctly', () => {
      const now = Date.now();
      const sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
      const eightDaysAgo = new Date(
        now - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const thirtyOneDaysAgo = new Date(
        now - 31 * 24 * 60 * 60 * 1000,
      ).toISOString();

      // 6 days ago: not eligible for 7_days or 30_days
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: sixDaysAgo },
          '7_days',
          now,
        ),
      ).toBe(false);
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: sixDaysAgo },
          '30_days',
          now,
        ),
      ).toBe(false);

      // 8 days ago: eligible for 7_days, not 30_days
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: eightDaysAgo },
          '7_days',
          now,
        ),
      ).toBe(true);
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: eightDaysAgo },
          '30_days',
          now,
        ),
      ).toBe(false);

      // 31 days ago: eligible for both
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: thirtyOneDaysAgo },
          '7_days',
          now,
        ),
      ).toBe(true);
      expect(
        isMeetingEligibleForRetention(
          { ...baseMeeting, ended_at: thirtyOneDaysAgo },
          '30_days',
          now,
        ),
      ).toBe(true);
    });
  });

  describe('deleteMeetingAudio', () => {
    it('deletes audio files, deletes meeting key, and updates database', async () => {
      const meetingId = 'meet-delete-1';
      const meetingDir = path.join(tempDir, meetingId);
      const chunksDir = path.join(meetingDir, 'capture-journal', 'chunks');
      fs.mkdirSync(chunksDir, { recursive: true });

      const chunkFile = path.join(chunksDir, 'chunk-1.enc');
      fs.writeFileSync(chunkFile, 'encrypted bytes');

      // Create audio key
      audioKeyStore.getOrCreateMeetingAudioKey(meetingId);
      expect(audioKeyStore.getMeetingAudioKey(meetingId)).not.toBeNull();

      // Insert meeting row
      sqlite
        .prepare(
          `INSERT INTO meetings (id, audio_path, audio_retention_status)
           VALUES (?, ?, 'retained')`,
        )
        .run(meetingId, chunkFile);

      const res = await deleteMeetingAudio(meetingId, {
        sqlite,
        audioKeyStore,
        artifactsRootDir: tempDir,
      });

      expect(res.success).toBe(true);
      expect(fs.existsSync(chunkFile)).toBe(false);
      expect(audioKeyStore.getMeetingAudioKey(meetingId)).toBeNull();

      const row = sqlite
        .prepare(
          'SELECT audio_retention_status, audio_deleted_at, audio_path FROM meetings WHERE id = ?',
        )
        .get(meetingId) as any;
      expect(row.audio_retention_status).toBe('deleted');
      expect(row.audio_deleted_at).not.toBeNull();
      expect(row.audio_path).toBeNull();
    });

    it('rejects deletion if meeting is active', async () => {
      const res = await deleteMeetingAudio('active-meet', {
        sqlite,
        audioKeyStore,
        artifactsRootDir: tempDir,
        isMeetingActive: (id) => id === 'active-meet',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('meeting_is_active');
    });
  });

  describe('runAudioRetentionSweep', () => {
    it('sweeps and deletes audio for eligible meetings according to policy', async () => {
      setAudioRetentionPolicy(sqlite, '7_days');

      const now = Date.now();
      const oldMeetingId = 'old-meeting';
      const newMeetingId = 'new-meeting';

      // Old meeting (10 days old)
      const oldDir = path.join(
        tempDir,
        oldMeetingId,
        'capture-journal',
        'chunks',
      );
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'c.enc'), 'old bytes');
      audioKeyStore.getOrCreateMeetingAudioKey(oldMeetingId);

      sqlite
        .prepare(
          `INSERT INTO meetings (id, finalization_status, transcript_status, ended_at, audio_retention_status)
           VALUES (?, 'finalized', 'final', ?, 'retained')`,
        )
        .run(
          oldMeetingId,
          new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        );

      // New meeting (1 day old)
      const newDir = path.join(
        tempDir,
        newMeetingId,
        'capture-journal',
        'chunks',
      );
      fs.mkdirSync(newDir, { recursive: true });
      fs.writeFileSync(path.join(newDir, 'c.enc'), 'new bytes');
      audioKeyStore.getOrCreateMeetingAudioKey(newMeetingId);

      sqlite
        .prepare(
          `INSERT INTO meetings (id, finalization_status, transcript_status, ended_at, audio_retention_status)
           VALUES (?, 'finalized', 'final', ?, 'retained')`,
        )
        .run(
          newMeetingId,
          new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
        );

      const sweep = await runAudioRetentionSweep({
        sqlite,
        audioKeyStore,
        artifactsRootDir: tempDir,
        nowMs: now,
      });

      expect(sweep.totalEligible).toBe(1);
      expect(sweep.deletedCount).toBe(1);
      expect(sweep.failedCount).toBe(0);

      // Old meeting audio deleted
      expect(audioKeyStore.getMeetingAudioKey(oldMeetingId)).toBeNull();
      // New meeting audio retained
      expect(audioKeyStore.getMeetingAudioKey(newMeetingId)).not.toBeNull();
    });
  });
});
