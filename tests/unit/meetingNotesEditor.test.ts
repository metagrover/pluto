import { expect, it } from 'vitest';
import {
  acceptEditedNotes,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import {
  buildNotesEditorPrompt,
  countEditedBlocks,
  parseEditedNotes,
} from '../../electron/llm/meetingNotesEditor';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import {
  makeDirectNotesFixture,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

it('counts changed blocks without treating node ids as editorial changes', () => {
  const { draft } = makeDirectNotesFixture();
  const next = structuredClone(draft);
  next.sections[0]!.items[0]!.id = 'new-node:item:0';
  expect(countEditedBlocks(draft, next)).toBe(0);
  next.sections[0]!.items[0]!.text = 'Send the outline to reviewers';
  expect(countEditedBlocks(draft, next)).toBe(1);
  next.sections[0]!.items = [];
  expect(countEditedBlocks(draft, next)).toBe(1);
});

it('accepts a complete source-reviewed document without patches or per-block verdicts', () => {
  const { source, draft, expectedAction } = makeDirectNotesFixture();
  const reviewed = parseEditedNotes({ raw: JSON.stringify(draft), source });
  expect(projectAuditedNotes(reviewed.audited).all_action_items).toEqual([
    expect.objectContaining(expectedAction),
  ]);
});

it('runs full-document editing through the bounded two-stage pipeline', async () => {
  const { source, draft, expectedAction } = makeDirectNotesFixture();
  const tasks: string[] = [];
  const result = await generateMeetingNotes({
    source,
    context: {
      userNotes: '',
      template: 'auto',
      trustedUserTerms: [],
      entityHints: [],
    },
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
    reviewProtocol: 'editor',
    generate: async (request) => {
      tasks.push(request.task);
      return JSON.stringify(draft);
    },
  });
  expect(tasks).toEqual(['notesWriter', 'notesAudit']);
  expect(result.all_action_items).toEqual([
    expect.objectContaining(expectedAction),
  ]);
  expect(result.generation_metadata?.pipeline_version).toBe('writer-editor-v1');
});

it('keeps corrected discussion without promoting conditional willingness to a task', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Ben',
      text: 'If legal approves, I can draft the announcement.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const spans = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.title = {
    id: 's0:title',
    text: 'Announcement possibility',
    sources: spans,
  };
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'point',
      text: 'Ben offered to draft the announcement if legal approves; no assignment was accepted.',
      sources: spans,
      owner: null,
      due: null,
    },
  ];
  const result = projectAuditedNotes(
    parseEditedNotes({ raw: JSON.stringify(draft), source }).audited,
  );
  expect(result.all_action_items).toEqual([]);
  expect(result.topics[0]!.summary).toMatch(/announcement.*legal/i);
  expect(source.segments[0]!.text).toBe(
    'If legal approves, I can draft the announcement.',
  );
});

it('rejects an uncorrected commitment instead of silently removing its discussion', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Ben',
      text: 'If legal approves, I can draft the announcement.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'action',
      text: 'Ben will draft the announcement if legal approves.',
      sources,
      owner: 'Ben',
      due: null,
    },
  ];
  expect(() =>
    parseEditedNotes({ raw: JSON.stringify(draft), source }),
  ).toThrow(/conditional_willingness.*point/);
});

it('conservatively preserves conditional willingness as source text instead of a commitment', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Ben',
      text: 'If legal approves, I can draft the announcement.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'action',
      text: 'Ben will draft the announcement if legal approves.',
      sources,
      owner: 'Ben',
      due: null,
    },
  ];

  const reviewed = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });

  expect(reviewed.draft.sections[0]!.items).toEqual([
    expect.objectContaining({
      kind: 'point',
      text: 'If legal approves, I can draft the announcement.',
      owner: null,
      due: null,
    }),
  ]);
  expect(reviewed.issues).toContain(
    'deterministic_reclassified_conditional_willingness:s0:item:0',
  );
});

