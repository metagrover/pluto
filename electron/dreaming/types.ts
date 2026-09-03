export type DreamingEntityType = 'project' | 'person';

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
  | { status: 'proposed'; proposals: RawDreamingProposal[] };

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
      proposals: ValidatedDreamingProposal[];
    }
  | { valid: false; error: string };

export type DreamingRunResult =
  | { status: 'no_change'; proposals: [] }
  | { status: 'proposed'; proposals: ValidatedDreamingProposal[] }
  | { status: 'failed'; errorCode: string }
  | { status: 'cancelled' };

interface LegacyDreamingMilestoneProposal {
  name: string;
  status: 'planned' | 'in_progress' | 'completed';
  source_meeting_id: string;
  evidence_snippet: string;
}

interface LegacyDreamingCommitmentProposal {
  task: string;
  owner_name: string;
  source_meeting_id: string;
}

interface LegacyProjectDreamingOutput {
  status: 'updated' | 'no_change';
  dossier_summary?: string;
  milestones?: LegacyDreamingMilestoneProposal[];
  associated_commitments?: LegacyDreamingCommitmentProposal[];
  suggested_aliases?: string[];
}

interface LegacyPersonDreamingOutput {
  status: 'updated' | 'no_change';
  headline?: string;
  current_focus?: string;
  recent_collaborators?: string[];
  suggested_aliases?: string[];
}

// TODO(#586): Remove these temporary aliases when the validator and coordinator
// persist ValidatedDreamingProposal records instead of dossier mutations.
export type DreamingMilestoneProposal = LegacyDreamingMilestoneProposal;
export type DreamingCommitmentProposal = LegacyDreamingCommitmentProposal;
export type ProjectDreamingOutput = LegacyProjectDreamingOutput;
export type PersonDreamingOutput = LegacyPersonDreamingOutput;

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
  currentBaseline?: Record<string, unknown>;
  currentSummary?: string | null;
  currentMilestones?: string[];
  currentCommitments?: string[];
  recentMeetingNotes: EntityMeetingNoteSummary[];
  correctionFingerprints?: string[];
  negativeConstraints: string[];
}
