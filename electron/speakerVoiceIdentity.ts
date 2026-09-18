import {
  ENROLLMENT_EXTRACTION_VERSION,
  type SpeakerCandidateEvidence,
} from '../src/services/speakerCandidateEvidence';
import {
  type VoiceProfileCalibrationPolicy,
  matchSpeakerVoiceOutcome,
} from '../src/services/speakerVoiceMatcher';
import type { IdentityBinding } from '../src/types/identity';
import type {
  CanonicalVoiceProfile,
  SpeakerVoiceRejection,
} from './speakerVoiceStore';

export const VOICE_MATCH_STRONG_ASSIGNMENT = 'voice_match_strong_v1' as const;

export type SpeakerVoiceCandidateInput = SpeakerCandidateEvidence & {
  sourceRevision?: string;
};

export type PlannedVoiceMatchAssignment = {
  speaker: string;
  personId: string;
  similarityScore: number;
  candidateDigest: string;
  sourceRevision: string;
};

export type VoiceMatchSpeakerBindingPlan =
  | {
      status: 'bind';
      assignments: PlannedVoiceMatchAssignment[];
      abstentions: Array<{ speaker: string; reason: string }>;
    }
  | {
      status: 'abstain';
      reason: string;
      abstentions: Array<{ speaker: string; reason: string }>;
    };

export const planVoiceMatchSpeakerAssignments = (input: {
  meetingId: string;
  candidates: SpeakerVoiceCandidateInput[];
  profiles: CanonicalVoiceProfile[];
  rejections: SpeakerVoiceRejection[];
  existingBindings: IdentityBinding[];
  isAutomaticBindingSuppressed: (
    speaker: string,
    assignment: string,
  ) => boolean;
  calendarAttendeePersonIds?: Set<string> | string[];
  options?: {
    policy?: VoiceProfileCalibrationPolicy;
    featureFlagEnabled?: boolean;
  };
}): VoiceMatchSpeakerBindingPlan => {
  if (input.candidates.length === 0) {
    return { status: 'abstain', reason: 'no_candidates', abstentions: [] };
  }
  if (input.profiles.length === 0) {
    return { status: 'abstain', reason: 'no_profiles', abstentions: [] };
  }

  const boundSpeakers = new Set(
    input.existingBindings
      .filter((binding) => Boolean(binding.personId))
      .map((binding) => binding.speaker),
  );

  const boundPersonIds = new Set(
    input.existingBindings
      .map((binding) => binding.personId)
      .filter((id): id is string => Boolean(id)),
  );

  const abstentions: Array<{ speaker: string; reason: string }> = [];
  const candidateMatches: PlannedVoiceMatchAssignment[] = [];

  for (const candidate of input.candidates) {
    if (boundSpeakers.has(candidate.speaker)) {
      continue;
    }

    if (
      input.isAutomaticBindingSuppressed(
        candidate.speaker,
        VOICE_MATCH_STRONG_ASSIGNMENT,
      )
    ) {
      abstentions.push({ speaker: candidate.speaker, reason: 'suppressed' });
      continue;
    }

    if (
      candidate.provenance?.enrollmentExtractionVersion &&
      candidate.provenance.enrollmentExtractionVersion !==
        ENROLLMENT_EXTRACTION_VERSION
    ) {
      abstentions.push({
        speaker: candidate.speaker,
        reason: 'incompatible_extraction',
      });
      continue;
    }

    const sourceRevision = candidate.sourceRevision ?? '';
    const outcome = matchSpeakerVoiceOutcome({
      meetingId: input.meetingId,
      sourceRevision,
      candidate,
      profiles: input.profiles,
      rejections: input.rejections,
      calendarAttendeePersonIds: input.calendarAttendeePersonIds,
      options: {
        featureFlagEnabled: input.options?.featureFlagEnabled ?? true,
        policy: input.options?.policy,
      },
    });

    if (outcome.category !== 'suggested') {
      abstentions.push({
        speaker: candidate.speaker,
        reason: outcome.category,
      });
      continue;
    }

    const suggestion = outcome.suggestion;
    if (boundPersonIds.has(suggestion.suggestedPersonId)) {
      abstentions.push({
        speaker: candidate.speaker,
        reason: 'person_already_bound',
      });
      continue;
    }

    candidateMatches.push({
      speaker: candidate.speaker,
      personId: suggestion.suggestedPersonId,
      similarityScore: suggestion.similarityScore,
      candidateDigest: suggestion.candidateDigest,
      sourceRevision,
    });
  }

  if (candidateMatches.length === 0) {
    return { status: 'abstain', reason: 'no_strong_matches', abstentions };
  }

  // Intra-meeting collision guardrail:
  // If multiple candidates in the same meeting match the same personId,
  // abstain on all of them to prevent assigning one person to two distinct voices.
  const byPerson = new Map<string, PlannedVoiceMatchAssignment[]>();
  for (const match of candidateMatches) {
    const list = byPerson.get(match.personId) ?? [];
    list.push(match);
    byPerson.set(match.personId, list);
  }

  const validAssignments: PlannedVoiceMatchAssignment[] = [];
  for (const [, matches] of byPerson) {
    if (matches.length > 1) {
      for (const m of matches) {
        abstentions.push({
          speaker: m.speaker,
          reason: 'duplicate_person_match_in_meeting',
        });
      }
    } else {
      validAssignments.push(matches[0]);
    }
  }

  if (validAssignments.length === 0) {
    return { status: 'abstain', reason: 'all_matches_collided', abstentions };
  }

  return {
    status: 'bind',
    assignments: validAssignments,
    abstentions,
  };
};

