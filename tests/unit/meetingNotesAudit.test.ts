import { expect, it } from 'vitest';
import {
  acceptEditedNotes,
  acceptSourceLedNotes,
  applyNotesAudit,
  applySourceBoundSemanticReview,
  hasOngoingSourceResponsibility,
  parseCompactNotesDraft,
  parseNotesAudit,
  parseNotesDraft,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import {
  groupCitedSourcePassages,
  quoteCitedSourcePassages,
} from '../../electron/llm/meetingNotesSource';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesAudit,
  NotesDraft,
} from '../../electron/llm/meetingNotesTypes';
import { getAnalysisEditBlocks } from '../../src/utils/analysisDocument';
import { rebaseMeetingNotesEdits } from '../../src/utils/meetingNotesEditRebase';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it.each([
  'valid',
  'unknown member',
  'self',
  'repeated member',
  'different owner',
  'outside evidence',
  'missing evidence',
])('applies only a bounded complete semantic merge: %s', (mode) => {
  const { source, draft } = makeDirectNotesFixture();
  const first = draft.sections[0]!.items[0]!;
  const duplicate = { ...structuredClone(first), id: 'duplicate' };
  draft.sections[0]!.items.push(duplicate);
  const notes = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const replacement = { ...structuredClone(first), mergedIds: ['duplicate'] };
  if (mode === 'unknown member') replacement.mergedIds = ['missing'];
  if (mode === 'self') replacement.mergedIds = [first.id];
  if (mode === 'repeated member') replacement.mergedIds.push('duplicate');
  if (mode === 'different owner') replacement.owner = 'Iris';
  if (mode === 'outside evidence') replacement.sources[0]!.segment = 4;
  if (mode === 'missing evidence') replacement.sources = [];
  const before = structuredClone(notes.draft);
  if (mode !== 'valid') {
    expect(() =>
      applySourceBoundSemanticReview(notes, [replacement]),
    ).toThrow();
    expect(notes.draft).toEqual(before);
    return;
  }
  const merged = applySourceBoundSemanticReview(notes, [replacement]);
  expect(projectAuditedNotes(merged).all_action_items).toHaveLength(1);
  expect(merged.draft.sections[0]!.items[0]).not.toHaveProperty('mergedIds');
  expect(notes.draft).toEqual(before);
});

it('preserves a compact writer overview and its evidence through projection', () => {
  const fixture = makeDirectNotesFixture();
  const sources = fixture.draft.sections[0]!.items[0]!.sources;
  const overview = 'The team reviewed the outline and agreed to send it.';
  const draft = parseCompactNotesDraft(
    JSON.stringify({
      title: null,
      overview: { text: overview, sources },
      sections: [
        {
          title: 'Outline',
          items: [
            {
              kind: 'action',
              text: 'Send the outline',
              owner: 'Milo',
              due: null,
              sources,
            },
          ],
        },
      ],
    }),
  );
  const audit = structuredClone(fixture.audit);
  audit.verdicts.push({ target: 'overview', status: 'supported', sources });
  const projected = projectAuditedNotes(
    applyNotesAudit({ ...fixture, draft, audit }),
  );
  expect(projected.overview).toBe(overview);
  expect(
    projected.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual(sources);
});

it.each(['same', 'owner', 'due', 'source', 'section'])(
  'projects exact duplicate commitments once without merging a different %s',
  async (variant) => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker: 'Rowan', text: 'I will send the report by Friday.' },
        { speaker: 'Quinn', text: 'I will send the report by Friday.' },
        { speaker: 'Rowan', text: 'I will send the report by Monday.' },
      ]),
    );
    const sources = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const first = {
      id: 'first',
      kind: 'action' as const,
      text: 'Send the report',
      owner: 'Rowan',
      due: 'Friday',
      sources,
    };
    const second = {
      ...first,
      id: 'second',
      owner: variant === 'owner' ? 'Quinn' : first.owner,
      due: variant === 'due' ? 'Monday' : first.due,
      sources: variant === 'source' ? [sources[0]!] : sources,
    };
    const section = {
      id: 's',
      title: { id: 'h', text: 'Reports', sources },
      items: variant === 'section' ? [first] : [first, second],
    };
    const draft: NotesDraft = {
      title: null,
      overview: null,
      sections: [
        section,
        ...(variant === 'section'
          ? [
              {
                ...section,
                id: 's2',
                title: { ...section.title, id: 'h2' },
                items: [second],
              },
            ]
          : []),
      ],
    };
    const reviewed = await reviewSourceBoundNotes(
      acceptEditedNotes({ source, draft, acceptancePolicy: 'conservative' }),
      async () =>
        JSON.stringify({
          resolutions: [first, second].map((item) => ({
            id: item.id,
            kind: 'accepted_action',
            text: item.text,
            owner: item.owner,
            due: item.due,
            discussion: null,
          })),
        }),
    );
    const result = projectAuditedNotes(reviewed);
    const expected = variant === 'same' ? 1 : 2;
    expect(result.all_action_items).toHaveLength(expected);
    expect(result.topics.flatMap((topic) => topic.action_items)).toHaveLength(
      expected,
    );
    if (variant === 'same') {
      expect(
        Object.values(
          result.generation_metadata!.source_provenance!.blocks,
        ).some((block) => block.id === 'second'),
      ).toBe(false);
      expect(reviewed.draft.sections[0]!.items).toHaveLength(2);
    }
  },
);

it('deduplicates identical model prose without substituting transcript text', () => {
  const text =
    'Do not deploy before staging tests pass, the meeting at 5 is only proposed.';
  const source = createNotesSource(JSON.stringify([{ speaker: 'Sora', text }]));
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const item = {
    id: 'first',
    kind: 'point' as const,
    text: 'The meeting at 5 is only proposed.',
    owner: null,
    due: null,
    sources,
  };
  const draft: NotesDraft = {
    title: null,
    overview: null,
    sections: [
      {
        id: 's',
        title: { id: 'h', text: 'Release', sources },
        items: [item, { ...item, id: 'second' }],
      },
    ],
  };
  const audited = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const result = projectAuditedNotes(audited);
  expect(result.topics[0]!.summary).toBe(item.text);
  expect(result.topics[0]!.key_points).toEqual([]);
  expect(result.overview).toBe(item.text);
  expect(result.all_action_items).toEqual([]);
  expect(result.all_decisions).toEqual([]);
  expect(
    Object.values(result.generation_metadata!.source_provenance!.blocks).some(
      (block) => block.id === 'second',
    ),
  ).toBe(false);
  expect(audited.draft.sections[0]!.items).toEqual([item]);
  expect(audited.issues).toContain('deterministic_collapsed_points:first');
});

