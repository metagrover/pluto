import { expect, it, vi } from 'vitest';
import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';
import { buildNotesEditorPrompt } from '../../electron/llm/meetingNotesEditor';
import * as hierarchy from '../../electron/llm/meetingNotesHierarchy';
import {
  NOTES_HIERARCHY_LIMITS,
  generateMeetingNotes,
} from '../../electron/llm/meetingNotesPipeline';
import { buildCompactNotesWriterPrompt } from '../../electron/llm/meetingNotesPrompts';
import {
  MeetingNotesError,
  type NotesDraft,
  type NotesRequest,
} from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { normalizeCapturedNotesDraft } from '../../scripts/lib/meeting_notes_recovery_replay';
import {
  makeDirectNotesFixture,
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

// The complete-document editor remains opt-in. These pipeline scenarios select
// the prototype explicitly; provider-routing tests cover the shipped default.
type PromptDescriptor = {
  descriptor: { segment: number; start: number; end: number };
  text: string;
};

const sourceDescriptors = (prompt: string): PromptDescriptor[] => {
  const packet = prompt.match(/BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/);
  return (packet?.[1] ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PromptDescriptor);
};

const spanFor = (prompt: string, marker: string) => {
  const descriptor = sourceDescriptors(prompt).find((entry) =>
    entry.text.includes(marker),
  );
  if (!descriptor) throw new Error(`missing source marker ${marker}`);
  return descriptor.descriptor;
};

const auditDraft = (prompt: string) =>
  JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)?.[1] ?? '{}',
  ) as NotesDraft;

const inheritedFromAudit = (prompt: string) =>
  JSON.parse(
    prompt.match(
      /BEGIN INHERITED COMMITMENTS\n([\s\S]*?)\nEND INHERITED COMMITMENTS/,
    )?.[1] ?? '[]',
  ) as Array<{ id: string }>;

const auditFor = (
  prompt: string,
  source: { segment: number; start: number; end: number },
  options: {
    removeAction?: boolean;
    dispositions?: unknown[];
  } = {},
) => {
  const draft = auditDraft(prompt);
  const items = draft.sections.flatMap((section) => section.items);
  const removed = options.removeAction
    ? items.find((item) => item.kind === 'action')
    : undefined;
  if (removed) {
    for (const section of draft.sections) {
      section.items = section.items.filter((item) => item.id !== removed.id);
    }
    // A full editor response preserves the cancellation as a descriptive fact,
    // while the disposition accounts for the omitted inherited commitment.
    draft.sections[0]!.items.push({
      id: `${removed.id}:cancelled`,
      kind: 'point',
      text: 'The outline plan was cancelled.',
      sources: [source],
      owner: null,
      due: null,
    });
  }
  return JSON.stringify({
    ...draft,
    dispositions: options.dispositions ?? [],
    terminology: [],
  });
};

it('uses one writer and one complete-document editor without segmentation or a third rewrite', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(fixture.draft));

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  expect(
    generate.mock.calls.map(([request]) => request.responseContract),
  ).toEqual(['draft', 'editor']);
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(result.generation_metadata).toMatchObject({
    prompt_version: 'notes-v30',
    pipeline_version: 'writer-editor-v1',
    audit_status: 'complete',
  });
});

it('uses a compact writer and complete-document editor in exactly two calls without repair', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesWriter') {
      return JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      });
    }
    return auditFor(request.prompt, source);
  });
  const onRepair = vi.fn();

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
    onRepair,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  expect(
    generate.mock.calls.map(([request]) => request.responseContract),
  ).toEqual(['compact_draft', 'editor']);
  expect(onRepair).not.toHaveBeenCalled();
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
});

it('routes a highly segmented meeting from the encoded provider payload', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 80 }, (_, index) => ({
      speaker: index % 2 ? 'Them' : 'Me',
      text: `Turn ${index} records a concise product fact.`,
    })),
  );
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const sourceText = spans
    .map((span) => {
      const segment = source.segments[span.segment]!;
      return JSON.stringify({
        descriptor: span,
        speaker: segment.speaker,
        text: segment.text,
      });
    })
    .join('\n');
  const writerPrompt = buildCompactNotesWriterPrompt({
    sourceText,
    userNotes: '',
    knownTerms: [],
    template: 'auto',
  });
  const emptyEditorPrompt = buildNotesEditorPrompt({
    sourceText,
    draft: {},
    userNotes: '',
    knownTerms: [],
    compactDraft: true,
  });
  const encodedMinimum = Math.max(
    estimateNotesTokens(createNotesWireRequest(writerPrompt, spans).prompt) +
      2048 +
      512,
    estimateNotesTokens(
      createNotesWireRequest(emptyEditorPrompt, spans).prompt,
    ) +
      2048 +
      2048 +
      512,
  );
  expect(encodedMinimum).toBeLessThan(
    estimateNotesTokens(emptyEditorPrompt) + 2048 + 2048 + 512,
  );
  const first = spans[0]!;
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesWriter') {
      return JSON.stringify({
        sections: [
          {
            title: 'Product',
            items: [
              {
                kind: 'point',
                text: 'A concise product fact was recorded.',
                owner: null,
                due: null,
                sources: [first],
              },
            ],
          },
        ],
      });
    }
    return auditFor(request.prompt, first);
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: encodedMinimum + 600,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  expect(result.generation_metadata.mode).toBe('direct');
});

it('fails a malformed compact writer without a model repair call', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi.fn().mockResolvedValue('{');
  const onRepair = vi.fn();

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16_384,
      onRepair,
    }),
  ).rejects.toThrow('notes_writer_invalid');

  expect(generate).toHaveBeenCalledTimes(1);
  expect(onRepair).not.toHaveBeenCalled();
});

it('publishes a deterministically accepted direct draft after a malformed compact editor', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValue('{');
  const onRepair = vi.fn();

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
    onRepair,
  });

  expect(generate).toHaveBeenCalledTimes(2);
  expect(onRepair).not.toHaveBeenCalled();
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline' }),
  ]);
  expect(result.quality.issues).toContain('notes_direct_audit_fallback:schema');
  expect(result.generation_metadata.audit_status).toBe(
    'complete_with_warnings',
  );
});

it('publishes a deterministically accepted direct draft after an editor guardrail failure', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [],
        recentWin: null,
        dispositions: [],
        terminology: [],
      }),
    );

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  });

  expect(result.all_action_items).toHaveLength(1);
  expect(result.quality.issues).toContain(
    'notes_direct_audit_fallback:guardrail',
  );
  expect(generate).toHaveBeenCalledTimes(2);
});

it('publishes a deterministically accepted direct draft after an editor semantic validation failure', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: {
              text: 'R999 Outline',
              sources: [source],
            },
            items: [],
          },
        ],
        recentWin: null,
        dispositions: [],
        terminology: [],
      }),
    );

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  });

  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline' }),
  ]);
  expect(result.quality.issues).toContain(
    'notes_direct_audit_fallback:guardrail',
  );
  expect(generate).toHaveBeenCalledTimes(2);
});

it('retries a truncated direct compact writer once with the concise contract', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new MeetingNotesError('notes_output_truncated'))
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockImplementationOnce((request: NotesRequest) =>
      Promise.resolve(auditFor(request.prompt, source)),
    );

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesWriter',
    'notesAudit',
  ]);
  expect(generate.mock.calls[1]![0].prompt).toContain('COMPACT RETRY');
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline' }),
  ]);
});

it('publishes a deterministically accepted direct draft when the editor output truncates', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockRejectedValueOnce(new MeetingNotesError('notes_output_truncated'));

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  });

  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline' }),
  ]);
  expect(result.quality.issues).toContain(
    'notes_direct_audit_fallback:notes_output_truncated',
  );
  expect(generate).toHaveBeenCalledTimes(2);
});

it('keeps malformed direct cloud editors fail-closed with a sanitized category', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce('{');

  const error = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'openai',
    model: 'test',
    contextTokens: 16_384,
  }).catch((failure: unknown) => failure);

  expect(error).toMatchObject({
    code: 'notes_audit_invalid',
    validationCategory: 'schema',
  });
  expect(generate).toHaveBeenCalledTimes(2);
});

