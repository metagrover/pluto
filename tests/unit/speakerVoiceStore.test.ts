import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SpeakerCandidateEvidence } from '../../src/services/speakerCandidateEvidence';

const directory = vi.hoisted(() => {
  const filesystem = require('node:fs') as typeof import('node:fs');
  return filesystem.mkdtempSync('/tmp/pluto-voice-store-');
});
vi.mock('electron', () => ({ app: { getPath: () => directory } }));

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('speakerVoiceStore & candidate database operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create minimal schema for test
    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        title TEXT,
        audio_path TEXT,
        transcript_json TEXT,
        transcript_integrity_json TEXT,
        transcript_validated_at DATETIME,
        transcript_status TEXT DEFAULT 'validating',
        finalization_status TEXT,
        finalization_error_category TEXT,
        enhanced_notes TEXT,
        analysis_json TEXT,
        value_signals_json TEXT,
        downstream_processing_json TEXT,
        capture_journal_generation TEXT
      );

      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      );

      CREATE TABLE person_aliases (
        person_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (person_id, canonical_id)
      );

      CREATE TABLE meeting_speaker_candidates (
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        clean_duration_sec REAL NOT NULL,
        clean_segment_count INTEGER NOT NULL,
        clean_chunk_count INTEGER NOT NULL,
        minimum_chunk_similarity REAL NOT NULL,
        mean_chunk_similarity REAL NOT NULL,
        reference_start_sec REAL NOT NULL,
        reference_end_sec REAL NOT NULL,
        reference_excerpt TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, speaker, source_revision)
      );

      CREATE TABLE speaker_voice_enrollments (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        source_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        source_revision TEXT NOT NULL,
        speaker TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        clean_duration_sec REAL NOT NULL,
        minimum_chunk_similarity REAL NOT NULL,
        mean_chunk_similarity REAL NOT NULL,
        reference_start_sec REAL NOT NULL,
        reference_end_sec REAL NOT NULL,
        reference_excerpt TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE speaker_voice_profile_settings (
        person_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE speaker_voice_rejections (
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, speaker, source_revision, candidate_digest, person_id)
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  const dummyCandidate: SpeakerCandidateEvidence = {
    speaker: 'Remote Speaker 1',
    nativeCluster: 'S1',
    candidateDigest: 'c'.repeat(64),
    embedding: new Array(256).fill(0.1),
    cleanDurationSeconds: 4.5,
    cleanSegmentCount: 2,
    cleanChunkCount: 3,
    minimumChunkSimilarity: 0.85,
    meanChunkSimilarity: 0.9,
    referenceInterval: {
      startTime: 1.0,
      endTime: 3.5,
      excerpt: 'reference speech excerpt',
    },
    provenance: {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: 'a'.repeat(40),
      artifactDigest: 'b'.repeat(64),
      runtimeVersion: 'fluidaudio-test',
      profileAlgorithmVersion: 'v1',
    },
    isEligibleForEnrollment: true,
  };

  it('saves meeting speaker candidates and retrieves them accurately', async () => {
    const { saveMeetingSpeakerCandidates, getMeetingSpeakerCandidates } =
      await import('../../electron/speakerVoiceStore');

    db.prepare(
      "INSERT INTO meetings (id, capture_journal_generation) VALUES ('m1', 'gen-1')",
    ).run();

    saveMeetingSpeakerCandidates('m1', 'gen-1', [dummyCandidate], db);

    const candidates = getMeetingSpeakerCandidates('m1', db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].speaker).toBe('Remote Speaker 1');
    expect(candidates[0].candidateDigest).toBe('c'.repeat(64));
    expect(candidates[0].embedding).toHaveLength(256);
    expect(candidates[0].cleanDurationSeconds).toBeCloseTo(4.5);
    expect(candidates[0].referenceInterval.excerpt).toBe(
      'reference speech excerpt',
    );
  });

  it('overwrites prior candidate generations on new commit for the same meeting', async () => {
    const { saveMeetingSpeakerCandidates, getMeetingSpeakerCandidates } =
      await import('../../electron/speakerVoiceStore');

    db.prepare(
      "INSERT INTO meetings (id, capture_journal_generation) VALUES ('m1', 'gen-1')",
    ).run();

    saveMeetingSpeakerCandidates('m1', 'gen-1', [dummyCandidate], db);
    expect(getMeetingSpeakerCandidates('m1', db)).toHaveLength(1);

    // Re-run generates gen-2 with 2 candidates
    const candidate2: SpeakerCandidateEvidence = {
      ...dummyCandidate,
      speaker: 'Remote Speaker 2',
      nativeCluster: 'S2',
      candidateDigest: 'd'.repeat(64),
    };
    saveMeetingSpeakerCandidates(
      'm1',
      'gen-2',
      [dummyCandidate, candidate2],
      db,
    );

    const candidates = getMeetingSpeakerCandidates('m1', db);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.speaker)).toEqual([
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
  });

  it('cascades deletion of meeting to wipe all candidate vectors permanently', async () => {
    const { saveMeetingSpeakerCandidates, getMeetingSpeakerCandidates } =
      await import('../../electron/speakerVoiceStore');

    db.prepare(
      "INSERT INTO meetings (id, capture_journal_generation) VALUES ('m1', 'gen-1')",
    ).run();

    saveMeetingSpeakerCandidates('m1', 'gen-1', [dummyCandidate], db);
    expect(getMeetingSpeakerCandidates('m1', db)).toHaveLength(1);

    // Delete meeting
    db.prepare("DELETE FROM meetings WHERE id = 'm1'").run();

    expect(getMeetingSpeakerCandidates('m1', db)).toHaveLength(0);
    const rowCount = db
      .prepare('SELECT count(*) as count FROM meeting_speaker_candidates')
      .get() as { count: number };
    expect(rowCount.count).toBe(0);
  });
});
