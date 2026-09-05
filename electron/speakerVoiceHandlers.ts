import type Database from 'better-sqlite3';
import type { SpeakerCandidateEvidence } from '../src/services/speakerCandidateEvidence';
import { matchSpeakerVoice } from '../src/services/speakerVoiceMatcher';
import {
  selectReviewableAnonymousSpeakers,
  selectSpeakerSampleIntervals,
} from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';
import * as db from './db';
import {
  deleteVoiceProfile,
  enrollSpeakerVoice,
  getCanonicalVoiceProfiles,
  getMeetingSpeakerCandidates,
  getVoiceRejections,
  recordVoiceRejection,
  resolvePersonId,
  saveMeetingSpeakerCandidate,
  setVoiceProfileStatus,
} from './speakerVoiceStore';

export const SPEAKER_VOICE_CHANNELS = [
  'SPEAKER_VOICE_GET_SUGGESTIONS',
  'SPEAKER_VOICE_ENROLL',
  'SPEAKER_VOICE_REJECT',
  'SPEAKER_VOICE_GET_PROFILES',
  'SPEAKER_VOICE_SET_STATUS',
  'SPEAKER_VOICE_DELETE',
  'SPEAKER_VOICE_GET_REFERENCE_SAMPLE',
] as const;

export type SpeakerVoiceChannel = (typeof SPEAKER_VOICE_CHANNELS)[number];

