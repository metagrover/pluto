import { afterEach, expect, it, vi } from 'vitest';
import * as budget from '../../electron/llm/meetingNotesBudget';
import * as hierarchy from '../../electron/llm/meetingNotesHierarchy';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesRequest,
} from '../../electron/llm/meetingNotesTypes';

// Explicit legacy standard-writer/every-node audit contract. The normal product
// uses compact writing plus genuine full-source review (covered by routing tests).
// These controls retain audit insertion, overlap evidence and fail-closed behavior.
afterEach(() => vi.restoreAllMocks());

const fixture = () => {
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Wren', text: 'The community hall has a side entrance.' },
      { speaker: 'Wren', text: 'I will send the volunteer schedule to Casey.' },
      { speaker: 'Casey', text: 'The workshop begins at noon.' },
    ]),
  );
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  // Force two small source packets to exercise the hierarchy without changing
  // request budgets or hiding any source text in a large synthetic transcript.
  vi.spyOn(budget, 'planNotesCapacity').mockReturnValue({
    mode: 'hierarchical',
  });
  vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
    {
      primarySpans: spans.slice(0, 2),
      overlapSpans: [],
      primaryText: '',
      sourceText: '',
      sourceRevision: source.revision,
    },
    {
      primarySpans: [spans[2]!],
      overlapSpans: [spans[0]!],
      primaryText: '',
      sourceText: '',
      sourceRevision: source.revision,
    },
  ]);
  return { source, spans };
};

const packet = (prompt: string) =>
  (prompt.match(/BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/)?.[1] ?? '')
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          descriptor: { segment: number; start: number; end: number };
          text: string;
        },
    );
const draftIn = (prompt: string) =>
  JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)?.[1] ?? '{}',
  ) as NotesDraft;
const context = {
  userNotes: '',
  template: 'auto' as const,
  trustedUserTerms: [],
  entityHints: [],
};

it('audits every primary and overlap turn, inserts a writer-omitted responsibility and retains it through the final merge', async () => {
  const { source, spans } = fixture();
  const auditPackets: number[][] = [];
  const generate = vi.fn(async (request: NotesRequest) => {
    const supplied = packet(request.prompt);
    if (request.task === 'notesWriter') {
      // Both writers omit the promised responsibility and cite only background.
      const background = supplied.some(
        (entry) => entry.descriptor.segment === 2,
      )
        ? 2
        : 0;
      return JSON.stringify({
        title: null,
        overview: null,
        meetingType: 'general',
        sections: [
          {
            id: 'section',
            title: {
              id: 'heading',
              text: 'Workshop arrangements',
              sources: [spans[background]!],
            },
            items: [
              {
                id: 'background',
                kind: 'point',
                text: source.segments[background]!.text,
                owner: null,
                due: null,
                sources: [spans[background]!],
              },
            ],
          },
        ],
      });
    }
    if (request.task === 'notesMerge') {
      const children = JSON.parse(
        request.prompt.match(
          /BEGIN CHILD DRAFTS\n([\s\S]*?)\nEND CHILD DRAFTS/,
        )![1]!,
      ) as NotesDraft[];
      expect(
        children
          .flatMap((draft) =>
            draft.sections.flatMap((section) => section.items),
          )
          .some(
            (item) =>
              item.text.replace(/\.$/, '') ===
              'Send the volunteer schedule to Casey',
          ),
      ).toBe(true);
      return JSON.stringify({
        title: null,
        overview: null,
        meetingType: 'general',
        sections: children.flatMap((child) => child.sections),
      });
    }
    auditPackets.push(supplied.map((entry) => entry.descriptor.segment));
    const draft = draftIn(request.prompt);
    const shouldInsert =
      supplied.some((entry) => entry.descriptor.segment === 1) &&
      !draft.sections.some((section) =>
        section.items.some((item) => item.kind === 'action'),
      );
    const restored = {
      id: 'restored-schedule',
      kind: 'action',
      text: 'Send the volunteer schedule to Casey.',
      owner: 'Wren',
      due: null,
      sources: [spans[1]!],
    };
    const blocks = [
      ...(draft.title ? [draft.title] : []),
      ...(draft.overview ? [draft.overview] : []),
      ...draft.sections.flatMap((section) => [section.title, ...section.items]),
      ...(shouldInsert ? [restored] : []),
    ];
    return JSON.stringify({
      changes: shouldInsert
        ? [{ op: 'insert', section: draft.sections[0]!.id, value: restored }]
        : [],
      verdicts: blocks.map((block) => ({
        target: block.id,
        status: 'supported',
        sources: block.sources,
      })),
      dispositions: [],
      terminology: [],
    });
  });
  const result = await generateMeetingNotes({
    source,
    context,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16384,
    compactWriterContract: false,
    hierarchyAuditStrategy: 'every_node',
    generate,
  });
  expect(
    auditPackets.map((packet) => [...packet].sort((a, b) => a - b)),
  ).toEqual([
    [0, 1],
    [0, 2],
    [0, 1, 2],
  ]);
  expect(result.all_action_items).toHaveLength(1);
  expect(result.all_action_items[0]).toMatchObject({
    text: 'Send the volunteer schedule to Casey',
    assignee: 'Wren',
  });
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesWriter',
    'notesAudit',
    'notesMerge',
    'notesAudit',
  ]);
});

