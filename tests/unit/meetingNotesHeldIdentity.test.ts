import { expect, it } from 'vitest';
import {
  acceptEditedNotes,
  applyNotesAudit,
  applySourceBoundSemanticReview,
} from '../../electron/llm/meetingNotesAudit';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type { NotesDraft } from '../../electron/llm/meetingNotesTypes';

const fixture = (bothConditional = false) => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Arden',
        text: `I will inspect the stage lights by November 10, 2026, and print the programme by November 11, 2026. Printing the programme must wait until Robin approves the layout; ${
          bothConditional
            ? 'inspecting the stage lights must wait until Casey approves the rig.'
            : 'the light inspection does not need that approval.'
        }`,
      },
    ]),
  );
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  const draft: NotesDraft = {
    title: null,
    overview: null,
    meetingType: 'general',
    sections: [
      {
        id: 'section',
        title: { id: 'heading', text: 'Theatre arrangements', sources },
        items: [
          {
            id: 'inspection',
            kind: 'action',
            text: 'Inspect the stage lights.',
            owner: 'Arden',
            due: 'November 10, 2026',
            sources,
          },
          {
            id: 'printing',
            kind: 'action',
            text: 'Print the programme.',
            owner: 'Arden',
            due: 'November 11, 2026',
            sources,
          },
        ],
      },
    ],
  };
  return { source, draft };
};

it('preserves distinct original responsibilities when conservative admission gives them identical quoted discussion', () => {
  const { source, draft } = fixture(true);
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const items = admitted.draft.sections[0]!.items;
  expect(items.map(({ id }) => id)).toEqual(['inspection', 'printing']);
  expect(items.map(({ kind }) => kind)).toEqual(['point', 'point']);
  expect(items[0]!.text).toBe(items[1]!.text);
  expect(items[0]!.sources).toEqual(items[1]!.sources);
});

it('retains both source-held cases through normal pipeline review with separate deadlines and prerequisites', async () => {
  const { source, draft } = fixture();
  let reviews = 0;
  const result = await generateMeetingNotes({
    source,
    context: {
      userNotes: '',
      template: 'auto',
      trustedUserTerms: [],
      entityHints: [],
    },
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16384,
    compactWriterContract: false,
    hierarchyAuditStrategy: 'deterministic_only',
    generate: async () => JSON.stringify(draft),
    reviewSourceBoundNotes: (notes) =>
      reviewSourceBoundNotes(notes, async ({ prompt }) => {
        reviews++;
        const cases = JSON.parse(prompt.split('\n').at(-1)!);
        expect(cases).toHaveLength(2);
        expect(
          cases.map(
            ({ operationFocus }: { operationFocus: string }) => operationFocus,
          ),
        ).toEqual(['Inspect the stage lights', 'Print the programme']);
        expect(cases[0].subjectSpeech).toBe(cases[1].subjectSpeech);
        return JSON.stringify({
          resolutions: cases.map(
            ({
              id,
              operationFocus,
            }: { id: string; operationFocus: string }) => ({
              id,
              kind: 'accepted_action',
              text: operationFocus.startsWith('Inspect')
                ? 'Inspect the stage lights by November 10, 2026.'
                : 'Print the programme by November 11, 2026, but wait until Robin approves the layout.',
              owner: 'Arden',
              due: operationFocus.startsWith('Inspect')
                ? '2026-11-10'
                : '2026-11-11',
              discussion: null,
            }),
          ),
        });
      }),
  });
  expect(reviews).toBe(1);
  expect(result.all_action_items).toHaveLength(2);
  expect(result.all_action_items.map(({ due }) => due)).toEqual([
    '2026-11-10',
    '2026-11-11',
  ]);
  expect(result.all_action_items[0]!.text).not.toContain('approval');
  expect(result.all_action_items[1]!.text).toContain('until Robin approves');
});

