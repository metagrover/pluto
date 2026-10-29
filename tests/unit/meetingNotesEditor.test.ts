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
import { quoteCitedSourcePassages } from '../../electron/llm/meetingNotesSource';
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
      text: quoteCitedSourcePassages(source, sources),
      owner: null,
      due: null,
    }),
  ]);
  expect(reviewed.issues).toContain(
    'deterministic_reclassified_conditional_willingness:s0:item:0',
  );
});

it.each([
  [
    'decision',
    'We could enable automatic cleanup after the owner confirms the records.',
    'Enable automatic cleanup.',
    'Ben',
  ],
  [
    'action',
    'The deployment is only a proposal until security reviews it.',
    'Deploy tomorrow.',
    'Ben',
  ],
] as const)(
  'preserves the cited context of an unsupported %s without publishing an outcome',
  (kind, text, claim, owner) => {
    const source = makeSyntheticNotesSource([{ speaker: 'Ben', text }]);
    const sources = [{ segment: 0, start: 0, end: text.length }];
    const { draft } = makeDirectNotesFixture();
    draft.sections[0]!.title.sources = sources;
    draft.sections[0]!.items = [
      { id: 's0:item:0', kind, text: claim, owner, due: 'tomorrow', sources },
    ];

    const reviewed = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
      compactNormalization: true,
    });
    expect(reviewed.draft.sections[0]!.items).toEqual([
      expect.objectContaining({
        kind: 'point',
        text: quoteCitedSourcePassages(source, sources),
        sources,
        owner: null,
        due: null,
      }),
    ]);
    const projected = projectAuditedNotes(reviewed);
    expect(projected.all_action_items).toEqual([]);
    expect(projected.all_decisions).toEqual([]);
    expect(JSON.stringify(projected.topics)).toContain(text);
    expect(() => acceptEditedNotes({ source, draft })).toThrow(
      /invalid_commitment/,
    );
  },
);

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

it('retains transcript-like fallback as an exact quote pending model repair', async () => {
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

  expect(reviewed.draft.sections[0]!.items).toEqual([
    expect.objectContaining({
      kind: 'point',
      text: quoteCitedSourcePassages(source, sources),
      owner: null,
      due: null,
    }),
  ]);
  expect(reviewed.issues).toContain(
    'deterministic_reclassified_conditional_willingness:s0:item:0',
  );
  await expect(
    generateMeetingNotes({
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
      hierarchyAuditStrategy: 'deterministic_only',
      generate: async () => JSON.stringify(draft),
      reviewSourceBoundNotes: async () => reviewed,
    }),
  ).rejects.toThrow('notes_semantic_review_incomplete');
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

it('does not let an explicit decision label bypass unsettled or contradictory source checks', () => {
  const text =
    'The decision is pending approval; the team has not selected a deployment target.';
  const source = makeSyntheticNotesSource([{ speaker: 'Ben', text }]);
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const { draft } = makeDirectNotesFixture();
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'decision',
      text: 'The team selected the production target.',
      owner: null,
      due: null,
      sources,
    },
  ];

  const accepted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
    compactNormalization: true,
  });
  expect(projectAuditedNotes(accepted).all_decisions).toEqual([]);
  expect(accepted.draft.sections[0]!.items[0]).toMatchObject({
    kind: 'point',
    text: quoteCitedSourcePassages(source, sources),
  });
  expect(() =>
    acceptEditedNotes({ source, draft, compactNormalization: true }),
  ).toThrow(/invalid_commitment/);
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

it.each(['Jules will send the outline.', 'Jules to send the outline.'])(
  'keeps source context rather than a corrected owner with contradictory prose: %s',
  (text) => {
    const { source, draft } = makeDirectNotesFixture();
    Object.assign(draft.sections[0]!.items[0]!, { text, owner: 'Jules' });
    const reviewed = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
    expect(projectAuditedNotes(reviewed).all_action_items).toEqual([]);
    expect(reviewed.draft.sections[0]!.items[0]).toMatchObject({
      kind: 'point',
      owner: null,
      due: null,
    });
    expect(reviewed.issues).toContain(
      'deterministic_reclassified_owner_conflict:s0:item:0',
    );
  },
);

