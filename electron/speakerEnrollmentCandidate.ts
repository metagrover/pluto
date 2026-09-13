import type { SpeakerCandidateEvidence } from '../src/services/speakerCandidateEvidence';
import { deriveReviewedSpeakerCandidate } from '../src/services/speakerCandidateEvidence';
import type { SpeakerSampleInterval } from '../src/utils/speakerReview';
import {
  selectReviewableAnonymousSpeakers,
  selectSpeakerEnrollmentIntervals,
} from '../src/utils/speakerReview';
import { parseTranscriptSegments } from '../src/utils/transcript';
import {
  type TranscriptTrustMeetingFields,
  canUseTranscriptTrustState,
  resolveTranscriptTrustState,
} from '../src/utils/transcriptTrustState';
import type {
  SpeakerEvidenceRequest,
  SpeakerEvidenceResult,
} from './transcription/parakeetFinalClient';

export type EnrollmentMeeting = TranscriptTrustMeetingFields & {
  id: string | number;
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
    signal?: AbortSignal;
  }) => Promise<{
    systemPath: string;
    micPath: string;
    totalDurationSeconds: number;
  } | null>;
  analyze: (
    request: Omit<SpeakerEvidenceRequest, 'signal'>,
  ) => Promise<SpeakerEvidenceResult>;
  signal?: AbortSignal;
}

export interface CandidateConstructionTimings {
  candidateConstructionMs: number;
  initialInferenceMs: number;
  representativeInferencesMs: number[];
}

type SpeakerEnrollmentSourceDependencies = Pick<
  SpeakerEnrollmentCandidateDependencies,
  'getMeeting' | 'fileExists'
>;

type SpeakerEnrollmentBaseSource = {
  sourcePath: string;
  sourceRevision: string;
  transcriptSegments: ReturnType<typeof parseTranscriptSegments>;
};

type SpeakerEnrollmentSource = SpeakerEnrollmentBaseSource & {
  transcriptFingerprint: string;
};

const hasUsableEnrollmentTranscript = (
  meeting: EnrollmentMeeting,
  transcriptSegments: ReturnType<typeof parseTranscriptSegments>,
): boolean => {
  const trustState = resolveTranscriptTrustState(meeting, {
    hasUsableMicArtifact: false,
    hasUsableSystemArtifact: true,
    hasUsableMixArtifact: false,
    hasSupportedActivityEvidence: false,
    micActivitySeconds: 0,
    systemActivitySeconds: 0,
    recoverySource: null,
    hasCaptureRecoveryHandler: false,
    canRestoreCaptureGap: false,
    hasExistingTranscript: transcriptSegments.length > 0,
    hasExistingDerivedArtifacts: false,
    validationMode: 'unavailable',
    canRunValidation: false,
  });
  return canUseTranscriptTrustState(trustState, 'generate_new');
};

export const isSpeakerEnrollmentSourceCurrent = (
  meetingId: string,
  sourceRevision: string,
  dependencies: Pick<SpeakerEnrollmentSourceDependencies, 'getMeeting'>,
): boolean => {
  const meeting = dependencies.getMeeting(meetingId);
  if (
    !meeting ||
    String(meeting.id) !== meetingId ||
    meeting.capture_journal_generation !== sourceRevision
  ) {
    return false;
  }
  return hasUsableEnrollmentTranscript(
    meeting,
    parseTranscriptSegments(meeting.transcript_json),
  );
};

const validateSpeakerEnrollmentBaseSource = (
  meetingId: string,
  meeting: EnrollmentMeeting | null | undefined,
  transcriptSegments: ReturnType<typeof parseTranscriptSegments>,
  fileExists: (inputPath: string) => boolean,
): SpeakerEnrollmentBaseSource | null => {
  const sourcePath = meeting?.system_audio_path;
  const sourceRevision = meeting?.capture_journal_generation;
  if (
    !meeting ||
    String(meeting.id) !== meetingId ||
    typeof sourcePath !== 'string' ||
    !sourcePath ||
    !fileExists(sourcePath) ||
    typeof sourceRevision !== 'string' ||
    !sourceRevision
  ) {
    return null;
  }

  if (!hasUsableEnrollmentTranscript(meeting, transcriptSegments)) return null;

  return {
    sourcePath,
    sourceRevision,
    transcriptSegments,
  };
};

