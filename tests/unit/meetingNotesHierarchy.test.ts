import { expect, it } from 'vitest';
import {
  planNotesLeaves,
  splitNotesDraftForMerge,
  validateInheritedItems,
} from '../../electron/llm/meetingNotesHierarchy';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it('splits oversized merge drafts only between claims, retaining IDs, qualifiers and exact evidence', () => {
  const { draft } = makeDirectNotesFixture();
  const item = draft.sections[0]!.items[0]!;
  draft.sections[0]!.items.push({
    ...item,
    id: 'second',
    text: 'After approval, send the outline',
    due: 'Friday',
  });
  const snapshot = structuredClone(draft);
  const packets = splitNotesDraftForMerge(draft);
  expect(packets).toHaveLength(2);
  expect(packets.flatMap((p) => p.sections.flatMap((s) => s.items))).toEqual(
    snapshot.sections[0]!.items,
  );
  expect(
    packets.every(
      (p) => p.sections[0]!.title.id === draft.sections[0]!.title.id,
    ),
  ).toBe(true);
  expect(draft).toEqual(snapshot);
});

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

it('protects every source-first inventory kind and rejects invented dispositions', () => {
  const source = [{ segment: 0, start: 0, end: 20 }];
  const fact = {
    id: 'fact-1',
    text: 'The limit is twenty.',
    kind: 'point' as const,
    owner: null,
    due: null,
    sources: source,
  };
  const question = {
    ...fact,
    id: 'question-1',
    text: 'Who verifies the limit?',
    kind: 'question' as const,
  };
  expect(() =>
    validateInheritedItems([fact, question], [fact], [], true),
  ).toThrow('notes_merge_dropped_commitment');
  expect(() =>
    validateInheritedItems(
      [fact],
      [fact],
      [
        {
          target: 'invented',
          kind: 'cancelled',
          replacementId: null,
          sources: source,
        },
      ],
      true,
    ),
  ).toThrow('notes_merge_unsafe_disposition');
});

it('requires a visible source-backed explanation for source-first cancellation', () => {
  const sources = [{ segment: 0, start: 0, end: 40 }];
  const action = {
    id: 'action-1',
    text: 'Send the outline',
    kind: 'action' as const,
    owner: 'Milo',
    due: null,
    sources,
  };
  const disposition = {
    target: action.id,
    kind: 'cancelled' as const,
    replacementId: null,
    sources,
  };
  expect(() =>
    validateInheritedItems([action], [], [disposition], true),
  ).toThrow('notes_merge_unsafe_disposition');
  expect(() =>
    validateInheritedItems(
      [action],
      [
        {
          id: 'point-1',
          text: 'The outline task was cancelled.',
          kind: 'point',
          owner: null,
          due: null,
          sources,
        },
      ],
      [disposition],
      true,
    ),
  ).not.toThrow();
});

it('cannot deduplicate commitments with different deadlines', () => {
  const base = {
    text: 'Send the outline',
    kind: 'action' as const,
    owner: 'Nira',
    sources: [{ segment: 0, start: 0, end: 30 }],
  };
  expect(() =>
    validateInheritedItems(
      [{ ...base, id: 'a', due: 'Friday' }],
      [{ ...base, id: 'b', due: 'Monday' }],
      [
        {
          target: 'a',
          kind: 'deduplicated',
          replacementId: 'b',
          sources: base.sources,
        },
      ],
    ),
  ).toThrow('notes_merge_dropped_commitment');
});

it.each([
  { owner: null },
  { due: null },
  { text: 'Send the outline' },
  { kind: 'decision' as const },
  { sources: [{ segment: 1, start: 0, end: 30 }] },
])(
  'does not silently lose inherited metadata, conditions, kind or sources: %j',
  (change) => {
    const item = {
      id: 'promise',
      text: 'Send the outline if legal approves',
      kind: 'action' as const,
      owner: 'Milo',
      due: 'Friday',
      sources: [{ segment: 0, start: 0, end: 30 }],
    };
    expect(() =>
      validateInheritedItems([item], [{ ...item, ...change }], []),
    ).toThrow('notes_merge_dropped_commitment');
  },
);

it('does not deduplicate identical task words owned by different speakers', () => {
  expect(() =>
    validateInheritedItems(
      [
        {
          id: 'nira-task',
          text: 'Send the outline',
          owner: 'Nira',
          kind: 'action',
          sources: [{ segment: 0, start: 0, end: 17 }],
        },
      ],
      [
        {
          id: 'milo-task',
          text: 'Send the outline',
          owner: 'Milo',
          kind: 'action',
          sources: [{ segment: 1, start: 0, end: 17 }],
        },
      ],
      [
        {
          target: 'nira-task',
          kind: 'deduplicated',
          replacementId: 'milo-task',
          sources: [{ segment: 1, start: 0, end: 17 }],
        },
      ],
    ),
  ).toThrow('notes_merge_dropped_commitment');
});