it.each(['point', 'question'])(
  'defaults absent non-commitment metadata to unknown for %s only',
  (kind) => {
    const { draft } = makeDirectNotesFixture();
    const raw = JSON.parse(JSON.stringify(draft));
    const item = raw.sections[0].items[0];
    item.kind = kind;
    item.owner = undefined;
    item.due = undefined;
    expect(
      parseNotesDraft(JSON.stringify(raw)).sections[0]!.items[0],
    ).toMatchObject({ owner: null, due: null });
    item.owner = 42;
    expect(() => parseNotesDraft(JSON.stringify(raw))).toThrow(
      'notes_writer_invalid',
    );
  },
);

it.each(['action', 'decision'])(
  'requires explicit commitment metadata for %s',
  (kind) => {
    const { draft } = makeDirectNotesFixture();
    const raw = JSON.parse(JSON.stringify(draft));
    raw.sections[0].items[0].kind = kind;
    raw.sections[0].items[0].owner = undefined;
    raw.sections[0].items[0].due = undefined;
    expect(() => parseNotesDraft(JSON.stringify(raw))).toThrow(
      'notes_writer_invalid',
    );
  },
);

it('omits an empty section after its last claim is rejected', () => {
  const fixture = makeDirectNotesFixture();
  fixture.audit.verdicts[1]!.status = 'unsupported';
  const projected = projectAuditedNotes(applyNotesAudit(fixture));
  expect(projected.topics).toEqual([]);
  expect(
    Object.keys(projected.generation_metadata!.source_provenance!.blocks),
  ).toEqual([]);
});

it('projects draft title to analysis title when present', () => {
  const fixture = makeDirectNotesFixture();
  const span = fixture.draft.sections[0]!.title.sources[0]!;
  fixture.draft.title = {
    id: 'doc:title',
    text: 'Executive Sync',
    sources: [span],
  };
  fixture.audit.verdicts.push({
    target: 'doc:title',
    status: 'supported',
    sources: [span],
  });
  const projected = projectAuditedNotes(applyNotesAudit(fixture));
  expect(projected.title).toBe('Executive Sync');
});

it('does not let an unsupported heading silently discard supported child claims', () => {
  const fixture = makeDirectNotesFixture();
  fixture.audit.verdicts[0]!.status = 'unsupported';
  expect(() => applyNotesAudit(fixture)).toThrow(
    'notes_audit_unsupported_title',
  );
});

it('labels uncertain discussion rather than publishing it as an unqualified fact', () => {
  const fixture = makeDirectNotesFixture();
  fixture.draft.sections[0]!.items[0]!.kind = 'point';
  fixture.audit.verdicts[1]!.status = 'uncertain';
  const projected = projectAuditedNotes(applyNotesAudit(fixture));
  expect(projected.topics[0]!.summary).toMatch(/^Unconfirmed:/);
  expect(
    projected.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual(fixture.draft.sections[0]!.items[0]!.sources);
});

it('lets the audit correct an item kind while preserving the material discussion', () => {
  const fixture = makeDirectNotesFixture();
  const item = fixture.draft.sections[0]!.items[0]!;
  fixture.audit.changes = [
    { op: 'replace', target: item.id, value: { ...item, kind: 'point' } },
  ];
  const result = projectAuditedNotes(applyNotesAudit(fixture));
  expect(result.all_action_items).toEqual([]);
  expect(result.topics[0]?.summary).toBe(item.text);
});

it.each([
  ['The room is ready', 'The room is ready.'],
  ['Who reviews it?', 'Who reviews it?'],
  ['The room is ready!', 'The room is ready!'],
  ['Robin said "Ready!"', 'Robin said "Ready!"'],
  ['Robin said “Ready?”', 'Robin said “Ready?”'],
  ['Robin said “Ready”', 'Robin said “Ready”.'],
])(
  'separates derived overview sentences without rewriting %s',
  (text, ending) => {
    const fixture = makeDirectNotesFixture();
    fixture.draft.sections[0]!.items[0]!.kind = 'point';
    const source = createNotesSource(
      JSON.stringify({
        segments: [
          { speaker: 'Milo', text: 'I will send the outline.' },
          { speaker: 'Robin', text },
        ],
      }),
    );
    const span = { segment: 1, start: 0, end: text.length };
    fixture.draft.sections[0]!.items.push({
      id: 's0:item:1',
      kind: 'point',
      text,
      sources: [span],
      owner: null,
      due: null,
    });
    fixture.audit.verdicts.push({
      target: 's0:item:1',
      status: 'supported',
      sources: [span],
    });
    const original = structuredClone(fixture.draft);
    const projected = projectAuditedNotes(
      applyNotesAudit({ ...fixture, source }),
    );

    expect(projected.overview).toBe(`Send the outline. ${ending}`);
    expect(projected.all_action_items).toEqual([]);
    expect(projected.topics[0]?.key_points).toEqual([{ text }]);
    expect(fixture.draft).toEqual(original);
    expect(
      projected.generation_metadata?.source_provenance?.blocks.overview
        ?.sources,
    ).toEqual([...original.sections[0]!.items[0]!.sources, span]);
  },
);

it('uses discussion for the overview while keeping actions and ownership separate', () => {
  const fixture = makeDirectNotesFixture();
  const text = 'Staging tests must pass before production.';
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Milo', text: 'I will send the outline.' },
        { speaker: 'Nira', text },
      ],
    }),
  );
  const span = { segment: 1, start: 0, end: text.length };
  fixture.draft.sections[0]!.items.push({
    id: 's0:item:1',
    kind: 'point',
    text,
    sources: [span],
    owner: null,
    due: null,
  });
  fixture.audit.verdicts.push({
    target: 's0:item:1',
    status: 'supported',
    sources: [span],
  });
  const projected = projectAuditedNotes(
    applyNotesAudit({ ...fixture, source }),
  );
  expect(projected.overview).toBe(text);
  expect(projected.all_action_items[0]).toMatchObject({
    text: 'Send the outline',
    assignee: 'Milo',
  });
  expect(
    projected.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual([span]);
});

it.each([1, 2])(
  'summarizes %i action-only follow-ups without owner-prefixed commands',
  (count) => {
    const fixture = makeDirectNotesFixture();
    if (count === 2) {
      const text = 'I will update the runbook.';
      fixture.source = createNotesSource(
        JSON.stringify({
          segments: [
            { speaker: 'Milo', text: 'I will send the outline.' },
            { speaker: 'Nira', text },
          ],
        }),
      );
      const sources = [{ segment: 1, start: 0, end: text.length }];
      fixture.draft.sections[0]!.items.push({
        id: 's0:item:1',
        kind: 'action',
        text: 'Update the runbook',
        sources,
        owner: 'Nira',
        due: null,
      });
      fixture.audit.verdicts.push({
        target: 's0:item:1',
        status: 'supported',
        sources,
      });
    }
    const projected = projectAuditedNotes(applyNotesAudit(fixture));
    expect(projected.overview).toBe(
      `The meeting recorded ${count} follow-up${count === 1 ? '' : 's'}.`,
    );
    expect(projected.all_action_items).toHaveLength(count);
    expect(projected.all_action_items[0]).toMatchObject({
      text: 'Send the outline',
      assignee: 'Milo',
    });
    expect(
      projected.generation_metadata?.source_provenance?.blocks.overview
        ?.sources,
    ).toEqual(fixture.draft.sections[0]!.items.flatMap((item) => item.sources));
  },
);

