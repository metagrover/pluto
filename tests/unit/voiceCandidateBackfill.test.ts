import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  VOICE_BACKFILL_REPORT,
  VOICE_BACKFILL_REQUEST,
  inspectVoiceBackfillMeeting,
  startVoiceCandidateBackfill,
} from '../../electron/voiceCandidateBackfill';

let db: Database.Database;
let directory: string;
beforeEach(() => {
  db = new Database(':memory:');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-backfill-test-'));
  db.exec(`CREATE TABLE meetings (id TEXT, audio_path TEXT, system_audio_path TEXT,
    started_at TEXT, capture_journal_generation TEXT, transcript_json TEXT,
    transcript_status TEXT, transcript_validated_at TEXT, transcript_integrity_json TEXT);
    CREATE TABLE meeting_speaker_candidates (meeting_id TEXT, speaker TEXT, source_revision TEXT, provenance_json TEXT);
    CREATE TABLE speaker_voice_candidate_attempts (meeting_id TEXT, speaker TEXT, source_revision TEXT, extraction_version TEXT, status TEXT);
    CREATE TABLE identity_bindings (meeting_id TEXT);`);
  fs.writeFileSync(path.join(directory, 'system.wav'), 'fixture');
  db.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'meeting',
    '',
    path.join(directory, 'system.wav'),
    '2026-09-08',
    'revision',
    JSON.stringify([
      { speaker: 'Them', text: 'First interval', start: 0, end: 5 },
      { speaker: 'Them', text: 'Second interval', start: 10, end: 15 },
    ]),
    'validated',
    '2026-09-08',
    JSON.stringify({
      schemaVersion: 2,
      state: 'validated',
      causes: [],
      evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
      validationProof: {
        gateVersion: 'canonical_integrity_v1',
        validatedAt: '2026-09-08',
      },
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('requires real current-revision extraction and retains terminal abstentions', () => {
  expect(inspectVoiceBackfillMeeting(db, 'meeting').status).toBe('pending');
  db.prepare('INSERT INTO meeting_speaker_candidates VALUES (?, ?, ?, ?)').run(
    'meeting',
    'Them',
    'old',
    JSON.stringify({ enrollmentExtractionVersion: 'single-pass-v2' }),
  );
  expect(inspectVoiceBackfillMeeting(db, 'meeting').status).toBe('pending');
  db.prepare(
    'INSERT INTO speaker_voice_candidate_attempts VALUES (?, ?, ?, ?, ?)',
  ).run('meeting', 'Them', 'revision', 'single-pass-v2', 'abstained');
  expect(inspectVoiceBackfillMeeting(db, 'meeting').status).toBe(
    'evidence_unavailable',
  );
  db.prepare('INSERT INTO meeting_speaker_candidates VALUES (?, ?, ?, ?)').run(
    'meeting',
    'Them',
    'revision',
    JSON.stringify({ enrollmentExtractionVersion: 'single-pass-v2' }),
  );
  expect(inspectVoiceBackfillMeeting(db, 'meeting').status).toBe('current');
});

it('does not enqueue missing audio or untrusted transcripts', () => {
  expect(inspectVoiceBackfillMeeting(db, 'meeting', () => false).status).toBe(
    'no_usable_source',
  );
  db.exec(
    "UPDATE meetings SET transcript_status='invalid', transcript_validated_at=NULL, transcript_integrity_json=NULL",
  );
  expect(inspectVoiceBackfillMeeting(db, 'meeting').status).toBe(
    'no_usable_source',
  );
});

it('resumes the durable request after restart, deduplicates, and verifies persisted completion', async () => {
  vi.useFakeTimers();
  fs.writeFileSync(
    path.join(directory, VOICE_BACKFILL_REQUEST),
    JSON.stringify({ requestId: 'test', version: 'single-pass-v2' }),
  );
  const enqueue = vi.fn();
  const options = {
    directory,
    db,
    enqueue,
    pending: () => [] as string[],
    diagnostics: () => ({}),
    onError: (error: unknown) => {
      throw error;
    },
  };
  let stop = startVoiceCandidateBackfill(options);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(enqueue).toHaveBeenCalledWith('meeting');
  stop();
  stop = startVoiceCandidateBackfill({
    ...options,
    pending: () => ['meeting'],
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(enqueue).toHaveBeenCalledTimes(1);
  db.prepare('INSERT INTO meeting_speaker_candidates VALUES (?, ?, ?, ?)').run(
    'meeting',
    'Them',
    'revision',
    JSON.stringify({ enrollmentExtractionVersion: 'single-pass-v2' }),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(
    JSON.parse(
      fs.readFileSync(path.join(directory, VOICE_BACKFILL_REPORT), 'utf8'),
    ),
  ).toMatchObject({ complete: true, counts: { current: 1 } });
  stop();
});
