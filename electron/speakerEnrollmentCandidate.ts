import type { SpeakerCandidateEvidence } from '../src/services/speakerCandidateEvidence';
import { deriveReviewedSpeakerCandidate } from '../src/services/speakerCandidateEvidence';
import type { SpeakerSampleInterval } from '../src/utils/speakerReview';
import { selectSpeakerSampleIntervals } from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';
import type {
  SpeakerEvidenceRequest,
  SpeakerEvidenceResult,
} from './transcription/parakeetFinalClient';

type EnrollmentMeeting = {
  id: string | number;
  transcript_json?: string | null;
  transcript_status?: string | null;
  capture_journal_generation?: string | null;
  system_audio_path?: string | null;
};

export interface SpeakerEnrollmentCandidateDependencies {
  getMeeting: (meetingId: string) => EnrollmentMeeting | null | undefined;
  fileExists: (inputPath: string) => boolean;
  createWorkDir: () => string;
  removeWorkDir: (workDir: string) => Promise<void>;
  createAudio: (input: {
    sourcePath: string;
    intervals: SpeakerSampleInterval[];
    outputDir: string;
  }) => Promise<{
    systemPath: string;
    micPath: string;
    totalDurationSeconds: number;
  } | null>;
  analyze: (
    request: Omit<SpeakerEvidenceRequest, 'signal'>,
  ) => Promise<SpeakerEvidenceResult>;
}

export const buildSpeakerEnrollmentCandidate = async (
  input: { meetingId: string; speaker: string },
  dependencies: SpeakerEnrollmentCandidateDependencies,
): Promise<{
  candidate: SpeakerCandidateEvidence;
  sourceRevision: string;
} | null> => {
  const meeting = dependencies.getMeeting(input.meetingId);
  const sourcePath = meeting?.system_audio_path;
  const sourceRevision = meeting?.capture_journal_generation;
  if (
    !meeting ||
    String(meeting.id) !== input.meetingId ||
    meeting.transcript_status !== 'validated' ||
    typeof sourcePath !== 'string' ||
    !sourcePath ||
    !dependencies.fileExists(sourcePath) ||
    typeof sourceRevision !== 'string' ||
    !sourceRevision
  ) {
    return null;
  }

  const intervals = selectSpeakerSampleIntervals(
    parseTranscriptSegments(meeting.transcript_json),
    input.speaker,
  );
  if (intervals.length !== 2) return null;

  const workDir = dependencies.createWorkDir();
  try {
    const audio = await dependencies.createAudio({
      sourcePath,
      intervals,
      outputDir: workDir,
    });
    if (!audio) return null;
    const evidence = await dependencies.analyze({
      mixedAudioPath: audio.systemPath,
      micAudioPath: audio.micPath,
      systemAudioPath: audio.systemPath,
    });
    const candidate = deriveReviewedSpeakerCandidate({
      speaker: input.speaker,
      clusterEvidence: evidence.clusterEvidence ?? [],
      provenance: evidence.provenance,
      reviewedIntervals: intervals,
    });
    return candidate ? { candidate, sourceRevision } : null;
  } finally {
    await dependencies.removeWorkDir(workDir);
  }
};