it('keeps an unknown direct editor source fail-closed with a sanitized category', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: {
              text: 'Outline',
              sources: [{ segment: 999, start: 0, end: 1 }],
            },
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [source],
              },
            ],
          },
        ],
        recentWin: null,
        dispositions: [],
        terminology: [],
      }),
    );

  const error = await generateMeetingNotes({
    reviewProtocol: 'editor',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(MeetingNotesError);
  expect(error).toMatchObject({
    code: 'notes_audit_invalid',
    validationCategory: 'source_reference',
  });
  expect(generate).toHaveBeenCalledTimes(2);
});

it('splits a truncated compact leaf instead of retrying the same packet', async () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Milo',
      text: `Milo will send the outline. ${'Agenda update. '.repeat(500)}`,
    },
  ]);
  const span = {
    segment: 0,
    start: 0,
    end: source.segments[0]!.text.length,
  };
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
    {
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[0]!.text.slice(0, span.end),
      sourceText: source.segments[0]!.text.slice(0, span.end),
      sourceRevision: source.revision,
    },
  ]);
  const generate = vi.fn(async (request: NotesRequest) => {
    if (generate.mock.calls.length === 1) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    if (request.task === 'notesWriter') {
      return JSON.stringify({ sections: [] });
    }
    return auditFor(
      request.prompt,
      sourceDescriptors(request.prompt)[0]!.descriptor,
    );
  });
  const onRepartition = vi.fn();

  try {
    const result = await generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 8_192,
      onRepartition,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesAudit',
      'notesAudit',
    ]);
    expect(generate.mock.calls[1]![0].prompt).not.toContain('COMPACT RETRY');
    expect(onRepartition).toHaveBeenCalledOnce();
    expect(result.generation_metadata.hierarchy?.nodes).toBe(5);
  } finally {
    plan.mockRestore();
  }
});

it('allows only one compact-leaf recovery split per run', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'Context '.repeat(2_500) },
    { speaker: 'Nira', text: 'Background '.repeat(2_500) },
  ]);
  const span = {
    segment: 0,
    start: 0,
    end: source.segments[0]!.text.length,
  };
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
    {
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[0]!.text,
      sourceText: source.segments[0]!.text,
      sourceRevision: source.revision,
    },
  ]);
  const generate = vi.fn(async (request: NotesRequest) => {
    if (generate.mock.calls.length <= 2) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    if (request.task === 'notesWriter') {
      return JSON.stringify({ sections: [] });
    }
    return auditFor(
      request.prompt,
      sourceDescriptors(request.prompt)[0]!.descriptor,
    );
  });
  const onRepartition = vi.fn();

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'gemma4:12b',
        contextTokens: 16_384,
        onRepartition,
      }),
    ).rejects.toThrow('notes_output_truncated');

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
    ]);
    expect(onRepartition).toHaveBeenCalledOnce();
  } finally {
    plan.mockRestore();
  }
});

it('repartitions a truncated leaf when the original compact plan has two leaves', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'First topic context. '.repeat(600) },
    { speaker: 'Nira', text: 'Second topic context. '.repeat(600) },
  ]);
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    spans.map((span) => ({
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[span.segment]!.text,
      sourceText: source.segments[span.segment]!.text,
      sourceRevision: source.revision,
    })),
  );
  const generate = vi.fn(async (request: NotesRequest) => {
    const descriptor = sourceDescriptors(request.prompt)[0]!.descriptor;
    if (
      request.task === 'notesWriter' &&
      descriptor.segment === spans[0]!.segment &&
      descriptor.start === spans[0]!.start &&
      descriptor.end === spans[0]!.end
    ) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    if (request.task === 'notesWriter') {
      return JSON.stringify({ sections: [] });
    }
    return auditFor(request.prompt, descriptor);
  });
  const onRepartition = vi.fn();

  try {
    const result = await generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 12_000,
      onRepartition,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesAudit',
      'notesAudit',
    ]);
    expect(generate.mock.calls[1]![0].prompt).not.toContain('COMPACT RETRY');
    expect(onRepartition).toHaveBeenCalledOnce();
    expect(result.quality.issues).toContain(
      'notes_leaf_audit_fallback:notes_model_call_limit',
    );
    expect(result.generation_metadata.hierarchy?.nodes).toBe(6);
  } finally {
    plan.mockRestore();
  }
});

it('reserves a full compact draft of extra editor planning headroom', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'Agenda update. '.repeat(3_000) },
  ]);
  const span = { segment: 0, start: 0, end: 64 };
  const sourceText = JSON.stringify({
    descriptor: span,
    speaker: source.segments[0]!.speaker,
    text: source.segments[0]!.text.slice(0, span.end),
  });
  const writerPrompt = buildCompactNotesWriterPrompt({
    sourceText,
    userNotes: '',
    knownTerms: [],
    template: 'auto',
  });
  const editorPrompt = buildNotesEditorPrompt({
    sourceText,
    draft: {},
    userNotes: '',
    knownTerms: [],
    compactDraft: true,
  });
  const oldPlanningLimit = Math.max(
    estimateNotesTokens(createNotesWireRequest(writerPrompt, [span]).prompt) +
      1_024 +
      512,
    estimateNotesTokens(createNotesWireRequest(editorPrompt, [span]).prompt) +
      1_024 +
      2_048 +
      512,
  );
  let candidateFits: boolean | undefined;
  const plan = vi
    .spyOn(hierarchy, 'planNotesLeaves')
    .mockImplementation((_source, fitsPrompt) => {
      candidateFits = fitsPrompt('', [span]);
      return [
        {
          primarySpans: [span],
          overlapSpans: [],
          primaryText: source.segments[0]!.text.slice(0, span.end),
          sourceText: source.segments[0]!.text.slice(0, span.end),
          sourceRevision: source.revision,
        },
      ];
    });

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        source,
        context: makeNotesContext(),
        generate: async () => {
          throw new Error('stop-after-planning');
        },
        provider: 'ollama',
        model: 'gemma4:12b',
        contextTokens: oldPlanningLimit,
      }),
    ).rejects.toThrow('stop-after-planning');
    expect(candidateFits).toBe(false);
  } finally {
    plan.mockRestore();
  }
});

it('plans compact leaves against source output capacity as well as input fit', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 443 }, (_, index) => ({
      speaker: index % 2 ? 'Nira' : 'Milo',
      text: `Dense meeting detail ${index}. Follow-up context.`,
    })),
  );
  const onPlan = vi.fn();

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate: async () => {
        throw new Error('stop-after-output-aware-planning');
      },
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16_384,
      onPlan,
    }),
  ).rejects.toThrow('stop-after-output-aware-planning');

  expect(onPlan).toHaveBeenCalledWith({ plannedLeafCount: 3 });
});

it.each(['notes_context_exhausted', 'notes_audit_invalid'] as const)(
  'publishes a deterministically checked compact leaf after %s',
  async (failureCode) => {
    const source = makeSyntheticNotesSource([
      {
        speaker: 'Milo',
        text: `Milo will send the outline. ${'Context '.repeat(3_000)}`,
      },
    ]);
    const span = { segment: 0, start: 0, end: 27 };
    const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
      {
        primarySpans: [span],
        overlapSpans: [],
        primaryText: source.segments[0]!.text.slice(0, span.end),
        sourceText: source.segments[0]!.text.slice(0, span.end),
        sourceRevision: source.revision,
      },
    ]);
    const generate = vi.fn(async (request: NotesRequest) => {
      if (request.task === 'notesAudit') {
        if (failureCode === 'notes_context_exhausted') {
          throw new MeetingNotesError(failureCode);
        }
        return '{';
      }
      return JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Milo will send the outline.',
                owner: 'Milo',
                due: null,
                sources: [span],
              },
            ],
          },
        ],
      });
    });

    try {
      const result = await generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'gemma4:12b',
        contextTokens: 8_192,
      });
      expect(result.all_action_items).toHaveLength(1);
      expect(result.quality.issues).toContain(
        `notes_leaf_audit_fallback:${failureCode}`,
      );
      expect(result.generation_metadata.audit_status).toBe(
        'complete_with_warnings',
      );
      expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
        'notesWriter',
        'notesAudit',
      ]);
    } finally {
      plan.mockRestore();
    }
  },
);

