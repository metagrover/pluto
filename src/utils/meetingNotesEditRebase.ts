import type { UserEditsMap } from '../types';

export type EditBlock = {
  path: string;
  text: string;
  sourceKey: string | null;
  completionIdentity?: {
    text: string;
    owner: string | null;
    sourceRevision: string | null;
    sources: Array<{ segment: number; start: number; end: number }>;
  };
};

export type PreservedEditConflict = {
  path: string;
  original: string;
  edited: string;
  edited_at: string;
  previousSourceKey: string | null;
};

export const isContinuationEditPath = (path: string): boolean =>
  path.startsWith('native_continuations:') ||
  path.startsWith('continuation:') ||
  path.includes(':continuation');

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
      next[key] = { original: 'false', edited, edited_at: editedAt };
    }
    return {
      edits: next,
      changed: JSON.stringify(next) !== JSON.stringify(edits),
    };
  }
  // An explicit empty list is a removal, unlike an overlay archived by rewrite.
  if (
    isContinuationEditPath(path) &&
    edited === '[]' &&
    Object.hasOwn(edits, path)
  ) {
    const next = {
      ...edits,
      [path]: { original, edited, edited_at: editedAt },
    };
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

const sameEditableIdentity = (
  previous: EditBlock,
  next: EditBlock,
): boolean => {
  if (previous.completionIdentity || next.completionIdentity) {
    const a = previous.completionIdentity;
    const b = next.completionIdentity;
    if (!a || !b || a.text !== b.text || a.owner !== b.owner) return false;
    if (
      !previous.sourceKey ||
      !next.sourceKey ||
      previous.sourceKey === next.sourceKey
    )
      return true;
    return (
      !!a.sourceRevision &&
      a.sourceRevision === b.sourceRevision &&
      a.sources.some((left) =>
        b.sources.some(
          (right) =>
            left.segment === right.segment &&
            left.start < right.end &&
            right.start < left.end,
        ),
      )
    );
  }
  return (
    next.text === previous.text &&
    (previous.sourceKey
      ? next.sourceKey === previous.sourceKey
      : next.sourceKey === null)
  );
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
      ? nextBlocks.filter((block) => sameEditableIdentity(previous, block))
      : [];
    if (
      candidates.length === 1 &&
      candidates[0] &&
      (!previous?.completionIdentity ||
        previousBlocks.filter((block) =>
          sameEditableIdentity(block, candidates[0]!),
        ).length === 1)
    ) {
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