export const reconcileVoiceMatchSpeakerIdentity = (input: {
  meetingId: string;
  getCandidates: (meetingId: string) => SpeakerVoiceCandidateInput[];
  getProfiles: () => CanonicalVoiceProfile[];
  getRejections: (meetingId: string) => SpeakerVoiceRejection[];
  getBindings: (meetingId: string) => IdentityBinding[];
  isAutomaticBindingSuppressed: (
    meetingId: string,
    speaker: string,
    assignment: string,
  ) => boolean;
  setBinding: (meetingId: string, binding: IdentityBinding) => unknown;
  ensureMeetingEntity?: (params: {
    meeting_id: string;
    entity_id: string;
    context?: string;
  }) => unknown;
  calendarAttendeePersonIds?: Set<string> | string[];
  options?: {
    policy?: VoiceProfileCalibrationPolicy;
    featureFlagEnabled?: boolean;
  };
}): VoiceMatchSpeakerBindingPlan => {
  const candidates = input.getCandidates(input.meetingId);
  const profiles = input.getProfiles();
  const rejections = input.getRejections(input.meetingId);
  const bindings = input.getBindings(input.meetingId);

  const plan = planVoiceMatchSpeakerAssignments({
    meetingId: input.meetingId,
    candidates,
    profiles,
    rejections,
    existingBindings: bindings,
    isAutomaticBindingSuppressed: (speaker, assignment) =>
      input.isAutomaticBindingSuppressed(input.meetingId, speaker, assignment),
    calendarAttendeePersonIds: input.calendarAttendeePersonIds,
    options: input.options,
  });

  if (plan.status === 'abstain') {
    return plan;
  }

  for (const assignment of plan.assignments) {
    input.setBinding(input.meetingId, {
      speaker: assignment.speaker,
      personId: assignment.personId,
      individual: true,
      source: 'user',
      sourceRevision: assignment.sourceRevision,
      evidence: [],
      assignment: {
        kind: VOICE_MATCH_STRONG_ASSIGNMENT,
      },
    });

    input.ensureMeetingEntity?.({
      meeting_id: input.meetingId,
      entity_id: assignment.personId,
      context: 'Recognized speaker in meeting',
    });
  }

  return plan;
};