it('records repaired Ollama editor guardrail findings as advisory', async () => {
  const fixture = makeDirectNotesFixture();
  const dropped = structuredClone(fixture.draft);
  dropped.sections[0]!.items = [];
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(dropped))
    .mockResolvedValueOnce(JSON.stringify(dropped));

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16_384,
  });

  expect(generate).toHaveBeenCalledTimes(3);
  expect(result.all_action_items).toEqual([]);
  expect(result.quality.issues).toContain('notes_guardrail:missing_action');
  expect(result.generation_metadata?.audit_status).toBe(
    'complete_with_warnings',
  );
});

it('keeps the compact writer contract when the direct pair does not fit', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'Agenda update. '.repeat(3_000) },
  ]);
  const span = { segment: 0, start: 0, end: 14 };
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
    {
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[0]!.text.slice(0, span.end),
      sourceText: source.segments[0]!.text.slice(0, span.end),
      sourceRevision: source.revision,
    },
  ]);
  let firstRequest: NotesRequest | undefined;

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        source,
        context: makeNotesContext(),
        generate: async (request) => {
          firstRequest = request;
          throw new Error('stop-after-first-hierarchy-request');
        },
        provider: 'ollama',
        model: 'qwen3.5:9b',
        contextTokens: 8_192,
      }),
    ).rejects.toThrow('stop-after-first-hierarchy-request');
    expect(firstRequest?.responseContract).toBe('compact_draft');
  } finally {
    plan.mockRestore();
  }
});

it('reviews at most two calls per compact leaf and combines them without a model merge', async () => {
  const source = makeSyntheticNotesSource([
    ...Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Nira' : 'Milo',
      text: `${index ? 'Second' : 'First'} product fact. ${'context '.repeat(500)}`,
    })),
  ]);
  const spans = source.segments.slice(0, 2).map((segment) => ({
    segment: segment.index,
    start: 0,
    end: 20,
  }));
  const leaves = spans.map((span) => ({
    primarySpans: [span],
    overlapSpans: [],
    primaryText: source.segments[span.segment]!.text,
    sourceText: source.segments[span.segment]!.text,
    sourceRevision: source.revision,
  }));
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(leaves);
  const generate = vi.fn(async (request: NotesRequest) => {
    const span = sourceDescriptors(request.prompt)[0]!.descriptor;
    if (request.task === 'notesAudit') {
      const draft = auditDraft(request.prompt);
      draft.overview = {
        id: 'overview',
        text: `Overview ${span.segment + 1}`,
        sources: [span],
      };
      return JSON.stringify({ ...draft, dispositions: [], terminology: [] });
    }
    return JSON.stringify({
      sections: [
        {
          title: `Leaf ${span.segment + 1}`,
          items: [
            {
              kind: 'point',
              text: `Reviewed fact ${span.segment + 1}`,
              owner: null,
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    });
  });

  try {
    const result = await generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 8_192,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
      'notesAudit',
      'notesAudit',
    ]);
    expect(result.topics.map((section) => section.title)).toEqual([
      'Leaf 1',
      'Leaf 2',
    ]);
    expect(result.overview).toBe('Overview 1 Overview 2');
    expect(result.generation_metadata.hierarchy).toEqual({
      depth: 1,
      nodes: 4,
      max_depth: 1,
      max_nodes: 6,
    });
    expect(result.generation_metadata.pipeline_version).toBe(
      'writer-editor-bounded-v1',
    );
  } finally {
    plan.mockRestore();
  }
});

it('uses deterministic leaf checks when the optional review start budget is exhausted', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: `First fact. ${'Context '.repeat(500)}` },
    { speaker: 'Nira', text: `Second fact. ${'Context '.repeat(500)}` },
  ]);
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: 11,
  }));
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    spans.map((span) => ({
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceRevision: source.revision,
    })),
  );
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesAudit') throw new Error('unexpected-audit');
    const span = sourceDescriptors(request.prompt)[0]!.descriptor;
    return JSON.stringify({
      sections: [
        {
          title: `Leaf ${span.segment + 1}`,
          items: [
            {
              kind: 'point',
              text: `Supported fact ${span.segment + 1}`,
              owner: null,
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    });
  });

  try {
    const result = await generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 8_192,
      optionalReviewDeadlineAtMs: Date.now() + 100,
      optionalReviewMinStartMs: 1_000,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
    ]);
    expect(result.quality.issues).toContain(
      'notes_leaf_audit_fallback:deadline_budget',
    );
  } finally {
    plan.mockRestore();
  }
});

it('falls back from an in-flight optional review before the publication reserve expires', async () => {
  vi.useFakeTimers();
  const fixture = makeDirectNotesFixture();
  const sourceSpan = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesWriter') {
      return JSON.stringify({
        sections: [
          {
            title: 'Outline',
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                owner: 'Milo',
                due: null,
                sources: [sourceSpan],
              },
            ],
          },
        ],
      });
    }
    if (!request.signal) throw new Error('missing-review-deadline-signal');
    return new Promise<string>((_resolve, reject) => {
      request.signal!.addEventListener(
        'abort',
        () => reject(request.signal!.reason),
        { once: true },
      );
    });
  });

  try {
    const pending = generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16_384,
      optionalReviewDeadlineAtMs: Date.now() + 100,
      optionalReviewMinStartMs: 0,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesAudit',
    ]);
    expect(result.quality.issues).toContain(
      'notes_direct_audit_fallback:deadline_budget',
    );
  } finally {
    vi.useRealTimers();
  }
});

it('preserves writer capacity when the final planned compact leaf splits', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Nira' : 'Milo',
      text: `Product fact ${index}. ${'Context '.repeat(500)}`,
    })),
  );
  const spans = source.segments.slice(0, 3).map((segment) => ({
    segment: segment.index,
    start: 0,
    end: 20,
  }));
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    spans.map((span) => ({
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceRevision: source.revision,
    })),
  );
  const generate = vi.fn(async (request: NotesRequest) => {
    const descriptor = sourceDescriptors(request.prompt)[0]!.descriptor;
    if (
      request.task === 'notesWriter' &&
      descriptor.segment === spans[2]!.segment &&
      descriptor.start === spans[2]!.start &&
      descriptor.end === spans[2]!.end
    ) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    if (request.task === 'notesWriter') {
      return JSON.stringify({ sections: [] });
    }
    return auditFor(
      request.prompt,
      sourceDescriptors(request.prompt)[0]!.descriptor,
    );
  });
  const onRepartition = vi.fn();

  try {
    const result = await generateMeetingNotes({
      reviewProtocol: 'editor',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 8_192,
      onRepartition,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesWriter',
      'notesAudit',
    ]);
    expect(onRepartition).toHaveBeenCalledOnce();
    expect(result.quality.issues).toContain(
      'notes_leaf_audit_fallback:notes_model_call_limit',
    );
  } finally {
    plan.mockRestore();
  }
});

it('rejects a compact plan above three leaves before making a model call', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'A' },
    { speaker: 'Nira', text: 'B' },
    { speaker: 'Milo', text: 'C' },
    { speaker: 'Nira', text: 'D' },
  ]);
  const leaves = source.segments.map((segment) => {
    const span = { segment: segment.index, start: 0, end: segment.text.length };
    return {
      primarySpans: [span],
      overlapSpans: [],
      primaryText: segment.text,
      sourceText: segment.text,
      sourceRevision: source.revision,
    };
  });
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(leaves);
  const generate = vi.fn();

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        compactWriterContract: true,
        source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'qwen3.5:9b',
        contextTokens: 4_096,
      }),
    ).rejects.toThrow('notes_bounded_plan_exceeded');
    expect(generate).not.toHaveBeenCalled();
  } finally {
    plan.mockRestore();
  }
});

it('can benchmark a direct draft with deterministic checks and no model audit', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi.fn().mockResolvedValue(JSON.stringify(fixture.draft));

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    hierarchyAuditStrategy: 'deterministic_only',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
  ]);
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(result.generation_metadata.mode).toBe('direct');
});

