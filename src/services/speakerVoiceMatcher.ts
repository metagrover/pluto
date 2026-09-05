import type {
  CanonicalVoiceProfile,
  SpeakerVoiceRejection,
} from '../../electron/speakerVoiceStore';
import {
  type SpeakerCandidateEvidence,
  type SpeakerCandidateProvenance,
  isCandidateEligibleForEnrollment,
} from './speakerCandidateEvidence';

export interface VoiceProfileCalibrationPolicy {
  policyVersion: string;
  compatibilityKey: {
    modelIdentifier: string;
    modelRevision: string;
    artifactDigest: string;
    runtimeVersion: string;
    profileAlgorithmVersion: string;
  };
  minAbsoluteSimilarity: number;
  minRunnerUpMargin: number;
  enabled: boolean;
}

export const DEFAULT_CALIBRATION_POLICY_V1: VoiceProfileCalibrationPolicy = {
  policyVersion: 'v1',
  compatibilityKey: {
    modelIdentifier: 'speaker-diarization-offline-v1',
    modelRevision: '27741ba0e8354c03b190f898327dcf61a3848148',
    artifactDigest:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    runtimeVersion: 'fluidaudio-v1',
    profileAlgorithmVersion: 'v1',
  },
  minAbsoluteSimilarity: 0.72,
  minRunnerUpMargin: 0.1,
  enabled: true,
};

export interface VoiceMatchSuggestion {
  speaker: string;
  suggestedPersonId: string;
  suggestedPersonName: string;
  similarityScore: number;
  confidenceTier: 'strong';
  isCalendarAttendee: boolean;
  candidateDigest: string;
  sourceRevision: string;
  referenceInterval?: {
    startTime: number;
    endTime: number;
    excerpt: string;
    sourceMeetingId: string;
  };
}

export type MatchOutcomeCategory =
  | 'suggested'
  | 'below_threshold'
  | 'ambiguous'
  | 'impure'
  | 'incompatible'
  | 'rejected_for_candidate'
  | 'disabled';

export function isProvenanceCompatible(
  provenance: SpeakerCandidateProvenance | undefined,
  compatibilityKey: VoiceProfileCalibrationPolicy['compatibilityKey'],
): boolean {
  if (!provenance) return false;
  return (
    provenance.modelIdentifier === compatibilityKey.modelIdentifier &&
    provenance.modelRevision === compatibilityKey.modelRevision &&
    provenance.artifactDigest === compatibilityKey.artifactDigest &&
    provenance.runtimeVersion === compatibilityKey.runtimeVersion &&
    (provenance.profileAlgorithmVersion ?? 'v1') ===
      compatibilityKey.profileAlgorithmVersion
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-9) return 0;
  return dotProduct / denom;
}

export function matchSpeakerVoice(input: {
  meetingId: string;
  sourceRevision: string;
  candidate: SpeakerCandidateEvidence;
  profiles: CanonicalVoiceProfile[];
  rejections: SpeakerVoiceRejection[];
  calendarAttendeePersonIds?: Set<string> | string[];
  options?: {
    policy?: VoiceProfileCalibrationPolicy;
    featureFlagEnabled?: boolean;
  };
}): VoiceMatchSuggestion | null {
  const featureFlagEnabled = input.options?.featureFlagEnabled ?? false;
  if (!featureFlagEnabled) {
    return null;
  }

  const policy = input.options?.policy ?? DEFAULT_CALIBRATION_POLICY_V1;
  if (!policy.enabled) {
    return null;
  }

  // Purity gate
  if (!isCandidateEligibleForEnrollment(input.candidate)) {
    return null;
  }

  // Candidate provenance compatibility
  if (
    !isProvenanceCompatible(input.candidate.provenance, policy.compatibilityKey)
  ) {
    return null;
  }

  // Filter eligible profiles
  const eligibleProfiles = input.profiles.filter((profile) => {
    if (!profile.isActive) return false;
    if (!isProvenanceCompatible(profile.provenance, policy.compatibilityKey)) {
      return false;
    }

    // Check rejection for exact candidate digest
    const isRejected = input.rejections.some(
      (r) =>
        r.meetingId === input.meetingId &&
        r.speaker === input.candidate.speaker &&
        r.sourceRevision === input.sourceRevision &&
        r.candidateDigest === input.candidate.candidateDigest &&
        r.personId === profile.canonicalPersonId,
    );

    return !isRejected;
  });

  if (eligibleProfiles.length === 0) {
    return null;
  }

  // Score all eligible profiles
  const scored = eligibleProfiles.map((profile) => ({
    profile,
    score: cosineSimilarity(input.candidate.embedding, profile.embedding),
  }));

  // Order strictly by acoustic similarity descending
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top.score < policy.minAbsoluteSimilarity) {
    return null;
  }

  if (scored.length > 1) {
    const runnerUp = scored[1];
    const margin = top.score - runnerUp.score;
    if (margin < policy.minRunnerUpMargin) {
      return null;
    }
  }

  const calendarSet =
    input.calendarAttendeePersonIds instanceof Set
      ? input.calendarAttendeePersonIds
      : new Set(input.calendarAttendeePersonIds ?? []);

  const isCalendarAttendee = calendarSet.has(top.profile.canonicalPersonId);

  return {
    speaker: input.candidate.speaker,
    suggestedPersonId: top.profile.canonicalPersonId,
    suggestedPersonName: top.profile.personName,
    similarityScore: top.score,
    confidenceTier: 'strong',
    isCalendarAttendee,
    candidateDigest: input.candidate.candidateDigest,
    sourceRevision: input.sourceRevision,
    referenceInterval: top.profile.referenceInterval,
  };
}
