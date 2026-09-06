import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  SpeakerCandidateEvidence,
  SpeakerCandidateProvenance,
} from '../src/services/speakerCandidateEvidence.ts';

export interface SpeakerVoiceEnrollment {
  id: string;
  personId: string;
  sourceMeetingId: string;
  sourceRevision: string;
  speaker: string;
  embedding: number[];
  chunkCount: number;
  cleanDurationSeconds: number;
  minimumChunkSimilarity: number;
  meanChunkSimilarity: number;
  referenceInterval: {
    startTime: number;
    endTime: number;
    excerpt: string;
  };
  provenance: SpeakerCandidateProvenance;
  candidateDigest: string;
  createdAt: string;
}

export interface CanonicalVoiceProfile {
  canonicalPersonId: string;
  personName: string;
  sampleCount: number;
  cleanDurationSeconds: number;
  isActive: boolean;
  embedding: number[];
  referenceInterval?: {
    startTime: number;
    endTime: number;
    excerpt: string;
    sourceMeetingId: string;
  };
  provenance?: SpeakerCandidateProvenance;
}

export interface SpeakerVoiceRejection {
  meetingId: string;
  speaker: string;
  sourceRevision: string;
  candidateDigest: string;
  personId: string;
  createdAt: string;
}

export interface StoredSpeakerCandidateEvidence
  extends SpeakerCandidateEvidence {
  sourceRevision: string;
}

import * as dbModule from './db';

const UPSERT_MEETING_SPEAKER_CANDIDATE = `INSERT INTO meeting_speaker_candidates (
  meeting_id, speaker, source_revision, candidate_digest, embedding_json,
  clean_duration_sec, clean_segment_count, clean_chunk_count,
  minimum_chunk_similarity, mean_chunk_similarity,
  reference_start_sec, reference_end_sec, reference_excerpt,
  provenance_json, created_at
) VALUES (
  ?, ?, ?, ?, ?,
  ?, ?, ?,
  ?, ?,
  ?, ?, ?,
  ?, CURRENT_TIMESTAMP
)
ON CONFLICT(meeting_id, speaker, source_revision) DO UPDATE SET
  candidate_digest = excluded.candidate_digest,
  embedding_json = excluded.embedding_json,
  clean_duration_sec = excluded.clean_duration_sec,
  clean_segment_count = excluded.clean_segment_count,
  clean_chunk_count = excluded.clean_chunk_count,
  minimum_chunk_similarity = excluded.minimum_chunk_similarity,
  mean_chunk_similarity = excluded.mean_chunk_similarity,
  reference_start_sec = excluded.reference_start_sec,
  reference_end_sec = excluded.reference_end_sec,
  reference_excerpt = excluded.reference_excerpt,
  provenance_json = excluded.provenance_json,
  created_at = CURRENT_TIMESTAMP`;

function getDb(dbInstance?: Database.Database): Database.Database {
  return dbInstance ?? dbModule.db;
}

function writeMeetingSpeakerCandidate(
  meetingId: string,
  sourceRevision: string,
  candidate: SpeakerCandidateEvidence,
  d: Database.Database,
  statement?: Database.Statement,
): void {
  (statement ?? d.prepare(UPSERT_MEETING_SPEAKER_CANDIDATE)).run(
    meetingId,
    candidate.speaker,
    sourceRevision,
    candidate.candidateDigest,
    JSON.stringify(candidate.embedding),
    candidate.cleanDurationSeconds,
    candidate.cleanSegmentCount,
    candidate.cleanChunkCount,
    candidate.minimumChunkSimilarity,
    candidate.meanChunkSimilarity,
    candidate.referenceInterval.startTime,
    candidate.referenceInterval.endTime,
    candidate.referenceInterval.excerpt,
    JSON.stringify(candidate.provenance),
  );
}

export function resolvePersonId(
  personId: string,
  dbInstance?: Database.Database,
): string {
  const d = getDb(dbInstance);
  let current = personId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const alias = d
      .prepare(
        'SELECT canonical_id FROM person_aliases WHERE person_id = ? AND active = 1',
      )
      .get(current) as { canonical_id: string } | undefined;
    if (!alias) return current;
    current = alias.canonical_id;
  }
  throw new Error('person_alias_cycle');
}

