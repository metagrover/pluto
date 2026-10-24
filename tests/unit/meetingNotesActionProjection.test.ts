import { expect, it } from 'vitest';
import {
  acceptEditedNotes,
  applySourceBoundSemanticReview,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesItem,
} from '../../electron/llm/meetingNotesTypes';

const short = 'Send the programme after the board approves the plan.';
const long =
  'Send the programme after the board approves the plan; the room inspection does not need that approval.';

const fixture = (texts = [short, long]) => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Avery',
        text: 'I will send the programme after the board approves the plan. The room inspection does not need that approval. I will review the programme after the board approves the plan.',
      },
      {
        speaker: 'Avery',
        text: 'I will send the programme after the board approves the plan. The room inspection does not need that approval.',
      },
    ]),
  );
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  const items: NotesItem[] = texts.map((text, index) => ({
    id: `work-${index}`,
    kind: 'action',
    text,
    owner: 'Avery',
    due: '2026-11-10',
    sources,
  }));
  const draft: NotesDraft = {
    title: null,
    overview: null,
    meetingType: 'general',
    sections: [
      {
        id: 'section',
        title: { id: 'heading', text: 'Programme arrangements', sources },
        items,
      },
    ],
  };
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  // Real review admission certifies the exact supplied conditional statements.
  const retained = new Set(
    admitted.draft.sections[0]!.items.map((item) => item.id),
  );
  return applySourceBoundSemanticReview(
    admitted,
    items.filter((item) => retained.has(item.id)),
  );
};

it.each([false, true])(
  'projects a complete-clause redundant action once while retaining the fuller statement and provenance (reverse=%s)',
  (reverse) => {
    const notes = fixture(reverse ? [long, short] : [short, long]);
    const result = projectAuditedNotes(notes);
    expect(result.all_action_items).toHaveLength(1);
    expect(result.all_action_items[0]!.text).toBe(long);
    const provenance =
      result.generation_metadata.source_provenance!.blocks[
        'all_action_items:0'
      ]!;
    expect(provenance.id).toBe(reverse ? 'work-0' : 'work-1');
    expect(provenance.sources).toEqual(
      notes.draft.sections[0]!.items[0]!.sources,
    );
    expect(notes.draft.sections[0]!.items).toHaveLength(2);
  },
);

it('retains distinct responsibilities sharing owner, deadline and source speech', () => {
  const notes = fixture([
    short,
    'Review the programme after the board approves the plan.',
  ]);
  expect(projectAuditedNotes(notes).all_action_items).toHaveLength(2);
});

it('keeps the fuller item in the first slot when exact duplicates recur beside distinct work', () => {
  const distinct = 'Review the programme after the board approves the plan.';
  const notes = fixture([short, distinct, long, short, long]);
  const result = projectAuditedNotes(notes);
  expect(result.all_action_items.map((item) => item.text)).toEqual([
    long,
    distinct,
  ]);
  expect(
    result.generation_metadata.source_provenance!.blocks['all_action_items:0']!
      .id,
  ).toBe('work-2');
});

it('does not grant projection trust to an unreviewed copy', () => {
  const notes = fixture();
  expect(() => projectAuditedNotes({ ...notes })).toThrow(
    'notes_unreviewed_projection',
  );
});

it.each([
  [
    'null owner',
    (item: NotesItem) => {
      item.owner = null;
    },
  ],
  [
    'different owner',
    (item: NotesItem) => {
      item.owner = 'Rory';
    },
  ],
  [
    'different deadline',
    (item: NotesItem) => {
      item.due = '2026-11-11';
    },
  ],
  [
    'different source',
    (item: NotesItem) => {
      item.sources = [{ segment: 1, start: 0, end: 10 }];
    },
  ],
  [
    'different source ordering',
    (item: NotesItem) => {
      item.sources = [...item.sources].reverse();
    },
  ],
] as const)('does not subsume actions with %s', (_label, change) => {
  const notes = fixture();
  // Isolate the projection's conservative matching controls after real admission.
  if (_label === 'different source ordering') {
    const spans = [
      notes.draft.sections[0]!.items[0]!.sources[0]!,
      { segment: 1, start: 0, end: notes.source.segments[1]!.text.length },
    ];
    notes.draft.sections[0]!.items.forEach((item) => {
      item.sources = spans;
    });
  }
  change(notes.draft.sections[0]!.items[1]!);
  expect(projectAuditedNotes(notes).all_action_items).toHaveLength(2);
});

it.each([
  'Send the programme after the board approves the plan for the festival.',
  'Send the programme after the board approves the plans; the room inspection does not need that approval.',
  'Send the programme after the board approves the plan. The room inspection does not need that approval.',
  'Send the programme before the board approves the plan; the room inspection does not need that approval.',
])(
  'does not infer action equivalence without an exact complete semicolon clause: %s',
  (text) => {
    const notes = fixture();
    notes.draft.sections[0]!.items[1]!.text = text;
    expect(projectAuditedNotes(notes).all_action_items).toHaveLength(2);
  },
);
