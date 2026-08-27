import { expect, it } from 'vitest';
import { projectAuditedNotes } from '../../electron/llm/meetingNotesAudit';
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
