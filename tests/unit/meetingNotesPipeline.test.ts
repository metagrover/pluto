import { expect, it, vi } from 'vitest';
import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';
import {
  NOTES_HIERARCHY_LIMITS,
  generateMeetingNotes,
} from '../../electron/llm/meetingNotesPipeline';
import { MeetingNotesError } from '../../electron/llm/meetingNotesTypes';
import {
  makeDirectNotesFixture,
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

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
  ) as {
    overview: { id: string } | null;
    sections: Array<{
      title: { id: string };
      items: Array<{ id: string; kind: string }>;
    }>;
  };

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
  const ids = [
    ...(draft.overview ? [draft.overview.id] : []),
    ...draft.sections.flatMap((section) => [
      section.title.id,
      ...section.items.map((item) => item.id),
    ]),
  ];
  return JSON.stringify({
    changes: removed ? [{ op: 'remove', target: removed.id }] : [],
    verdicts: ids.map((target) => ({
      target,
      status: 'supported',
      sources: [source],
    })),
    dispositions: options.dispositions ?? [],
    terminology: [],
  });
};

it('uses one writer and one audit without segmentation or a third rewrite', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(fixture.audit));

  const result = await generateMeetingNotes({
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
    prompt_version: 'notes-v10',
    pipeline_version: 'writer-audit-v1',
    audit_status: 'complete',
  });
});

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

it('repairs an incomplete audit once with the rejected payload and missing block diagnosis', async () => {
  const fixture = makeDirectNotesFixture();
  const incomplete = { ...fixture.audit, verdicts: [] };
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(incomplete))
    .mockResolvedValueOnce(JSON.stringify(fixture.audit));
  const result = await generateMeetingNotes({
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
  expect(repair).toContain('notes_audit_missing_verdict');
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
      changes: [],
      verdicts: [
        { target: 'overview', status: 'supported', sources: [span] },
        { target: 'recent-win', status: 'supported', sources: [span] },
        {
          target: 'recent-win-impact',
          status: 'supported',
          sources: [span],
        },
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
    });
  });

  const entityOnly = await generateMeetingNotes({
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
      const draftMatch = request.prompt.match(
        /BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/,
      );
      const draft = JSON.parse(draftMatch?.[1] ?? '{}') as {
        overview: { id: string } | null;
        sections: Array<{
          title: { id: string };
          items: Array<{ id: string }>;
        }>;
      };
      const ids = [
        ...(draft.overview ? [draft.overview.id] : []),
        ...draft.sections.flatMap((section) => [
          section.title.id,
          ...section.items.map((item) => item.id),
        ]),
      ];
      return JSON.stringify({
        changes: [],
        verdicts: ids.map((target) => ({
          target,
          status: 'supported',
          sources: [span],
        })),
        dispositions: [],
        terminology: [],
      });
    }
    return JSON.stringify({
      meetingType: 'general',
      overview: null,
      sections: [{ title: { text: 'Context', sources: [span] }, items: [] }],
    });
  });

  const result = await generateMeetingNotes({
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