it('keeps a genuinely repeated original responsibility eligible for the existing exact point collapse', () => {
  const { source, draft } = fixture(true);
  draft.sections[0]!.items = [
    draft.sections[0]!.items[0]!,
    { ...draft.sections[0]!.items[0]!, id: 'duplicate' },
  ];
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  expect(admitted.draft.sections[0]!.items).toHaveLength(1);
  expect(admitted.issues).toContain(
    'deterministic_collapsed_points:inspection',
  );
});

it('does not admit the writer’s unconditional printing statement during initial conservative validation', () => {
  const { source, draft } = fixture();
  draft.sections[0]!.items = [draft.sections[0]!.items[1]!];
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  expect(admitted.issues).toContain(
    'deterministic_unsupported_commitment:printing',
  );
  expect(admitted.draft.sections[0]!.items[0]!.kind).toBe('point');
});

it('holds an unconditional printing resolution until the source prerequisite is restored', async () => {
  const { source, draft } = fixture();
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const reviewed = await reviewSourceBoundNotes(admitted, async () =>
    JSON.stringify({
      resolutions: [
        {
          id: 'inspection',
          kind: 'accepted_action',
          text: 'Inspect the stage lights by November 10, 2026.',
          owner: 'Arden',
          due: '2026-11-10',
          discussion: null,
        },
        {
          id: 'printing',
          kind: 'accepted_action',
          text: 'Print the programme by November 11, 2026.',
          owner: 'Arden',
          due: '2026-11-11',
          discussion: null,
        },
      ],
    }),
  );
  expect(reviewed.issues).toContain(
    'semantic_notes_review_unavailable:printing',
  );
  expect(
    reviewed.draft.sections[0]!.items.find(({ id }) => id === 'printing')!.kind,
  ).toBe('point');
});

it('rejects a direct review callback that omits the same subject’s supported prerequisite', () => {
  const { source, draft } = fixture();
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const item = admitted.draft.sections[0]!.items.find(
    ({ id }) => id === 'printing',
  )!;
  expect(() =>
    applySourceBoundSemanticReview(admitted, [
      {
        ...item,
        kind: 'action',
        text: 'Print the programme by November 11, 2026.',
        owner: 'Arden',
        due: '2026-11-11',
      },
    ]),
  ).toThrow('invalid_notes_audit');
});

it('preserves original identities before exact-point collapse when early guardrails hold two conditional actions', async () => {
  const speech =
    'I will send the invitations after Casey confirms the hall. I will publish the timetable after Devon approves the session order.';
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Wren', text: speech }]),
  );
  const sources = [{ segment: 0, start: 0, end: speech.length }];
  const items = ['Send the invitations.', 'Publish the timetable.'].map(
    (text, index) => ({
      id: `task-${index}`,
      kind: 'action' as const,
      text,
      owner: 'Wren',
      due: null,
      sources,
    }),
  );
  let writerCalls = 0;
  let reviewCalls = 0;
  const result = await generateMeetingNotes({
    source,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16384,
    compactWriterContract: false,
    hierarchyAuditStrategy: 'deterministic_only',
    context: {
      userNotes: '',
      template: 'auto',
      trustedUserTerms: [],
      entityHints: [],
    },
    generate: async () => {
      writerCalls++;
      return JSON.stringify({
        title: null,
        overview: null,
        meetingType: 'general',
        sections: [
          {
            id: 'section',
            title: { id: 'heading', text: 'Workshop arrangements', sources },
            items,
          },
        ],
      });
    },
    reviewSourceBoundNotes: (notes) => {
      reviewCalls++;
      expect(notes.draft.sections[0]!.items).toHaveLength(2);
      expect(
        [...notes.reviewOriginals!.values()].map(({ text }) => text),
      ).toEqual(items.map(({ text }) => text));
      return reviewSourceBoundNotes(notes, async ({ prompt }) => {
        const cases = JSON.parse(prompt.split('\n').at(-1)!);
        expect(
          cases.map(
            ({ operationFocus }: { operationFocus: string }) => operationFocus,
          ),
        ).toEqual(['Send the invitations', 'Publish the timetable']);
        return JSON.stringify({
          resolutions: cases.map(
            ({
              id,
              operationFocus,
            }: { id: string; operationFocus: string }) => ({
              id,
              kind: 'accepted_action',
              owner: 'Wren',
              due: null,
              discussion: null,
              text: operationFocus.startsWith('Send')
                ? 'Send the invitations after Casey confirms the hall.'
                : 'Publish the timetable after Devon approves the session order.',
            }),
          ),
        });
      });
    },
  });
  expect(writerCalls).toBe(1);
  expect(reviewCalls).toBe(1);
  expect(
    result.all_action_items.map(({ text, assignee, due }) => ({
      text,
      assignee,
      due,
    })),
  ).toEqual([
    {
      text: 'Send the invitations after Casey confirms the hall.',
      assignee: 'Wren',
      due: undefined,
    },
    {
      text: 'Publish the timetable after Devon approves the session order.',
      assignee: 'Wren',
      due: undefined,
    },
  ]);
});