it('holds a copied disfluent writer point for source review', () => {
  const text =
    'as a homework just on each face I can review the kind of work that would have done and if if word change changes';
  const source = makeSyntheticNotesSource([{ speaker: 'Ben', text }]);
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const { draft } = makeDirectNotesFixture();
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'point',
      text,
      sources,
      owner: null,
      due: null,
    },
  ];

  const projected = projectAuditedNotes(
    acceptEditedNotes({ source, draft, acceptancePolicy: 'conservative' }),
  );

  expect(projected.topics).toEqual([]);
  expect(projected.quality.issues).toContain(
    'deterministic_review_unclear_prose:s0:item:0',
  );
  expect(projected.generation_metadata?.prose_review?.items[0]).toMatchObject({
    original_text: text,
    evidence: text,
    reason: 'raw_transcript_like',
  });
});

it('holds transcript-like prose introduced by conservative action reclassification', () => {
  const text =
    'I can review the kind of work that would have done and if if word change changes after the meeting without a deadline';
  const source = makeSyntheticNotesSource([{ speaker: 'Ben', text }]);
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const { draft } = makeDirectNotesFixture();
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'action',
      text: 'Ben will review the work after the meeting.',
      sources,
      owner: 'Ben',
      due: null,
    },
  ];

  const reviewed = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });

  expect(reviewed.draft.sections[0]!.items).toEqual([]);
  expect(reviewed.issues).toEqual(
    expect.arrayContaining([
      'deterministic_reclassified_conditional_willingness:s0:item:0',
      'deterministic_review_unclear_prose:s0:item:0',
    ]),
  );
  expect(reviewed.proseReviewItems?.[0]?.original_text).toBe(text);
});

it('does not hold a coherent first-person source excerpt without repeated words', () => {
  const text =
    'If legal approves the final version, I can draft the announcement for the launch team tomorrow morning.';
  const source = makeSyntheticNotesSource([{ speaker: 'Ben', text }]);
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const { draft } = makeDirectNotesFixture();
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'point',
      text,
      sources,
      owner: null,
      due: null,
    },
  ];

  const reviewed = acceptEditedNotes({ source, draft });

  expect(reviewed.draft.sections[0]!.items[0]?.text).toBe(text);
  expect(reviewed.proseReviewItems).toBeUndefined();
});

it('rejects fabricated source references', () => {
  const { source, draft } = makeDirectNotesFixture();
  draft.sections[0]!.items[0]!.sources = [{ segment: 99, start: 0, end: 12 }];
  expect(() =>
    parseEditedNotes({ raw: JSON.stringify(draft), source }),
  ).toThrow();
});

it('does not silently change a wrong owner while leaving contradictory prose', () => {
  const { source, draft } = makeDirectNotesFixture();
  Object.assign(draft.sections[0]!.items[0]!, {
    text: 'Jules will send the outline.',
    owner: 'Jules',
  });
  expect(() =>
    parseEditedNotes({ raw: JSON.stringify(draft), source }),
  ).toThrow(/invalid_commitment/);
});

it('preserves the speaker of an explicit declarative decision', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Nadia',
      text: 'The decision is a staged rollout. Stages limit the impact of failures.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'decision',
      text: 'Use a staged rollout to limit the impact of failures.',
      sources,
      owner: 'Nadia',
      due: null,
    },
  ];
  expect(
    projectAuditedNotes(
      parseEditedNotes({ raw: JSON.stringify(draft), source }).audited,
    ).all_decisions[0]?.decided_by,
  ).toBe('Nadia');
});

it('derives the speaker for an explicit decision and preserves its rejected alternative', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Nadia',
      text: 'The decision is a staged rollout. We are rejecting the big-bang launch because stages limit the impact of failures.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'decision',
      text: 'A staged rollout is chosen; a big-bang launch is rejected because stages limit the impact of failures.',
      sources,
      owner: null,
      due: null,
    },
  ];
  expect(
    projectAuditedNotes(
      parseEditedNotes({
        raw: JSON.stringify(draft),
        source,
        compactDraft: true,
      }).audited,
    ).all_decisions[0]?.decided_by,
  ).toBe('Nadia');
});

