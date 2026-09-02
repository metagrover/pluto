import type { Entity, PersistedMeeting } from '../db';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  EntityMeetingNoteSummary,
} from './types';

export interface PackageEntityNotesDeps {
  getEntity(id: string): Entity | null | undefined;
  getEntityMeetings(entityId: string): Array<{
    id: string;
    started_at?: string | null;
    created_at?: string | null;
    context?: string | null;
  }>;
  getMeeting(id: string): PersistedMeeting | null | undefined;
  getEntityCorrections(entityId: string): Array<{ fingerprint: string }>;
}

export const packageEntityNotes = (
  entityId: string,
  deps: PackageEntityNotesDeps,
): DreamingInputPackage | null => {
  const entity = deps.getEntity(entityId);
  if (!entity) return null;
  if (entity.type !== 'project' && entity.type !== 'person') return null;

  const entityMeetings = deps.getEntityMeetings(entityId);
  const corrections = deps.getEntityCorrections(entityId);
  const negativeConstraints = corrections.map((c) =>
    c.fingerprint.toLowerCase().trim(),
  );

  const recentMeetingNotes: EntityMeetingNoteSummary[] = [];

  for (const mRef of entityMeetings.slice(0, 10)) {
    const meeting = deps.getMeeting(mRef.id);
    if (!meeting) continue;

    // Extract ONLY enhanced_notes and user_notes, NEVER raw transcript_json
    const notesContent = [meeting.user_notes, meeting.enhanced_notes]
      .filter((n): n is string => Boolean(n?.trim()))
      .join('\n\n')
      .trim();

    if (notesContent) {
      recentMeetingNotes.push({
        meetingId: String(meeting.id),
        title: meeting.title,
        startedAt: meeting.started_at ?? meeting.created_at ?? null,
        notesContent,
        mentionedContext: mRef.context ?? null,
      });
    }
  }

  return {
    entityId: entity.id,
    entityType: entity.type as DreamingEntityType,
    entityName: entity.name,
    negativeConstraints,
    recentMeetingNotes,
  };
};