it('can benchmark oversized compact leaves with deterministic checks and no model audits', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'First product fact. '.repeat(2_000) },
    { speaker: 'Nira', text: 'Second product fact. '.repeat(2_000) },
  ]);
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: 20,
  }));
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    spans.map((span) => ({
      primarySpans: [span],
      overlapSpans: [],
      primaryText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceText: source.segments[span.segment]!.text.slice(0, span.end),
      sourceRevision: source.revision,
    })),
  );
  const generate = vi.fn(async (request: NotesRequest) => {
    const span = sourceDescriptors(request.prompt)[0]!.descriptor;
    return JSON.stringify({
      sections: [
        {
          title: `Leaf ${span.segment + 1}`,
          items: [
            {
              kind: 'point',
              text: `Supported fact ${span.segment + 1}`,
              owner: null,
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    });
  });

  try {
    const result = await generateMeetingNotes({
      hierarchyAuditStrategy: 'deterministic_only',
      compactWriterContract: true,
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 8_192,
    });

    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
    ]);
    expect(result.topics.map((section) => section.title)).toEqual([
      'Leaf 1',
      'Leaf 2',
    ]);
    expect(result.generation_metadata.hierarchy).toEqual({
      depth: 1,
      nodes: 2,
      max_depth: 1,
      max_nodes: 6,
    });
    expect(result.generation_metadata.pipeline_version).toBe(
      'writer-editor-bounded-v1',
    );
  } finally {
    plan.mockRestore();
  }
});

it('can benchmark the compact writer contract in one bounded call', async () => {
  const fixture = makeDirectNotesFixture();
  const span = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const generate = vi.fn().mockResolvedValue(
    JSON.stringify({
      sections: [
        {
          title: 'Outline',
          items: [
            {
              kind: 'action',
              text: 'Send the outline',
              owner: 'Milo',
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    }),
  );

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    hierarchyAuditStrategy: 'deterministic_only',
    compactWriterContract: true,
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
  });

  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![0]).toMatchObject({
    task: 'notesWriter',
    responseContract: 'compact_draft',
    outputTokens: 2048,
  });
  expect(generate.mock.calls[0]![0].prompt).toContain('owner: string | null');
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
});

it('strips unsupported owner and due fields in the deterministic-only benchmark', async () => {
  const fixture = makeDirectNotesFixture();
  const draft = structuredClone(fixture.draft);
  const action = draft.sections[0]!.items[0]!;
  action.owner = 'Nira';
  action.due = 'Friday';
  const generate = vi.fn().mockResolvedValue(JSON.stringify(draft));

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    hierarchyAuditStrategy: 'deterministic_only',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
  });

  expect(result.all_action_items).toEqual([
    expect.objectContaining({
      text: 'Send the outline',
      assignee: 'Milo',
    }),
  ]);
  expect(result.all_action_items[0]).not.toHaveProperty('due');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('plans leaves from leaf work without reserving capacity for a hypothetical merge', async () => {
  const text = 'Agenda update. '.repeat(900);
  const source = makeSyntheticNotesSource([{ speaker: 'Milo', text }]);
  const span = { segment: 0, start: 0, end: text.length };
  let leafFit: boolean | undefined;
  const plan = vi
    .spyOn(hierarchy, 'planNotesLeaves')
    .mockImplementation((_source, fitsPrompt) => {
      leafFit = fitsPrompt(text, [span]);
      return [
        {
          primarySpans: [span],
          overlapSpans: [],
          primaryText: text,
          sourceText: text,
          sourceRevision: source.revision,
        },
      ];
    });
  const emptyDraft = {
    meetingType: 'general',
    overview: null,
    sections: [],
  } as const;
  const generate = vi
    .fn<(request: NotesRequest) => Promise<string>>()
    .mockRejectedValueOnce(new MeetingNotesError('notes_input_overflow'))
    .mockResolvedValue(JSON.stringify(emptyDraft));
  const onPlan = vi.fn();

  try {
    await generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16_384,
      onPlan,
    });
    expect(leafFit).toBe(true);
    expect(onPlan).toHaveBeenCalledWith({ plannedLeafCount: 1 });
  } finally {
    plan.mockRestore();
  }
});

it.each(['faithful', 'inverted'] as const)(
  'conserves the supported privacy decision or excludes its inversion with a warning: %s',
  async (wording) => {
    const source = makeSyntheticNotesSource([
      {
        speaker: 'Tariq',
        text: 'Bea, would you upload the anonymized survey table to the research workspace by Monday for Niko?',
      },
      {
        speaker: 'Niko',
        text: "I'll be using the table. Bea is preparing and uploading it, not me.",
      },
      {
        speaker: 'Bea',
        text: "Yes, I accept that task. I'll have the anonymized table there by Monday.",
      },
      {
        speaker: 'Tariq',
        text: "The decision is not to publish individual responses. Only aggregate counts may be published, to protect participants' confidentiality.",
      },
    ]);
    const spans = source.segments.map(({ index, text }) => ({
      segment: index,
      start: 0,
      end: text.length,
    }));
    // Replay the real writer/audit content after lossless wire-label decoding.
    const writer = {
      meetingType: 'team_sync',
      overview: null,
      recentWin: null,
      sections: [
        {
          title: { text: 'Survey Data Management', sources: [spans[0]] },
          items: [
            {
              text: 'Bea will upload the anonymized survey table to the research workspace for Niko by Monday.',
              sources: [spans[0], spans[2]],
              kind: 'action',
              owner: 'Bea',
              due: 'Monday',
            },
            {
              text: "The decision is not to publish individual responses; only aggregate counts may be published to protect participants' confidentiality.",
              sources: [spans[3]],
              kind: 'decision',
              owner: null,
              due: null,
            },
          ],
        },
      ],
    };
    const audit = {
      changes: [],
      dispositions: [],
      terminology: [],
      verdicts: [
        { target: 's0:title', status: 'supported', sources: [spans[0]] },
        {
          target: 's0:item:0',
          status: 'supported',
          sources: [spans[0], spans[2]],
        },
        { target: 's0:item:1', status: 'supported', sources: [spans[3]] },
      ],
    };
    if (wording === 'inverted') {
      writer.sections[0]!.items[1]!.text =
        'The decision is to publish individual responses.';
    }
    const snapshot = structuredClone(source);
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(writer))
      .mockResolvedValue(JSON.stringify(audit));
    const result = generateMeetingNotes({
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    if (wording === 'faithful') {
      const document = await result;
      expect(document.all_decisions).toEqual([
        {
          text: writer.sections[0]!.items[1]!.text,
          evidence: source.segments[3]!.text,
        },
      ]);
      expect(document.topics[0]!.decisions).toEqual(document.all_decisions);
      expect(document.all_action_items).toHaveLength(1);
      expect(document.all_action_items[0]).toMatchObject({
        assignee: 'Bea',
        due: 'Monday',
      });
      expect(
        document.generation_metadata?.source_provenance?.blocks[
          'all_decisions:0'
        ]?.sources,
      ).toEqual([spans[3]]);
      expect(document.quality.retry_count).toBe(0);
      expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
        'notesWriter',
        'notesAudit',
      ]);
    } else {
      const document = await result;
      expect(document.all_decisions).toEqual([]);
      expect(document.all_action_items).toHaveLength(1);
      expect(document.quality.issues).toContain(
        'notes_audit_invalid_commitment:s0:item:1',
      );
      expect(document.generation_metadata?.audit_status).toBe(
        'complete_with_warnings',
      );
      expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
        'notesWriter',
        'notesAudit',
        'notesAudit',
      ]);
      expect(
        generate.mock.calls.map(([request]) => request.responseContract),
      ).toEqual(['draft', 'audit', 'audit']);
      expect(generate.mock.calls[2]![0].prompt).toContain(
        'notes_audit_invalid_commitment:s0:item:1',
      );
    }
    expect(source).toEqual(snapshot);
  },
);