it('leaves an explicit overview unchanged instead of adding derived punctuation', () => {
  const fixture = makeDirectNotesFixture();
  const sources = fixture.draft.sections[0]!.items[0]!.sources;
  fixture.draft.overview = {
    id: 'overview',
    text: 'Send the outline',
    sources,
  };
  fixture.audit.verdicts.push({
    target: 'overview',
    status: 'supported',
    sources,
  });
  expect(projectAuditedNotes(applyNotesAudit(fixture)).overview).toBe(
    'Send the outline',
  );
});

it('rejects a deduplication record without an identified replacement', () => {
  expect(() =>
    parseNotesAudit(
      JSON.stringify({
        changes: [],
        verdicts: [],
        terminology: [],
        dispositions: [
          {
            target: 'a1',
            kind: 'deduplicated',
            replacementId: null,
            sources: [{ segment: 0, start: 0, end: 1 }],
          },
        ],
      }),
    ),
  ).toThrow('notes_audit_invalid');
});

it('identifies an unsourced writer item for the one repair without copying private text into the error', () => {
  const { draft } = makeDirectNotesFixture();
  draft.sections[0]!.items[0]!.sources = [];
  draft.sections[0]!.items[0]!.text = 'PRIVATE_MARKER';
  expect(() => parseNotesDraft(JSON.stringify(draft))).toThrow(
    'notes_writer_invalid:s0:item:0:missing_source',
  );
});

it('adds a source-backed commitment omitted by the writer', () => {
  const sourceText = 'I will send the outline.';
  const source = createNotesSource(
    JSON.stringify({
      segments: [{ speaker: 'Me', text: sourceText }],
    }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 't0', text: 'Outline', sources: [span] },
        items: [],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [
      {
        op: 'insert',
        section: 's0',
        value: {
          id: 'a1',
          kind: 'action',
          text: 'Send the outline',
          sources: [span],
          owner: 'Me',
          due: null,
        },
      },
    ],
    verdicts: [
      { target: 't0', status: 'supported', sources: [span] },
      { target: 'a1', status: 'supported', sources: [span] },
    ],
    dispositions: [],
    terminology: [],
  };

  const result = projectAuditedNotes(applyNotesAudit({ source, draft, audit }));
  expect(result.all_action_items).toEqual([
    expect.objectContaining({
      text: 'Send the outline',
      assignee: 'Me',
      evidence: 'I will send the outline.',
    }),
  ]);
});

it('rejects malformed nested audit operations before they can reach application', () => {
  expect(() =>
    parseNotesAudit(
      JSON.stringify({
        changes: [null],
        verdicts: [],
        dispositions: [],
        terminology: [],
      }),
    ),
  ).toThrow('notes_audit_invalid');
});

it('assigns deterministic block ids instead of trusting writer object paths', () => {
  const raw = JSON.stringify({
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: '__proto__',
        title: {
          id: 'constructor',
          text: 'Outline',
          sources: [{ segment: 0, start: 0, end: 4 }],
        },
        items: [
          {
            id: 'prototype',
            kind: 'point',
            text: 'A point',
            sources: [{ segment: 0, start: 0, end: 4 }],
            owner: null,
            due: null,
          },
        ],
      },
    ],
  });

  expect(parseNotesDraft(raw)).toMatchObject({
    sections: [
      {
        id: 's0',
        title: { id: 's0:title' },
        items: [{ id: 's0:item:0' }],
      },
    ],
  });
});

it('rejects an atomic audit when a change targets an unknown block', () => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Me', text: 'Keep this.' }] }),
  );
  const span = { segment: 0, start: 0, end: 'Keep this.'.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 't0', text: 'Keep', sources: [span] },
        items: [],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [{ op: 'remove', target: 'unknown' }],
    verdicts: [{ target: 't0', status: 'supported', sources: [span] }],
    dispositions: [],
    terminology: [],
  };

  expect(() => applyNotesAudit({ source, draft, audit })).toThrow(
    'invalid_notes_audit',
  );
});

it('does not drop a reviewed accepted request solely for paraphrasing', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        {
          speaker: 'Nira',
          text: 'Could you send the outline to the reviewers?',
        },
        { speaker: 'Milo', text: 'Yes, I will do that.' },
      ],
    }),
  );
  const sources = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 't0', text: 'Outline review', sources },
        items: [
          {
            id: 'a0',
            kind: 'action',
            text: 'Share the outline with reviewers',
            sources,
            owner: 'Milo',
            due: null,
          },
        ],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [],
    dispositions: [],
    terminology: [],
    verdicts: [
      { target: 't0', status: 'supported', sources },
      { target: 'a0', status: 'supported', sources },
    ],
  };

  expect(
    projectAuditedNotes(applyNotesAudit({ source, draft, audit }))
      .all_action_items,
  ).toEqual([
    expect.objectContaining({
      text: 'Share the outline with reviewers',
      assignee: 'Milo',
    }),
  ]);
});

it('keeps an audited, source-backed recent win through v3 projection', () => {
  const sourceText = 'We shipped the release and closed the launch blocker.';
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text: sourceText }] }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft = parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [],
      recentWin: {
        win: { text: 'The release shipped', sources: [span] },
        impact: { text: 'The launch blocker is closed', sources: [span] },
      },
    }),
  );
  const audit: NotesAudit = {
    changes: [],
    verdicts: [
      { target: 'recent-win', status: 'supported', sources: [span] },
      { target: 'recent-win-impact', status: 'supported', sources: [span] },
    ],
    dispositions: [],
    terminology: [],
  };

  const result = projectAuditedNotes(applyNotesAudit({ source, draft, audit }));

  expect(result.recent_win).toEqual({
    win: 'The release shipped',
    why_it_counts: 'The launch blocker is closed',
    evidence: sourceText,
  });
  expect(result.generation_metadata?.source_provenance?.blocks).toMatchObject({
    'recent_win:win': { id: 'recent-win', sources: [span] },
    'recent_win:why_it_counts': { id: 'recent-win-impact', sources: [span] },
  });
});

it('accepts an omitted recent win as null without weakening malformed-field rejection', () => {
  expect(
    parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        recentWin: null,
        sections: [],
      }),
    ).recentWin,
  ).toBeUndefined();
});

