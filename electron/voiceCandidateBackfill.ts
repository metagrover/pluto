import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ENROLLMENT_EXTRACTION_VERSION } from '../src/services/speakerCandidateEvidence';
import {
  type EnrollmentMeeting,
  getSpeakerEnrollmentAvailability,
} from './speakerEnrollmentCandidate';

export const VOICE_BACKFILL_REQUEST = 'voice-candidate-backfill-request.json';
export const VOICE_BACKFILL_REPORT = 'voice-candidate-backfill-report.json';

type MeetingResult = {
  status: 'pending' | 'current' | 'evidence_unavailable' | 'no_usable_source';
  speakers: Record<string, string>;
};

// Read only metadata here. Extraction and persistence stay in the normal voice
// queue, including its source checks, opt-outs, cancellation and admission gate.
export function inspectVoiceBackfillMeeting(
  db: Database.Database,
  meetingId: string,
  fileExists: (file: string) => boolean = fs.existsSync,
): MeetingResult {
  const meeting = db
    .prepare('SELECT * FROM meetings WHERE id = ?')
    .get(meetingId) as EnrollmentMeeting | undefined;
  const availability = getSpeakerEnrollmentAvailability(meetingId, {
    getMeeting: () => meeting,
    fileExists,
  });
  const candidates = db
    .prepare(`SELECT speaker,
    json_extract(provenance_json, '$.enrollmentExtractionVersion') AS version
    FROM meeting_speaker_candidates WHERE meeting_id = ? AND source_revision = ?
      AND json_valid(provenance_json)`)
    .all(meetingId, meeting?.capture_journal_generation ?? '') as Array<{
    speaker: string;
    version: string | null;
  }>;
  const attempts = db
    .prepare(`SELECT speaker, status FROM speaker_voice_candidate_attempts
    WHERE meeting_id = ? AND source_revision = ? AND extraction_version = ?`)
    .all(
      meetingId,
      meeting?.capture_journal_generation ?? '',
      ENROLLMENT_EXTRACTION_VERSION,
    ) as Array<{ speaker: string; status: string }>;
  const speakers: Record<string, string> = {};
  for (const [speaker, available] of Object.entries(availability)) {
    if (!available) {
      speakers[speaker] = 'no_usable_source';
    } else if (
      candidates.some(
        (row) =>
          row.speaker === speaker &&
          row.version === ENROLLMENT_EXTRACTION_VERSION,
      )
    ) {
      speakers[speaker] = 'current';
    } else {
      speakers[speaker] =
        attempts.find((row) => row.speaker === speaker)?.status === 'abstained'
          ? 'evidence_unavailable'
          : 'pending';
    }
  }
  const states = Object.values(speakers);
  return {
    status: states.includes('pending')
      ? 'pending'
      : states.includes('evidence_unavailable')
        ? 'evidence_unavailable'
        : states.includes('current')
          ? 'current'
          : 'no_usable_source',
    speakers,
  };
}

export function startVoiceCandidateBackfill(options: {
  directory: string;
  db: Database.Database;
  enqueue: (meetingId: string) => void;
  pending: () => string[];
  diagnostics: () => unknown;
  onError: (error: unknown) => void;
}) {
  let requestId: string | undefined;
  let ids: string[] = [];
  let cursor = 0;
  let results: Record<string, MeetingResult> = {};
  let complete = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    try {
      const requestPath = path.join(options.directory, VOICE_BACKFILL_REQUEST);
      if (!fs.existsSync(requestPath)) return;
      const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
      if (
        request.version !== ENROLLMENT_EXTRACTION_VERSION ||
        typeof request.requestId !== 'string'
      )
        return;
      if (requestId !== request.requestId) {
        requestId = request.requestId;
        // Recompute on startup from durable candidate/attempt records, never
        // trust a prior report as evidence that extraction actually finished.
        ids = (
          options.db
            .prepare(`SELECT m.id FROM meetings m
          WHERE COALESCE(m.audio_path, '') != '' OR COALESCE(m.system_audio_path, '') != ''
          ORDER BY EXISTS (SELECT 1 FROM identity_bindings b WHERE b.meeting_id = m.id) DESC,
            m.started_at DESC`)
            .all() as Array<{ id: string }>
        ).map((row) => row.id);
        cursor = 0;
        results = {};
        complete = false;
      }
      if (complete) return;
      // One source per tick avoids scanning every transcript on the main loop.
      if (ids.length) {
        const id = ids[cursor];
        const result = inspectVoiceBackfillMeeting(options.db, id);
        results[id] = result;
        if (result.status === 'pending' && !options.pending().includes(id))
          options.enqueue(id);
        cursor = (cursor + 1) % ids.length;
      }
      const counts = Object.values(results).reduce<Record<string, number>>(
        (out, row) => {
          out[row.status] = (out[row.status] ?? 0) + 1;
          return out;
        },
        {},
      );
      complete = Object.keys(results).length === ids.length && !counts.pending;
      const reportPath = path.join(options.directory, VOICE_BACKFILL_REPORT);
      fs.writeFileSync(
        `${reportPath}.tmp`,
        JSON.stringify(
          {
            requestId,
            version: ENROLLMENT_EXTRACTION_VERSION,
            updatedAt: new Date().toISOString(),
            complete,
            total: ids.length,
            scanned: Object.keys(results).length,
            counts,
            diagnostics: options.diagnostics(),
            meetings: results,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      fs.renameSync(`${reportPath}.tmp`, reportPath);
    } catch (error) {
      options.onError(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, 1_000);
        timer.unref();
      }
    }
  };
  timer = setTimeout(tick, 1_000);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