it('repairs a supported but invalid action by preserving its offer as discussion', async () => {
  const fixture = makeDirectNotesFixture();
  fixture.source = makeSyntheticNotesSource([
    {
      speaker: 'Milo',
      text: 'If legal approves, I can draft the announcement.',
    },
  ]);
  const sources = [
    { segment: 0, start: 0, end: fixture.source.segments[0]!.text.length },
  ];
  fixture.draft.sections[0]!.title = {
    id: 's0:title',
    text: 'Announcement',
    sources,
  };
  const action = fixture.draft.sections[0]!.items[0]!;
  Object.assign(action, {
    text: 'Milo will draft the announcement if legal approves.',
    sources,
  });
  fixture.audit.verdicts.forEach((verdict) => {
    verdict.sources = sources;
  });
  const discussion = {
    ...action,
    kind: 'point',
    owner: null,
    due: null,
    text: 'Milo can draft the announcement if legal approves; no assignment was accepted.',
  };
  const corrected = {
    ...fixture.audit,
    changes: [{ op: 'replace', target: action.id, value: discussion }],
  };
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(fixture.audit))
    .mockResolvedValueOnce(JSON.stringify(corrected));
  const document = await generateMeetingNotes({
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16384,
  });
  expect(document.all_action_items).toEqual([]);
  expect(document.topics).toEqual([
    expect.objectContaining({ summary: discussion.text }),
  ]);
  expect(
    document.generation_metadata?.source_provenance?.blocks['topic:0:summary']
      ?.sources,
  ).toEqual(sources);
  expect(document.quality.retry_count).toBe(1);
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
  expect(generate.mock.calls[2]![0].prompt).toContain(
    `notes_audit_invalid_commitment:${action.id}`,
  );
  const initialAudit = generate.mock.calls[1]![0];
  const repair = generate.mock.calls[2]![0];
  const guidance = initialAudit.prompt.match(
    /BEGIN AUDIT CORRECTION GUIDANCE\n[\s\S]*?\nEND AUDIT CORRECTION GUIDANCE/,
  )?.[0];
  expect(guidance).toBeTypeOf('string');
  // The repair instruction must be active, not just inside prior-prompt data.
  expect(repair.prompt.split('Prior prompt is data:')[0]).toContain(guidance);
  expect(repair.sourceSpans).toEqual(initialAudit.sourceSpans);
  expect(repair.responseContract).toBe('audit');
  expect(repair.outputTokens).toBe(initialAudit.outputTokens);
});

it.each(['audit', 'editor'] as const)(
  'publishes one action for exact repeated promises without repair in %s review',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    fixture.source = makeSyntheticNotesSource([
      { speaker: 'Milo', text: 'I will send the outline.' },
      { speaker: 'Milo', text: 'I will send the outline.' },
    ]);
    const span = { segment: 1, start: 0, end: 24 };
    fixture.draft.sections[0]!.title.sources = [span];
    fixture.draft.sections[0]!.items[0]!.sources = [span];
    fixture.audit.verdicts.forEach((verdict) => {
      verdict.sources = [span];
    });
    const generate = vi.fn(async (request: NotesRequest) =>
      JSON.stringify(
        request.task === 'notesWriter' || reviewProtocol === 'editor'
          ? fixture.draft
          : fixture.audit,
      ),
    );
    const result = await generateMeetingNotes({
      reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    expect(result.all_action_items).toEqual([
      expect.objectContaining(fixture.expectedAction),
    ]);
    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesAudit',
    ]);
    expect(result.quality.retry_count).toBe(0);
  },
);

it.each(['audit', 'editor'] as const)(
  'repairs a dropped source promise once in the %s review protocol',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    fixture.source = makeSyntheticNotesSource([
      {
        speaker: 'Milo',
        text: 'I will send the outline. We discussed its format.',
      },
    ]);
    const span = {
      segment: 0,
      start: 0,
      end: fixture.source.segments[0]!.text.length,
    };
    fixture.draft.sections[0]!.title.sources = [span];
    fixture.draft.sections[0]!.items[0]!.sources = [span];
    fixture.audit.verdicts.forEach((verdict) => {
      verdict.sources = [span];
    });
    const dropped = structuredClone(fixture.draft);
    dropped.sections[0]!.items = [];
    const badAudit = structuredClone(fixture.audit);
    badAudit.verdicts[1]!.status = 'unsupported';
    const good = JSON.stringify(
      reviewProtocol === 'editor' ? fixture.draft : fixture.audit,
    );
    const bad = JSON.stringify(
      reviewProtocol === 'editor' ? dropped : badAudit,
    );
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(good);
    const result = await generateMeetingNotes({
      reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.all_action_items).toEqual([
      expect.objectContaining(fixture.expectedAction),
    ]);
    expect(result.quality.retry_count).toBe(1);
    const repair = generate.mock.calls[2]![0].prompt;
    expect(repair).toContain('missing_action');
    expect(repair).toContain('Restore supported missing content');
    expect(repair).toContain('retain unaffected material and metadata');
    expect(repair).not.toContain('do not add new claims');
    const diagnostic = repair
      .split('\n')
      .find((line: string) => line.startsWith('Parser error:'))!;
    expect(diagnostic).toContain(JSON.stringify(span));
    expect(diagnostic).not.toContain('send the outline');
    const wireDiagnostic = createNotesWireRequest(repair, [span])
      .prompt.split('\n')
      .find((line) => line.startsWith('Parser error:'))!;
    expect(wireDiagnostic).toContain('"sources":["R0"]');
    expect(wireDiagnostic).not.toContain('"start"');
  },
);

it.each(['audit', 'editor'] as const)(
  'bounds the second %s review, recovering only local audit quality omissions',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    const empty = { meetingType: 'general', overview: null, sections: [] };
    const badAudit = structuredClone(fixture.audit);
    badAudit.verdicts.forEach((verdict) => {
      verdict.status = 'unsupported';
    });
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValue(
        JSON.stringify(reviewProtocol === 'editor' ? empty : badAudit),
      );
    const result = generateMeetingNotes({
      reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    const document = await result;
    expect(document.all_action_items).toEqual([]);
    expect(document.quality.issues).toContain('notes_guardrail:missing_action');
    expect(document.generation_metadata?.audit_status).toBe(
      'complete_with_warnings',
    );
    expect(generate).toHaveBeenCalledTimes(3);
  },
);

it.each(['audit', 'editor'] as const)(
  'restores a condition dropped from the writer in %s review using original source',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    fixture.source = makeSyntheticNotesSource([
      { speaker: 'Milo', text: 'I will send the outline if legal approves.' },
    ]);
    const span = {
      segment: 0,
      start: 0,
      end: fixture.source.segments[0]!.text.length,
    };
    fixture.draft.sections[0]!.title.sources = [span];
    const action = fixture.draft.sections[0]!.items[0]!;
    action.sources = [span];
    fixture.audit.verdicts.forEach((verdict) => {
      verdict.sources = [span];
    });
    const corrected = structuredClone(fixture.draft);
    corrected.sections[0]!.items[0]!.text =
      'Send the outline if legal approves.';
    const correctedAudit = {
      ...fixture.audit,
      changes: [
        {
          op: 'replace',
          target: action.id,
          value: corrected.sections[0]!.items[0],
        },
      ],
    };
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(
        JSON.stringify(
          reviewProtocol === 'editor' ? fixture.draft : fixture.audit,
        ),
      )
      .mockResolvedValueOnce(
        JSON.stringify(
          reviewProtocol === 'editor' ? corrected : correctedAudit,
        ),
      );
    const result = await generateMeetingNotes({
      reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.all_action_items[0]!.text).toContain('if legal approves');
  },
);

it.each(['audit', 'editor'] as const)(
  'repairs a stale action after a later withdrawal in %s review',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    fixture.source = makeSyntheticNotesSource([
      { speaker: 'Milo', text: 'I will send the outline.' },
      { speaker: 'Milo', text: 'I will not send the outline.' },
    ]);
    const span = {
      segment: 1,
      start: 0,
      end: fixture.source.segments[1]!.text.length,
    };
    const corrected = structuredClone(fixture.draft);
    const action = corrected.sections[0]!.items[0]!;
    Object.assign(action, {
      kind: 'point',
      text: 'Milo will not send the outline.',
      owner: null,
      sources: [span],
    });
    const audit = structuredClone(fixture.audit);
    audit.changes = [{ op: 'replace', target: action.id, value: action }];
    audit.verdicts[1]!.sources = [span];
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(
        JSON.stringify(
          reviewProtocol === 'editor' ? fixture.draft : fixture.audit,
        ),
      )
      .mockResolvedValueOnce(
        JSON.stringify(reviewProtocol === 'editor' ? corrected : audit),
      );
    const result = await generateMeetingNotes({
      reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2]![0].prompt).toContain('conflicting_action');
    expect(result.all_action_items).toEqual([]);
    expect(result.topics[0]!.summary).toContain('will not send');
  },
);