export function saveMeetingSpeakerCandidates(
  meetingId: string,
  sourceRevision: string,
  candidates: SpeakerCandidateEvidence[],
  dbInstance?: Database.Database,
): void {
  const d = getDb(dbInstance);
  d.transaction(() => {
    d.prepare(
      'DELETE FROM meeting_speaker_candidates WHERE meeting_id = ?',
    ).run(meetingId);

    const statement = d.prepare(UPSERT_MEETING_SPEAKER_CANDIDATE);
    for (const cand of candidates) {
      writeMeetingSpeakerCandidate(
        meetingId,
        sourceRevision,
        cand,
        d,
        statement,
      );
    }
  })();
}

export function saveMeetingSpeakerCandidate(
  meetingId: string,
  sourceRevision: string,
  candidate: SpeakerCandidateEvidence,
  dbInstance?: Database.Database,
): void {
  writeMeetingSpeakerCandidate(
    meetingId,
    sourceRevision,
    candidate,
    getDb(dbInstance),
  );
}

export function getMeetingSpeakerCandidates(
  meetingId: string,
  dbInstance?: Database.Database,
): StoredSpeakerCandidateEvidence[] {
  const d = getDb(dbInstance);
  const rows = d
    .prepare(
      `SELECT * FROM meeting_speaker_candidates
       WHERE meeting_id = ?
       ORDER BY speaker ASC`,
    )
    .all(meetingId) as Array<{
    meeting_id: string;
    speaker: string;
    source_revision: string;
    candidate_digest: string;
    embedding_json: string;
    clean_duration_sec: number;
    clean_segment_count: number;
    clean_chunk_count: number;
    minimum_chunk_similarity: number;
    mean_chunk_similarity: number;
    reference_start_sec: number;
    reference_end_sec: number;
    reference_excerpt: string;
    provenance_json: string;
    created_at: string;
  }>;

  return rows.map((r) => {
    const provenance = JSON.parse(
      r.provenance_json,
    ) as SpeakerCandidateProvenance;
    return {
      speaker: r.speaker,
      sourceRevision: r.source_revision,
      nativeCluster: r.speaker,
      candidateDigest: r.candidate_digest,
      embedding: JSON.parse(r.embedding_json),
      cleanDurationSeconds: r.clean_duration_sec,
      cleanSegmentCount: r.clean_segment_count,
      cleanChunkCount: r.clean_chunk_count,
      minimumChunkSimilarity: r.minimum_chunk_similarity,
      meanChunkSimilarity: r.mean_chunk_similarity,
      referenceInterval: {
        startTime: r.reference_start_sec,
        endTime: r.reference_end_sec,
        excerpt: r.reference_excerpt,
      },
      provenance,
      isEligibleForEnrollment: true,
    };
  });
}