const getSpeakerEnrollmentBaseSource = (
  meetingId: string,
  dependencies: SpeakerEnrollmentSourceDependencies,
): SpeakerEnrollmentSource | null => {
  const meeting = dependencies.getMeeting(meetingId);
  const source = validateSpeakerEnrollmentBaseSource(
    meetingId,
    meeting,
    parseTranscriptSegments(meeting?.transcript_json),
    dependencies.fileExists,
  );
  if (!source || !meeting) return null;
  return {
    ...source,
    transcriptFingerprint: JSON.stringify([
      meeting.transcript_json ?? null,
      meeting.transcript_integrity_json ?? null,
      meeting.transcript_validated_at ?? null,
      source.sourcePath,
      source.sourceRevision,
    ]),
  };
};

export const getSpeakerEnrollmentSource = (
  input: { meetingId: string; speaker: string },
  dependencies: SpeakerEnrollmentSourceDependencies,
): {
  sourcePath: string;
  sourceRevision: string;
  transcriptFingerprint: string;
  intervals: SpeakerSampleInterval[];
} | null => {
  const source = getSpeakerEnrollmentBaseSource(input.meetingId, dependencies);
  if (!source) return null;

  const intervals = selectSpeakerEnrollmentIntervals(
    source.transcriptSegments,
    input.speaker,
  );
  return intervals.length >= 2 ? { ...source, intervals } : null;
};

export const getSpeakerEnrollmentAvailability = (
  meetingId: string,
  dependencies: SpeakerEnrollmentSourceDependencies,
): Record<string, boolean> => {
  const meeting = dependencies.getMeeting(meetingId);
  const transcriptSegments = parseTranscriptSegments(meeting?.transcript_json);
  const source = validateSpeakerEnrollmentBaseSource(
    meetingId,
    meeting,
    transcriptSegments,
    dependencies.fileExists,
  );
  const speakers = selectReviewableAnonymousSpeakers(
    transcriptSegments.flatMap((segment) =>
      typeof segment.speaker === 'string' ? [segment.speaker] : [],
    ),
  );
  return Object.fromEntries(
    speakers.map((speaker) => [
      speaker,
      Boolean(
        source &&
          selectSpeakerEnrollmentIntervals(source.transcriptSegments, speaker)
            .length >= 2,
      ),
    ]),
  );
};

export const buildSpeakerEnrollmentCandidate = async (
  input: { meetingId: string; speaker: string },
  dependencies: SpeakerEnrollmentCandidateDependencies,
): Promise<{
  candidate: SpeakerCandidateEvidence;
  sourceRevision: string;
  timings?: CandidateConstructionTimings;
} | null> => {
  const constructionStart = performance.now();
  let initialInferenceMs = 0;
  const representativeInferencesMs: number[] = [];

  dependencies.signal?.throwIfAborted?.();
  const source = getSpeakerEnrollmentSource(input, dependencies);
  if (!source) return null;
  const { intervals, sourcePath, sourceRevision, transcriptFingerprint } =
    source;

  const workDir = dependencies.createWorkDir();
  try {
    dependencies.signal?.throwIfAborted?.();
    const audio = await dependencies.createAudio({
      sourcePath,
      intervals,
      outputDir: workDir,
      signal: dependencies.signal,
    });
    if (!audio) return null;

    dependencies.signal?.throwIfAborted?.();
    const initInfStart = performance.now();
    const evidence = await dependencies.analyze({
      mixedAudioPath: audio.systemPath,
      micAudioPath: audio.micPath,
      systemAudioPath: audio.systemPath,
    });
    initialInferenceMs = Math.round(performance.now() - initInfStart);

    const candidate = deriveReviewedSpeakerCandidate({
      speaker: input.speaker,
      clusterEvidence: evidence.clusterEvidence ?? [],
      provenance: evidence.provenance,
      reviewedIntervals: intervals,
    });
    const currentSource = getSpeakerEnrollmentSource(input, dependencies);
    if (
      !currentSource ||
      currentSource.transcriptFingerprint !== transcriptFingerprint
    ) {
      return null;
    }
    if (!candidate || (candidate.representativeEmbeddings?.length ?? 0) < 2) {
      return null;
    }
    const finalSource = getSpeakerEnrollmentSource(input, dependencies);
    if (
      !finalSource ||
      finalSource.transcriptFingerprint !== transcriptFingerprint
    ) {
      return null;
    }

    const candidateConstructionMs = Math.round(
      performance.now() - constructionStart,
    );
    const timings: CandidateConstructionTimings = {
      candidateConstructionMs,
      initialInferenceMs,
      representativeInferencesMs,
    };
    console.log('[Pluto][SpeakerVoice] candidate construction completed', {
      meetingId: input.meetingId,
      speaker: input.speaker,
      ...timings,
    });

    return candidate ? { candidate, sourceRevision, timings } : null;
  } finally {
    await dependencies.removeWorkDir(workDir);
  }
};
