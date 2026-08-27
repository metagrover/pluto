import {
  type NotesSourceWindow,
  partitionNotesSource,
} from './meetingNotesBudget';
import {
  MeetingNotesError,
  type NotesDraft,
  type NotesSource,
  type SourceSpan,
} from './meetingNotesTypes';

export type NotesLeaf = NotesSourceWindow & {
  sourceRevision: string;
};

/** Repacking never splits a claim or rewrites its original-source references. */
export const splitNotesDraftForMerge = (draft: NotesDraft): NotesDraft[] => {
  const empty = (): NotesDraft => ({
    meetingType: draft.meetingType,
    overview: null,
    sections: [],
  });
  const packets: NotesDraft[] = [];
  if (draft.overview)
    packets.push({ ...empty(), overview: structuredClone(draft.overview) });
  if (draft.recentWin)
    packets.push({ ...empty(), recentWin: structuredClone(draft.recentWin) });
  for (const section of draft.sections) {
    if (!section.items.length)
      packets.push({ ...empty(), sections: [structuredClone(section)] });
    for (const item of section.items) {
      packets.push({
        ...empty(),
        sections: [
          { ...structuredClone(section), items: [structuredClone(item)] },
        ],
      });
    }
  }
  return packets.length ? packets : [structuredClone(draft)];
};

export type InheritedCommitment = {
  id: string;
  text: string;
  sources: SourceSpan[];
  kind?: 'action' | 'decision';
  owner?: string | null;
  due?: string | null;
};

export type CommitmentDisposition = {
  target: string;
  kind: 'deduplicated' | 'cancelled' | 'superseded';
  replacementId?: string | null;
  sources?: SourceSpan[];
};

export const planNotesLeaves = (
  source: NotesSource,
  fitsPrompt: (packet: string, spans?: SourceSpan[]) => boolean,
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
  const parentById = new Map(parent.map((item) => [item.id, item]));
  for (const item of inherited) {
    if (parentById.has(item.id)) continue;
    const disposition = dispositions.find(
      (candidate) =>
        candidate.target === item.id &&
        ['deduplicated', 'cancelled', 'superseded'].includes(candidate.kind),
    );
    if (!disposition || !(disposition.sources?.length ?? 0)) {
      throw new MeetingNotesError('notes_merge_dropped_commitment');
    }
    const replacement = disposition.replacementId
      ? parentById.get(disposition.replacementId)
      : undefined;
    if (
      disposition.kind === 'deduplicated' &&
      (!replacement ||
        replacement.kind !== item.kind ||
        replacement.owner !== item.owner ||
        replacement.due !== item.due ||
        replacement.text !== item.text ||
        JSON.stringify(replacement.sources) !== JSON.stringify(item.sources))
    ) {
      throw new MeetingNotesError('notes_merge_dropped_commitment');
    }
  }
};