export interface SpeakerVoiceDependencies {
  dbInstance?: Database.Database;
  isFeatureFlagEnabled?: () => boolean;
  getMeeting?: (meetingId: string) => db.PersistedMeeting | null;
  fileExists?: (path: string) => boolean;
  createTemporaryPath?: () => string;
  sliceWav?: (opts: {
    inputPath: string;
    outputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<boolean>;
  readFile?: (path: string) => Promise<Buffer>;
  removeFile?: (path: string) => Promise<void>;
  buildEnrollmentCandidate?: (input: {
    meetingId: string;
    speaker: string;
  }) => Promise<{
    candidate: SpeakerCandidateEvidence;
    sourceRevision: string;
  } | null>;
}

export async function handleSpeakerVoiceRequest(
  channel: SpeakerVoiceChannel,
  payload: any,
  deps?: SpeakerVoiceDependencies,
): Promise<unknown> {
  const d = deps?.dbInstance ?? db.db;

  switch (channel) {
    case 'SPEAKER_VOICE_GET_SUGGESTIONS': {
      const meetingId = String(payload?.meetingId ?? '');
      if (!meetingId) {
        return {
          suggestions: {},
          candidates: {},
          enrollmentAvailability: {},
        };
      }

      const candidates = getMeetingSpeakerCandidates(meetingId, d);
      const clientCandidates: Record<string, unknown> = {};
      for (const candidate of candidates) {
        clientCandidates[candidate.speaker] = {
          candidateDigest: candidate.candidateDigest,
          sourceRevision: candidate.sourceRevision,
          isEligibleForEnrollment: candidate.isEligibleForEnrollment,
          cleanDurationSeconds: candidate.cleanDurationSeconds,
        };
      }

      const getMeeting =
        deps?.getMeeting ??
        ((id: string) =>
          (db.getMeeting(id) as db.PersistedMeeting | undefined) ?? null);
      const meeting = getMeeting(meetingId);
      const fileExists = deps?.fileExists ?? require('node:fs').existsSync;
      const transcriptSegments = parseTranscriptSegments(
        meeting?.transcript_json,
      );
      const enrollmentAvailability = Object.fromEntries(
        selectReviewableAnonymousSpeakers(
          transcriptSegments.flatMap((segment) =>
            typeof segment.speaker === 'string' ? [segment.speaker] : [],
          ),
        ).map((speaker) => [
          speaker,
          typeof meeting?.system_audio_path === 'string' &&
            fileExists(meeting.system_audio_path) &&
            selectSpeakerSampleIntervals(transcriptSegments, speaker).length ===
              2,
        ]),
      );

      const profiles = getCanonicalVoiceProfiles({
        dbInstance: d,
        activeOnly: true,
      });
      const calibrationFlagEnabled =
        deps?.isFeatureFlagEnabled?.() ??
        (db.getSetting('voice_profile_suggestions_v1') === 'true' ||
          process.env.VOICE_PROFILE_SUGGESTIONS_V1 === 'true');

      // Explicitly enrolling an active profile is the user's opt-in to future
      // recognition. The flag remains available for calibration before any
      // real profile exists, but must not make an enrolled profile inert.
      if (!calibrationFlagEnabled && profiles.length === 0) {
        return {
          suggestions: {},
          candidates: clientCandidates,
          enrollmentAvailability,
        };
      }
      const rejections = getVoiceRejections(meetingId, d);

      const suggestions: Record<string, unknown> = {};

      for (const candidate of candidates) {
        const match = matchSpeakerVoice({
          meetingId,
          sourceRevision: candidate.sourceRevision,
          candidate,
          profiles,
          rejections,
          calendarAttendeePersonIds: payload?.calendarAttendeePersonIds,
          options: { featureFlagEnabled: true },
        });

        if (match) {
          // Exclude raw embeddings completely
          suggestions[candidate.speaker] = {
            speaker: match.speaker,
            suggestedPersonId: match.suggestedPersonId,
            suggestedPersonName: match.suggestedPersonName,
            similarityScore: match.similarityScore,
            confidenceTier: match.confidenceTier,
            isCalendarAttendee: match.isCalendarAttendee,
            candidateDigest: match.candidateDigest,
            sourceRevision: match.sourceRevision,
            referenceInterval: match.referenceInterval,
          };
        }
      }

      return {
        suggestions,
        candidates: clientCandidates,
        enrollmentAvailability,
      };
    }

    case 'SPEAKER_VOICE_ENROLL': {
      const {
        personId,
        sourceMeetingId,
        sourceRevision,
        speaker,
        candidateDigest,
        expectedRevision,
      } = payload ?? {};

      if (
        typeof expectedRevision !== 'number' ||
        db.identityStore.getRevision() !== expectedRevision
      ) {
        throw new Error('identity_revision_stale');
      }

      const canonicalPersonId = resolvePersonId(String(personId ?? ''), d);
      const bindingMatches = () => {
        const binding = db.identityStore
          .getBindings(String(sourceMeetingId ?? ''))
          .find((entry) => entry.speaker === speaker);
        return (
          binding?.source === 'user' &&
          typeof binding.personId === 'string' &&
          resolvePersonId(binding.personId, d) === canonicalPersonId
        );
      };
      if (!bindingMatches()) throw new Error('speaker_enrollment_unconfirmed');

      const suppliedCandidateIdentity =
        typeof sourceRevision === 'string' &&
        sourceRevision.length > 0 &&
        typeof candidateDigest === 'string' &&
        candidateDigest.length > 0;
      if (
        (sourceRevision !== undefined || candidateDigest !== undefined) &&
        !suppliedCandidateIdentity
      ) {
        throw new Error('speaker_candidate_invalid');
      }

      let enrollmentSourceRevision = sourceRevision as string | undefined;
      let enrollmentCandidateDigest = candidateDigest as string | undefined;
      let builtCandidate: SpeakerCandidateEvidence | null = null;

      if (suppliedCandidateIdentity) {
        const candidateRow = d
          .prepare(
            `SELECT candidate_digest FROM meeting_speaker_candidates
             WHERE meeting_id = ? AND speaker = ? AND source_revision = ?`,
          )
          .get(sourceMeetingId, speaker, sourceRevision) as
          | { candidate_digest: string }
          | undefined;

        if (
          !candidateRow ||
          candidateRow.candidate_digest !== candidateDigest
        ) {
          throw new Error('speaker_candidate_stale');
        }
      } else {
        const built = await deps?.buildEnrollmentCandidate?.({
          meetingId: String(sourceMeetingId ?? ''),
          speaker: String(speaker ?? ''),
        });
        if (
          !built?.candidate.isEligibleForEnrollment ||
          built.candidate.speaker !== speaker ||
          !built.sourceRevision
        ) {
          throw new Error('speaker_enrollment_evidence_unavailable');
        }
        if (
          db.identityStore.getRevision() !== expectedRevision ||
          !bindingMatches()
        ) {
          throw new Error('identity_revision_stale');
        }
        builtCandidate = built.candidate;
        enrollmentSourceRevision = built.sourceRevision;
        enrollmentCandidateDigest = built.candidate.candidateDigest;
      }

      if (!enrollmentSourceRevision || !enrollmentCandidateDigest) {
        throw new Error('speaker_enrollment_evidence_unavailable');
      }

      const enrollment = d.transaction(() => {
        if (builtCandidate) {
          saveMeetingSpeakerCandidate(
            String(sourceMeetingId),
            enrollmentSourceRevision,
            builtCandidate,
            d,
          );
        }
        return enrollSpeakerVoice(
          {
            personId: canonicalPersonId,
            sourceMeetingId,
            sourceRevision: enrollmentSourceRevision,
            speaker,
            candidateDigest: enrollmentCandidateDigest,
          },
          d,
        );
      })();

      return { success: true, enrollmentId: enrollment.id };
    }

    case 'SPEAKER_VOICE_REJECT': {
      const { meetingId, speaker, sourceRevision, candidateDigest, personId } =
        payload ?? {};
      recordVoiceRejection(
        {
          meetingId,
          speaker,
          sourceRevision,
          candidateDigest,
          personId,
        },
        d,
      );
      return { success: true };
    }

    case 'SPEAKER_VOICE_GET_PROFILES': {
      const profiles = getCanonicalVoiceProfiles({ dbInstance: d });
      // Strip raw embeddings so biometric data never enters renderer IPC
      const sanitized = profiles.map((p) => ({
        canonicalPersonId: p.canonicalPersonId,
        personName: p.personName,
        sampleCount: p.sampleCount,
        cleanDurationSeconds: p.cleanDurationSeconds,
        isActive: p.isActive,
        referenceInterval: p.referenceInterval,
      }));
      return { profiles: sanitized };
    }

    case 'SPEAKER_VOICE_SET_STATUS': {
      const { personId, isActive } = payload ?? {};
      setVoiceProfileStatus(personId, Boolean(isActive), d);
      return { success: true };
    }

    case 'SPEAKER_VOICE_DELETE': {
      const { personId } = payload ?? {};
      deleteVoiceProfile(personId, d);
      return { success: true };
    }

    case 'SPEAKER_VOICE_GET_REFERENCE_SAMPLE': {
      const { sourceMeetingId, startTime, endTime } = payload ?? {};
      const getMeeting =
        deps?.getMeeting ??
        ((id: string) =>
          (db.getMeeting(id) as db.PersistedMeeting | undefined) ?? null);

      const meeting = getMeeting(sourceMeetingId);
      if (!meeting?.system_audio_path) {
        return null;
      }

      const fileExists = deps?.fileExists ?? require('node:fs').existsSync;
      if (!fileExists(meeting.system_audio_path)) {
        return null;
      }

      if (!deps?.sliceWav || !deps?.readFile || !deps?.createTemporaryPath) {
        return null;
      }

      const tempPath = deps.createTemporaryPath();
      const durationSec = Math.max(
        0.5,
        Math.min(Number(endTime) - Number(startTime), 10),
      );

      const ok = await deps.sliceWav({
        inputPath: meeting.system_audio_path,
        outputPath: tempPath,
        startSec: Math.max(0, Number(startTime)),
        durationSec,
      });

      if (!ok) {
        return null;
      }

      try {
        const buffer = await deps.readFile(tempPath);
        return {
          bytes: new Uint8Array(buffer),
          mimeType: 'audio/wav',
          durationSeconds: durationSec,
        };
      } finally {
        if (deps.removeFile) {
          await deps.removeFile(tempPath).catch(() => {});
        }
      }
    }

    default:
      throw new Error(`unsupported_speaker_voice_channel: ${channel}`);
  }
}
