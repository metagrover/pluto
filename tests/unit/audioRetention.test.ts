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
import { EncryptedArtifactStore } from '../../electron/crypto/encryptedArtifactStore';
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
    expect(
      audioRetentionBlockReason(
        eligibleMeeting('historical-migration'),
        false,
        false,
        true,
      ),
    ).toBe('historical_migration');
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
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
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

  it('authenticates and removes every encrypted audio segment while retaining its journal key', async () => {
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
    const transcriptRoot = path.join(
      root,
      'encrypted',
      'transcript-checkpoints',
    );
    fs.mkdirSync(transcriptRoot, { recursive: true });
    const transcriptPath = path.join(transcriptRoot, 'mic.enc');
    const transcriptHeader = {
      artifactKind: 'sidecar' as const,
      meetingId: context.meetingId,
      generation: context.generation,
      keyId: context.keyId,
      source: 'mic' as const,
      sequence: 0,
    };
    fs.writeFileSync(
      transcriptPath,
      EncryptedArtifactStore.seal(
        Buffer.from('transcript evidence'),
        meetingKey,
        transcriptHeader,
      ).fullBuffer,
    );
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('encrypted', bundlePath);
    let keyAvailable = true;
    const deleteMeetingAudioKey = vi.fn(() => {
      keyAvailable = false;
      return true;
    });
    const getMeetingAudioKey = vi.fn(() =>
      keyAvailable ? { meetingKey, keyId: context.keyId } : null,
    );
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
        getMeetingAudioKey,
        deleteMeetingAudioKey,
      },
    });

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
    });
    expect(fs.readdirSync(root)).toEqual(['encrypted']);
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
    const retainedKey = getMeetingAudioKey();
    expect(retainedKey).not.toBeNull();
    expect(
      EncryptedArtifactStore.open(
        fs.readFileSync(transcriptPath),
        retainedKey!.meetingKey,
        transcriptHeader,
      ).plaintext.toString(),
    ).toBe('transcript evidence');
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
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
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
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('holds an exclusive audio deletion lease across artifact removal', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const audioPath = path.join(root, 'leased.wav');
    fs.writeFileSync(audioPath, 'audio');
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('leased', audioPath);
    const release = vi.fn();
    const acquireDeletionLease = vi.fn(() => release);
    const meeting = eligibleMeeting('leased', audioPath);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => null),
        deleteMeetingAudioKey: vi.fn(() => true),
      },
      acquireDeletionLease,
    });

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
    });
    expect(acquireDeletionLease).toHaveBeenCalledWith('leased');
    expect(release).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it('removes capture journal audio chunks when nested under capture-journal/ while preserving transcript sidecars', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const meetingRoot = path.join(root, 'journal-nested');
    const journalRoot = path.join(meetingRoot, 'capture-journal');
    const chunksRoot = path.join(journalRoot, 'chunks');
    const repairRoot = path.join(journalRoot, 'repair');
    const transcriptRoot = path.join(journalRoot, 'transcript-checkpoints');
    const acceptanceRoot = path.join(journalRoot, 'acceptance-frames');
    fs.mkdirSync(chunksRoot, { recursive: true });
    fs.mkdirSync(repairRoot, { recursive: true });
    fs.mkdirSync(transcriptRoot, { recursive: true });
    fs.mkdirSync(acceptanceRoot, { recursive: true });
    fs.writeFileSync(path.join(chunksRoot, 'chunk-000.enc'), 'chunk audio');
    fs.writeFileSync(path.join(repairRoot, 'repair-000.enc'), 'repair audio');
    const manifestPath = path.join(journalRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 4 }));
    const transcriptPath = path.join(transcriptRoot, 'transcript-000.enc');
    fs.writeFileSync(transcriptPath, 'transcript sidecar data');
    const framePath = path.join(acceptanceRoot, 'frame-000.enc');
    fs.writeFileSync(framePath, 'acceptance frame sidecar');

    sqlite
      .prepare('INSERT INTO meetings (id) VALUES (?)')
      .run('journal-nested');
    const deleteMeetingAudioKey = vi.fn(() => true);
    const meeting = eligibleMeeting('journal-nested');
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

    const inspection = await manager.inspect();
    expect(inspection.retainedBytes).toBe(
      'chunk audio'.length + 'repair audio'.length,
    );

    await expect(manager.deleteMeetingAudio(meeting)).resolves.toMatchObject({
      status: 'deleted',
      deletedBytes: 'chunk audio'.length + 'repair audio'.length,
    });

    expect(fs.existsSync(chunksRoot)).toBe(false);
    expect(fs.existsSync(repairRoot)).toBe(false);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.readFileSync(transcriptPath, 'utf8')).toBe(
      'transcript sidecar data',
    );
    expect(fs.readFileSync(framePath, 'utf8')).toBe('acceptance frame sidecar');
    expect(deleteMeetingAudioKey).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('prunes unreferenced loose wav files older than grace period and preserves recent or referenced ones', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const oldOrphanPath = path.join(
      root,
      'meeting-1_1700000000_old_orphan.wav',
    );
    const recentOrphanPath = path.join(
      root,
      'meeting-2_1700000000_recent_orphan.wav',
    );
    const referencedPath = path.join(root, 'meeting-3_referenced.wav');

    fs.writeFileSync(oldOrphanPath, 'old orphan audio data');
    fs.writeFileSync(recentOrphanPath, 'recent orphan audio data');
    fs.writeFileSync(referencedPath, 'referenced audio data');

    // Backdate mtime for old orphan by 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(oldOrphanPath, twoHoursAgo, twoHoursAgo);

    // Old speaker profile temp dir
    const oldSpeakerDir = path.join(root, '.speaker-profile-oldtest');
    fs.mkdirSync(oldSpeakerDir, { recursive: true });
    fs.writeFileSync(path.join(oldSpeakerDir, 'scratch.wav'), 'scratch');
    fs.utimesSync(oldSpeakerDir, twoHoursAgo, twoHoursAgo);

    const meeting = eligibleMeeting('meeting-3', referencedPath);
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run(String(meeting.id), referencedPath);

    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: vi.fn(() => null),
        deleteMeetingAudioKey: vi.fn(() => true),
      },
      orphanGracePeriodMs: 60 * 60 * 1000, // 1 hour grace
    });

    const inspection = await manager.inspect();
    // Inspection counts all retained audio, including recent files and scratch work.
    expect(inspection.retainedBytes).toBe(
      'old orphan audio data'.length +
        'referenced audio data'.length +
        'recent orphan audio data'.length +
        'scratch'.length,
    );

    const result = await manager.sweep();

    expect(fs.existsSync(oldOrphanPath)).toBe(false);
    expect(fs.existsSync(oldSpeakerDir)).toBe(false);
    expect(fs.existsSync(recentOrphanPath)).toBe(true);
    expect(fs.existsSync(referencedPath)).toBe(true);
    expect(result.deletedBytes).toBe(
      'old orphan audio data'.length + 'scratch'.length,
    );
    sqlite.close();
  });

  it('preserves every segment of a referenced encrypted bundle during orphan cleanup', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const context = {
      meetingId: 'bundle',
      generation: 'generation-1',
      keyId: 'key-1',
      meetingKey: Buffer.alloc(32, 7),
    };
    const bundlePath = await writeEncryptedAudioBundle({
      rootDir: root,
      totalFrames: 16,
      source: 'mic',
      context,
      produceWindow: async (_start, frames) => new Float32Array(frames),
    });
    const files = fs.readdirSync(root).map((name) => path.join(root, name));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const file of files) fs.utimesSync(file, old, old);
    const meeting = {
      ...eligibleMeeting('bundle', bundlePath),
      capture_journal_generation: context.generation,
    };
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('bundle', bundlePath);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: {
        getMeetingAudioKey: () => ({
          meetingKey: context.meetingKey,
          keyId: context.keyId,
        }),
        deleteMeetingAudioKey: vi.fn(() => true),
      },
    });
    const bytes = files.reduce(
      (total, file) => total + fs.statSync(file).size,
      0,
    );
    expect(await manager.inspect()).toMatchObject({
      retainedBytes: bytes,
      measurementComplete: true,
    });
    expect(await manager.sweep()).toMatchObject({
      retainedBytes: bytes,
      deletedBytes: 0,
    });
    for (const file of files) expect(fs.existsSync(file)).toBe(true);
    sqlite.close();
  });

  it('prunes orphans when a stable direct reference is inside a journal audio root', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const chunks = path.join(root, 'nested', 'capture-journal', 'chunks');
    fs.mkdirSync(chunks, { recursive: true });
    const audioPath = path.join(chunks, 'mic.enc');
    fs.writeFileSync(audioPath, 'source audio');
    const orphan = path.join(root, 'abandoned.wav');
    fs.writeFileSync(orphan, 'orphan');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(orphan, old, old);
    const meeting = eligibleMeeting('nested', audioPath);
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('nested', audioPath);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: null,
    });
    expect(await manager.sweep()).toMatchObject({
      retainedBytes: 12,
      deletedBytes: 6,
    });
    expect(fs.existsSync(audioPath)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    sqlite.close();
  });

  it('defers cleanup when an encrypted index becomes referenced during the scan', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const context = {
      meetingId: 'published',
      generation: 'generation-1',
      keyId: 'key-1',
      meetingKey: Buffer.alloc(32, 7),
    };
    const bundlePath = await writeEncryptedAudioBundle({
      rootDir: root,
      totalFrames: 16,
      source: 'mic',
      context,
      produceWindow: async (_start, frames) => new Float32Array(frames),
    });
    const files = fs.readdirSync(root).map((name) => path.join(root, name));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const file of files) fs.utimesSync(file, old, old);
    const meeting = eligibleMeeting('published', bundlePath);
    sqlite
      .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
      .run('published', bundlePath);
    const listMeetings = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValue([meeting]);
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings,
      getSetting: () => '10',
      audioKeyStore: null,
    });
    expect(await manager.sweep()).toMatchObject({ deletedBytes: 0 });
    for (const file of files) expect(fs.existsSync(file)).toBe(true);
    sqlite.close();
  });

  it.each(['recording', 'analysis', 'migration', 'recovery', 'missing-key'])(
    'defers orphan deletion while %s leaves ownership unsafe',
    async (state) => {
      const root = makeRoot();
      const sqlite = makeDatabase();
      const orphanPath = path.join(root, 'unpublished.enc');
      fs.writeFileSync(orphanPath, 'unpublished audio');
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(orphanPath, old, old);
      const workDir = path.join(root, '.speaker-profile-active');
      fs.mkdirSync(workDir);
      fs.writeFileSync(path.join(workDir, 'scratch.wav'), 'scratch');
      fs.utimesSync(workDir, old, old);
      const meeting = eligibleMeeting(
        'busy',
        state === 'missing-key' ? orphanPath : undefined,
      );
      if (state === 'recovery') meeting.finalization_status = 'needs_attention';
      sqlite
        .prepare('INSERT INTO meetings (id, audio_path) VALUES (?, ?)')
        .run('busy', meeting.audio_path ?? null);
      if (state === 'analysis') {
        sqlite
          .prepare('INSERT INTO meeting_analysis_runs VALUES (?, ?, ?)')
          .run('busy', 'running', 'pending');
      }
      const manager = createAudioRetentionManager({
        rootDir: root,
        sqlite,
        listMeetings: () => [meeting],
        getSetting: () => '10',
        audioKeyStore: null,
        isMeetingActive: () => state === 'recording',
        isHistoricalMigrationBlocked: () => state === 'migration',
      });
      const result = await manager.sweep();
      expect(result.deletedBytes).toBe(0);
      expect(fs.existsSync(orphanPath)).toBe(true);
      expect(fs.existsSync(workDir)).toBe(true);
      if (state === 'missing-key')
        expect(result.measurementComplete).toBe(false);
      sqlite.close();
    },
  );

  it('keeps files created in this session even after the grace period passes', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [],
      getSetting: () => '10',
      audioKeyStore: null,
    });
    const file = path.join(root, 'unpublished.wav');
    fs.writeFileSync(file, 'still in use');
    const now = Date.now();
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(now + 2 * 60 * 60 * 1000);
    try {
      expect(await manager.sweep()).toMatchObject({
        retainedBytes: 12,
        deletedBytes: 0,
      });
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      clock.mockRestore();
      sqlite.close();
    }
  });

  it('counts recent audio and speaker work directories and reports orphan scan failures', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    fs.writeFileSync(path.join(root, 'recent.wav'), 'audio');
    const workDir = path.join(root, '.speaker-profile-recent');
    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(workDir, 'scratch.wav'), 'scratch');
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [],
      getSetting: () => '10',
      audioKeyStore: null,
    });
    expect(await manager.inspect()).toMatchObject({
      retainedBytes: 12,
      measurementComplete: true,
    });
    const stat = vi
      .spyOn(fs.promises, 'lstat')
      .mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'EACCES' }),
      );
    try {
      expect(await manager.inspect()).toMatchObject({
        measurementComplete: false,
        overBudget: true,
      });
    } finally {
      stat.mockRestore();
      sqlite.close();
    }
  });

  it('rejects capture journal paths whose parent symlink escapes the managed root', async () => {
    const root = makeRoot();
    const outside = makeRoot();
    const sqlite = makeDatabase();
    const chunks = path.join(outside, 'chunks');
    fs.mkdirSync(chunks);
    fs.writeFileSync(path.join(chunks, 'source.wav'), 'preserve');
    const meetingRoot = path.join(root, 'linked');
    fs.mkdirSync(meetingRoot);
    fs.symlinkSync(outside, path.join(meetingRoot, 'capture-journal'));
    const meeting = eligibleMeeting('linked');
    sqlite.prepare('INSERT INTO meetings (id) VALUES (?)').run('linked');
    const manager = createAudioRetentionManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [meeting],
      getSetting: () => '10',
      audioKeyStore: null,
    });
    expect(await manager.deleteMeetingAudio(meeting)).toMatchObject({
      status: 'failed',
      reason: 'artifact_path_invalid',
    });
    expect(fs.readFileSync(path.join(chunks, 'source.wav'), 'utf8')).toBe(
      'preserve',
    );
    sqlite.close();
  });
});