it('refuses invalid mandatory leaf audits instead of publishing the unaudited writer', async () => {
  const { source, spans } = fixture();
  const generate = vi.fn(async (request: NotesRequest) =>
    request.task === 'notesAudit'
      ? '{'
      : JSON.stringify({
          title: null,
          overview: null,
          meetingType: 'general',
          sections: [
            {
              title: { text: 'Workshop arrangements', sources: [spans[0]!] },
              items: [
                {
                  kind: 'point',
                  text: source.segments[0]!.text,
                  owner: null,
                  due: null,
                  sources: [spans[0]!],
                },
              ],
            },
          ],
        }),
  );
  await expect(
    generateMeetingNotes({
      source,
      context,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
      compactWriterContract: false,
      hierarchyAuditStrategy: 'every_node',
      generate,
    }),
  ).rejects.toThrow('notes_audit_invalid');
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
});

it('refuses a repaired unsupported action before mandatory semantic review instead of deleting it', async () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Wren',
        text: 'I might send the volunteer schedule to Casey, but I have not agreed to do it.',
      },
    ]),
  );
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesWriter')
      return JSON.stringify({
        title: null,
        overview: null,
        meetingType: 'general',
        sections: [
          {
            title: { text: 'Workshop arrangements', sources },
            items: [
              {
                kind: 'point',
                text: 'Wren might send the volunteer schedule but has not agreed to do it.',
                owner: null,
                due: null,
                sources,
              },
            ],
          },
        ],
      });
    const draft = draftIn(request.prompt);
    const target = draft.sections[0]!.items[0]!;
    return JSON.stringify({
      changes: [
        {
          op: 'replace',
          target: target.id,
          value: {
            ...target,
            kind: 'action',
            text: 'Send the volunteer schedule to Casey.',
            owner: 'Wren',
          },
        },
      ],
      verdicts: draft.sections
        .flatMap((section) => [section.title, ...section.items])
        .map((block) => ({
          target: block.id,
          status: 'supported',
          sources: block.sources,
        })),
      dispositions: [],
      terminology: [],
    });
  });
  const review = vi.fn(
    async (
      notes: import('../../electron/llm/meetingNotesAudit').AuditedNotes,
    ) => notes,
  );
  await expect(
    generateMeetingNotes({
      source,
      context,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
      compactWriterContract: false,
      hierarchyAuditStrategy: 'every_node',
      generate,
      reviewSourceBoundNotes: review,
    }),
  ).rejects.toThrow('notes_audit_invalid');
  expect(review).not.toHaveBeenCalled();
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
});
