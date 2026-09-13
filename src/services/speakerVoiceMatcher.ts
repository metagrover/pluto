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
    modelRevision: '1ed7a662fdc7109e36d822db793ee6eebdaf8594',
    artifactDigest:
      'e0b6b63bdb2a12d087031067d61600f5e2b6b9a26f9c9e511118d2a6206349cd',
    runtimeVersion: 'fluidaudio-0.15.5',
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
  | 'no_candidate'
  | 'no_profile'
  | 'below_threshold'
  | 'ambiguous'
  | 'impure'
  | 'incompatible'
  | 'rejected_for_candidate'
  | 'disabled';

export type VoiceMatchOutcome =
  | { category: 'suggested'; suggestion: VoiceMatchSuggestion }
  | { category: Exclude<MatchOutcomeCategory, 'suggested' | 'no_candidate'> };

type MatchSpeakerVoiceInput = {
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
};

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

const representativeSimilarity = (
  candidate: SpeakerCandidateEvidence,
  profile: CanonicalVoiceProfile,
): number => {
  const candidateRepresentatives = candidate.representativeEmbeddings ?? [];
  const profileRepresentatives = profile.representativeEmbeddings ?? [];
  if (
    candidateRepresentatives.length === 0 ||
    profileRepresentatives.length < 2
  ) {
    return 0;
  }
  const profileSupport = profileRepresentatives
    .map((profileEmbedding) =>
      Math.max(
        ...candidateRepresentatives.map((candidateEmbedding) =>
          cosineSimilarity(profileEmbedding, candidateEmbedding),
        ),
      ),
    )
    .sort((left, right) => right - left);
  return profileSupport[1] ?? 0;
};

export function matchSpeakerVoiceOutcome(
  input: MatchSpeakerVoiceInput,
): VoiceMatchOutcome {
  const featureFlagEnabled = input.options?.featureFlagEnabled ?? false;
  if (!featureFlagEnabled) {
    return { category: 'disabled' };
  }

  const policy = input.options?.policy ?? DEFAULT_CALIBRATION_POLICY_V1;
  if (!policy.enabled) {
    return { category: 'disabled' };
  }

  // Purity gate
  if (!isCandidateEligibleForEnrollment(input.candidate)) {
    return { category: 'impure' };
  }

  // Candidate provenance compatibility
  if (
    !isProvenanceCompatible(input.candidate.provenance, policy.compatibilityKey)
  ) {
    return { category: 'incompatible' };
  }

  if (input.profiles.length === 0) return { category: 'no_profile' };

  const compatibleProfiles = input.profiles.filter((profile) => {
    if (!profile.isActive) return false;
    if (!isProvenanceCompatible(profile.provenance, policy.compatibilityKey)) {
      return false;
    }

    return true;
  });
  if (compatibleProfiles.length === 0) return { category: 'incompatible' };

  // A rejection applies only to this exact candidate/profile pair. Other
  // compatible profiles remain eligible for independent acoustic comparison.
  const eligibleProfiles = compatibleProfiles.filter((profile) => {
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
    return { category: 'rejected_for_candidate' };
  }

  // Score all eligible profiles
  const scored = eligibleProfiles.map((profile) => ({
    profile,
    score: Math.max(
      cosineSimilarity(input.candidate.embedding, profile.embedding),
      representativeSimilarity(input.candidate, profile),
    ),
  }));

  // Order strictly by acoustic similarity descending
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top.score < policy.minAbsoluteSimilarity) {
    return { category: 'below_threshold' };
  }

  if (scored.length > 1) {
    const runnerUp = scored[1];
    const margin = top.score - runnerUp.score;
    if (margin < policy.minRunnerUpMargin) {
      return { category: 'ambiguous' };
    }
  }

  const calendarSet =
    input.calendarAttendeePersonIds instanceof Set
      ? input.calendarAttendeePersonIds
      : new Set(input.calendarAttendeePersonIds ?? []);

  const isCalendarAttendee = calendarSet.has(top.profile.canonicalPersonId);

  return {
    category: 'suggested',
    suggestion: {
      speaker: input.candidate.speaker,
      suggestedPersonId: top.profile.canonicalPersonId,
      suggestedPersonName: top.profile.personName,
      similarityScore: top.score,
      confidenceTier: 'strong',
      isCalendarAttendee,
      candidateDigest: input.candidate.candidateDigest,
      sourceRevision: input.sourceRevision,
      referenceInterval: top.profile.referenceInterval,
    },
  };
}

export function matchSpeakerVoice(
  input: MatchSpeakerVoiceInput,
): VoiceMatchSuggestion | null {
  const outcome = matchSpeakerVoiceOutcome(input);
  return outcome.category === 'suggested' ? outcome.suggestion : null;
}