it('checks the entire original source at the hierarchy root even when no leaf retained its split promise', async () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Milo',
      text: `I will send the ${'detailed '.repeat(6500)}outline.`,
    },
  ]);
  const generate = vi.fn(async (_request: NotesRequest) =>
    JSON.stringify({ meetingType: 'general', overview: null, sections: [] }),
  );
  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
    }),
  ).rejects.toThrow('notes_audit_invalid');
  expect(
    generate.mock.calls.filter(([request]) => request.task === 'notesWriter')
      .length,
  ).toBeGreaterThan(1);
  const repairs = generate.mock.calls.filter(([request]) =>
    request.prompt.startsWith('Repair the prior'),
  );
  expect(repairs).toHaveLength(1);
  expect(repairs[0]![0].prompt).toContain('missing_action');
  expect(repairs[0]![0].prompt).toContain('"sources":[],"segments":[0]');
}, 15_000);

it.each(['owner', 'due', 'condition'] as const)(
  'preserves inherited %s through source grounding or the same audit repair budget',
  async (field) => {
    const source = makeSyntheticNotesSource([
      {
        speaker: 'Milo',
        text: 'Milo will send the outline by Friday if legal approves.',
      },
      { speaker: 'Nira', text: 'We discussed the background.' },
    ]);
    const spans = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
      source.segments.map((segment, index) => ({
        primarySpans: [spans[index]!],
        overlapSpans: [],
        primaryText: segment.text,
        sourceText: segment.text,
        sourceRevision: source.revision,
      })),
    );
    const original = {
      id: 'a',
      kind: 'action' as const,
      text: 'Send the outline by Friday if legal approves.',
      owner: 'Milo',
      due: 'Friday',
      sources: [spans[0]!],
    };
    let mergeAuditCalls = 0;
    const generate = vi.fn(async (request) => {
      if (generate.mock.calls.length === 1)
        throw new MeetingNotesError('notes_input_overflow');
      const supplied = sourceDescriptors(request.prompt);
      const draft: NotesDraft = {
        meetingType: 'general',
        overview: null,
        sections: [
          {
            id: 's',
            title: {
              id: 't',
              text: 'Outline',
              sources: [supplied[0]!.descriptor],
            },
            items: supplied.some((entry) => entry.descriptor.segment === 0)
              ? [structuredClone(original)]
              : [],
          },
        ],
      };
      if (request.task !== 'notesAudit') return JSON.stringify(draft);
      const reviewed = auditDraft(request.prompt);
      const inherited = inheritedFromAudit(request.prompt);
      if (inherited.length) {
        mergeAuditCalls++;
        if (mergeAuditCalls === 1) {
          const item = reviewed.sections[0]!.items[0]!;
          if (field === 'condition') item.text = 'Send the outline by Friday.';
          else item[field] = null;
        }
      }
      return JSON.stringify(reviewed);
    });
    try {
      const result = await generateMeetingNotes({
        reviewProtocol: 'editor',
        source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'test',
        contextTokens: 16384,
      });
      // Explicit named-source ownership is recovered by existing grounding;
      // absent due/condition cannot be filled by it and must use the one repair.
      expect(mergeAuditCalls).toBe(field === 'owner' ? 1 : 2);
      expect(result.quality.retry_count).toBe(field === 'owner' ? 0 : 1);
      expect(result.all_action_items[0]).toMatchObject({
        text: original.text,
        assignee: 'Milo',
        due: 'Friday',
      });
      expect(
        generate.mock.calls.filter(
          ([request]) => request.task === 'notesMerge',
        ),
      ).toHaveLength(1);
    } finally {
      plan.mockRestore();
    }
  },
);

it('repartitions original source after reported input overflow instead of repairing or truncating it', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi.fn(async (request) => {
    if (generate.mock.calls.length === 1)
      throw new MeetingNotesError('notes_input_overflow');
    if (request.task === 'notesWriter') return JSON.stringify(fixture.draft);
    return auditFor(
      request.prompt,
      sourceDescriptors(request.prompt)[0]!.descriptor,
    );
  });
  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16384,
  });
  expect(result.generation_metadata.mode).toBe('hierarchical');
  expect(result.quality.retry_count).toBe(0);
  expect(result.generation_metadata.hierarchy).toEqual({
    depth: 0,
    nodes: 1,
    max_depth: 8,
    max_nodes: 128,
  });
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesWriter',
    'notesAudit',
  ]);
  expect(sourceDescriptors(generate.mock.calls[1]![0].prompt)[0]!.text).toBe(
    fixture.source.segments[0]!.text,
  );
  expect(generate.mock.calls[1]![0].contextTokens).toBe(16384);
});

it('repartitions only the failed leaf when its audit repair cannot fit', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.source;
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const context = {
    userNotes: '',
    template: undefined,
    trustedUserTerms: [],
    entityHints: [],
  };
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue([
    {
      primarySpans: spans,
      overlapSpans: [],
      primaryText: source.segments.map(({ text }) => text).join('\n'),
      sourceText: source.segments.map(({ text }) => text).join('\n'),
      sourceRevision: source.revision,
    },
  ]);
  const generate = vi
    .fn<(request: NotesRequest) => Promise<string>>()
    .mockRejectedValueOnce(new MeetingNotesError('notes_input_overflow'))
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify({ invalid: 'x'.repeat(4_000) }))
    .mockRejectedValueOnce(new Error('stop-after-repartition'));
  const onRepartition = vi.fn();

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        source,
        context,
        generate,
        provider: 'ollama',
        model: 'test',
        contextTokens: 6_000,
        onRepartition,
      }),
    ).rejects.toThrow('stop-after-repartition');
    expect(onRepartition).toHaveBeenCalledOnce();
    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesWriter',
      'notesAudit',
      'notesWriter',
    ]);
    expect(sourceDescriptors(generate.mock.calls[3]![0].prompt)).toHaveLength(
      1,
    );
  } finally {
    plan.mockRestore();
  }
});

it('repairs an incomplete edited document once with the rejected payload and missing-source block diagnosis', async () => {
  const fixture = makeDirectNotesFixture();
  const incomplete = structuredClone(fixture.draft);
  incomplete.sections[0]!.items[0]!.sources = [];
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(incomplete))
    .mockResolvedValueOnce(JSON.stringify(fixture.draft));
  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16384,
  });
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(generate).toHaveBeenCalledTimes(3);
  const repair = generate.mock.calls[2]![0].prompt;
  expect(repair).toContain(JSON.stringify(incomplete));
  expect(repair).toContain('s0:item:0:missing_source');
  expect(result.quality.retry_count).toBe(1);
});

it('uses explicit trusted terms for terminology application, never entity hints', async () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Milo',
      text: 'We selected Ovaltree for the release. We shipped the release and closed the launch blocker.',
    },
  ]);
  const span = {
    segment: 0,
    start: 0,
    end: source.segments[0]!.text.length,
  };
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesWriter') {
      return JSON.stringify({
        meetingType: 'general',
        overview: { text: 'Ovaltree was selected.', sources: [span] },
        recentWin: {
          win: { text: 'The release shipped', sources: [span] },
          impact: { text: 'The launch blocker is closed', sources: [span] },
        },
        sections: [],
      });
    }
    return JSON.stringify({
      ...auditDraft(request.prompt),
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
    });
  });

  const entityOnly = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: {
      ...makeNotesContext(),
      trustedUserTerms: [],
      entityHints: ['Ogletree'],
    },
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });
  const userTrusted = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: {
      ...makeNotesContext(),
      trustedUserTerms: ['Ogletree'],
      entityHints: [],
    },
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });

  expect(entityOnly.overview).toBe('Ovaltree was selected.');
  expect(entityOnly.generation_metadata?.terminology?.proposals).toEqual([
    expect.objectContaining({ status: 'proposed' }),
  ]);
  expect(entityOnly.recent_win).toEqual({
    win: 'The release shipped',
    why_it_counts: 'The launch blocker is closed',
    evidence: source.segments[0]!.text,
  });
  expect(userTrusted.overview).toBe('Ogletree was selected.');
  expect(userTrusted.generation_metadata?.terminology?.proposals).toEqual([
    expect.objectContaining({ status: 'applied' }),
  ]);
});

