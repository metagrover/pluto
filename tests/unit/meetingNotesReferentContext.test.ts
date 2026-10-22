import { expect, it, vi } from 'vitest';
import {
  acceptEditedNotes,
  applySourceBoundSemanticReview,
  sourceBoundItemReviewWindow,
} from '../../electron/llm/meetingNotesAudit';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type { NotesDraft } from '../../electron/llm/meetingNotesTypes';

const fixture = (
  lines = [
    {
      speaker: 'Ari',
      text: 'I offer to lend you my telescope for the school visit.',
    },
    {
      speaker: 'Bo',
      text: 'I decline that offer because the children already have a telescope.',
    },
  ],
) => {
  const source = createNotesSource(JSON.stringify(lines));
  const last = source.segments.at(-1)!;
  const sources = [{ segment: last.index, start: 0, end: last.text.length }];
  const draft: NotesDraft = {
    title: null,
    overview: null,
    meetingType: 'general',
    sections: [
      {
        id: 'section',
        title: { id: 'heading', text: 'School visit', sources },
        items: [
          {
            id: 'choice',
            kind: 'decision',
            text: 'Bo declined Ari’s offer to lend a telescope because the children already have one.',
            owner: null,
            due: null,
            sources,
          },
        ],
      },
    ],
  };
  return acceptEditedNotes({ source, draft, acceptancePolicy: 'conservative' });
};

it('supplies and retains exact antecedent provenance when a response refers to another speaker’s offer', async () => {
  const notes = fixture();
  const generate = vi.fn(async (_request: { prompt: string }) =>
    JSON.stringify({
      resolutions: [
        {
          id: 'choice',
          kind: 'decision',
          text: 'Bo declined Ari’s offer to lend a telescope for the school visit because the children already have one.',
          owner: null,
          due: null,
          discussion: null,
        },
      ],
    }),
  );
  const reviewed = await reviewSourceBoundNotes(notes, generate);
  const cases = JSON.parse(
    generate.mock.calls[0]![0]!.prompt.split('\n').at(-1)!,
  );
  expect(
    cases[0].source.map(({ speaker }: { speaker: string }) => speaker),
  ).toEqual(['Ari', 'Bo']);
  expect(cases[0].source[0].text).toBe(notes.source.segments[0]!.text);
  expect(reviewed.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(
    reviewed.draft.sections[0]!.items[0]!.sources.map(({ segment }) => segment),
  ).toEqual([0, 1]);
});

it('uses the same bounded antecedent window at the application trust boundary', () => {
  const notes = fixture([
    { speaker: 'Cy', text: 'An unrelated family story.' },
    { speaker: 'Dee', text: 'The previous subject is closed.' },
    {
      speaker: 'Ari',
      text: 'I offer to lend you my telescope for the school visit.',
    },
    { speaker: 'Bo', text: 'The children already have a telescope.' },
    { speaker: 'Ari', text: 'Then it may not be needed.' },
    { speaker: 'Bo', text: 'I decline that offer.' },
  ]);
  const item = notes.draft.sections[0]!.items[0]!;
  const window = sourceBoundItemReviewWindow(notes, item);
  expect(window.map(({ segment }) => segment)).toEqual([2, 3, 4, 5]);
  expect(() =>
    applySourceBoundSemanticReview(notes, [
      {
        ...item,
        sources: [
          { segment: 0, start: 0, end: notes.source.segments[0]!.text.length },
        ],
      },
    ]),
  ).toThrow('notes_source_out_of_scope');
});

it('keeps an unsupported first-turn task referent held by the existing output rule', async () => {
  const notes = fixture([{ speaker: 'Bo', text: 'Do not reopen that task.' }]);
  notes.draft.sections[0]!.items[0] = {
    ...notes.draft.sections[0]!.items[0]!,
    kind: 'point',
    text: 'Do not reopen that task.',
  };
  const reviewed = await reviewSourceBoundNotes(notes, async () =>
    JSON.stringify({
      resolutions: [
        {
          id: 'choice',
          kind: 'point',
          text: 'That task must remain closed.',
          owner: null,
          due: null,
          discussion: null,
        },
      ],
    }),
  );
  expect(reviewed.issues).toContain('semantic_notes_review_unavailable:choice');
  expect(
    reviewed.draft.sections[0]!.items[0]!.sources.map(({ segment }) => segment),
  ).toEqual([0]);
});