export function enrollSpeakerVoice(
  params: {
    personId: string;
    sourceMeetingId: string;
    sourceRevision: string;
    speaker: string;
    candidateDigest: string;
  },
  dbInstance?: Database.Database,
): SpeakerVoiceEnrollment {
  const d = getDb(dbInstance);
  const candidate = d
    .prepare(
      `SELECT * FROM meeting_speaker_candidates
       WHERE meeting_id = ? AND speaker = ? AND source_revision = ? AND candidate_digest = ?`,
    )
    .get(
      params.sourceMeetingId,
      params.speaker,
      params.sourceRevision,
      params.candidateDigest,
    ) as
    | {
        meeting_id: string;
        speaker: string;
        source_revision: string;
        candidate_digest: string;
        embedding_json: string;
        clean_duration_sec: number;
        clean_segment_count: number;
        clean_chunk_count: number;
        minimum_chunk_similarity: number;
        mean_chunk_similarity: number;
        reference_start_sec: number;
        reference_end_sec: number;
        reference_excerpt: string;
        provenance_json: string;
        created_at: string;
      }
    | undefined;

  if (!candidate) {
    throw new Error('speaker_candidate_not_found');
  }

  const existing = d
    .prepare(
      `SELECT id, created_at FROM speaker_voice_enrollments
       WHERE person_id = ? AND source_meeting_id = ? AND source_revision = ?
         AND speaker = ? AND candidate_digest = ?
       LIMIT 1`,
    )
    .get(
      params.personId,
      params.sourceMeetingId,
      params.sourceRevision,
      params.speaker,
      params.candidateDigest,
    ) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    d.prepare(
      `INSERT INTO speaker_voice_enrollments (
        id, person_id, source_meeting_id, source_revision, speaker,
        embedding_json, chunk_count, clean_duration_sec,
        minimum_chunk_similarity, mean_chunk_similarity,
        reference_start_sec, reference_end_sec, reference_excerpt,
        provenance_json, candidate_digest, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, CURRENT_TIMESTAMP
      )`,
    ).run(
      id,
      params.personId,
      params.sourceMeetingId,
      params.sourceRevision,
      params.speaker,
      candidate.embedding_json,
      candidate.clean_chunk_count,
      candidate.clean_duration_sec,
      candidate.minimum_chunk_similarity,
      candidate.mean_chunk_similarity,
      candidate.reference_start_sec,
      candidate.reference_end_sec,
      candidate.reference_excerpt,
      candidate.provenance_json,
      params.candidateDigest,
    );
  }

  const row =
    existing ??
    (d
      .prepare('SELECT created_at FROM speaker_voice_enrollments WHERE id = ?')
      .get(id) as { created_at: string });

  return {
    id,
    personId: params.personId,
    sourceMeetingId: params.sourceMeetingId,
    sourceRevision: params.sourceRevision,
    speaker: params.speaker,
    embedding: JSON.parse(candidate.embedding_json),
    chunkCount: candidate.clean_chunk_count,
    cleanDurationSeconds: candidate.clean_duration_sec,
    minimumChunkSimilarity: candidate.minimum_chunk_similarity,
    meanChunkSimilarity: candidate.mean_chunk_similarity,
    referenceInterval: {
      startTime: candidate.reference_start_sec,
      endTime: candidate.reference_end_sec,
      excerpt: candidate.reference_excerpt,
    },
    provenance: JSON.parse(candidate.provenance_json),
    candidateDigest: params.candidateDigest,
    createdAt: row?.created_at || new Date().toISOString(),
  };
}

