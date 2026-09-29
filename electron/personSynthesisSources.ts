import type { PersonActivityItem } from '../src/utils/personBriefing';

export interface PersonSynthesisSource {
  id: string;
  evidence: string;
  enhanced_notes?: string | null;
  user_notes?: string | null;
  entity_names?: string[];
}

/** A linked meeting is only a source for a person read when its notes describe that person. */
export const focusPersonSynthesisSources = <T extends PersonSynthesisSource>(
  meetings: T[],
  activity: PersonActivityItem[],
  personName: string,
): T[] => {
  const byMeeting = new Map<string, string[]>();
  for (const item of activity) {
    const notes = byMeeting.get(item.meetingId) ?? [];
    notes.push(item.text);
    byMeeting.set(item.meetingId, notes);
  }
  return meetings.flatMap((meeting) => {
    const notes = byMeeting.get(meeting.id);
    return notes?.length
      ? [
          {
            ...meeting,
            evidence: notes.join('\n'),
            enhanced_notes: null,
            user_notes: null,
            entity_names: [personName],
          },
        ]
      : [];
  });
};
