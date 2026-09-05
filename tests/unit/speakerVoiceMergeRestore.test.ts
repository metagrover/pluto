import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('speakerVoiceMergeRestore & lossless identity integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        title TEXT,
        audio_path TEXT,
        transcript_json TEXT,
        transcript_integrity_json TEXT,
        transcript_validated_at DATETIME,
        transcript_status TEXT DEFAULT 'validating',
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

    // Seed test entities and meetings
    db.prepare("INSERT INTO entities (id, name, type) VALUES ('person-alex', 'Alex Smith', 'person')").run();
    db.prepare("INSERT INTO entities (id, name, type) VALUES ('person-bob', 'Bob Jones', 'person')").run();
    db.prepare("INSERT INTO meetings (id, capture_journal_generation) VALUES ('m1', 'gen-1')").run();
    db.prepare("INSERT INTO meetings (id, capture_journal_generation) VALUES ('m2', 'gen-1')").run();
  });

  afterEach(() => {
    db.close();
  });

  const dummyProvenance = {
    modelIdentifier: 'speaker-diarization-offline-v1',
    modelRevision: 'a'.repeat(40),
    artifactDigest: 'b'.repeat(64),
    runtimeVersion: 'fluidaudio-test',
    profileAlgorithmVersion: 'v1',
  };

  it('enrolls a confirmed speaker voice sample under original person_id', async () => {
    const { enrollSpeakerVoice, getCanonicalVoiceProfiles } = await import('../../electron/speakerVoiceStore');

    const v1 = new Array(256).fill(0.1);
    db.prepare(`
      INSERT INTO meeting_speaker_candidates (
        meeting_id, speaker, source_revision, candidate_digest, embedding_json,
        clean_duration_sec, clean_segment_count, clean_chunk_count,
        minimum_chunk_similarity, mean_chunk_similarity,
        reference_start_sec, reference_end_sec, reference_excerpt, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'm1', 'Remote Speaker 1', 'gen-1', 'digest-1', JSON.stringify(v1),
      4.0, 2, 2, 0.85, 0.9, 1.0, 3.0, 'Hello from Alex', JSON.stringify(dummyProvenance)
    );

    const enrollment = enrollSpeakerVoice({
      personId: 'person-alex',
      sourceMeetingId: 'm1',
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'digest-1',
    }, db);

    expect(enrollment.id).toBeDefined();
    expect(enrollment.personId).toBe('person-alex');

    const profiles = getCanonicalVoiceProfiles({ dbInstance: db });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].canonicalPersonId).toBe('person-alex');
    expect(profiles[0].personName).toBe('Alex Smith');
    expect(profiles[0].sampleCount).toBe(1);
    expect(profiles[0].cleanDurationSeconds).toBeCloseTo(4.0);
    expect(profiles[0].isActive).toBe(true);
  });

  it('combines enrollments dynamically on person merge and restores exact uncorrupted profiles on restore', async () => {
    const { enrollSpeakerVoice, getCanonicalVoiceProfiles, deleteVoiceProfile, setVoiceProfileStatus } =
      await import('../../electron/speakerVoiceStore');

    // Vector 1 (mostly dimension 0)
    const v1 = new Array(256).fill(0);
    v1[0] = 1.0;
    db.prepare(`
      INSERT INTO meeting_speaker_candidates (
        meeting_id, speaker, source_revision, candidate_digest, embedding_json,
        clean_duration_sec, clean_segment_count, clean_chunk_count,
        minimum_chunk_similarity, mean_chunk_similarity,
        reference_start_sec, reference_end_sec, reference_excerpt, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'm1', 'Remote Speaker 1', 'gen-1', 'digest-alex', JSON.stringify(v1),
      4.0, 2, 2, 0.85, 0.9, 1.0, 3.0, 'Alex audio', JSON.stringify(dummyProvenance)
    );

    // Vector 2 (mostly dimension 1)
    const v2 = new Array(256).fill(0);
    v2[1] = 1.0;
    db.prepare(`
      INSERT INTO meeting_speaker_candidates (
        meeting_id, speaker, source_revision, candidate_digest, embedding_json,
        clean_duration_sec, clean_segment_count, clean_chunk_count,
        minimum_chunk_similarity, mean_chunk_similarity,
        reference_start_sec, reference_end_sec, reference_excerpt, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'm2', 'Remote Speaker 1', 'gen-1', 'digest-bob', JSON.stringify(v2),
      6.0, 3, 3, 0.80, 0.85, 2.0, 5.0, 'Bob audio', JSON.stringify(dummyProvenance)
    );

    enrollSpeakerVoice({
      personId: 'person-alex',
      sourceMeetingId: 'm1',
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'digest-alex',
    }, db);

    enrollSpeakerVoice({
      personId: 'person-bob',
      sourceMeetingId: 'm2',
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'digest-bob',
    }, db);

    // Before merge: 2 distinct profiles
    const initialProfiles = getCanonicalVoiceProfiles({ dbInstance: db });
    expect(initialProfiles).toHaveLength(2);

    // Merge Bob into Alex (person_aliases: Bob -> Alex)
    db.prepare("INSERT INTO person_aliases (person_id, canonical_id, active) VALUES ('person-bob', 'person-alex', 1)").run();

    // After merge: 1 profile under Alex combining both enrollments
    const mergedProfiles = getCanonicalVoiceProfiles({ dbInstance: db });
    expect(mergedProfiles).toHaveLength(1);
    expect(mergedProfiles[0].canonicalPersonId).toBe('person-alex');
    expect(mergedProfiles[0].personName).toBe('Alex Smith');
    expect(mergedProfiles[0].sampleCount).toBe(2);
    expect(mergedProfiles[0].cleanDurationSeconds).toBeCloseTo(10.0);
    // Combined vector has both dim 0 and dim 1 components
    expect(mergedProfiles[0].embedding[0]).toBeGreaterThan(0.4);
    expect(mergedProfiles[0].embedding[1]).toBeGreaterThan(0.4);

    // Permanent delete is BLOCKED while merged
    expect(() => deleteVoiceProfile('person-alex', db)).toThrow(
      'Restore this person merge before permanently deleting voice samples.'
    );
    expect(() => deleteVoiceProfile('person-bob', db)).toThrow(
      'Restore this person merge before permanently deleting voice samples.'
    );

    // Restore merge (deactivate alias)
    db.prepare("UPDATE person_aliases SET active = 0 WHERE person_id = 'person-bob' AND canonical_id = 'person-alex'").run();

    // After restore: both Alex and Bob immediately recover exact original profiles!
    const restoredProfiles = getCanonicalVoiceProfiles({ dbInstance: db });
    expect(restoredProfiles).toHaveLength(2);
    const restoredAlex = restoredProfiles.find((p) => p.canonicalPersonId === 'person-alex');
    const restoredBob = restoredProfiles.find((p) => p.canonicalPersonId === 'person-bob');
    expect(restoredAlex?.sampleCount).toBe(1);
    expect(restoredAlex?.cleanDurationSeconds).toBeCloseTo(4.0);
    expect(restoredAlex?.embedding[0]).toBeCloseTo(1.0);
    expect(restoredBob?.sampleCount).toBe(1);
    expect(restoredBob?.cleanDurationSeconds).toBeCloseTo(6.0);
    expect(restoredBob?.embedding[1]).toBeCloseTo(1.0);
  });
});
