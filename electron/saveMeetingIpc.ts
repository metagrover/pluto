type ParticipantBearingMeeting = {
  id: unknown;
  participants?: unknown;
};

type ParticipantEntity = {
  id: string;
};

export type SaveMeetingFailureDiagnostic = {
  meetingId: string | null;
  validationRunId: string | null;
  downstreamRunId: string | null;
  operation:
    | 'claim_validation'
    | 'save_validation_result'
    | 'save_downstream_result'
    | 'save_meeting';
  reason: string;
  rollback: 'transaction_rolled_back';
};

export const buildSaveMeetingFailureDiagnostic = (input: {
  meetingId: unknown;
  expectedValidationRunId: string | null;
  expectedDownstreamRunId: string | null;
  claimValidationLease: unknown;
  transcriptOwnedFieldsOnly: unknown;
  error: unknown;
}): SaveMeetingFailureDiagnostic => ({
  meetingId: input.meetingId == null ? null : String(input.meetingId),
  validationRunId:
    input.expectedValidationRunId ??
    (input.claimValidationLease &&
    typeof input.claimValidationLease === 'object' &&
    typeof (input.claimValidationLease as { runId?: unknown }).runId ===
      'string'
      ? (input.claimValidationLease as { runId: string }).runId
      : null),
  downstreamRunId: input.expectedDownstreamRunId,
  operation: input.expectedDownstreamRunId
    ? 'save_downstream_result'
    : input.claimValidationLease
      ? 'claim_validation'
      : input.expectedValidationRunId
        ? 'save_validation_result'
        : 'save_meeting',
  reason: input.error instanceof Error ? input.error.message : 'unknown',
  rollback: 'transaction_rolled_back',
});

export const saveMeetingWithParticipantSideEffects = <Result>(params: {
  meeting: ParticipantBearingMeeting;
  saveMeeting: () => Result;
  upsertEntity: (input: {
    type: 'person';
    name: string;
    status: 'active';
  }) => ParticipantEntity;
  addMeetingEntity: (input: {
    meeting_id: string;
    entity_id: string;
    mention_count: number;
    context: 'Manual participant';
  }) => unknown;
}): Result => {
  const result = params.saveMeeting();
  if (result === false || !Array.isArray(params.meeting.participants)) {
    return result;
  }

  console.log(
    `[Pluto] Processing ${params.meeting.participants.length} manual participants...`,
  );
  for (const name of params.meeting.participants as string[]) {
    if (!name || !name.trim()) continue;

    try {
      const entity = params.upsertEntity({
        type: 'person',
        name: name.trim(),
        status: 'active',
      });
      params.addMeetingEntity({
        meeting_id: String(params.meeting.id),
        entity_id: entity.id,
        mention_count: 1,
        context: 'Manual participant',
      });
    } catch (error) {
      console.error(`[Pluto] Failed to process participant: ${name}`, error);
    }
  }

  return result;
};