it('validates and clones inherited same-id originals without introducing unrelated item ids', () => {
  const { source, draft } = fixture();
  const original = draft.sections[0]!.items[0]!;
  const admitted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
    reviewOriginals: new Map([
      [original.id, original],
      ['unrelated', { ...original, id: 'unrelated' }],
    ]),
  });
  expect(admitted.reviewOriginals!.get(original.id)).toEqual(original);
  expect(admitted.reviewOriginals!.get(original.id)).not.toBe(original);
  expect(admitted.reviewOriginals!.has('unrelated')).toBe(false);
  expect(() =>
    acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
      reviewOriginals: new Map([
        [
          original.id,
          { ...original, sources: [{ segment: 99, start: 0, end: 1 }] },
        ],
      ]),
    }),
  ).toThrow();
  expect(() =>
    acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
      reviewOriginals: new Map([
        [original.id, { ...original, id: 'mismatched' }],
      ]),
    }),
  ).toThrow('invalid_notes_audit');
});

it('uses corrected and inserted audit action identities rather than stale writer identities', () => {
  const speech = 'I will send the invitations. I will publish the timetable.';
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Wren', text: speech }]),
  );
  const sources = [{ segment: 0, start: 0, end: speech.length }];
  const first = {
    id: 'item',
    kind: 'action' as const,
    text: 'Wren will send the invitations.',
    owner: 'Wren',
    due: null,
    sources,
  };
  const second = {
    ...first,
    id: 'inserted',
    text: 'Wren will publish the timetable.',
  };
  const draft: NotesDraft = {
    title: null,
    overview: null,
    meetingType: 'general',
    sections: [
      {
        id: 'section',
        title: { id: 'heading', text: 'Arrangements', sources },
        items: [
          { ...first, kind: 'point', text: 'Wren described arrangements.' },
        ],
      },
    ],
  };
  const audit = {
    changes: [
      { op: 'replace' as const, target: 'item', value: first },
      { op: 'insert' as const, section: 'section', value: second },
    ],
    verdicts: ['heading', 'item', 'inserted'].map((target) => ({
      target,
      status: 'supported' as const,
      sources,
    })),
    dispositions: [],
    terminology: [],
  };
  const before = structuredClone({ draft, audit });
  const admitted = applyNotesAudit({ source, draft, audit });
  expect({ draft, audit }).toEqual(before);
  expect([...admitted.reviewOriginals!.values()]).toEqual([first, second]);
  expect(admitted.draft.sections[0]!.items.map(({ text }) => text)).toEqual([
    'Send the invitations',
    'Publish the timetable',
  ]);
  admitted.draft.sections[0]!.items[0]!.text = 'Changed presentation';
  expect(admitted.reviewOriginals!.get('item')!.text).toBe(first.text);
  expect(admitted.reviewOriginals!.get('inserted')).not.toBe(second);
});
