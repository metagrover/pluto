import { expect, it } from 'vitest';
import {
  applyNotesAudit,
  parseNotesAudit,
  parseNotesDraft,
  projectAuditedNotes,
} from '../../electron/llm/meetingNotesAudit';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesAudit,
  NotesDraft,
} from '../../electron/llm/meetingNotesTypes';
import { getAnalysisEditBlocks } from '../../src/utils/analysisDocument';
import { rebaseMeetingNotesEdits } from '../../src/utils/meetingNotesEditRebase';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

it('omits an empty section after its last claim is rejected', () => {
  const fixture = makeDirectNotesFixture();
  fixture.audit.verdicts[1]!.status = 'unsupported';
  const projected = projectAuditedNotes(applyNotesAudit(fixture));
  expect(projected.topics).toEqual([]);
  expect(
    Object.keys(projected.generation_metadata!.source_provenance!.blocks),
  ).toEqual([]);
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
    'topic:0:summary': { id: 's0:item:0', sources: [actionSpan] },
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
  expect(make('Send the outline.').all_action_items).toEqual([]);
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