it('lets the audit replace either recent-win field with newly grounded prose', () => {
  const sourceText = 'We shipped the release and closed the launch blocker.';
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text: sourceText }] }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft = parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [],
      recentWin: {
        win: { text: 'The release is progressing', sources: [span] },
        impact: { text: 'The blocker may close', sources: [span] },
      },
    }),
  );
  const audit: NotesAudit = {
    changes: [
      {
        op: 'replace',
        target: 'recent-win',
        value: { text: 'The release shipped', sources: [span] },
      },
      {
        op: 'replace',
        target: 'recent-win-impact',
        value: { text: 'The launch blocker is closed', sources: [span] },
      },
    ],
    verdicts: [
      { target: 'recent-win', status: 'supported', sources: [span] },
      { target: 'recent-win-impact', status: 'supported', sources: [span] },
    ],
    dispositions: [],
    terminology: [],
  };

  const result = applyNotesAudit({ source, draft, audit });

  expect(result.draft.recentWin).toEqual({
    win: { id: 'recent-win', text: 'The release shipped', sources: [span] },
    impact: {
      id: 'recent-win-impact',
      text: 'The launch blocker is closed',
      sources: [span],
    },
  });
});

it('applies a trusted terminology correction to prose but keeps source evidence verbatim', () => {
  const sourceText = 'We selected Ovaltree for the release.';
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text: sourceText }] }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: {
      id: 'overview',
      text: 'Ovaltree was selected.',
      sources: [span],
    },
    sections: [
      {
        id: 's0',
        title: { id: 's0:title', text: 'Ovaltree rollout', sources: [span] },
        items: [
          {
            id: 's0:item:0',
            kind: 'point',
            text: 'Ovaltree is the selected tool.',
            sources: [span],
            owner: null,
            due: null,
          },
        ],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [],
    verdicts: [
      { target: 'overview', status: 'supported', sources: [span] },
      { target: 's0:title', status: 'supported', sources: [span] },
      { target: 's0:item:0', status: 'supported', sources: [span] },
    ],
    dispositions: [],
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
    applyNotesAudit({
      source,
      draft,
      audit,
      terminology: {
        trustedUserTerms: ['Ogletree'],
        provider: 'ollama',
        model: 'test-model',
      },
    }),
  );

  expect(result.overview).toBe('Ogletree was selected.');
  expect(result.topics[0]).toMatchObject({
    title: 'Ogletree rollout',
    summary: 'Ogletree is the selected tool.',
  });
  expect(result.generation_metadata?.terminology?.proposals).toEqual([
    expect.objectContaining({ status: 'applied' }),
  ]);
  expect(
    result.generation_metadata?.source_provenance?.blocks.overview.sources,
  ).toEqual([span]);
});

it('rejects malformed terminology proposals without failing a valid notes audit', () => {
  const sourceText = 'We selected Ovaltree for the release.';
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text: sourceText }] }),
  );
  const span = { segment: 0, start: 0, end: sourceText.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: {
      id: 'overview',
      text: 'Ovaltree was selected.',
      sources: [span],
    },
    sections: [],
  };
  const audit = {
    changes: [],
    verdicts: [{ target: 'overview', status: 'supported', sources: [span] }],
    dispositions: [],
    terminology: [null],
  } as unknown as NotesAudit;

  expect(() =>
    applyNotesAudit({
      source,
      draft,
      audit,
      terminology: {
        trustedUserTerms: ['Ogletree'],
        provider: 'ollama',
        model: 'test-model',
      },
    }),
  ).not.toThrow();
});

it('projects audited source provenance onto renderer edit paths', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: 'I will send the outline.' },
        { speaker: 'Them', text: 'Use the source-grounded flow.' },
      ],
    }),
  );
  const actionSpan = { segment: 0, start: 0, end: 24 };
  const discussionSpan = { segment: 1, start: 0, end: 29 };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: {
      id: 'overview',
      text: 'Outline is owned.',
      sources: [actionSpan],
    },
    sections: [
      {
        id: 's0',
        title: { id: 's0:title', text: 'Outline', sources: [actionSpan] },
        items: [
          {
            id: 's0:item:0',
            kind: 'point',
            text: 'The outline is ready.',
            sources: [actionSpan],
            owner: null,
            due: null,
          },
          {
            id: 's0:item:1',
            kind: 'question',
            text: 'Who reviews it?',
            sources: [discussionSpan],
            owner: null,
            due: null,
          },
          {
            id: 's0:item:2',
            kind: 'action',
            text: 'Send the outline',
            sources: [actionSpan],
            owner: 'Me',
            due: null,
          },
          {
            id: 's0:item:3',
            kind: 'decision',
            text: 'Use the source-grounded flow',
            sources: [discussionSpan],
            owner: null,
            due: null,
          },
        ],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [],
    dispositions: [],
    terminology: [],
    verdicts: [
      { target: 'overview', status: 'supported', sources: [actionSpan] },
      { target: 's0:title', status: 'supported', sources: [actionSpan] },
      { target: 's0:item:0', status: 'supported', sources: [actionSpan] },
      { target: 's0:item:1', status: 'supported', sources: [discussionSpan] },
      { target: 's0:item:2', status: 'supported', sources: [actionSpan] },
      { target: 's0:item:3', status: 'supported', sources: [discussionSpan] },
    ],
  };

  const projected = projectAuditedNotes(
    applyNotesAudit({ source, draft, audit }),
  );
  const blocks = projected.generation_metadata?.source_provenance?.blocks;

  expect(blocks).toMatchObject({
    overview: { id: 'overview', sources: [actionSpan] },
    'topic:0:title': { id: 's0:title', sources: [actionSpan] },
    'topic:0:point:0': { id: 's0:item:0', sources: [actionSpan] },
    'topic:0:question:0': { id: 's0:item:1', sources: [discussionSpan] },
    'topic:0:action:0': { id: 's0:item:2', sources: [actionSpan] },
    'topic:0:decision:0': { id: 's0:item:3', sources: [discussionSpan] },
    'all_action_items:0': { id: 's0:item:2', sources: [actionSpan] },
    'completion:all_action_items:0': {
      id: 's0:item:2',
      sources: [actionSpan],
    },
    'native_continuations:all_action_items:0': {
      id: 's0:item:2',
      sources: [actionSpan],
    },
    'all_decisions:0': { id: 's0:item:3', sources: [discussionSpan] },
  });
  expect(blocks).not.toHaveProperty('s0:item:2');

  const next = structuredClone(projected);
  next.all_action_items = [
    { text: 'Unrelated action' },
    ...projected.all_action_items,
  ];
  const provenance = next.generation_metadata?.source_provenance;
  if (!provenance) throw new Error('expected source provenance');
  provenance.blocks['all_action_items:1'] =
    provenance.blocks['all_action_items:0']!;
  provenance.blocks['completion:all_action_items:1'] =
    provenance.blocks['completion:all_action_items:0']!;
  provenance.blocks['native_continuations:all_action_items:1'] =
    provenance.blocks['native_continuations:all_action_items:0']!;
  provenance.blocks['all_action_items:0'] = {
    id: 'other-action',
    sources: [{ segment: 1, start: 0, end: 1 }],
  };
  provenance.blocks['completion:all_action_items:0'] =
    provenance.blocks['all_action_items:0'];
  provenance.blocks['native_continuations:all_action_items:0'] =
    provenance.blocks['all_action_items:0'];

  const rebased = rebaseMeetingNotesEdits({
    edits: {
      'all_action_items:0': {
        original: 'Send the outline',
        edited: 'Send the reviewed outline',
        edited_at: '2026-08-26T00:00:00.000Z',
      },
    },
    previousBlocks: getAnalysisEditBlocks(projected),
    nextBlocks: getAnalysisEditBlocks(next),
  });

  expect(rebased.edits['all_action_items:1']?.edited).toBe(
    'Send the reviewed outline',
  );
  expect(rebased.conflicts).toEqual([]);

  const duplicate = structuredClone(projected);
  duplicate.all_action_items = [
    ...projected.all_action_items,
    ...projected.all_action_items,
  ];
  const duplicateProvenance = duplicate.generation_metadata?.source_provenance;
  if (!duplicateProvenance) throw new Error('expected duplicate provenance');
  duplicateProvenance.blocks['all_action_items:1'] =
    duplicateProvenance.blocks['all_action_items:0']!;
  duplicateProvenance.blocks['completion:all_action_items:1'] =
    duplicateProvenance.blocks['completion:all_action_items:0']!;
  duplicateProvenance.blocks['native_continuations:all_action_items:1'] =
    duplicateProvenance.blocks['native_continuations:all_action_items:0']!;

  const ambiguous = rebaseMeetingNotesEdits({
    edits: {
      'all_action_items:0': {
        original: 'Send the outline',
        edited: 'Send the reviewed outline',
        edited_at: '2026-08-26T00:00:00.000Z',
      },
    },
    previousBlocks: getAnalysisEditBlocks(projected),
    nextBlocks: getAnalysisEditBlocks(duplicate),
  });
  expect(ambiguous.edits).toEqual({});
  expect(ambiguous.conflicts).toHaveLength(1);

  const changedRevision = structuredClone(projected);
  const changedProvenance =
    changedRevision.generation_metadata?.source_provenance;
  if (!changedProvenance) throw new Error('expected changed provenance');
  changedProvenance.source_revision = 'different-source-revision';
  const sourceChanged = rebaseMeetingNotesEdits({
    edits: {
      'all_action_items:0': {
        original: 'Send the outline',
        edited: 'Send the reviewed outline',
        edited_at: '2026-08-26T00:00:00.000Z',
      },
    },
    previousBlocks: getAnalysisEditBlocks(projected),
    nextBlocks: getAnalysisEditBlocks(changedRevision),
  });
  expect(sourceChanged.edits).toEqual({});
  expect(sourceChanged.conflicts).toHaveLength(1);
});
import localWriterFailure from '../manual/fixtures/meetingNotesV10LocalSeed41WriterFailure.json';