export function getCanonicalVoiceProfiles(options?: {
  dbInstance?: Database.Database;
  activeOnly?: boolean;
}): CanonicalVoiceProfile[] {
  const d = getDb(options?.dbInstance);
  const rows = d
    .prepare(
      `SELECT * FROM speaker_voice_enrollments
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string;
    person_id: string;
    source_meeting_id: string;
    source_revision: string;
    speaker: string;
    embedding_json: string;
    chunk_count: number;
    clean_duration_sec: number;
    minimum_chunk_similarity: number;
    mean_chunk_similarity: number;
    reference_start_sec: number;
    reference_end_sec: number;
    reference_excerpt: string;
    provenance_json: string;
    candidate_digest: string;
    created_at: string;
  }>;

  const grouped = new Map<
    string,
    Array<{
      enrollment: (typeof rows)[0];
      embedding: number[];
      provenance: SpeakerCandidateProvenance;
    }>
  >();

  for (const r of rows) {
    const canonicalId = resolvePersonId(r.person_id, d);
    let group = grouped.get(canonicalId);
    if (!group) {
      group = [];
      grouped.set(canonicalId, group);
    }
    group.push({
      enrollment: r,
      embedding: JSON.parse(r.embedding_json),
      provenance: JSON.parse(r.provenance_json),
    });
  }

  const profiles: CanonicalVoiceProfile[] = [];

  for (const [canonicalPersonId, entries] of grouped.entries()) {
    const setting = d
      .prepare(
        'SELECT is_active FROM speaker_voice_profile_settings WHERE person_id = ?',
      )
      .get(canonicalPersonId) as { is_active: number } | undefined;
    const isActive = setting ? setting.is_active === 1 : true;

    if (options?.activeOnly && !isActive) {
      continue;
    }

    let totalDuration = 0;
    const sumEmbedding = new Array(256).fill(0);

    for (const entry of entries) {
      const duration = entry.enrollment.clean_duration_sec;
      totalDuration += duration;
      const weight = duration > 0 ? duration : 1.0;
      for (let i = 0; i < 256; i++) {
        sumEmbedding[i] += entry.embedding[i] * weight;
      }
    }

    let normSq = 0;
    for (let i = 0; i < 256; i++) {
      normSq += sumEmbedding[i] * sumEmbedding[i];
    }
    const norm = Math.sqrt(normSq);
    const centroid = new Array(256).fill(0);
    if (norm > 1e-9) {
      for (let i = 0; i < 256; i++) {
        centroid[i] = sumEmbedding[i] / norm;
      }
    }

    // Best reference interval: largest clean duration, tiebreak newest created_at
    const sortedEntries = [...entries].sort((a, b) => {
      const durDiff =
        b.enrollment.clean_duration_sec - a.enrollment.clean_duration_sec;
      if (Math.abs(durDiff) > 1e-5) return durDiff;
      return (
        new Date(b.enrollment.created_at).getTime() -
        new Date(a.enrollment.created_at).getTime()
      );
    });

    const best = sortedEntries[0];
    const entity = d
      .prepare('SELECT name FROM entities WHERE id = ?')
      .get(canonicalPersonId) as { name: string } | undefined;
    const personName = entity?.name ?? canonicalPersonId;

    profiles.push({
      canonicalPersonId,
      personName,
      sampleCount: entries.length,
      cleanDurationSeconds: totalDuration,
      isActive,
      embedding: centroid,
      referenceInterval: {
        startTime: best.enrollment.reference_start_sec,
        endTime: best.enrollment.reference_end_sec,
        excerpt: best.enrollment.reference_excerpt,
        sourceMeetingId: best.enrollment.source_meeting_id,
      },
      provenance: best.provenance,
    });
  }

  return profiles;
}

export function setVoiceProfileStatus(
  personId: string,
  isActive: boolean,
  dbInstance?: Database.Database,
): void {
  const d = getDb(dbInstance);
  const canonicalId = resolvePersonId(personId, d);
  d.prepare(
    `INSERT INTO speaker_voice_profile_settings (person_id, is_active, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(person_id) DO UPDATE SET
       is_active = excluded.is_active,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(canonicalId, isActive ? 1 : 0);
}

export function deleteVoiceProfile(
  personId: string,
  dbInstance?: Database.Database,
): void {
  const d = getDb(dbInstance);
  const aliasExists = d
    .prepare(
      `SELECT 1 FROM person_aliases
       WHERE (person_id = ? OR canonical_id = ?) AND active = 1
       LIMIT 1`,
    )
    .get(personId, personId);

  if (aliasExists) {
    throw new Error(
      'Restore this person merge before permanently deleting voice samples.',
    );
  }

  d.transaction(() => {
    d.prepare('DELETE FROM speaker_voice_enrollments WHERE person_id = ?').run(
      personId,
    );
    d.prepare(
      'DELETE FROM speaker_voice_profile_settings WHERE person_id = ?',
    ).run(personId);
  })();
}

export function recordVoiceRejection(
  params: {
    meetingId: string;
    speaker: string;
    sourceRevision: string;
    candidateDigest: string;
    personId: string;
  },
  dbInstance?: Database.Database,
): void {
  const d = getDb(dbInstance);
  d.prepare(
    `INSERT OR REPLACE INTO speaker_voice_rejections (
      meeting_id, speaker, source_revision, candidate_digest, person_id, created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    params.meetingId,
    params.speaker,
    params.sourceRevision,
    params.candidateDigest,
    params.personId,
  );
}

export function getVoiceRejections(
  meetingId: string,
  dbInstance?: Database.Database,
): SpeakerVoiceRejection[] {
  const d = getDb(dbInstance);
  const rows = d
    .prepare(
      `SELECT meeting_id, speaker, source_revision, candidate_digest, person_id, created_at
       FROM speaker_voice_rejections
       WHERE meeting_id = ?`,
    )
    .all(meetingId) as Array<{
    meeting_id: string;
    speaker: string;
    source_revision: string;
    candidate_digest: string;
    person_id: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    meetingId: r.meeting_id,
    speaker: r.speaker,
    sourceRevision: r.source_revision,
    candidateDigest: r.candidate_digest,
    personId: r.person_id,
    createdAt: r.created_at,
  }));
}
