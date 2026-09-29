import { parseAnalysisDocumentV3Json } from '../src/utils/analysisDocument';
import {
  type PersonActivityItem,
  type PersonBriefingMeeting,
  selectPersonActivity,
} from '../src/utils/personBriefing';

export interface PersonSynthesisSource {
  id: string;
  evidence: string;
  enhanced_notes?: string | null;
  user_notes?: string | null;
  entity_names?: string[];
}

/** Read beyond the dossier's five recent highlights, without admitting meeting-wide topics. */
export const collectPersonSynthesisActivity = (
  meetings: PersonBriefingMeeting[],
  sources: Array<{ id: string; analysis_json?: string | null }>,
  personName: string,
  recentActivity: PersonActivityItem[],
): PersonActivityItem[] => {
  const sourceIds = new Set(sources.map((source) => source.id));
  const analyses = new Map(
    sources.flatMap((source) => {
      const analysis = parseAnalysisDocumentV3Json(source.analysis_json);
      return analysis ? [[source.id, analysis] as const] : [];
    }),
  );
  return [
    ...selectPersonActivity(
      meetings.filter(
        (meeting) =>
          meeting.evidence !== 'scheduled' && sourceIds.has(meeting.id),
      ),
      [personName],
      analyses,
      40,
      [],
      null,
      4,
    ),
    ...recentActivity,
  ].filter((item) => !/\bwill (?:notify|ping|inform)\b/i.test(item.text));
};

/** A linked meeting is only a source for a person read when its notes describe that person. */
export const focusPersonSynthesisSources = <T extends PersonSynthesisSource>(
  meetings: T[],
  activity: PersonActivityItem[],
  personName: string,
): T[] => {
  const byMeeting = new Map<string, string[]>();
  for (const item of activity) {
    const notes = byMeeting.get(item.meetingId) ?? [];
    if (!notes.includes(item.text)) notes.push(item.text);
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
