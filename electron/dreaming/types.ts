export type DreamingEntityType = 'project' | 'person';

export interface DreamingMilestoneProposal {
  name: string;
  status: 'planned' | 'in_progress' | 'completed';
  source_meeting_id: string;
  evidence_snippet: string;
}

export interface DreamingCommitmentProposal {
  task: string;
  owner_name: string;
  source_meeting_id: string;
}

export interface ProjectDreamingOutput {
  status: 'updated' | 'no_change';
  dossier_summary?: string;
  milestones?: DreamingMilestoneProposal[];
  associated_commitments?: DreamingCommitmentProposal[];
  suggested_aliases?: string[];
}

export interface PersonDreamingOutput {
  status: 'updated' | 'no_change';
  headline?: string;
  current_focus?: string;
  recent_collaborators?: string[];
  suggested_aliases?: string[];
}

export interface EntityMeetingNoteSummary {
  meetingId: string;
  title: string;
  startedAt: string | null;
  notesContent: string;
  mentionedContext?: string | null;
}

export type DreamingMeetingNote = EntityMeetingNoteSummary;

export interface DreamingInputPackage {
  entityId: string;
  entityType: DreamingEntityType;
  entityName: string;
  currentSummary?: string | null;
  currentMilestones?: string[];
  currentCommitments?: string[];
  recentMeetingNotes: EntityMeetingNoteSummary[];
  negativeConstraints: string[];
}
