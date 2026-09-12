import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCaptureJournal,
  readCaptureJournalManifest,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import { encodeCanonicalPcm16Wav } from '../../electron/crypto/encryptedAudioBundle';
import { createHistoricalAudioMigrationManager } from '../../electron/historicalAudioMigration';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

describe('historical audio migration', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-history-'));
    roots.push(root);
    return root;
  };

  const makeDatabase = () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        created_at TEXT,
        audio_path TEXT,
        system_audio_path TEXT,
        mixed_audio_path TEXT
      );
      CREATE TABLE meeting_audio_migrations (
        meeting_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        migrated_bytes INTEGER NOT NULL DEFAULT 0,
        last_failure_code TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    return sqlite;
  };

  const makeSealedJournal = async (root: string, meetingId: string) => {
    const created = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const evidence = await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence: await buildCaptureActivityEvidence(
        [{ startTime: 0, endTime: 1, speaker: 'Me' }],
        {
          clock: {
            kind: 'meeting_relative_seconds',
            origin: 'recording_start',
          },
          thresholds: {
            rms: 0.01,
            dominanceRatio: 1.5,
            minimumSwitchIntervalMs: 250,
          },
          algorithmVersion: 'speaker_activity_v1',
        },
      ),
    });
    if (evidence.schemaVersion !== 3) throw new Error('expected v3');
    const stopping = await stopCaptureJournal(root, {
      meetingId,
      generation: created.generation,
      expectedRevision: evidence.revision,
    });
    return await sealCaptureJournal(root, {
      meetingId,
      endedAtMs: 2_000,
      meetingKey: stopping.schemaVersion === 4 ? Buffer.alloc(32) : undefined,
    });
  };

  it('migrates only the newest eligible meeting per run and removes verified plaintext', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    const keys = new Map<string, { keyId: string; meetingKey: Buffer }>();
    const keyStore = {
      getOrCreateMeetingAudioKey: (meetingId: string) => {
        let key = keys.get(meetingId);
        if (!key) {
          key = { keyId: `key-${meetingId}`, meetingKey: randomBytes(32) };
          keys.set(meetingId, key);
        }
        return key;
      },
      getMeetingAudioKey: (meetingId: string) => keys.get(meetingId) ?? null,
    };
    for (const [meetingId, startedAt] of [
      ['older', '2026-01-01T00:00:00.000Z'],
      ['newer', '2026-02-01T00:00:00.000Z'],
    ] as const) {
      await makeSealedJournal(root, meetingId);
      const wavPath = path.join(root, `${meetingId}.wav`);
      fs.writeFileSync(
        wavPath,
        encodeCanonicalPcm16Wav(new Int16Array([0, 1, -1, 32_767, -32_768])),
      );
      sqlite
        .prepare(
          `INSERT INTO meetings (id, started_at, created_at, audio_path)
           VALUES (?, ?, ?, ?)`,
        )
        .run(meetingId, startedAt, startedAt, wavPath);
    }
    const listMeetings = () =>
      sqlite
        .prepare('SELECT * FROM meetings')
        .all()
        .map((row) => ({
          ...(row as Record<string, unknown>),
          transcript_status: 'validated' as const,
          finalization_status: 'finalized',
          downstream_processing_json: null,
        }));
    const manager = createHistoricalAudioMigrationManager({
      rootDir: root,
      sqlite,
      listMeetings,
      audioKeyStore: keyStore,
    });

    expect(await manager.sweepOne()).toMatchObject({
      status: 'migrated',
      meetingId: 'newer',
    });
    const newer = sqlite
      .prepare('SELECT audio_path FROM meetings WHERE id = ?')
      .get('newer') as { audio_path: string };
    expect(newer.audio_path).toMatch(/\.enc$/);
    expect(fs.existsSync(path.join(root, 'newer.wav'))).toBe(false);
    expect(
      await readCaptureJournalManifest(root, 'newer', {
        meetingKey: keys.get('newer')!.meetingKey,
      }),
    ).toMatchObject({ schemaVersion: 4, keyId: 'key-newer' });
    expect(
      (await readCaptureJournalManifest(root, 'older')).schemaVersion,
    ).toBe(3);

    expect(await manager.sweepOne()).toMatchObject({
      status: 'migrated',
      meetingId: 'older',
    });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM meeting_audio_migrations
           WHERE status = 'complete'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    sqlite.close();
  });

  it('preserves plaintext and records only a reason code when verification cannot pass', async () => {
    const root = makeRoot();
    const sqlite = makeDatabase();
    await makeSealedJournal(root, 'invalid');
    const wavPath = path.join(root, 'invalid.wav');
    fs.writeFileSync(wavPath, Buffer.from('not-a-canonical-wav'));
    sqlite
      .prepare(
        `INSERT INTO meetings (id, started_at, created_at, audio_path)
         VALUES ('invalid', '2026-03-01', '2026-03-01', ?)`,
      )
      .run(wavPath);
    const meetingKey = randomBytes(32);
    const manager = createHistoricalAudioMigrationManager({
      rootDir: root,
      sqlite,
      listMeetings: () => [
        {
          id: 'invalid',
          started_at: '2026-03-01',
          created_at: '2026-03-01',
          audio_path: wavPath,
          transcript_status: 'validated',
          finalization_status: 'finalized',
        },
      ],
      audioKeyStore: {
        getOrCreateMeetingAudioKey: () => ({
          keyId: 'invalid-key',
          meetingKey,
        }),
        getMeetingAudioKey: () => ({ keyId: 'invalid-key', meetingKey }),
      },
    });

    expect(await manager.sweepOne()).toEqual({
      status: 'failed',
      meetingId: 'invalid',
      reason: 'historical_audio_wav_invalid',
    });
    expect(fs.readFileSync(wavPath)).toEqual(
      Buffer.from('not-a-canonical-wav'),
    );
    expect(
      sqlite
        .prepare(
          `SELECT status, last_failure_code FROM meeting_audio_migrations
           WHERE meeting_id = 'invalid'`,
        )
        .get(),
    ).toEqual({
      status: 'failed',
      last_failure_code: 'historical_audio_wav_invalid',
    });
    expect(
      (await readCaptureJournalManifest(root, 'invalid')).schemaVersion,
    ).toBe(3);
    sqlite.close();
  });
});
