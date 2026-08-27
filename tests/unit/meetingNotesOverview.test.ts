import { expect, it, vi } from 'vitest';
import {
  applyNotesAudit,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type {
  NotesDraft,
  NotesItem,
  NotesRequest,
} from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import captured from '../fixtures/meeting-notes-qualified-publication-seed41.json';
import {
  makeDirectNotesFixture,
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

const projectSections = (
  groups: Array<Array<Pick<NotesItem, 'kind' | 'text'>>>,
  explicitOverview = false,
) => {
  const source = makeSyntheticNotesSource(
    groups.flatMap((group) =>
      group.map((item) => ({ speaker: 'Milo', text: item.text })),
    ),
  );
  let index = 0;
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: groups.map((group, sectionIndex) => {
      const items = group.map((item, itemIndex) => {
        const segment = source.segments[index++]!;
        return {
          ...item,
          id: `s${sectionIndex}:item:${itemIndex}`,
          sources: [
            { segment: segment.index, start: 0, end: segment.text.length },
          ],
          owner: null,
          due: null,
        };
      });
      return {
        id: `s${sectionIndex}`,
        title: {
          id: `s${sectionIndex}:title`,
          text: `Topic ${sectionIndex + 1}`,
          sources: items[0]!.sources,
        },
        items,
      };
    }),
  };
  if (explicitOverview)
    draft.overview = { ...draft.sections[0]!.items[0]!, id: 'overview' };
  const blocks = [
    ...(draft.overview ? [draft.overview] : []),
    ...draft.sections.flatMap((section) => [section.title, ...section.items]),
  ];
  const result = projectAuditedNotes(
    applyNotesAudit({
      source,
      draft,
      audit: {
        changes: [],
        dispositions: [],
        terminology: [],
        verdicts: blocks.map((block) => ({
          target: block.id,
          status: 'supported',
          sources: block.sources,
        })),
      },
    }),
  );
  return { result, draft };
};

it('derives an action-only overview from the reviewed action with matching provenance', () => {
  const fixture = makeDirectNotesFixture();
  const action = fixture.draft.sections[0]!.items[0]!;
  const result = projectAuditedNotes(applyNotesAudit(fixture));
  expect(result.overview).toBe(result.all_action_items[0]!.text);
  expect(
    result.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual(action.sources);
});

it.each([
  [
    { kind: 'action' as const, text: 'I will send the outline.' },
    { kind: 'decision' as const, text: 'We decided to keep the report plain.' },
  ],
  [
    { kind: 'decision' as const, text: 'We decided to keep the report plain.' },
    { kind: 'action' as const, text: 'I will send the outline.' },
  ],
])(
  'keeps the first outcome kind in source order and fills without reselecting it',
  (first, second) => {
    const { result, draft } = projectSections([
      [
        { kind: 'point', text: 'The discussion covered the report.' },
        first,
        second,
        { kind: 'point', text: 'The report includes a diagram.' },
      ],
    ]);
    const outcomeText = (item: typeof first) =>
      item.kind === 'action' ? result.all_action_items[0]!.text : item.text;
    expect(result.overview).toBe(
      [
        outcomeText(first),
        draft.sections[0]!.items[0]!.text,
        outcomeText(second),
      ].join(' '),
    );
    expect(
      result.generation_metadata?.source_provenance?.blocks.overview?.sources,
    ).toEqual(
      [1, 0, 2].flatMap((index) => draft.sections[0]!.items[index]!.sources),
    );
  },
);

it('keeps narrative-only topics in section order before filling their remaining details', () => {
  const { result, draft } = projectSections([
    [
      { kind: 'point', text: 'The first loaf was flat.' },
      { kind: 'point', text: 'The second loaf rose.' },
    ],
    [{ kind: 'point', text: 'The radio still hums.' }],
  ]);
  expect(result.overview).toBe(
    'The first loaf was flat. The radio still hums. The second loaf rose.',
  );
  expect(
    result.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual([
    ...draft.sections[0]!.items[0]!.sources,
    ...draft.sections[1]!.items[0]!.sources,
    ...draft.sections[0]!.items[1]!.sources,
  ]);
});

it('leaves an explicit reviewed overview and its provenance untouched', () => {
  const { result, draft } = projectSections(
    [
      [
        { kind: 'point', text: 'The outline needs a diagram.' },
        { kind: 'action', text: 'I will send the outline.' },
      ],
    ],
    true,
  );
  expect(result.overview).toBe(draft.overview!.text);
  expect(
    result.generation_metadata?.source_provenance?.blocks.overview,
  ).toEqual(
    draft.overview && {
      id: draft.overview.id,
      sources: draft.overview.sources,
    },
  );
});

it.each(['decision-first', 'offer-first'])(
  'represents each reviewed topic in the fallback instead of promoting only the declined offer: %s',
  async (order) => {
    const writer = JSON.parse(captured.writerRaw);
    const audit = JSON.parse(captured.repairedAuditRaw);
    if (order === 'offer-first') {
      // Reproduce the notes-v20 seed41 writer ordering with the same captured
      // statements and matching review targets, without a model call.
      writer.sections[0].items.reverse();
      for (const verdict of audit.verdicts) {
        if (verdict.target === 's0:item:0') verdict.target = 's0:item:1';
        else if (verdict.target === 's0:item:1') verdict.target = 's0:item:0';
      }
    }
    const replies = [JSON.stringify(writer), JSON.stringify(audit)];
    const generate = vi.fn(async (request: NotesRequest) => {
      const raw = replies.shift();
      if (!raw) throw new Error('offline_replay_exhausted');
      return createNotesWireRequest(
        request.prompt,
        request.sourceSpans ?? [],
      ).decode(raw);
    });
    const result = await generateMeetingNotes({
      source: structuredClone(captured.source),
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.overview).toBe(
      [
        result.all_decisions[0]!.text,
        'Cleo withdrew the promise to replace product screenshots because the images are still accurate.',
        result.all_action_items[0]!.text,
      ].join(' '),
    );
    const metadata = result.generation_metadata!.source_provenance!.blocks;
    expect(metadata.overview?.sources).toEqual([
      ...metadata['all_decisions:0']!.sources,
      ...metadata['topic:1:summary']!.sources,
      ...metadata['all_action_items:0']!.sources,
    ]);
  },
);
