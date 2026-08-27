import {
  type NotesSourceWindow,
  partitionNotesSource,
} from './meetingNotesBudget';
import {
  MeetingNotesError,
  type NotesSource,
  type SourceSpan,
} from './meetingNotesTypes';

export type NotesLeaf = NotesSourceWindow & {
  sourceRevision: string;
};

export type InheritedCommitment = {
  id: string;
  text: string;
  sources: SourceSpan[];
};

export type CommitmentDisposition = {
  target: string;
  kind: 'deduplicated' | 'cancelled' | 'superseded';
  replacementId?: string | null;
  sources?: SourceSpan[];
};

export const planNotesLeaves = (
  source: NotesSource,
  fitsPrompt: (packet: string) => boolean,
): NotesLeaf[] =>
  partitionNotesSource(source, fitsPrompt).map((leaf) => ({
    ...leaf,
    sourceRevision: source.revision,
  }));

export const validateInheritedItems = (
  inherited: InheritedCommitment[],
  parent: InheritedCommitment[],
  dispositions: CommitmentDisposition[],
) => {
  const parentIds = new Set(parent.map((item) => item.id));
  for (const item of inherited) {
    if (parentIds.has(item.id)) continue;
    const disposition = dispositions.find(
      (candidate) =>
        candidate.target === item.id &&
        ['deduplicated', 'cancelled', 'superseded'].includes(candidate.kind),
    );
    if (!disposition) {
      throw new MeetingNotesError('notes_merge_dropped_commitment');
    }
  }
};