it('preserves source-reviewed paraphrased decisions without a lexical overlap threshold', () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Milo',
        text: 'We decided to postpone the launch until approval arrives.',
      },
    ]),
  );
  const span = { segment: 0, start: 0, end: source.segments[0]!.text.length };
  const draft = parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Launch', sources: [span] },
          items: [
            {
              kind: 'decision',
              text: 'Delay release pending approval.',
              owner: 'Milo',
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    }),
  );
  const audit: NotesAudit = {
    changes: [],
    dispositions: [],
    terminology: [],
    verdicts: ['s0:title', 's0:item:0'].map((target) => ({
      target,
      status: 'supported',
      sources: [span],
    })),
  };
  expect(
    projectAuditedNotes(applyNotesAudit({ source, draft, audit }))
      .all_decisions,
  ).toEqual([
    expect.objectContaining({ text: 'Delay release pending approval.' }),
  ]);
});

it.each([
  [
    'We decided to publish individual responses.',
    'We decided not to publish individual responses.',
  ],
  [
    'We might not publish individual responses.',
    'The decision is not to publish individual responses.',
  ],
  [
    'We decided not to publish individual responses.',
    'We decided to publish individual responses.',
  ],
])(
  'fails explicitly when a supported audit decision cannot pass the existing source guard: %s',
  (evidence, text) => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Tariq', text: evidence }]),
    );
    const sources = [{ segment: 0, start: 0, end: evidence.length }];
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Privacy', sources },
            items: [
              { kind: 'decision', text, owner: null, due: null, sources },
            ],
          },
        ],
      }),
    );
    const audit: NotesAudit = {
      changes: [],
      dispositions: [],
      terminology: [],
      verdicts: ['s0:title', 's0:item:0'].map((target) => ({
        target,
        status: 'supported',
        sources,
      })),
    };
    const snapshot = structuredClone({ source, draft, audit });
    expect(() => applyNotesAudit({ source, draft, audit })).toThrow(
      'notes_audit_invalid_commitment:s0:item:0',
    );
    expect({ source, draft, audit }).toEqual(snapshot);
  },
);

it.each([
  [
    'We decided not to publish individual responses.',
    'We decided not to publish individual responses.',
  ],
  [
    "The decision is not to publish individual responses. Only aggregate counts may be published, to protect participants' confidentiality.",
    "The decision is not to publish individual responses; only aggregate counts may be published to protect participants' confidentiality.",
  ],
])(
  'preserves a validated negative decision with its original text and evidence: %s',
  (evidence, text) => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Tariq', text: evidence }]),
    );
    const sources = [{ segment: 0, start: 0, end: evidence.length }];
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Privacy', sources },
            items: [
              {
                kind: 'decision',
                text,
                sources,
                owner: null,
                due: null,
              },
            ],
          },
        ],
      }),
    );
    const audit: NotesAudit = {
      changes: [],
      dispositions: [],
      terminology: [],
      verdicts: ['s0:title', 's0:item:0'].map((target) => ({
        target,
        status: 'supported',
        sources,
      })),
    };
    const result = projectAuditedNotes(
      applyNotesAudit({ source, draft, audit }),
    );
    expect(result.all_decisions).toEqual([{ text, evidence }]);
    expect(result.topics[0]!.decisions).toEqual(result.all_decisions);
    expect(
      result.generation_metadata?.source_provenance?.blocks['all_decisions:0']
        ?.sources,
    ).toEqual(sources);
  },
);

it('does not resurrect an unconditional commitment or fabricated deadline after audit', () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Milo',
        text: 'If approval comes Friday, I will send the outline.',
      },
    ]),
  );
  const span = { segment: 0, start: 0, end: source.segments[0]!.text.length };
  const make = (text: string) => {
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Outline', sources: [span] },
            items: [
              {
                kind: 'action',
                text,
                owner: 'Milo',
                due: 'Friday',
                sources: [span],
              },
            ],
          },
        ],
      }),
    );
    const audit: NotesAudit = {
      changes: [],
      dispositions: [],
      terminology: [],
      verdicts: ['s0:title', 's0:item:0'].map((target) => ({
        target,
        status: 'supported',
        sources: [span],
      })),
    };
    return projectAuditedNotes(applyNotesAudit({ source, draft, audit }));
  };
  expect(() => make('Send the outline.')).toThrow(
    'notes_audit_invalid_commitment',
  );
  const conditional = make('Send the outline if approval comes Friday.');
  expect(conditional.all_action_items).toHaveLength(1);
  expect(conditional.all_action_items[0]!.due).toBeUndefined();
});

