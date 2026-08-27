import { expect, it, vi } from 'vitest';
import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';
import * as hierarchy from '../../electron/llm/meetingNotesHierarchy';
import {
  NOTES_HIERARCHY_LIMITS,
  generateMeetingNotes,
} from '../../electron/llm/meetingNotesPipeline';
import {
  MeetingNotesError,
  type NotesDraft,
  type NotesRequest,
} from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
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
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(result.generation_metadata).toMatchObject({
    prompt_version: 'notes-v13',
    pipeline_version: 'writer-editor-v1',
    audit_status: 'complete',
  });
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
  'fails safely after a second invalid %s review without a third attempt',
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
    await expect(
      generateMeetingNotes({
        reviewProtocol: reviewProtocol === 'editor' ? 'editor' : undefined,
        source: fixture.source,
        context: makeNotesContext(),
        generate,
        provider: 'ollama',
        model: 'test',
        contextTokens: 16384,
      }),
    ).rejects.toThrow('notes_audit_invalid');
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

it('repairs a malformed direct audit once, but not a second malformed response', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValue('{broken');

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
  ).rejects.toThrow('notes_audit_invalid');
  expect(generate).toHaveBeenCalledTimes(3);
});

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
  });

  expect(result.generation_metadata.mode).toBe('hierarchical');
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
});

it('keeps the documented depth ceiling alongside the enforced node ceiling', () => {
  expect(NOTES_HIERARCHY_LIMITS).toEqual({ maxDepth: 8, maxNodes: 128 });
});