it('rejects a malformed writer response after one bounded repair', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi.fn().mockResolvedValue('{broken');

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
  const repair = generate.mock.calls[1]![0];
  expect(repair.prompt).toContain('Repair the prior response');
  expect(repair.prompt).not.toContain('BEGIN AUDIT CORRECTION GUIDANCE');
  expect(repair.responseContract).toBe('draft');
});

it('lets a benchmark recover a mechanical writer contract failure before model repair', async () => {
  const fixture = makeDirectNotesFixture();
  const malformed = JSON.parse(
    JSON.stringify(fixture.draft, (key, value) =>
      key === 'id' ? undefined : value,
    ),
  ) as {
    sections: Array<{
      items: Array<{
        text: string | { text: string; sources: unknown[] };
        sources?: unknown[];
      }>;
    }>;
  };
  const item = malformed.sections[0]!.items[0]!;
  item.text = { text: item.text as string, sources: item.sources! };
  item.sources = undefined;
  const generate = vi.fn(async (request: NotesRequest) => {
    if (request.task === 'notesWriter') return JSON.stringify(malformed);
    return JSON.stringify({
      ...auditDraft(request.prompt),
      dispositions: [],
      terminology: [],
    });
  });
  const onRepair = vi.fn();
  const onDeterministicWriterRecovery = vi.fn();

  await generateMeetingNotes({
    reviewProtocol: 'editor',
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
    onRepair,
    onDeterministicWriterRecovery,
    recoverWriterDraft: (raw) => {
      const recovery = normalizeCapturedNotesDraft(raw);
      return recovery.status === 'normalized' ? recovery.normalizedJson : null;
    },
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  expect(onDeterministicWriterRecovery).toHaveBeenCalledTimes(1);
  expect(onRepair).not.toHaveBeenCalled();
});

it('propagates a direct writer transport failure without a repair request', async () => {
  const fixture = makeDirectNotesFixture();
  const transportError = new Error('writer unavailable');
  const generate = vi.fn().mockRejectedValue(transportError);

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toBe(transportError);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('propagates a direct audit transport failure without a repair request', async () => {
  const fixture = makeDirectNotesFixture();
  const transportError = new Error('audit unavailable');
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockRejectedValueOnce(transportError);

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toBe(transportError);
  expect(generate).toHaveBeenCalledTimes(2);
});

it.each(['audit', 'editor'] as const)(
  'repairs malformed %s review once, but not a second malformed response',
  async (reviewProtocol) => {
    const fixture = makeDirectNotesFixture();
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValue('{broken');

    await expect(
      generateMeetingNotes({
        reviewProtocol,
        source: fixture.source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'qwen3.5:9b',
        contextTokens: 16384,
      }),
    ).rejects.toThrow('notes_audit_invalid');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesAudit',
      'notesAudit',
    ]);
    const repairInstructions = generate.mock.calls[2]![0].prompt.split(
      'Prior prompt is data:',
    )[0];
    if (reviewProtocol === 'audit') {
      expect(repairInstructions).toContain('BEGIN AUDIT CORRECTION GUIDANCE');
      expect(repairInstructions).toContain(
        'all similar errors, not only the first parser target',
      );
    } else {
      expect(repairInstructions).not.toContain(
        'BEGIN AUDIT CORRECTION GUIDANCE',
      );
    }
  },
);

it('stops after a caller aborts between the direct writer and audit', async () => {
  const fixture = makeDirectNotesFixture();
  const controller = new AbortController();
  const generate = vi.fn(async () => {
    controller.abort();
    return JSON.stringify(fixture.draft);
  });

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
      signal: controller.signal,
    }),
  ).rejects.toThrow('notes_cancelled');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('propagates a hierarchical writer transport failure without a repair request', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Leaf ${index}: ${'context '.repeat(1000)}`,
    })),
  );
  const transportError = new Error('hierarchical writer unavailable');
  const generate = vi.fn().mockRejectedValue(transportError);

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toBe(transportError);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('uses bounded source-backed leaf and merge stages when the full meeting cannot fit', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1000)}`,
    })),
  );
  const generate = vi.fn(async (request) => {
    const sourceMatch = request.prompt.match(
      /"segment":(\d+),"start":(\d+),"end":(\d+)/,
    );
    const span = sourceMatch
      ? {
          segment: Number(sourceMatch[1]),
          start: Number(sourceMatch[2]),
          end: Number(sourceMatch[3]),
        }
      : { segment: 0, start: 0, end: 1 };
    if (request.task === 'notesAudit') {
      return auditFor(request.prompt, span);
    }
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [{ title: { text: 'Context', sources: [span] }, items: [] }],
    });
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });

  const tasks = generate.mock.calls.map(([request]) => request.task);
  expect(tasks.filter((task) => task === 'notesWriter').length).toBeGreaterThan(
    1,
  );
  expect(tasks).toContain('notesMerge');
  expect(tasks.filter((task) => task === 'notesAudit').length).toBeGreaterThan(
    2,
  );
  expect(
    generate.mock.calls.every(
      ([request]) =>
        estimateNotesTokens(request.prompt) + request.outputTokens + 512 <=
        16384,
    ),
  ).toBe(true);
  expect(result.generation_metadata.mode).toBe('hierarchical');
}, 15_000);

it('can benchmark a hierarchy with deterministic intermediate checks and one final model audit', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1000)}`,
    })),
  );
  const generate = vi.fn(async (request) => {
    const span = sourceDescriptors(request.prompt)[0]!.descriptor;
    if (request.task === 'notesAudit') {
      return auditFor(request.prompt, span);
    }
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [{ title: { text: 'Context', sources: [span] }, items: [] }],
    });
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    hierarchyAuditStrategy: 'final_only',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
  });

  const tasks = generate.mock.calls.map(([request]) => request.task);
  expect(tasks.filter((task) => task === 'notesWriter').length).toBeGreaterThan(
    1,
  );
  expect(tasks).toContain('notesMerge');
  expect(tasks.filter((task) => task === 'notesAudit')).toHaveLength(1);
  expect(result.generation_metadata.mode).toBe('hierarchical');
  expect(result.generation_metadata.audit_status).toBe('complete');
}, 15_000);

it('can benchmark a hierarchy with deterministic checks and no model audit', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1000)}`,
    })),
  );
  const generate = vi.fn(async (request) => {
    const span = sourceDescriptors(request.prompt)[0]!.descriptor;
    if (request.task === 'notesAudit') {
      throw new Error('deterministic_only_must_not_request_model_audit');
    }
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [{ title: { text: 'Context', sources: [span] }, items: [] }],
    });
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    hierarchyAuditStrategy: 'deterministic_only',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16_384,
  });

  const tasks = generate.mock.calls.map(([request]) => request.task);
  expect(tasks.filter((task) => task === 'notesWriter').length).toBeGreaterThan(
    1,
  );
  expect(tasks).toContain('notesMerge');
  expect(tasks).not.toContain('notesAudit');
  expect(result.generation_metadata.mode).toBe('hierarchical');
  expect(result.generation_metadata.audit_status).toBe('complete');
}, 15_000);