it('normalizes an explicitly absent nested recent win from the real local writer', () => {
  for (const writer of localWriterFailure.writerCalls) {
    const draft = parseNotesDraft(JSON.stringify(writer));
    expect(draft.recentWin).toBeUndefined();
    expect(draft.sections).toHaveLength(writer.sections.length);
  }
});

it('preserves rejected decision and action classifications as exact discussion, without invented commitment fields', () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Morgan',
        text: 'Should we launch to partners? It is employees only, not partners. We have not approved a launch.',
      },
    ]),
  );
  const span = { segment: 0, start: 0, end: source.segments[0]!.text.length };
  for (const kind of ['decision', 'action'] as const) {
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Scope', sources: [span] },
            items: [
              {
                kind,
                text: 'Morgan approved launching to partners.',
                owner: 'Morgan',
                due: 'Friday',
                sources: [span],
              },
            ],
          },
        ],
      }),
    );
    const accepted = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
    const retained = accepted.draft.sections[0].items[0];
    expect(retained).toMatchObject({
      kind: 'point',
      text: quoteCitedSourcePassages(source, [span]),
      owner: null,
      due: null,
      sources: [span],
    });
    const projected = projectAuditedNotes(accepted);
    expect(projected.all_action_items).toEqual([]);
    expect(projected.all_decisions).toEqual([]);
    expect(projected.generation_metadata?.source_provenance).toBeDefined();
    expect(() => acceptEditedNotes({ source, draft })).toThrow(
      'notes_editor_invalid_commitment',
    );
  }
});

it.each([
  {
    sourceText: 'If you want, I could send the outline.',
    text: 'Send the outline',
    owner: 'Morgan',
  },
  {
    sourceText:
      'The group accepted sending the outline, but no owner has been assigned.',
    text: 'Send the outline',
    owner: null,
  },
  {
    sourceText: 'Please review the draft and give feedback.',
    text: 'Review the draft',
    owner: 'Me',
  },
])(
  'marks conservative source fallback as an exact quote for publication repair %#',
  ({ sourceText, text, owner }) => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Morgan', text: sourceText }]),
    );
    const sources = [{ segment: 0, start: 0, end: sourceText.length }];
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Outline', sources },
            items: [{ kind: 'action', text, owner, due: null, sources }],
          },
        ],
      }),
    );
    const original = structuredClone(draft);
    const accepted = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
    expect(accepted.draft.sections[0]!.items[0]).toMatchObject({
      kind: 'point',
      text: quoteCitedSourcePassages(source, sources),
      owner: null,
      due: null,
    });
    expect(accepted.reviewOriginals?.get('s0:item:0')).toEqual(
      original.sections[0]!.items[0],
    );
    expect(draft).toEqual(original);
    expect(source.segments[0]!.text).toBe(sourceText);
  },
);

it('groups adjacent cited fragments without bridging omitted words, different speakers, or ambiguous recording labels', () => {
  const make = (speakers: string[]) =>
    createNotesSource(
      JSON.stringify([
        { speaker: speakers[0], text: 'Let me put' },
        { speaker: speakers[1], text: 'the review' },
        { speaker: speakers[2], text: 'time on the calendar.' },
      ]),
    );
  const source = make(['Me', 'Me', 'Me']);
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  expect(groupCitedSourcePassages(source, spans)).toEqual([
    {
      speaker: 'Me',
      text: 'Let me put the review time on the calendar.',
      spans,
    },
  ]);
  expect(groupCitedSourcePassages(source, [spans[0]!, spans[2]!])).toHaveLength(
    2,
  );
  expect(
    groupCitedSourcePassages(make(['Me', 'Nora', 'Me']), spans),
  ).toHaveLength(3);
  expect(
    groupCitedSourcePassages(make(['Them', 'Them', 'Them']), spans),
  ).toHaveLength(3);
  const name = createNotesSource(
    JSON.stringify([{ speaker: 'Them', text: 'Riley' }]),
  );
  expect(
    groupCitedSourcePassages(name, [
      { segment: 0, start: 0, end: 2 },
      { segment: 0, start: 2, end: 5 },
    ])[0]?.text,
  ).toBe('Riley');
});

it('does not leave an unaccepted imperative in the action list merely because its wording lacks a question mark', () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Nora',
        text: 'Please review the draft and give feedback. You need to speak to Morgan.',
      },
    ]),
  );
  const span = { segment: 0, start: 0, end: source.segments[0].text.length };
  const draft = parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Review', sources: [span] },
          items: [
            {
              kind: 'action',
              text: 'Review the draft and speak to Morgan',
              owner: 'Me',
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    }),
  );
  const result = projectAuditedNotes(
    acceptEditedNotes({ source, draft, acceptancePolicy: 'conservative' }),
  );
  expect(result.all_action_items).toEqual([]);
  expect(JSON.stringify(result.topics)).toContain('Please review the draft');
});

it('does not borrow settlement from an unrelated task and retains an explicitly settled unowned action', async () => {
  const make = (text: string) => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Morgan', text }]),
    );
    const span = { segment: 0, start: 0, end: text.length };
    const draft = parseNotesDraft(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Outline', sources: [span] },
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: null,
                due: null,
                sources: [span],
              },
            ],
          },
        ],
      }),
    );
    return acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
  };
  const request = make('We accepted the migration. Please send the outline.');
  expect(projectAuditedNotes(request).all_action_items).toEqual([]);
  const accepted = make(
    'The group accepted sending the outline, but no owner has been assigned.',
  );
  expect(projectAuditedNotes(accepted).all_action_items).toEqual([]);
  const id = accepted.draft.sections[0]!.items[0]!.id;
  const reviewed = await reviewSourceBoundNotes(accepted, async () =>
    JSON.stringify({
      resolutions: [
        {
          id,
          kind: 'accepted_action',
          text: 'Send the outline',
          owner: null,
          due: null,
          discussion: null,
        },
      ],
    }),
  );
  expect(projectAuditedNotes(reviewed).all_action_items).toHaveLength(1);
  expect(
    projectAuditedNotes(reviewed).all_action_items[0]?.assignee,
  ).toBeUndefined();
});

