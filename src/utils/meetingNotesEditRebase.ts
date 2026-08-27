import type { UserEditsMap } from '../types';

export type EditBlock = {
  path: string;
  text: string;
  sourceKey: string | null;
};

export type PreservedEditConflict = {
  path: string;
  original: string;
  edited: string;
  edited_at: string;
  previousSourceKey: string | null;
};

const normalizeNoOpEdit = (value: string): string =>
  value.replace(/\r\n?/g, '\n').trim();

export const rebaseMeetingNotesEdits = ({
  edits,
  previousBlocks,
  nextBlocks,
}: {
  edits: UserEditsMap;
  previousBlocks: EditBlock[];
  nextBlocks: EditBlock[];
}): {
  edits: UserEditsMap;
  conflicts: PreservedEditConflict[];
} => {
  const rebased: UserEditsMap = {};
  const conflicts: PreservedEditConflict[] = [];
  for (const [path, edit] of Object.entries(edits)) {
    if (normalizeNoOpEdit(edit.original) === normalizeNoOpEdit(edit.edited)) {
      continue;
    }
    const previous = previousBlocks.find(
      (block) => block.path === path && block.text === edit.original,
    );
    const candidates = previous
      ? nextBlocks.filter(
          (block) =>
            block.text === previous.text &&
            (previous.sourceKey
              ? block.sourceKey === previous.sourceKey
              : block.sourceKey === null),
        )
      : [];
    if (candidates.length === 1 && candidates[0]) {
      rebased[candidates[0].path] = {
        original: candidates[0].text,
        edited: edit.edited,
        edited_at: edit.edited_at,
      };
      continue;
    }
    conflicts.push({
      path,
      original: edit.original,
      edited: edit.edited,
      edited_at: edit.edited_at,
      previousSourceKey: previous?.sourceKey ?? null,
    });
  }
  return { edits: rebased, conflicts };
};
