import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AudioRetentionMeeting,
  DEFAULT_AUDIO_STORAGE_BUDGET_GB,
  audioRetentionBlockReason,
  createAudioRetentionManager,
  parseAudioStorageBudgetGb,
} from '../../electron/audioRetention';
import { writeEncryptedAudioBundle } from '../../electron/crypto/encryptedAudioBundle';

const makeDatabase = () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      audio_path TEXT,
      system_audio_path TEXT,
      mixed_audio_path TEXT
    );
    CREATE TABLE meeting_analysis_runs (
      meeting_id TEXT PRIMARY KEY,
      notes_status TEXT NOT NULL,
      secondary_status TEXT NOT NULL
    );
    CREATE TABLE meeting_audio_retention (
      meeting_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      retained_bytes INTEGER NOT NULL DEFAULT 0,
      last_failure_code TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  return sqlite;
};

const eligibleMeeting = (
  id: string,
  audioPath?: string,
  startedAt = '2026-01-01T00:00:00.000Z',
): AudioRetentionMeeting => ({
  id,
  started_at: startedAt,
  created_at: startedAt,
  audio_path: audioPath,
  transcript_status: 'validated',
  finalization_status: 'finalized',
  downstream_processing_json: null,
});

describe('audio retention', () => {
  const roots: string[] = [];
  const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-retention-'));
    roots.push(root);
    return root;
  };

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts only the supported user budgets and keeps 10 GB as the default', () => {
    expect(parseAudioStorageBudgetGb('2')).toBe(2);
    expect(parseAudioStorageBudgetGb('10')).toBe(10);
    expect(parseAudioStorageBudgetGb('20')).toBe(20);
    expect(parseAudioStorageBudgetGb('unlimited')).toBeNull();
    expect(parseAudioStorageBudgetGb('7')).toBe(
      DEFAULT_AUDIO_STORAGE_BUDGET_GB,
    );
  });

  it('blocks deletion until finalization, transcript, and background work are safe', () => {
    expect(
      audioRetentionBlockReason(
        { ...eligibleMeeting('active'), finalization_status: 'processing' },
        true,
      ),
    ).toBe('active_recording');
    expect(
      audioRetentionBlockReason({
        ...eligibleMeeting('finalizing'),
        finalization_status: 'needs_attention',
      }),
    ).toBe('finalization_incomplete');
    expect(
      audioRetentionBlockReason({
        ...eligibleMeeting('provisional'),
        transcript_status: 'provisional',
      }),
    ).toBe('transcript_not_validated');
    expect(
      audioRetentionBlockReason(eligibleMeeting('analysis'), false, true),
    ).toBe('downstream_processing');
  });

  it('deletes the oldest eligible audio until usage is within the selected budget', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const deleteMeetingAudioKey = vi.fn(() => true);
    const getMeetingAudioKey = vi.fn(() => null);
    const oldPath = path.join(root, 'old.wav');
    const newPath = path.join(root, 'new.wav');
    fs.closeSync(fs.openSync(oldPath, 'w'));
    fs.closeSync(fs.openSync(newPath, 'w'));
    fs.truncateSync(oldPath, 1024 ** 3 + 1);
    fs.truncateSync(newPath, 1024 ** 3 + 1);
    const meetings = [
      eligibleMeeting('old', oldPath, '2026-01-01T00:00:00.000Z'),
      eligibleMeeting('new', newPath, '2026-02-01T00:00:00.000Z'),
    ];
    for (const meeting of meetings) {
      sqlite
        .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
        .run(String(meeting.id), meeting.audio_path);
    }

    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => meetings,
      getSetting: () => '2',
      audioKeyStore: { getMeetingAudioKey, deleteMeetingAudioKey },
    });
    const inspection = await manager.inspect();
    expect(inspection.overBudget).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(true);
    const result = await manager.sweep();

    expect(result.deletedMeetings).toBe(1);
    expect(result.overBudget).toBe(false);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);
    expect(deleteMeetingAudioKey).toHaveBeenCalledWith('old');
    expect(
      sqlite.prepare('SELECT audio_path FROM meetings WHERE id = ?').get('old'),
    ).toEqual({ audio_path: null });
    sqlite.close();
  });

  it('retains the key and records only a content-free code when deletion cannot start safely', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const meetingRoot = path.join(root, 'unsafe');
    const chunksRoot = path.join(meetingRoot, 'chunks');
    fs.mkdirSync(chunksRoot, { recursive: true });
    fs.symlinkSync(path.join(root, 'outside'), path.join(chunksRoot, 'link'));
    sqlite.prepare('INSERT INTO meetings (id) VALUES (?)').run('unsafe');
    const deleteMeetingAudioKey = vi.fn(() => true);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [eligibleMeeting('unsafe')],
      getSetting: () => '2',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => null),
        deleteMeetingAudioKey,
      },
    });

    const result = await manager.deleteMeetingAudio(eligibleMeeting('unsafe'));

    expect(result).toEqual({
      status: 'failed',
      reason: 'artifact_path_invalid',
      deletedBytes: 0,
    });
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
    expect(
      sqlite
        .prepare(
          'SELECT status, last_failure_code FROM meeting_audio_retention WHERE meeting_id = ?',
        )
        .get('unsafe'),
    ).toEqual({ status: 'failed', last_failure_code: 'artifact_path_invalid' });
    await expect(manager.inspect()).resolves.toMatchObject({
      measurementComplete: false,
      overBudget: true,
    });
    sqlite.close();
  });

  it('blocks a manual deletion while a meeting analysis run is active', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const audioPath = path.join(root, 'active.wav');
    fs.writeFileSync(audioPath, 'audio');
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('active', audioPath);
    sqlite
      .prepare(
        'INSERT INTO meeting_analysis_runs (meeting_id, notes_status, secondary_status) VALUES (?, ?, ?)',
      )
      .run('active', 'running', 'pending');
    const deleteMeetingAudioKey = vi.fn(() => true);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [eligibleMeeting('active', audioPath)],
      getSetting: () => '2',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => null),
        deleteMeetingAudioKey,
      },
    });

    await expect(
      manager.deleteMeetingAudio(eligibleMeeting('active', audioPath)),
    ).resolves.toEqual({
      status: 'blocked',
      reason: 'downstream_processing',
      deletedBytes: 0,
    });
    expect(fs.existsSync(audioPath)).toBe(true);
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('authenticates and removes every encrypted bundle segment before deleting its key', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const meetingKey = Buffer.alloc(32, 7);
    const context = {
      meetingId: 'encrypted',
      generation: 'generation-1',
      keyId: 'key-1',
      meetingKey,
    };
    const bundlePath = await writeEncryptedAudioBundle({
      rootDir: root,
      totalFrames: 16,
      source: 'mic',
      context,
      produceWindow: async (_start, frames) => new Float32Array(frames),
    });
    const filesBefore = fs.readdirSync(root);
    expect(filesBefore.length).toBe(2);
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('encrypted', bundlePath);
    const deleteMeetingAudioKey = vi.fn(() => true);
    const meeting = {
      ...eligibleMeeting('encrypted', bundlePath),
      capture_journal_generation: context.generation,
    };
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => ({
          meetingKey,
          keyId: context.keyId,
        })),
        deleteMeetingAudioKey,
      },
    });

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
    });
    expect(fs.readdirSync(root)).toEqual([]);
    expect(deleteMeetingAudioKey).toHaveBeenCalledWith('encrypted');
    sqlite.close();
  });

  it('removes capture audio without deleting transcript sidecars', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const meetingRoot = path.join(root, 'journaled');
    const chunksRoot = path.join(meetingRoot, 'chunks');
    const repairRoot = path.join(meetingRoot, 'repair');
    const transcriptRoot = path.join(meetingRoot, 'transcript-checkpoints');
    fs.mkdirSync(chunksRoot, { recursive: true });
    fs.mkdirSync(repairRoot, { recursive: true });
    fs.mkdirSync(transcriptRoot, { recursive: true });
    fs.writeFileSync(path.join(chunksRoot, 'mic.enc'), 'raw audio');
    fs.writeFileSync(path.join(repairRoot, 'mic.enc'), 'repair audio');
    const transcriptPath = path.join(transcriptRoot, 'mic.enc');
    fs.writeFileSync(transcriptPath, 'transcript evidence');
    sqlite.prepare('INSERT INTO meetings (id) VALUES (?)').run('journaled');
    const deleteMeetingAudioKey = vi.fn(() => true);
    const meeting = eligibleMeeting('journaled');
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => null),
        deleteMeetingAudioKey,
      },
    });

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
    });
    expect(fs.existsSync(chunksRoot)).toBe(false);
    expect(fs.existsSync(repairRoot)).toBe(false);
    expect(fs.readFileSync(transcriptPath, 'utf8')).toBe('transcript evidence');
    expect(deleteMeetingAudioKey).toHaveBeenCalledWith('journaled');
    sqlite.close();
  });

  it('deletes a large legacy encrypted recording without buffering it', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const audioPath = path.join(root, 'legacy.enc');
    fs.closeSync(fs.openSync(audioPath, 'w'));
    fs.truncateSync(audioPath, 2 * 1024 ** 2);
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('legacy', audioPath);
    const deleteMeetingAudioKey = vi.fn(() => true);
    const meeting = {
      ...eligibleMeeting('legacy', audioPath),
      capture_journal_generation: 'legacy-generation',
    };
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => ({
          meetingKey: Buffer.alloc(32, 9),
          keyId: 'legacy-key',
        })),
        deleteMeetingAudioKey,
      },
    });

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
      deletedBytes: 2 * 1024 ** 2,
    });
    expect(fs.existsSync(audioPath)).toBe(false);
    expect(deleteMeetingAudioKey).toHaveBeenCalledWith('legacy');
    sqlite.close();
  });
});
