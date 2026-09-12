import { createHash } from 'node:crypto';
import type { IdentityBinding } from '../src/types/identity';
import { parseTranscriptSegments } from '../src/utils/transcript';

export const MANUAL_PARTICIPANT_CONTEXT = 'Manual participant';
export const MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT =
  'manual_participant_singleton_v1' as const;

type Person = {
  id: string;
  name: string;
};

type MeetingPerson = Person & {
  type: string;
  context: string | null;
};

type MeetingRecord = {
  transcript_json?: string | null;
};

export type SingletonParticipantBindingPlan =
  | {
      status: 'bind';
      speaker: 'Them';
      personId: string;
      sourceRevision: string;
    }
  | {
      status: 'abstain';
      reason:
        | 'meeting_missing'
        | 'not_local_capture'
        | 'participant_count_not_one'
        | 'remote_speaker_not_singleton'
        | 'prior_user_choice';
    };

const transcriptRevision = (transcriptJson: string): string =>
  createHash('sha256').update(transcriptJson).digest('hex');

const parseRemoteDiarization = (
  transcriptJson: string,
): {
  attempted?: unknown;
  input?: unknown;
  applied?: unknown;
  clusterCount?: unknown;
  fallbackReason?: unknown;
} | null => {
  try {
    const parsed = JSON.parse(transcriptJson) as {
      speakerAttribution?: { remoteDiarization?: unknown };
    };
    const remote = parsed?.speakerAttribution?.remoteDiarization;
    return remote && typeof remote === 'object' && !Array.isArray(remote)
      ? remote
      : null;
  } catch {
    return null;
  }
};

export const planSingletonManualParticipantBinding = (input: {
  meeting: MeetingRecord | null | undefined;
  captureOrigin: 'local' | 'imported' | 'unknown';
  selfPersonId: string | null;
  manualParticipants: MeetingPerson[];
  bindings: IdentityBinding[];
  automaticBindingSuppressed: boolean;
}): SingletonParticipantBindingPlan => {
  const transcriptJson = input.meeting?.transcript_json;
  if (!transcriptJson) return { status: 'abstain', reason: 'meeting_missing' };
  if (input.captureOrigin !== 'local') {
    return { status: 'abstain', reason: 'not_local_capture' };
  }

  const participants = new Map<string, MeetingPerson>();
  for (const participant of input.manualParticipants) {
    if (
      participant.type === 'person' &&
      participant.context === MANUAL_PARTICIPANT_CONTEXT &&
      participant.id !== input.selfPersonId
    ) {
      participants.set(participant.id, participant);
    }
  }
  if (participants.size !== 1) {
    return { status: 'abstain', reason: 'participant_count_not_one' };
  }

  const speakers = new Set(
    parseTranscriptSegments(transcriptJson)
      .filter(
        (segment) =>
          typeof segment.text === 'string' && segment.text.trim().length > 0,
      )
      .map((segment) => String(segment.speaker ?? '').trim())
      .filter(Boolean),
  );
  const remote = parseRemoteDiarization(transcriptJson);
  const singleSupportedRemoteVoice =
    speakers.has('Them') &&
    ![...speakers].some((speaker) => /^Remote Speaker \d+$/u.test(speaker)) &&
    remote?.attempted === true &&
    remote.input === 'system_audio' &&
    remote.applied === false &&
    remote.fallbackReason === 'not_enough_speakers' &&
    remote.clusterCount === 1;
  if (!singleSupportedRemoteVoice) {
    return { status: 'abstain', reason: 'remote_speaker_not_singleton' };
  }

  if (
    input.automaticBindingSuppressed ||
    input.bindings.some(
      (binding) =>
        binding.speaker === 'Them' ||
        binding.personId === participants.keys().next().value,
    )
  ) {
    return { status: 'abstain', reason: 'prior_user_choice' };
  }

  return {
    status: 'bind',
    speaker: 'Them',
    personId: participants.keys().next().value!,
    sourceRevision: transcriptRevision(transcriptJson),
  };
};

export const buildMeetingNotesIdentityProjection = (input: {
  transcriptJson: string;
  bindings: IdentityBinding[];
  people: Person[];
}): {
  speakerDisplayNames: Record<string, string>;
  trustedUserTerms: string[];
} => {
  const currentRevision = transcriptRevision(input.transcriptJson);
  const speakers = new Set(
    parseTranscriptSegments(input.transcriptJson).map((segment) =>
      String(segment.speaker ?? '').trim(),
    ),
  );
  const people = new Map(input.people.map((person) => [person.id, person]));
  const speakerDisplayNames: Record<string, string> = {};
  const trustedUserTerms: string[] = [];
  const seenNames = new Set<string>();

  for (const binding of input.bindings) {
    if (
      !binding.personId ||
      !speakers.has(binding.speaker) ||
      (binding.source !== 'user' && binding.sourceRevision !== currentRevision)
    ) {
      continue;
    }
    const name = people.get(binding.personId)?.name.trim();
    if (!name) continue;
    speakerDisplayNames[binding.speaker] = name;
    const key = name.toLocaleLowerCase('en-US');
    if (!seenNames.has(key)) {
      seenNames.add(key);
      trustedUserTerms.push(name);
    }
  }

  return { speakerDisplayNames, trustedUserTerms };
};

export const reconcileSingletonManualParticipantIdentity = (input: {
  meetingId: string;
  getMeeting: (meetingId: string) => MeetingRecord | null | undefined;
  getMeetingEntities: (meetingId: string) => MeetingPerson[];
  getCapture: (meetingId: string) => {
    origin: 'local' | 'imported' | 'unknown';
    selfPersonId: string | null;
  };
  getSelfPersonId: () => string | null;
  getBindings: (meetingId: string) => IdentityBinding[];
  isAutomaticBindingSuppressed: (
    meetingId: string,
    speaker: string,
    assignment: typeof MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT,
  ) => boolean;
  setBinding: (meetingId: string, binding: IdentityBinding) => unknown;
}): SingletonParticipantBindingPlan => {
  const capture = input.getCapture(input.meetingId);
  const plan = planSingletonManualParticipantBinding({
    meeting: input.getMeeting(input.meetingId),
    captureOrigin: capture.origin,
    selfPersonId: capture.selfPersonId ?? input.getSelfPersonId(),
    manualParticipants: input.getMeetingEntities(input.meetingId),
    bindings: input.getBindings(input.meetingId),
    automaticBindingSuppressed: input.isAutomaticBindingSuppressed(
      input.meetingId,
      'Them',
      MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT,
    ),
  });
  if (plan.status === 'abstain') return plan;

  input.setBinding(input.meetingId, {
    speaker: plan.speaker,
    personId: plan.personId,
    individual: true,
    source: 'user',
    sourceRevision: plan.sourceRevision,
    evidence: [],
    assignment: { kind: MANUAL_PARTICIPANT_SINGLETON_ASSIGNMENT },
  });
  return plan;
};
