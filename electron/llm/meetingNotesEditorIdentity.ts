import type { NotesDraft, NotesItem } from './meetingNotesTypes';

const commitmentKey = (item: NotesItem) =>
  JSON.stringify([item.kind, item.text, item.owner, item.due, item.sources]);

/** Model ids are hints, never authority. Only identical inherited commitments
 * retain an old identity; all other blocks get a unique node-local identity. */
export const identifyEditedNotes = (
  draft: NotesDraft,
  inherited: NotesItem[],
  rawDraft: unknown,
  prefix: string,
): NotesDraft => {
  const next = structuredClone(draft);
  const raw = rawDraft as {
    sections?: Array<{ items?: Array<{ id?: unknown }> }>;
  };
  const used = new Set<string>();
  if (next.overview) next.overview.id = `${prefix}:overview`;
  if (next.recentWin) {
    next.recentWin.win.id = `${prefix}:recent-win`;
    next.recentWin.impact.id = `${prefix}:recent-win-impact`;
  }
  next.sections.forEach((section, sectionIndex) => {
    section.id = `${prefix}:s${sectionIndex}`;
    section.title.id = `${section.id}:title`;
    section.items.forEach((item, itemIndex) => {
      item.id = `${section.id}:item:${itemIndex}`;
      if (item.kind !== 'action' && item.kind !== 'decision') return;
      const candidates = inherited.filter(
        (candidate) =>
          !used.has(candidate.id) &&
          commitmentKey(candidate) === commitmentKey(item),
      );
      const hint = raw?.sections?.[sectionIndex]?.items?.[itemIndex]?.id;
      const match =
        candidates.find((candidate) => candidate.id === hint) ?? candidates[0];
      if (match) {
        item.id = match.id;
        used.add(match.id);
      }
    });
  });
  return next;
};
