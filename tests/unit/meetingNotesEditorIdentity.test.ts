import { expect, it } from 'vitest';
import { identifyEditedNotes } from '../../electron/llm/meetingNotesEditorIdentity';
import { validateInheritedItems } from '../../electron/llm/meetingNotesHierarchy';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it('keeps hierarchy leaf identities distinct after complete-document parsing', () => {
  const { draft } = makeDirectNotesFixture();
  const a = identifyEditedNotes(draft, [], {}, 'leaf0');
  const b = identifyEditedNotes(draft, [], {}, 'leaf1');
  expect(a.sections[0]!.items[0]!.id).not.toBe(b.sections[0]!.items[0]!.id);
});

it.each(['A', 'B'])(
  'preserves the explicitly retained duplicate %s and its disposition reference',
  (id) => {
    const { draft } = makeDirectNotesFixture();
    const inherited = ['A', 'B'].map((id) => ({
      ...draft.sections[0]!.items[0]!,
      id,
    }));
    const raw = structuredClone(draft);
    raw.sections[0]!.items[0]!.id = id;
    const reviewed = identifyEditedNotes(draft, inherited, raw, 'merge2');
    const item = reviewed.sections[0]!.items[0]!;
    expect(item.id).toBe(id);
    expect(() =>
      validateInheritedItems(
        inherited.map((i) => ({ ...i, kind: 'action' })),
        [{ ...item, kind: 'action' }],
        [
          {
            target: id === 'A' ? 'B' : 'A',
            kind: 'deduplicated',
            replacementId: id,
            sources: item.sources,
          },
        ],
      ),
    ).not.toThrow();
  },
);

it('does not preserve an inherited identity for changed text or owner', () => {
  const { draft } = makeDirectNotesFixture();
  const inherited = [{ ...draft.sections[0]!.items[0]!, id: 'A' }];
  const raw = structuredClone(draft);
  raw.sections[0]!.items[0]!.id = 'A';
  draft.sections[0]!.items[0]!.owner = 'SomeoneElse';
  expect(
    identifyEditedNotes(draft, inherited, raw, 'merge2').sections[0]!.items[0]!
      .id,
  ).not.toBe('A');
});

it('rejects a changed inherited commitment even when an id is reused', () => {
  const { draft } = makeDirectNotesFixture();
  const item = { ...draft.sections[0]!.items[0]!, kind: 'action' as const };
  expect(() =>
    validateInheritedItems([item], [{ ...item, owner: 'SomeoneElse' }], []),
  ).toThrow('notes_merge_dropped_commitment');
});