it('keeps only the promised action and preserves the tentative plan as source discussion', async () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Me',
        text: 'Maybe we meet with Riley to review the onboarding flow and have Riley design it.',
      },
      { speaker: 'Them', text: 'I think you need to speak to Riley.' },
      {
        speaker: 'Me',
        text: 'I will schedule calendar time with Riley. Only after legal approves.',
      },
    ]),
  );
  const sources = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const draft = parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Review planning', sources },
          items: [
            {
              kind: 'action',
              text: 'Meet with Riley to review onboarding, have Riley design it, and schedule calendar time.',
              owner: 'Me',
              due: null,
              sources,
            },
          ],
        },
      ],
    }),
  );
  const accepted = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const id = accepted.draft.sections[0]!.items[0]!.id;
  const result = projectAuditedNotes(
    await reviewSourceBoundNotes(accepted, async () =>
      JSON.stringify({
        resolutions: [
          {
            id,
            kind: 'accepted_action',
            text: 'Schedule calendar time with Riley. Only after legal approves.',
            owner: 'Me',
            due: null,
            discussion:
              'A possible meeting with Riley to review onboarding and have Riley design it was discussed, not agreed.',
          },
        ],
      }),
    ),
  );

  expect(result.all_action_items).toHaveLength(1);
  expect(result.all_action_items[0].assignee).toBe('Me');
  expect(result.all_action_items[0].text).toContain(
    'Only after legal approves',
  );
  expect(result.all_action_items[0].text).not.toContain('design');
  expect(
    JSON.stringify(result.topics.flatMap((topic) => topic.key_points)),
  ).toContain('A possible meeting with Riley');
  expect(result.generation_metadata?.source_provenance).toBeDefined();
  expect(() => acceptEditedNotes({ source, draft })).toThrow(
    'notes_editor_invalid_commitment',
  );
});

it.each([
  'valid',
  'outside window',
  'partial pair',
  'invented owner',
  'unknown omit',
  'extra omit key',
  'ordinary ownership',
])(
  'validates optional factual review at the shared application boundary: %s',
  (mode) => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker: 'Dana', text: 'Dana completed the pilot successfully.' },
        { speaker: 'Dana', text: 'The pilot reduced incidents by three.' },
      ]),
    );
    const span = (segment: number) => ({
      segment,
      start: 0,
      end: source.segments[segment]!.text.length,
    });
    const draft: NotesDraft = {
      meetingType: 'general',
      overview: null,
      sections: [],
      recentWin: {
        win: { id: 'win', text: 'The pilot succeeded.', sources: [span(0)] },
        impact: {
          id: 'impact',
          text: 'The pilot reduced incidents.',
          sources: [span(1)],
        },
      },
    };
    const notes = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
    const replacements: any[] = [
      {
        id: 'win',
        kind: 'point',
        text: 'Dana successfully completed the pilot.',
        sources: [span(0)],
        owner: 'Dana',
        ownership: 'personal',
        due: null,
        discussion: null,
      },
      {
        id: 'impact',
        kind: 'point',
        text: 'The pilot reduced incident counts by three.',
        sources: [span(1)],
        owner: null,
        due: null,
        discussion: null,
      },
    ];
    if (mode === 'outside window') replacements[1].sources = [span(0)];
    if (mode === 'partial pair') replacements.pop();
    if (mode === 'invented owner') replacements[0].owner = 'Sora';
    if (mode === 'unknown omit')
      replacements[0] = { id: 'unknown', omit: true };
    if (mode === 'extra omit key')
      replacements[0] = { id: 'win', omit: true, text: 'extra' };
    if (mode === 'ordinary ownership') replacements[1].ownership = 'shared';
    if (mode === 'valid') {
      const reviewed = applySourceBoundSemanticReview(notes, replacements);
      expect(reviewed.draft.recentWin?.owner).toBe('Dana');
      expect(reviewed.draft.recentWin?.impact.sources).toEqual([span(1)]);
    } else
      expect(() =>
        applySourceBoundSemanticReview(notes, replacements),
      ).toThrow();
  },
);
it('atomically removes a reviewed optional win and ownership without inventing replacement prose', () => {
  const { source, draft } = makeDirectNotesFixture();
  const span = draft.sections[0]!.items[0]!.sources;
  draft.recentWin = {
    win: { id: 'win', text: 'A rollout completed.', sources: span },
    impact: { id: 'impact', text: 'Errors fell.', sources: span },
    ownership: 'personal',
    owner: 'Milo',
  };
  const notes = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  const reviewed = applySourceBoundSemanticReview(notes, [
    { id: 'win', omit: true },
    { id: 'impact', omit: true },
  ]);
  expect(reviewed.draft.recentWin).toBeUndefined();
  expect(reviewed.draft.sections).toEqual(notes.draft.sections);
});

it.each(['personal', 'other'] as const)(
  'uses own cited named-actor evidence for a narrated %s win without classifying from the speaker roster',
  (ownership) => {
    const lines = [
      {
        speaker: 'Me',
        text:
          ownership === 'other'
            ? 'Dana from the outside vendor completed the pilot successfully.'
            : 'Dana completed the pilot successfully.',
      },
      { speaker: 'Me', text: 'The pilot reduced incidents by three.' },
      ...(ownership === 'other'
        ? [{ speaker: 'Dana', text: 'The vendor update is recorded.' }]
        : []),
    ];
    const source = createNotesSource(JSON.stringify(lines));
    const span = (segment: number) => ({
      segment,
      start: 0,
      end: source.segments[segment]!.text.length,
    });
    const draft: NotesDraft = {
      meetingType: 'general',
      overview: null,
      sections: [],
      recentWin: {
        win: { id: 'win', text: 'The pilot succeeded.', sources: [span(0)] },
        impact: { id: 'impact', text: 'Incidents fell.', sources: [span(1)] },
      },
    };
    const notes = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'conservative',
    });
    const result = applySourceBoundSemanticReview(notes, [
      {
        id: 'win',
        kind: 'point',
        text: 'Dana successfully completed the pilot.',
        sources: [span(0)],
        ownership,
        owner: 'Dana',
        due: null,
        discussion: null,
      },
      {
        id: 'impact',
        kind: 'point',
        text: 'The pilot reduced incident counts by three.',
        sources: [span(1)],
        owner: null,
        due: null,
        discussion: null,
      },
    ]);
    expect(result.draft.recentWin).toMatchObject({ ownership, owner: 'Dana' });
  },
);

it('refuses a source-led null global overview instead of inventing a follow-up count', () => {
  const { source, draft } = makeDirectNotesFixture();
  expect(() => acceptSourceLedNotes(source, draft)).toThrow(
    'notes_semantic_review_incomplete',
  );
});

it('retains a source-led provider overview with its own exact provenance', () => {
  const { source, draft } = makeDirectNotesFixture();
  draft.overview = {
    id: 'overview',
    text: 'Milo will send the outline.',
    sources: draft.sections[0]!.items[0]!.sources,
  };
  const result = projectAuditedNotes(acceptSourceLedNotes(source, draft));
  expect(result.overview).toBe('Milo will send the outline.');
  expect(
    result.generation_metadata?.source_provenance?.blocks.overview?.sources,
  ).toEqual(draft.overview.sources);
});

