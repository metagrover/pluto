type ParticipantBearingMeeting = {
  id: unknown;
  participants?: unknown;
};

type ParticipantEntity = {
  id: string;
};

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
