import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import {
  createNotesSource,
  quoteCitedSourcePassages,
} from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesItem,
} from '../../electron/llm/meetingNotesTypes';

const fixtures = {
  point: {
    source: 'We scheduled the pilot review for Friday.',
    readable: 'The team scheduled the pilot review for Friday.',
    firstPerson: 'We scheduled the pilot review for Friday.',
  },
  question: {
    source: 'Should we schedule the pilot review for Friday?',
    readable: 'Should the team schedule the pilot review for Friday?',
    firstPerson:
      'We need to decide whether to schedule the pilot review for Friday.',
  },
  action: {
    source: 'I will schedule the pilot review for Friday.',
    readable: 'Schedule the pilot review for Friday.',
    firstPerson: 'I will schedule the pilot review for Friday.',
  },
  decision: {
    source: 'We decided to schedule the pilot review for Friday.',
    readable: 'The team decided to schedule the pilot review for Friday.',
    firstPerson: 'We decided to schedule the pilot review for Friday.',
  },
} satisfies Record<
  NotesItem['kind'],
  {
    source: string;
    readable: string;
    firstPerson: string;
  }
>;

const fixture = (kind: NotesItem['kind']) => {
  const wording = fixtures[kind];
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Dana', text: wording.source }]),
  );
  const sources = [{ segment: 0, start: 0, end: wording.source.length }];
  const draft: NotesDraft = {
    title: null,
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 's0:title', text: 'Pilot review', sources },
        items: [
          {
            id: 's0:item:0',
            kind,
            text: wording.readable,
            owner: kind === 'action' ? 'Dana' : null,
            due: null,
            sources,
          },
        ],
      },
    ],
  };
  return { wording, source, sources, draft };
};

const inputFor = (item: ReturnType<typeof fixture>) => ({
  source: item.source,
  context: {
    userNotes: '',
    template: 'auto' as const,
    trustedUserTerms: [],
    entityHints: [],
  },
  provider: 'ollama',
  model: 'gemma4:12b',
  contextTokens: 16384,
  hierarchyAuditStrategy: 'deterministic_only' as const,
});

const cases = (Object.keys(fixtures) as NotesItem['kind'][]).flatMap((kind) =>
  (['formatted source quotation', 'leading first-person prose'] as const).map(
    (style) => ({ kind, style }),
  ),
);

const rejectedText = (
  item: ReturnType<typeof fixture>,
  style: (typeof cases)[number]['style'],
) =>
  style === 'formatted source quotation'
    ? quoteCitedSourcePassages(item.source, item.sources)
    : item.wording.firstPerson;

const resolution = (id: string, kind: NotesItem['kind'], text: string) => ({
  id,
  kind: kind === 'action' ? 'accepted_action' : kind,
  text,
  owner: kind === 'action' ? 'Dana' : null,
  due: null,
  discussion: null,
});

it.each(cases)(
  'repairs $style in a $kind through the real publication pipeline',
  async ({ kind, style }) => {
    const item = fixture(kind);
    const badText = rejectedText(item, style);
    const writer = vi.fn(async () => JSON.stringify(item.draft));
    const review = vi.fn(async ({ prompt }: { prompt: string }) => {
      const entries = JSON.parse(prompt.split('\n').at(-1)!) as {
        id: string;
      }[];
      expect(entries).toHaveLength(1);
      return JSON.stringify({
        resolutions: [
          resolution(
            entries[0]!.id,
            kind,
            review.mock.calls.length === 1 ? badText : item.wording.readable,
          ),
        ],
      });
    });
    const result = await generateMeetingNotes({
      ...inputFor(item),
      generate: writer,
      reviewSourceBoundNotes: (notes) => reviewSourceBoundNotes(notes, review),
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledTimes(2);
    const prose = result.topics.flatMap((topic) => [
      topic.summary,
      ...topic.key_points.map((point) => point.text),
      ...topic.action_items.map((action) => action.text),
      ...topic.decisions.map((decision) => decision.text),
      ...topic.open_questions,
    ]);
    expect(prose).toContain(item.wording.readable);
    expect(prose).not.toContain(badText);
    expect(
      Object.values(result.generation_metadata.source_provenance!.blocks).some(
        (block) =>
          block.id === 's0:item:0' &&
          JSON.stringify(block.sources) === JSON.stringify(item.sources),
      ),
    ).toBe(true);
  },
);

it.each(cases)(
  'refuses exhausted $style repair for a $kind instead of publishing the original writer',
  async ({ kind, style }) => {
    const item = fixture(kind);
    const writer = vi.fn(async () => JSON.stringify(item.draft));
    const review = vi.fn(async ({ prompt }: { prompt: string }) => {
      const entries = JSON.parse(prompt.split('\n').at(-1)!) as {
        id: string;
      }[];
      return JSON.stringify({
        resolutions: [
          resolution(entries[0]!.id, kind, rejectedText(item, style)),
        ],
      });
    });
    await expect(
      generateMeetingNotes({
        ...inputFor(item),
        generate: writer,
        reviewSourceBoundNotes: (notes) =>
          reviewSourceBoundNotes(notes, review),
      }),
    ).rejects.toThrow('notes_semantic_review_incomplete');
    expect(writer).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledTimes(2);
  },
);

it.each(cases)(
  'blocks a final callback that bypasses $style review for a $kind',
  async ({ kind, style }) => {
    const item = fixture(kind);
    const callback = vi.fn(async (notes) => {
      notes.draft.sections[0]!.items[0]!.text = rejectedText(item, style);
      notes.draft.sections[0]!.items[0]!.kind = kind;
      return notes;
    });
    await expect(
      generateMeetingNotes({
        ...inputFor(item),
        generate: async () => JSON.stringify(item.draft),
        reviewSourceBoundNotes: callback,
      }),
    ).rejects.toThrow('notes_semantic_review_incomplete');
    expect(callback).toHaveBeenCalledOnce();
  },
);

it.each([
  [
    'Will Carter completed the pilot review.',
    'Will Carter completed the pilot review.',
  ],
  [
    'I completed the pilot review.',
    'Dana said, “I completed the pilot review.”',
  ],
])(
  'preserves supported proper-name or attributed prose: %s',
  async (sourceText, readable) => {
    const item = fixture('point');
    item.source = createNotesSource(
      JSON.stringify([{ speaker: 'Dana', text: sourceText }]),
    );
    item.sources = [{ segment: 0, start: 0, end: sourceText.length }];
    item.draft.sections[0]!.title.sources = item.sources;
    item.draft.sections[0]!.items[0]!.sources = item.sources;
    item.draft.sections[0]!.items[0]!.text = readable;
    const review = vi.fn(async ({ prompt }: { prompt: string }) => {
      const entries = JSON.parse(prompt.split('\n').at(-1)!) as {
        id: string;
      }[];
      return JSON.stringify({
        resolutions: [resolution(entries[0]!.id, 'point', readable)],
      });
    });
    const result = await generateMeetingNotes({
      ...inputFor(item),
      generate: async () => JSON.stringify(item.draft),
      reviewSourceBoundNotes: (notes) => reviewSourceBoundNotes(notes, review),
    });
    expect(review).toHaveBeenCalledOnce();
    expect([
      result.topics[0]!.summary,
      ...result.topics[0]!.key_points.map((point) => point.text),
    ]).toContain(readable);
  },
);