it.each(['owner', 'due', 'quantity', 'pronoun', 'direct speech'])(
  'does not brand a source-led result with unsupported %s',
  (defect) => {
    const { source, draft } = makeDirectNotesFixture();
    draft.overview = {
      id: 'overview',
      text: 'Milo will send the outline.',
      sources: draft.sections[0]!.items[0]!.sources,
    };
    const item = draft.sections[0]!.items[0]!;
    if (defect === 'owner') item.owner = 'Rowan';
    if (defect === 'due') item.due = '2023-10-21';
    if (defect === 'quantity') item.text = 'Milo will send 30 outlines.';
    if (defect === 'pronoun') item.text = 'He will send the outline.';
    if (defect === 'direct speech') item.text = 'I will send the outline.';
    expect(() => acceptSourceLedNotes(source, draft)).toThrow(
      /notes_semantic_review_incomplete|notes_editor_invalid_commitment/,
    );
  },
);

it('keeps source-led strict commitment grounding rather than treating a model verdict as permission', () => {
  const { draft } = makeDirectNotesFixture();
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Milo', text: 'Maybe I could send the outline.' },
    ]),
  );
  draft.sections[0]!.title.sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  draft.sections[0]!.items[0]!.sources = structuredClone(
    draft.sections[0]!.title.sources,
  );
  draft.overview = {
    id: 'overview',
    text: 'Milo could send the outline.',
    sources: draft.sections[0]!.items[0]!.sources,
  };
  expect(() => acceptSourceLedNotes(source, draft)).toThrow(
    'notes_editor_invalid_commitment',
  );
});

it.each(['personal', 'shared', 'other', 'unknown'] as const)(
  'preserves a genuine source-led recent win with %s ownership',
  (ownership) => {
    const text =
      ownership === 'shared'
        ? 'The team completed the migration and removed the deployment blocker.'
        : ownership === 'unknown'
          ? 'The migration was completed and removed the deployment blocker.'
          : ownership === 'other'
            ? 'Dana, who is outside the group, completed the migration and removed the deployment blocker.'
            : 'Dana completed the migration and removed the deployment blocker.';
    const source = createNotesSource(JSON.stringify([{ speaker: 'Me', text }]));
    const sources = [{ segment: 0, start: 0, end: text.length }];
    const owner =
      ownership === 'personal' || ownership === 'other' ? 'Dana' : null;
    const winText =
      ownership === 'shared'
        ? 'The team completed the migration.'
        : ownership === 'unknown'
          ? 'The migration was completed.'
          : 'Dana completed the migration.';
    const draft: NotesDraft = {
      meetingType: 'general',
      title: null,
      overview: { id: 'overview', text: winText, sources },
      sections: [
        {
          id: 's0',
          title: { id: 's0:title', text: 'Migration', sources },
          items: [
            {
              id: 's0:item:0',
              kind: 'point',
              text: winText,
              owner: null,
              due: null,
              sources,
            },
          ],
        },
      ],
      recentWin: {
        win: { id: 'recent-win', text: winText, sources },
        impact: {
          id: 'recent-win-impact',
          text: 'The migration removed the deployment blocker.',
          sources,
        },
        ownership,
        owner,
      },
    };
    const result = projectAuditedNotes(acceptSourceLedNotes(source, draft));
    expect(result.recent_win).toMatchObject({ win: winText, ownership });
  },
);

it('rejects a source-led recent-win owner supported only by another uncited passage', () => {
  const source = createNotesSource(
    JSON.stringify([
      {
        speaker: 'Me',
        text: 'The migration was completed and removed the deployment blocker.',
      },
      { speaker: 'Me', text: 'Dana is away today.' },
    ]),
  );
  const sources = [
    { segment: 0, start: 0, end: source.segments[0]!.text.length },
  ];
  const draft: NotesDraft = {
    meetingType: 'general',
    title: null,
    overview: { id: 'overview', text: 'The migration was completed.', sources },
    sections: [
      {
        id: 's0',
        title: { id: 's0:title', text: 'Migration', sources },
        items: [
          {
            id: 's0:item:0',
            kind: 'point',
            text: 'The migration was completed.',
            owner: null,
            due: null,
            sources,
          },
        ],
      },
    ],
    recentWin: {
      win: { id: 'recent-win', text: 'The migration was completed.', sources },
      impact: {
        id: 'recent-win-impact',
        text: 'The migration removed the deployment blocker.',
        sources,
      },
      ownership: 'personal',
      owner: 'Dana',
    },
  };
  expect(() => acceptSourceLedNotes(source, draft)).toThrow(
    'notes_semantic_review_incomplete',
  );
});

it.each([false, true])(
  'preserves existing ongoing-action coverage when represented=%s',
  (represented) => {
    const text = 'I am preparing the training agenda.';
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Milo', text }]),
    );
    const sources = [{ segment: 0, start: 0, end: text.length }];
    const point = {
      id: 's0:item:0',
      kind: 'point' as const,
      text: 'Milo is preparing the training agenda.',
      owner: null,
      due: null,
      sources,
    };
    const action = {
      ...point,
      id: 's0:item:1',
      kind: 'action' as const,
      text: 'Continue preparing the training agenda',
      owner: 'Milo',
    };
    const draft: NotesDraft = {
      meetingType: 'general',
      title: null,
      overview: { id: 'overview', text: point.text, sources },
      sections: [
        {
          id: 's0',
          title: { id: 's0:title', text: 'Agenda', sources },
          items: [point, ...(represented ? [action] : [])],
        },
      ],
    };
    expect(hasOngoingSourceResponsibility({ source, draft }, point, true)).toBe(
      !represented,
    );
    if (represented)
      expect(
        projectAuditedNotes(acceptSourceLedNotes(source, draft))
          .all_action_items,
      ).toHaveLength(1);
    else
      expect(() => acceptSourceLedNotes(source, draft)).toThrow(
        'notes_semantic_review_incomplete',
      );
  },
);

it.each([
  [
    'I am preparing the training agenda. Actually cancel that task.',
    'Milo cancelled the training agenda.',
  ],
  [
    'I am preparing the training agenda. The training agenda is finished now.',
    'Milo finished the training agenda.',
  ],
])(
  'does not force closed ongoing history back into active work',
  (speech, summary) => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Milo', text: speech }]),
    );
    const sources = [{ segment: 0, start: 0, end: speech.length }];
    const point = {
      id: 's0:item:0',
      kind: 'point' as const,
      text: summary,
      owner: null,
      due: null,
      sources,
    };
    const draft: NotesDraft = {
      meetingType: 'general',
      title: null,
      overview: { id: 'overview', text: summary, sources },
      sections: [
        {
          id: 's0',
          title: { id: 's0:title', text: 'Agenda', sources },
          items: [point],
        },
      ],
    };
    expect(hasOngoingSourceResponsibility({ source, draft }, point, true)).toBe(
      false,
    );
    expect(
      projectAuditedNotes(acceptSourceLedNotes(source, draft)).all_action_items,
    ).toEqual([]);
  },
);
