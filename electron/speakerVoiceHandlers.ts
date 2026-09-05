import type Database from 'better-sqlite3';
import { matchSpeakerVoice } from '../src/services/speakerVoiceMatcher';
import * as db from './db';
import {
  deleteVoiceProfile,
  enrollSpeakerVoice,
  getCanonicalVoiceProfiles,
  getMeetingSpeakerCandidates,
  getVoiceRejections,
  recordVoiceRejection,
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
}

export async function handleSpeakerVoiceRequest(
  channel: SpeakerVoiceChannel,
  payload: any,
  deps?: SpeakerVoiceDependencies,
): Promise<unknown> {
  const d = deps?.dbInstance ?? db.db;

  switch (channel) {
    case 'SPEAKER_VOICE_GET_SUGGESTIONS': {
      const isEnabled =
        deps?.isFeatureFlagEnabled?.() ??
        (db.getSetting('voice_profile_suggestions_v1') === 'true' ||
          process.env.VOICE_PROFILE_SUGGESTIONS_V1 === 'true');

      if (!isEnabled) {
        return { suggestions: {} };
      }

      const meetingId = String(payload?.meetingId ?? '');
      if (!meetingId) {
        return { suggestions: {} };
      }

      const candidates = getMeetingSpeakerCandidates(meetingId, d);
      const profiles = getCanonicalVoiceProfiles({
        dbInstance: d,
        activeOnly: true,
      });
      const rejections = getVoiceRejections(meetingId, d);

      const suggestions: Record<string, unknown> = {};

      for (const candidate of candidates) {
        const match = matchSpeakerVoice({
          meetingId,
          sourceRevision: payload?.sourceRevision ?? 'gen-1',
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

      return { suggestions };
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

      const candidateRow = d
        .prepare(
          `SELECT candidate_digest FROM meeting_speaker_candidates
           WHERE meeting_id = ? AND speaker = ? AND source_revision = ?`,
        )
        .get(sourceMeetingId, speaker, sourceRevision) as
        | { candidate_digest: string }
        | undefined;

      if (!candidateRow || candidateRow.candidate_digest !== candidateDigest) {
        throw new Error('speaker_candidate_stale');
      }

      const enrollment = enrollSpeakerVoice(
        {
          personId,
          sourceMeetingId,
          sourceRevision,
          speaker,
          candidateDigest,
        },
        d,
      );

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
      if (!meeting?.audio_path) {
        return null;
      }

      const fileExists = deps?.fileExists ?? require('node:fs').existsSync;
      if (!fileExists(meeting.audio_path)) {
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
        inputPath: meeting.audio_path,
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