it('corrects owner metadata without treating a named recipient as the actor', () => {
  const text = 'I will send the outline to Jules.';
  const source = makeSyntheticNotesSource([{ speaker: 'Milo', text }]);
  const { draft } = makeDirectNotesFixture();
  const sources = [{ segment: 0, start: 0, end: text.length }];
  draft.sections[0]!.title.sources = sources;
  draft.sections[0]!.items = [
    {
      id: 's0:item:0',
      kind: 'action',
      text: 'Send the outline to Jules.',
      owner: 'Jules',
      due: null,
      sources,
    },
  ];
  const reviewed = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  expect(projectAuditedNotes(reviewed).all_action_items).toEqual([
    expect.objectContaining({
      text: 'Send the outline to Jules',
      assignee: 'Milo',
    }),
  ]);
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

it('holds a paraphrased decision for source review when local checks cannot verify its rejected alternative', () => {
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
  expect(() =>
    parseEditedNotes({
      raw: JSON.stringify(draft),
      source,
      compactDraft: true,
    }),
  ).toThrow(/invalid_commitment/);
  const held = acceptEditedNotes({
    source,
    draft,
    compactNormalization: true,
    acceptancePolicy: 'conservative',
  });
  expect(held.issues).toContain(
    'deterministic_unsupported_commitment:s0:item:0',
  );
  expect(held.draft.sections[0]!.items[0]!.kind).toBe('point');
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

it('applies correction-only edits through the existing acceptance path and preserves untouched blocks', () => {
  const { source, draft } = makeDirectNotesFixture();
  const original = structuredClone(draft);
  const raw = JSON.stringify({
    changes: [
      {
        op: 'replace',
        target: draft.sections[0].items[0].id,
        value: {
          ...draft.sections[0].items[0],
          text: 'Milo will send the outline.',
        },
      },
    ],
    dispositions: [],
    terminology: [],
  });
  const edited = parseEditedNotes({ raw, source, originalDraft: draft });
  // The same commitment normalizer runs for complete and correction-only editors.
  const complete = structuredClone(draft);
  complete.sections[0].items[0].text = 'Milo will send the outline.';
  expect(edited.draft).toEqual(
    parseEditedNotes({ raw: JSON.stringify(complete), source }).draft,
  );
  expect(edited.draft.sections[0].title).toEqual(original.sections[0].title);
  expect(draft).toEqual(original);
  const unchanged = parseEditedNotes({
    raw: JSON.stringify({ changes: [], dispositions: [], terminology: [] }),
    source,
    originalDraft: draft,
  });
  expect(unchanged.draft).toEqual(
    parseEditedNotes({ raw: JSON.stringify(draft), source }).draft,
  );
});

it('rejects invented targets, duplicate corrections, references and unsupported commitments', () => {
  const { source, draft } = makeDirectNotesFixture();
  const replace = {
    op: 'replace',
    target: draft.sections[0].items[0].id,
    value: {
      ...draft.sections[0].items[0],
      text: 'Milo will send the outline.',
    },
  };
  const parse = (changes: unknown[]) =>
    parseEditedNotes({
      raw: JSON.stringify({ changes, dispositions: [], terminology: [] }),
      source,
      originalDraft: draft,
    });
  expect(() =>
    parseEditedNotes({ raw: 'not json', source, originalDraft: draft }),
  ).toThrow('notes_audit_invalid');
  expect(() => parse([{ op: 'remove', target: 'invented' }])).toThrow();
  expect(() => parse([replace, replace])).toThrow();
  expect(() =>
    parse([
      {
        ...replace,
        value: {
          ...replace.value,
          sources: [{ segment: 99, start: 0, end: 2 }],
        },
      },
    ]),
  ).toThrow();
  expect(() =>
    parse([
      {
        ...replace,
        value: {
          ...replace.value,
          text: 'Milo will book the hotel by Monday.',
          due: 'Monday',
        },
      },
    ]),
  ).toThrow();
});

it('routes correction-only reviews through the production source and publication checks', async () => {
  const { source, draft, expectedAction } = makeDirectNotesFixture();
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
    reviewProtocol: 'editor',
    correctionOnlyReview: true,
    generate: async (request) => {
      if (request.task === 'notesWriter') return JSON.stringify(draft);
      expect(request.responseContract).toBe('corrections');
      expect(request.prompt).toContain('Read every original source turn');
      return JSON.stringify({ changes: [], dispositions: [], terminology: [] });
    },
  });
  expect(result.all_action_items).toEqual([
    expect.objectContaining(expectedAction),
  ]);
});

it('accepts correction-only compact editors without forcing a rewrite of the existing title', async () => {
  const { source, draft, expectedAction } = makeDirectNotesFixture();
  const title = {
    text: 'Outline follow-up',
    sources: draft.sections[0].title.sources,
  };
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
    compactWriterContract: true,
    compactSourceSpeakers: true,
    correctionOnlyReview: true,
    reviewProtocol: 'editor',
    generate: async (request) =>
      request.task === 'notesWriter'
        ? JSON.stringify({
            title,
            sections: [
              {
                title: 'Outline',
                items: draft.sections[0].items.map(
                  ({ id: _id, ...item }) => item,
                ),
              },
            ],
          })
        : JSON.stringify({ changes: [], dispositions: [], terminology: [] }),
  });
  expect(result.all_action_items).toEqual([
    expect.objectContaining(expectedAction),
  ]);
  expect(result.title).toBe(title.text);
});