it('keeps a withdrawal replacement explanation as discussion, not a decision', () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Owen',
      text: 'I withdraw the Friday commitment. Instead I will send a corrected forecast on Monday.',
    },
    {
      speaker: 'Lila',
      text: 'The corrected Monday version replaces the old draft, not an additional delivery.',
    },
  ]);
  const { draft } = makeDirectNotesFixture();
  const sources = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'decision',
      text: 'The corrected forecast on Monday replaces the old draft, not an additional delivery.',
      sources,
      owner: null,
      due: null,
    },
  ];
  const result = projectAuditedNotes(
    parseEditedNotes({
      raw: JSON.stringify(draft),
      source,
      compactDraft: true,
    }).audited,
  );
  expect(result.all_decisions).toEqual([]);
  expect(result.topics[0]?.summary).toMatch(/replaces.*old draft/i);
});

it('rejects source labels leaking into visible prose but permits labels spoken in the source', () => {
  const { source, draft } = makeDirectNotesFixture();
  draft.sections[0]!.items[0]!.text = 'Send the outline (R0).';
  expect(() =>
    parseEditedNotes({ raw: JSON.stringify(draft), source }),
  ).toThrow(/source_label/);
  const actualSource = makeSyntheticNotesSource([
    { speaker: 'Nira', text: 'R0 is the release name.' },
  ]);
  const sources = [
    { segment: 0, start: 0, end: actualSource.segments[0]!.text.length },
  ];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'point',
      text: 'R0 is the release name.',
      sources,
      owner: null,
      due: null,
    },
  ];
  expect(() =>
    parseEditedNotes({ raw: JSON.stringify(draft), source: actualSource }),
  ).not.toThrow();
});

it.each([true, false])(
  'applies only trusted terminology, keeping original evidence (trusted=%s)',
  (trusted) => {
    const source = makeSyntheticNotesSource([
      { speaker: 'Milo', text: 'Ovaltree was discussed as an option.' },
    ]);
    const sources = [
      { segment: 0, start: 0, end: source.segments[0]!.text.length },
    ];
    const draft = {
      meetingType: 'general',
      overview: { text: 'Ovaltree was discussed.', sources },
      recentWin: null,
      sections: [],
      terminology: [
        {
          rawForms: ['Ovaltree'],
          preferredTerm: 'Ogletree',
          segmentIndexes: [0],
          confidence: 'high',
          signals: ['known_entity'],
        },
      ],
    };
    const result = projectAuditedNotes(
      parseEditedNotes({
        raw: JSON.stringify(draft),
        source,
        terminology: {
          trustedUserTerms: trusted ? ['Ogletree'] : [],
          provider: 'ollama',
          model: 'test',
        },
      }).audited,
    );
    expect(result.overview).toBe(
      `${trusted ? 'Ogletree' : 'Ovaltree'} was discussed.`,
    );
    expect(
      result.generation_metadata?.source_provenance?.blocks.overview.sources,
    ).toEqual(sources);
    expect(source.segments[0]!.text).toBe(
      'Ovaltree was discussed as an option.',
    );
  },
);

it('asks for one edited document rather than a patch protocol', () => {
  const { draft } = makeDirectNotesFixture();
  const prompt = buildNotesEditorPrompt({
    sourceText: 'source data',
    draft,
    userNotes: '',
    knownTerms: [],
  });
  expect(prompt).toContain('complete corrected document');
  expect(prompt).not.toContain('REQUIRED REVIEW TARGETS');
  expect(prompt).not.toContain('"op":"replace"');
  expect(prompt).toContain('original source');
  expect(prompt).not.toContain(
    'You produce compact, source-grounded Pluto meeting-note drafts.',
  );
  expect(prompt).toContain('final state');
  expect(prompt).toContain('third person');
  const shownDraft = JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)![1]!,
  );
  expect(shownDraft).toEqual(draft);
});

it('documents valid hierarchy cancellation and deduplication contracts', () => {
  const { draft } = makeDirectNotesFixture();
  const prompt = buildNotesEditorPrompt({
    sourceText: 'source',
    draft,
    userNotes: '',
    knownTerms: [],
    inherited: draft.sections[0]!.items,
  });
  expect(prompt).toContain(
    'for deduplicated, replacementId is the retained inherited id',
  );
  expect(prompt).toContain(
    'Preserve the id of each retained inherited commitment',
  );
});
