import { expect, it } from 'vitest';
import {
  planNotesLeaves,
  validateInheritedItems,
} from '../../electron/llm/meetingNotesHierarchy';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';

it('covers every primary segment and keeps a late reversal available to consolidation', () => {
  const segments = Array.from({ length: 12 }, (_, index) => ({
    speaker: 'Me',
    text:
      index === 2
        ? 'I will send the outline.'
        : index === 11
          ? 'Do not send the outline; that plan is cancelled.'
          : `Context ${index}.`,
  }));
  const source = createNotesSource(JSON.stringify({ segments }));
  const leaves = planNotesLeaves(source, (packet) => packet.length <= 160);
  const primary = leaves.flatMap((leaf) =>
    leaf.primarySpans.map((span) => span.segment),
  );

  expect(new Set(primary)).toEqual(new Set(segments.map((_, index) => index)));
  expect(leaves.at(-1)?.sourceText).toContain('that plan is cancelled');
  expect(leaves.every((leaf) => leaf.sourceText.length <= 160)).toBe(true);
});

it('rejects a parent merge that silently drops an inherited commitment', () => {
  expect(() =>
    validateInheritedItems(
      [
        {
          id: 'a0',
          text: 'Send the outline',
          sources: [{ segment: 0, start: 0, end: 4 }],
        },
      ],
      [],
      [],
    ),
  ).toThrow('notes_merge_dropped_commitment');
});
