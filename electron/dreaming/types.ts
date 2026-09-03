export type DreamingEntityType = 'project' | 'person';

export const MAX_DREAMING_PROPOSALS = 20;

export type DreamingProposalKind =
  | 'project_summary'
  | 'project_milestone'
  | 'project_commitment'
  | 'project_alias'
  | 'person_headline'
  | 'person_focus'
  | 'person_collaborator'
  | 'person_alias';

export interface DreamingEvidenceReference {
  meetingId: string;
  excerpt: string;
}

export interface DreamingProposalPayloadByKind {
  project_summary: { summary: string };
  project_milestone: {
    name: string;
    status: 'planned' | 'in_progress' | 'completed';
  };
  project_commitment: { task: string };
  project_alias: { alias: string };
  person_headline: { headline: string };
  person_focus: { focus: string };
  person_collaborator: { name: string };
  person_alias: { alias: string };
}

export type DreamingProposalPayload =
  DreamingProposalPayloadByKind[DreamingProposalKind];

export type RawDreamingProposal = {
  [Kind in DreamingProposalKind]: {
    kind: Kind;
    payload: DreamingProposalPayloadByKind[Kind];
    evidence: DreamingEvidenceReference[];
  };
}[DreamingProposalKind];

export type RawDreamingOutput =
  | { status: 'no_change'; proposals: [] }
  | {
      status: 'proposed';
      proposals: [RawDreamingProposal, ...RawDreamingProposal[]];
    };

export type ValidatedDreamingProposal = RawDreamingProposal & {
  fingerprint: string;
};

export type DreamingRunStatus =
  | 'running'
  | 'no_change'
  | 'proposed'
  | 'failed'
  | 'cancelled';

export type DreamingValidationResult =
  | { valid: true; status: 'no_change'; proposals: [] }
  | {
      valid: true;
      status: 'proposed';
      proposals: [ValidatedDreamingProposal, ...ValidatedDreamingProposal[]];
    }
  | { valid: false; error: string };

export type DreamingRunResult =
  | { status: 'no_change'; proposals: [] }
  | {
      status: 'proposed';
      proposals: [ValidatedDreamingProposal, ...ValidatedDreamingProposal[]];
    }
  | { status: 'failed'; errorCode: string }
  | { status: 'cancelled' };

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
  sourceRevision: string;
  currentBaseline?: Record<string, unknown>;
  currentSummary?: string | null;
  currentMilestones?: string[];
  currentCommitments?: string[];
  recentMeetingNotes: EntityMeetingNoteSummary[];
  correctionFingerprints?: string[];
  negativeConstraints: string[];
}
