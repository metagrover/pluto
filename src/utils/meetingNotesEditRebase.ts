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

export const isNoOpMeetingNotesEdit = (
  original: string,
  edited: string,
): boolean => normalizeNoOpEdit(original) === normalizeNoOpEdit(edited);

export const applyMeetingNotesUserEdit = (
  edits: UserEditsMap,
  path: string,
  original: string,
  edited: string,
  editedAt: string,
): { edits: UserEditsMap; changed: boolean } => {
  const completion = path.match(
    /^completion:(?:all_action_items|v2:action):(\d+)$/,
  );
  if (completion && (edited === 'true' || edited === 'false')) {
    const next = { ...edits };
    for (const prefix of ['all_action_items', 'v2:action']) {
      const key = `completion:${prefix}:${completion[1]}`;
      if (edited === 'false') delete next[key];
      else next[key] = { original: 'false', edited, edited_at: editedAt };
    }
    return {
      edits: next,
      changed: JSON.stringify(next) !== JSON.stringify(edits),
    };
  }
  if (isNoOpMeetingNotesEdit(original, edited)) {
    if (!Object.hasOwn(edits, path)) return { edits, changed: false };
    const next = { ...edits };
    delete next[path];
    return { edits: next, changed: true };
  }
  return {
    edits: { ...edits, [path]: { original, edited, edited_at: editedAt } },
    changed: true,
  };
};

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
    if (isNoOpMeetingNotesEdit(edit.original, edit.edited)) {
      continue;
    }
    const matchingPreviousBlocks = previousBlocks.filter(
      (block) => block.path === path && block.text === edit.original,
    );
    const previous =
      matchingPreviousBlocks.length === 1 ? matchingPreviousBlocks[0] : null;
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
