import * as db from '../db';
import type { Entity, PersistedMeeting } from '../db';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  DreamingMeetingNote,
} from './types';

export interface PackageEntityNotesDeps {
  getEntity(id: string): Entity | null | undefined;
  getEntityMeetings(entityId: string): Array<{
    id: string | number;
    started_at?: string | null;
    created_at?: string;
    user_notes?: string | null;
    enhanced_notes?: string | null;
    title?: string;
  }>;
  getMeeting(id: string): PersistedMeeting | null | undefined;
  getEntityCorrections(entityId: string): Array<{ fingerprint: string }>;
}

export const packageEntityNotes = (
  entityId: string,
  deps?: Partial<PackageEntityNotesDeps>,
): DreamingInputPackage | null => {
  const getEntity = deps?.getEntity ?? db.getEntity;
  const getEntityMeetings = deps?.getEntityMeetings ?? db.getEntityMeetings;
  const getMeeting = deps?.getMeeting ?? db.getMeeting;
  const getEntityCorrections =
    deps?.getEntityCorrections ?? db.getEntityCorrections;

  const entity = getEntity(entityId);
  if (!entity) return null;
  if (entity.type !== 'project' && entity.type !== 'person') return null;

  const entityMeetings = getEntityMeetings(entityId);
  const corrections = getEntityCorrections(entityId);
  const negativeConstraints = corrections.map((c) =>
    c.fingerprint.trim().toLowerCase(),
  );

  const recentMeetingNotes: DreamingMeetingNote[] = [];
  for (const em of entityMeetings) {
    const meetingId = String(em.id);
    const meeting: Partial<PersistedMeeting> | null =
      getMeeting(meetingId) ?? (em as unknown as Partial<PersistedMeeting>);
    if (!meeting) continue;

    // Extract ONLY enhanced_notes and user_notes, NEVER raw transcript_json
    const notesContent = [meeting.user_notes, meeting.enhanced_notes]
      .filter((n): n is string => Boolean(n?.trim()))
      .join('\n\n')
      .trim();

    if (!notesContent) continue;

    recentMeetingNotes.push({
      meetingId,
      title: meeting.title ?? 'Untitled Meeting',
      startedAt: meeting.started_at ?? meeting.created_at ?? null,
      notesContent,
    });
  }

  return {
    entityId: entity.id,
    entityType: entity.type as DreamingEntityType,
    entityName: entity.name,
    recentMeetingNotes,
    negativeConstraints,
  };
};
