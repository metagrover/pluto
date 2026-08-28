import { expect, it, vi } from 'vitest';
import { applyNotesAudit } from '../../electron/llm/meetingNotesAudit';
import * as budget from '../../electron/llm/meetingNotesBudget';
import * as hierarchy from '../../electron/llm/meetingNotesHierarchy';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type {
  GenerateMeetingNotesInput,
  NotesAudit,
  NotesDraft,
  NotesRequest,
} from '../../electron/llm/meetingNotesTypes';
import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';
import {
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

const fixture = (text = 'If legal approves, I can draft the announcement.') => {
  const source = makeSyntheticNotesSource([{ speaker: 'Milo', text }]);
  const sources = [{ segment: 0, start: 0, end: text.length }];
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: { id: 's0:title', text: 'Planning', sources },
        items: [
          {
            id: 's0:item:0',
            kind: 'point',
            text,
            sources,
            owner: null,
            due: null,
          },
          {
            id: 's0:item:1',
            kind: 'action',
            text: 'Milo will draft the announcement if legal approves.',
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
    verdicts: [draft.sections[0]!.title, ...draft.sections[0]!.items].map(
      (block) => ({ target: block.id, status: 'supported', sources }),
    ),
  };
  return { source, draft, audit };
};

const run = (
  f: ReturnType<typeof fixture>,
  overrides: Partial<GenerateMeetingNotesInput> = {},
  auditRaw = JSON.stringify(f.audit),
) => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValue(auditRaw);
  return {
    generate,
    result: generateMeetingNotes({
      source: f.source,
      context: makeNotesContext(),
      provider: 'ollama',
      model: 'offline',
      contextTokens: 16384,
      generate,
      ...overrides,
    }),
  };
};

it('publishes reviewed prose with warnings after the sole correction fails semantically', async () => {
  const f = fixture();
  const { result, generate } = run(f);
  const document = await result;
  expect(document.topics[0]?.summary).toBe(f.source.segments[0]!.text);
  expect(document.topics[0]?.action_items).toEqual([]);
  expect(document.all_action_items).toEqual([]);
  expect(document.quality).toMatchObject({
    format_pass: true,
    fallback_used: false,
    retry_count: 1,
  });
  expect(document.quality.issues).toContain(
    'notes_audit_invalid_commitment:s0:item:1',
  );
  expect(document.generation_metadata?.audit_status).toBe(
    'complete_with_warnings',
  );
  expect(generate).toHaveBeenCalledTimes(3);
});

it('keeps the direct audit helper strict by default', () => {
  expect(() => applyNotesAudit(fixture())).toThrow(
    'notes_audit_invalid_commitment',
  );
});

it.each(['openai', 'claude', 'gemini'] as const)(
  'keeps %s semantic failures strict',
  async (provider) => {
    const { result, generate } = run(fixture(), { provider });
    await expect(result).rejects.toThrow('notes_audit_invalid');
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it('keeps the editor strict', async () => {
  const f = fixture();
  const { result, generate } = run(
    f,
    { reviewProtocol: 'editor' },
    JSON.stringify(f.draft),
  );
  await expect(result).rejects.toThrow('notes_audit_invalid');
  expect(generate).toHaveBeenCalledTimes(3);
});

it.each([
  'malformed',
  'schema',
  'missing verdict',
  'duplicate verdict',
  'unknown verdict',
  'bad change target',
  'bad disposition target',
  'invalid source',
  'out of scope source',
  'malformed terminology',
  'invalid terminology source',
])(
  'never recovers a hard %s error even beside a semantic failure',
  async (failure) => {
    const f = fixture();
    if (failure === 'schema')
      (f.audit as unknown as Record<string, unknown>).dispositions = null;
    if (failure === 'missing verdict') f.audit.verdicts.pop();
    if (failure === 'duplicate verdict')
      f.audit.verdicts.push(f.audit.verdicts[0]!);
    if (failure === 'unknown verdict')
      f.audit.verdicts.push({ ...f.audit.verdicts[0]!, target: 'unknown' });
    if (failure === 'bad change target')
      f.audit.changes.push({ op: 'remove', target: 'unknown' });
    if (failure === 'bad disposition target')
      f.audit.dispositions.push({
        target: 'unknown',
        kind: 'cancelled',
        replacementId: null,
        sources: f.audit.verdicts[0]!.sources,
      });
    if (failure === 'invalid source')
      f.audit.verdicts[0]!.sources = [{ segment: 99, start: 0, end: 1 }];
    if (failure === 'out of scope source')
      f.audit.verdicts[0]!.sources = [{ segment: 0, start: 0, end: 1 }];
    if (failure === 'malformed terminology')
      f.audit.terminology = [null as never];
    if (failure === 'invalid terminology source')
      f.audit.terminology = [
        {
          rawForms: ['Kora'],
          preferredTerm: null,
          segmentIndexes: [99],
          confidence: 'low',
          signals: [],
        },
      ];
    const { result, generate } = run(
      f,
      {},
      failure === 'malformed' ? '{' : JSON.stringify(f.audit),
    );
    await expect(result).rejects.toThrow('notes_audit_invalid');
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it.each([
  'notes_provider_error',
  'notes_context_exhausted',
  'notes_output_truncated',
  'notes_cancelled',
])('does not recover a repaired request failure: %s', async (code) => {
  const f = fixture();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit))
    .mockRejectedValueOnce(new Error(code));
  await expect(run(f, { generate }).result).rejects.toThrow(code);
  expect(generate).toHaveBeenCalledTimes(3);
});

it.each(['missing_action', 'missing_cancellation_context'] as const)(
  'records %s without inventing a replacement',
  async (code) => {
    const text =
      code === 'missing_action'
        ? 'I will send the outline.'
        : 'I will send the outline. I am withdrawing my outline promise.';
    const f = fixture(text);
    f.draft.sections[0]!.items = [];
    f.audit.verdicts = [f.audit.verdicts[0]!];
    const { result, generate } = run(f);
    const document = await result;
    expect(document.quality.issues.join(' ')).toContain(code);
    expect(document.all_action_items).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it.each([
  'leaf warning',
  'inherited omission',
  'final transport failure',
] as const)('completes the entire local hierarchy with %s', async (mode) => {
  const texts = [
    mode === 'inherited omission'
      ? 'We decided to use the blue cover.'
      : 'If legal approves, I can draft the announcement.',
    'The budget discussion is complete.',
  ];
  const f = fixture(texts[0]);
  f.source = makeSyntheticNotesSource(
    texts.map((text) => ({ speaker: 'Milo', text })),
  );
  const spans = f.source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const capacity = vi
    .spyOn(budget, 'planNotesCapacity')
    .mockReturnValue({ mode: 'hierarchical' });
  const leaves = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    spans.map((span, index) => ({
      primarySpans: [span],
      overlapSpans: [],
      primaryText: texts[index]!,
      sourceText: texts[index]!,
      sourceRevision: f.source.revision,
    })),
  );
  let merged = false;
  const audits: Array<{ merge: boolean; repair: boolean }> = [];
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesAudit') {
      audits.push({
        merge: merged,
        repair: request.prompt.startsWith('Repair'),
      });
      if (merged && mode === 'final transport failure')
        throw new Error('notes_provider_error');
      const draft = JSON.parse(
        request.prompt.match(
          /BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/,
        )![1]!,
      ) as NotesDraft;
      return JSON.stringify({
        changes: [],
        dispositions: [],
        terminology: [],
        verdicts: draft.sections
          .flatMap((section) => [section.title, ...section.items])
          .map((block) => ({
            target: block.id,
            status: 'supported',
            sources: block.sources,
          })),
      });
    }
    if (request.task === 'notesMerge') merged = true;
    const span = request.sourceSpans![0]!;
    const draft = structuredClone(f.draft);
    draft.sections[0]!.title.sources = [span];
    draft.sections[0]!.items = [
      {
        ...draft.sections[0]!.items[0]!,
        text: texts[span.segment]!,
        sources: [span],
      },
    ];
    if (!merged && span.segment === 0) {
      draft.sections[0]!.items.push({
        id: 's0:item:1',
        sources: [span],
        owner: null,
        due: null,
        kind: mode === 'inherited omission' ? 'decision' : 'action',
        text:
          mode === 'inherited omission'
            ? texts[0]!
            : 'Milo will draft the announcement if legal approves.',
      });
    }
    return JSON.stringify(draft);
  });
  try {
    const result = run(f, { generate }).result;
    if (mode === 'final transport failure')
      await expect(result).rejects.toThrow('notes_provider_error');
    else {
      const document = await result;
      expect(document.quality.fallback_used).toBe(false);
      expect(document.generation_metadata).toMatchObject({
        mode: 'hierarchical',
        audit_status: 'complete_with_warnings',
        hierarchy: { nodes: 3, depth: 1 },
      });
      expect(document.quality.issues.join(' ')).toContain(
        mode === 'inherited omission'
          ? 'notes_merge_dropped_commitment'
          : 'notes_audit_invalid_commitment:leaf0',
      );
      expect(document.all_action_items).toEqual([]);
      expect(document.all_decisions).toEqual([]);
      if (mode === 'leaf warning')
        expect(audits.filter((audit) => audit.merge)).toEqual([
          { merge: true, repair: false },
        ]);
      else
        expect(audits.filter((audit) => audit.merge)).toEqual([
          { merge: true, repair: false },
          { merge: true, repair: true },
        ]);
    }
    expect(
      generate.mock.calls.filter(([request]) => request.task === 'notesMerge'),
    ).toHaveLength(1);
    expect(
      generate.mock.calls.filter(([request]) => request.task === 'notesWriter'),
    ).toHaveLength(2);
  } finally {
    capacity.mockRestore();
    leaves.mockRestore();
  }
});

it.each(['missing_condition', 'conflicting_action'] as const)(
  'removes only the action implicated by %s',
  async (code) => {
    const text =
      code === 'missing_condition'
        ? 'I will send the outline after legal approves. I will review the budget.'
        : 'I will send the outline. I will review the budget. I will not send the outline.';
    const f = fixture(text);
    const action = f.draft.sections[0]!.items[1]!;
    action.text = 'Send the outline';
    f.draft.sections[0]!.items.push({
      ...action,
      id: 's0:item:2',
      text: 'Review the budget',
    });
    f.audit.verdicts.push({ ...f.audit.verdicts[2]!, target: 's0:item:2' });
    if (code === 'missing_condition') {
      f.source = makeSyntheticNotesSource([
        {
          speaker: 'Milo',
          text: 'I will send the outline after legal approves.',
        },
        { speaker: 'Milo', text: 'I will review the budget.' },
      ]);
      const spans = f.source.segments.map((segment) => ({
        segment: segment.index,
        start: 0,
        end: segment.text.length,
      }));
      action.text = 'Send the outline after approval';
      [f.draft.sections[0]!.title, ...f.draft.sections[0]!.items].forEach(
        (block, index) => {
          block.sources = [spans[index === 3 ? 1 : 0]!];
        },
      );
      f.audit.verdicts.forEach((verdict, index) => {
        verdict.sources = [spans[index === 3 ? 1 : 0]!];
      });
    }
    const { result, generate } = run(f);
    const document = await result;
    expect(document.all_action_items.map((item) => item.text)).toEqual([
      'Review the budget',
    ]);
    expect(document.quality.issues.join(' ')).toContain(code);
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it('removes an unverifiable decision without losing reviewed discussion', async () => {
  const f = fixture('The decision is not to publish individual responses.');
  Object.assign(f.draft.sections[0]!.items[1]!, {
    kind: 'decision',
    text: 'The decision is to publish individual responses.',
    owner: null,
  });
  const document = await run(f).result;
  expect(document.all_decisions).toEqual([]);
  expect(document.topics[0]?.summary).toBe(f.source.segments[0]!.text);
  expect(document.quality.issues.length).toBeGreaterThan(0);
});

it('records individual action exclusions even when another action satisfies the whole-draft guard', async () => {
  const f = fixture('I will send the outline after legal approves.');
  const action = f.draft.sections[0]!.items[1]!;
  action.text = 'Send the outline after approval';
  f.draft.sections[0]!.items.push({
    ...action,
    id: 's0:item:2',
    text: 'Send the outline after legal approves',
  });
  f.audit.verdicts.push({ ...f.audit.verdicts[2]!, target: 's0:item:2' });
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce('{')
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const document = await run(f, { generate }).result;
  expect(document.all_action_items.map((item) => item.text)).toEqual([
    'Send the outline after legal approves',
  ]);
  expect(document.quality.issues.join(' ')).toContain('missing_condition');
  expect(document.generation_metadata?.audit_status).toBe(
    'complete_with_warnings',
  );
});

it.each(['missing_condition', 'conflicting_action'] as const)(
  'excludes a late %s after earlier omissions fill the diagnostic cap',
  async (code) => {
    const text =
      code === 'missing_condition'
        ? 'I will send the outline after legal approves.'
        : 'I will send the outline.';
    const f = fixture(text);
    f.source = makeSyntheticNotesSource([
      ...Array.from({ length: 33 }, () => ({
        speaker: 'Milo',
        text: 'I will review the budget.',
      })),
      { speaker: 'Milo', text },
      ...(code === 'conflicting_action'
        ? [{ speaker: 'Milo', text: 'I will not send the outline.' }]
        : []),
    ]);
    const sources = [{ segment: 33, start: 0, end: text.length }];
    const section = f.draft.sections[0]!;
    for (const block of [section.title, ...section.items])
      block.sources = sources;
    section.items[1]!.text =
      code === 'missing_condition'
        ? 'Send the outline after approval'
        : 'Send the outline';
    for (const verdict of f.audit.verdicts) verdict.sources = sources;

    const { result, generate } = run(f);
    const document = await result;
    expect(document.all_action_items).toEqual([]);
    expect(document.topics[0]!.action_items).toEqual([]);
    expect(document.quality.issues).toContain(
      `notes_guardrail:${code}:s0:item:1`,
    );
    expect(document.generation_metadata?.audit_status).toBe(
      'complete_with_warnings',
    );
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it('preserves cancellation if the signal changes while the corrected response arrives', async () => {
  const f = fixture();
  const controller = new AbortController();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit))
    .mockImplementationOnce(async () => {
      controller.abort();
      return JSON.stringify(f.audit);
    });
  await expect(
    run(f, { generate, signal: controller.signal }).result,
  ).rejects.toThrow('notes_cancelled');
  expect(generate).toHaveBeenCalledTimes(3);
});

it('publishes the complete warning-bearing document and retains diagnostics in the serialized payload', async () => {
  const f = fixture();
  const document = await run(f).result;
  const publish = vi.fn().mockReturnValue(true);
  const coordinator = createMeetingAnalysisRunCoordinator({
    db: {
      getMeeting: () => ({
        id: 'advisory',
        transcript_json: JSON.stringify(f.source.segments),
        transcript_status: 'validated',
      }),
      getMeetingAnalysisPublicationRevisions: () => ({
        sourceRevision: f.source.revision,
        eligibilityRevision: 'proof',
        userNotesHash: 'notes',
      }),
      getMeetingAnalysisRun: () => null,
      beginMeetingAnalysisRun: vi.fn(),
      updateMeetingAnalysisRunStatus: vi.fn(),
      updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
      isMeetingAnalysisRunCurrent: () => true,
      publishMeetingNotesIfCurrent: publish,
      getAllEntities: () => [],
    },
    getSettings: async () => ({
      llm_provider: 'ollama',
      ollama_model: 'old-generic',
    }),
    getProvider: async () => ({
      name: 'ollama',
      generateStructuredAnalysis: async () => document,
    }),
    createRunId: () => 'advisory-run',
  });
  await expect(
    coordinator.generateAndPublishMeetingNotes({
      meetingId: 'advisory',
      requestId: 'request',
      template: 'auto',
      reason: 'manual',
    }),
  ).resolves.toMatchObject({ status: 'published' });
  expect(publish).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(JSON.stringify(publish.mock.calls[0]![0].analysis));
  expect(stored.quality).toMatchObject({
    format_pass: true,
    fallback_used: false,
    issues: document.quality.issues,
  });
  expect(stored.generation_metadata.audit_status).toBe(
    'complete_with_warnings',
  );
  expect(stored.generation_metadata.error_categories).toContain(
    'notes_quality_warning',
  );
});