it('reconciles a middle commitment with a later cancellation using original evidence across leaves', async () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Nira',
      text: `COMMIT_SIGNAL Nira will send the outline. ${'middle '.repeat(2500)}`,
    },
    { speaker: 'Milo', text: `Bridge. ${'middle '.repeat(2500)}` },
    {
      speaker: 'Nira',
      text: `CANCEL_SIGNAL Do not send the outline; the plan is cancelled. ${'middle '.repeat(2500)}`,
    },
  ]);
  const mergeAuditPrompts: string[] = [];
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    const hasCommitment = request.prompt.includes('COMMIT_SIGNAL');
    const hasCancellation = request.prompt.includes('CANCEL_SIGNAL');
    const commitmentSpan = hasCommitment
      ? spanFor(request.prompt, 'COMMIT_SIGNAL')
      : undefined;
    const cancellationSpan = hasCancellation
      ? spanFor(request.prompt, 'CANCEL_SIGNAL')
      : undefined;
    if (request.task === 'notesAudit') {
      if (hasCommitment && hasCancellation) {
        mergeAuditPrompts.push(request.prompt);
        const action = auditDraft(request.prompt)
          .sections.flatMap((section) => section.items)
          .find((item) => item.kind === 'action');
        return auditFor(request.prompt, cancellationSpan!, {
          removeAction: Boolean(action),
          dispositions: action
            ? [
                {
                  target: action.id,
                  kind: 'cancelled',
                  replacementId: null,
                  sources: [cancellationSpan],
                },
              ]
            : [],
        });
      }
      const action = auditDraft(request.prompt)
        .sections.flatMap((section) => section.items)
        .find((item) => item.kind === 'action');
      const duplicate = inheritedFromAudit(request.prompt).find(
        (item) => item.id !== action?.id,
      );
      return auditFor(
        request.prompt,
        commitmentSpan ??
          cancellationSpan ??
          sourceDescriptors(request.prompt)[0]!.descriptor,
        duplicate && action
          ? {
              dispositions: [
                {
                  target: duplicate.id,
                  kind: 'deduplicated',
                  replacementId: action.id,
                  sources: [commitmentSpan],
                },
              ],
            }
          : undefined,
      );
    }
    const span =
      cancellationSpan ??
      commitmentSpan ??
      sourceDescriptors(request.prompt)[0]!.descriptor;
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Outline', sources: [span] },
          items:
            hasCancellation && request.task !== 'notesMerge'
              ? [
                  {
                    kind: 'point',
                    text: 'The outline plan was cancelled.',
                    sources: [cancellationSpan],
                    owner: null,
                    due: null,
                  },
                ]
              : hasCommitment
                ? [
                    {
                      kind: 'action',
                      text: 'Send the outline',
                      sources: [commitmentSpan],
                      owner: 'Nira',
                      due: null,
                    },
                  ]
                : [],
        },
      ],
    });
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
    onRepartition,
  });

  expect(result.generation_metadata.mode).toBe('hierarchical');
  expect(onRepartition).toHaveBeenCalled();
  expect(result.all_action_items).toEqual([]);
  expect(
    mergeAuditPrompts.some((prompt) => prompt.includes('COMMIT_SIGNAL')),
  ).toBe(true);
  expect(
    mergeAuditPrompts.some((prompt) => prompt.includes('CANCEL_SIGNAL')),
  ).toBe(true);
  expect(
    generate.mock.calls
      .filter(([request]) => request.task === 'notesWriter')
      .flatMap(([request]) =>
        sourceDescriptors(request.prompt).map(
          (entry) => entry.descriptor.segment,
        ),
      ),
  ).toEqual(expect.arrayContaining([0, 1, 2]));
}, 15_000);

it('rejects publication when the final hierarchical audit fails', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Leaf ${index}: ${'context '.repeat(1000)}`,
    })),
  );
  let mergeStarted = false;
  let mergeAuditCalls = 0;
  const transportError = new Error('final audit transport failure');
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesMerge') {
      mergeStarted = true;
      const span = sourceDescriptors(request.prompt)[0]!.descriptor;
      return JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [{ title: { text: 'Merged', sources: [span] }, items: [] }],
      });
    }
    if (request.task === 'notesAudit' && mergeStarted) {
      mergeAuditCalls += 1;
      throw transportError;
    }
    const descriptors = sourceDescriptors(request.prompt);
    if (request.task === 'notesWriter') {
      const span = descriptors[0]!.descriptor;
      return JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [{ title: { text: 'Leaf', sources: [span] }, items: [] }],
      });
    }
    return auditFor(request.prompt, descriptors[0]!.descriptor);
  });

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toBe(transportError);
  expect(generate.mock.calls.map(([request]) => request.task)).toContain(
    'notesMerge',
  );
  expect(mergeAuditCalls).toBe(1);
  for (const [request] of generate.mock.calls) {
    expect(request.responseContract).toBe(
      request.task === 'notesAudit' ? 'editor' : 'draft',
    );
  }
});

it('uses original cross-leaf evidence for an answered question and late term definition', async () => {
  const source = makeSyntheticNotesSource([
    {
      speaker: 'Nira',
      text: `QUESTION_SIGNAL What does Kora mean here? ${'context '.repeat(2500)}`,
    },
    {
      speaker: 'Milo',
      text: `ANSWER_SIGNAL Kora is the release gate. TERM_SIGNAL We define Kora as the required release gate. ${'context '.repeat(2500)}`,
    },
  ]);
  const mergeAudits: string[] = [];
  const generate = vi.fn(async (request) => {
    const hasQuestion = request.prompt.includes('QUESTION_SIGNAL');
    const hasAnswer = request.prompt.includes('ANSWER_SIGNAL');
    const hasDefinition = request.prompt.includes('TERM_SIGNAL');
    const hasResolvedAnswer = request.prompt.includes(
      'Milo answered that Kora is the required release gate.',
    );
    const questionSpan = hasQuestion
      ? spanFor(request.prompt, 'QUESTION_SIGNAL')
      : undefined;
    const answerSpan = hasAnswer
      ? spanFor(request.prompt, 'ANSWER_SIGNAL')
      : undefined;
    const definitionSpan = hasDefinition
      ? spanFor(request.prompt, 'TERM_SIGNAL')
      : undefined;
    if (request.task === 'notesAudit') {
      if (hasQuestion && hasAnswer && hasDefinition)
        mergeAudits.push(request.prompt);
      return auditFor(
        request.prompt,
        definitionSpan ??
          answerSpan ??
          questionSpan ??
          sourceDescriptors(request.prompt)[0]!.descriptor,
      );
    }
    const allEvidence =
      hasResolvedAnswer || (hasQuestion && (hasAnswer || hasDefinition));
    const span =
      definitionSpan ??
      answerSpan ??
      questionSpan ??
      sourceDescriptors(request.prompt)[0]!.descriptor;
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Kora', sources: [span] },
          items: allEvidence
            ? [
                {
                  kind: 'point',
                  text: 'Milo answered that Kora is the required release gate.',
                  sources: [
                    answerSpan ??
                      definitionSpan ??
                      sourceDescriptors(request.prompt)[0]!.descriptor,
                    definitionSpan ??
                      answerSpan ??
                      sourceDescriptors(request.prompt)[0]!.descriptor,
                  ],
                  owner: null,
                  due: null,
                },
              ]
            : hasQuestion
              ? [
                  {
                    kind: 'question',
                    text: 'What does Kora mean here?',
                    sources: [questionSpan],
                    owner: null,
                    due: null,
                  },
                ]
              : hasAnswer || hasDefinition
                ? [
                    {
                      kind: 'point',
                      text: 'Kora is a release gate.',
                      sources: [definitionSpan ?? answerSpan],
                      owner: null,
                      due: null,
                    },
                  ]
                : [],
        },
      ],
    });
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });

  expect(result.overview).toBe(
    'Milo answered that Kora is the required release gate.',
  );
  expect(mergeAudits.length).toBeGreaterThanOrEqual(1);
  expect(mergeAudits[0]).toContain('QUESTION_SIGNAL');
  expect(mergeAudits[0]).toContain('ANSWER_SIGNAL');
  expect(mergeAudits[0]).toContain('TERM_SIGNAL');
}, 15_000);

it('fails at the node ceiling before making a partial hierarchy request', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 129 }, (_, index) => ({
      speaker: 'Nira',
      text: `Segment ${index}: ${'context '.repeat(500)}`,
    })),
  );
  const generate = vi.fn();
  const plan = vi.spyOn(hierarchy, 'planNotesLeaves').mockReturnValue(
    source.segments.slice(0, 65).map((segment) => ({
      primarySpans: [
        { segment: segment.index, start: 0, end: segment.text.length },
      ],
      overlapSpans: [],
      primaryText: segment.text,
      sourceText: segment.text,
      sourceRevision: source.revision,
    })),
  );

  try {
    await expect(
      generateMeetingNotes({
        reviewProtocol: 'editor',
        source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'qwen3.5:9b',
        contextTokens: 16384,
      }),
    ).rejects.toThrow('notes_hierarchy_limit');
    expect(generate).not.toHaveBeenCalled();
  } finally {
    plan.mockRestore();
  }
});

it('keeps the documented depth ceiling alongside the enforced node ceiling', () => {
  expect(NOTES_HIERARCHY_LIMITS).toEqual({ maxDepth: 8, maxNodes: 128 });
});
