import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAnalysisDocumentV3 } from '../../electron/llm/analysisDocumentV3';
import {
  notesContentGuidance,
  notesMultilingualGuidance,
  notesProseGuidance,
  notesSourceGuidance,
} from '../../electron/llm/meetingNotesGuidance';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { hasPersonalActionOwner } from '../../src/utils/actionCommitment';
import { getAnalysisEditBlocks } from '../../src/utils/analysisDocument';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unit tests must not reach a model transport');
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fixture = (text = 'I will send the outline.') => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text }] }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
    ollama_fast_model: 'phi4-mini:3.8b',
  });
  vi.spyOn(provider as never, 'resolveOllamaModel').mockResolvedValue(
    'gemma4:12b',
  );
  const response = {
    title: null,
    overview: { text: 'An outline will be sent.', sources: ['R0'] },
    sections: [
      {
        title: 'Outline',
        items: [
          {
            kind: 'action',
            text: 'Send the outline',
            owner: 'Milo' as string | null,
            due: null,
            sources: ['R0'],
          },
        ],
      },
    ],
  };
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValue(JSON.stringify(response));
  return { provider, source, response, generate };
};

it('writes ordinary local notes once without a model reviewer or semantic-review proof', async () => {
  const { provider, source, generate } = fixture();
  const original = structuredClone(source);
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      task: 'notesWriter',
      notesModel: 'gemma4:12b',
      notesBudget: { contextTokens: 16384, outputTokens: 2048 },
      notesContinuation: undefined,
    }),
  );
  expect(result.overview).toBe('An outline will be sent.');
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
  ]);
  expect(result.quality.fallback_used).toBe(false);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
  expect(result.generation_metadata).not.toHaveProperty('audit_status');
  expect(result.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  const reread = parseAnalysisDocumentV3(JSON.stringify(result));
  expect(reread?.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  expect(reread?.all_action_items).toEqual(result.all_action_items);
  expect(source).toEqual(original);
  expect(getAnalysisEditBlocks(result).length).toBeGreaterThan(0);
  const missingProvenance = structuredClone(result);
  missingProvenance.generation_metadata!.source_provenance = undefined;
  expect(getAnalysisEditBlocks(missingProvenance)).toEqual([]);
  expect(
    hasPersonalActionOwner(
      {
        metadata: JSON.stringify({
          origin: 'extraction',
          assignee_name: 'Me',
          source_meeting_id: 'fictional-meeting',
          source_evidence: 'I will send the outline.',
        }),
      },
      {},
    ),
  ).toBe(false);
});

it('retains the existing bounded writer JSON-format repair', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockResolvedValueOnce('{bad json')
    .mockResolvedValueOnce(JSON.stringify(response));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesWriter',
  ]);
  const repairPrompt = generate.mock.calls[1]![0].prompt;
  const [instructions, data] = repairPrompt.split('Prior prompt is data:');
  for (const guidance of [
    notesContentGuidance,
    notesProseGuidance,
    notesMultilingualGuidance,
    notesSourceGuidance,
  ]) {
    expect(instructions).toContain(guidance);
    expect(data).not.toContain(guidance);
  }
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
});

it('repairs a missing required overview inside the existing writer attempt limit', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockResolvedValueOnce(JSON.stringify({ ...response, overview: null }))
    .mockResolvedValueOnce(JSON.stringify(response));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1]![0].prompt).toContain(
    'Add a concise source-grounded overview',
  );
  expect(result.overview).toBe(response.overview.text);
});

it('refuses a lost approval condition after one repair without transcript replacement', async () => {
  const { provider, source, generate } = fixture(
    'I will send the outline only after legal approval.',
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
});

it('refuses an unaccepted offer instead of converting it into raw-source discussion', async () => {
  const { provider, source, generate } = fixture(
    'I could send the outline if somebody needs it.',
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(2);
});

it('refuses a missing model overview instead of publishing an unreadable document or fallback', async () => {
  const { provider, source, response, generate } = fixture();
  generate.mockResolvedValue(JSON.stringify({ ...response, overview: null }));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
});

it('rejects raw first-person transcript prose after the bounded repair', async () => {
  const { provider, source, response, generate } = fixture();
  response.sections[0]!.items[0]!.text = 'I will send the outline.';
  response.sections[0]!.items[0]!.kind = 'point';
  generate.mockResolvedValue(JSON.stringify(response));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(2);
});

it('refuses an oversized compact plan before generation rather than entering audit/merge', async () => {
  const { provider, generate } = fixture();
  const source = createNotesSource(
    JSON.stringify({
      segments: Array.from({ length: 80 }, (_, index) => ({
        speaker: 'Milo',
        text: `Topic ${index}. ${'Workshop details. '.repeat(400)}`,
      })),
    }),
  );
  const original = structuredClone(source);
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_bounded_plan_exceeded');
  expect(generate).not.toHaveBeenCalled();
  expect(source).toEqual(original);
});

it.each(['overview', 'title'])(
  'rejects raw source in the model %s without a prose fallback',
  async (field) => {
    const { provider, source, response, generate } = fixture();
    generate.mockResolvedValue(
      JSON.stringify({
        ...response,
        [field]: {
          text: 'I will send the outline.',
          sources: ['R0'],
        },
      }),
    );
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', { source }),
    ).rejects.toThrow('notes_writer_invalid');
    expect(generate).toHaveBeenCalledTimes(2);
  },
);

it('lets the existing writer repair correct a source-invalid responsibility without granting review trust', async () => {
  const { provider, source, response, generate } = fixture();
  const invalid = structuredClone(response);
  invalid.sections[0]!.items[0]!.owner = 'Another person';
  generate
    .mockResolvedValueOnce(JSON.stringify(invalid))
    .mockResolvedValueOnce(JSON.stringify(response));
  const original = structuredClone(source);
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesWriter',
  ]);
  expect(generate.mock.calls[1]![0].prompt).toContain(
    'BEGIN REJECTED RESPONSE DATA',
  );
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
  ]);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
  expect(source).toEqual(original);
});

it('identifies a misclassified discussion item in the bounded writer repair', async () => {
  const { provider, source, response, generate } = fixture(
    'This is a discussion of outlines, not an assignment.',
  );
  response.overview!.text = 'The conversation concerns outlines.';
  const item = response.sections[0]!.items[0]!;
  item.kind = 'decision';
  item.text = 'This is a discussion of outlines, not an assignment.';
  item.owner = null;
  const corrected = structuredClone(response);
  corrected.sections[0]!.items[0]!.kind = 'point';
  generate
    .mockResolvedValueOnce(JSON.stringify(response))
    .mockResolvedValueOnce(JSON.stringify(corrected));
  const original = structuredClone(source);
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  const repairPrompt = generate.mock.calls[1]![0].prompt;
  expect(repairPrompt).toContain('sections[0].items[0]');
  expect(repairPrompt.indexOf('The failed item is')).toBeGreaterThan(
    repairPrompt.indexOf('END REJECTED RESPONSE DATA'),
  );
  expect(repairPrompt).not.toContain('Parser error:');
  expect(result.all_action_items).toEqual([]);
  expect(result.all_decisions).toEqual([]);
  expect(result.topics[0]!.summary).toBe(item.text);
  expect(source).toEqual(original);
});

it.each(['overview', 'point'])(
  'refuses an unsupported gendered pronoun in ordinary local %s prose',
  async (field) => {
    const { provider, source, response, generate } = fixture(
      'I enjoyed carving a small wooden bird.',
    );
    response.overview!.text = 'Milo enjoyed carving a wooden bird.';
    const item = response.sections[0]!.items[0]!;
    item.kind = 'point';
    item.owner = null;
    item.text = response.overview!.text;
    if (field === 'overview')
      response.overview!.text = 'Milo enjoyed her woodcarving.';
    else item.text = 'Milo enjoyed her woodcarving.';
    generate.mockResolvedValue(JSON.stringify(response));
    const original = structuredClone(source);
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', { source }),
    ).rejects.toMatchObject({
      code: 'notes_writer_invalid',
      validationCategory: 'guardrail',
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(source).toEqual(original);
  },
);

it('retains an explicitly source-supported pronoun without another model call', async () => {
  const { provider, source, response, generate } = fixture(
    'I use she and her. I enjoyed carving a wooden bird.',
  );
  response.overview!.text = 'Milo enjoyed her woodcarving.';
  const item = response.sections[0]!.items[0]!;
  item.kind = 'point';
  item.owner = null;
  item.text = response.overview!.text;
  generate.mockResolvedValue(JSON.stringify(response));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(result.overview).toBe(response.overview!.text);
  expect(generate).toHaveBeenCalledTimes(1);
});

it.each([
  {
    sourceText: 'I carved three wooden birds.',
    text: 'Milo carved three other wooden birds.',
    reason: 'quantity_scope',
  },
  {
    sourceText: 'I might send the outline only if finance approves.',
    text: 'Milo might send the outline only if legal approves.',
    reason: 'unsupported_condition',
  },
])('checks $reason in discussion prose before publication', async (entry) => {
  const { provider, source, response, generate } = fixture(entry.sourceText);
  response.overview!.text = 'Milo discussed a personal activity.';
  const item = response.sections[0]!.items[0]!;
  item.kind = 'point';
  item.owner = null;
  item.text = entry.text;
  generate.mockResolvedValue(JSON.stringify(response));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1]![0].prompt).toContain(
    `notes_editor_${entry.reason}:s0:item:0`,
  );
});

it('reports every hard prose failure within the same single repair', async () => {
  const { provider, source, response, generate } = fixture(
    'I might send three worksheets only if finance approves.',
  );
  response.overview!.text =
    'Milo might send her three worksheets only if legal approves.';
  const item = response.sections[0]!.items[0]!;
  item.kind = 'point';
  item.owner = null;
  item.text = 'Milo might send three other worksheets.';
  const corrected = structuredClone(response);
  corrected.overview!.text =
    'Milo might send three worksheets only if finance approves.';
  corrected.sections[0]!.items[0]!.text = corrected.overview!.text;
  generate
    .mockResolvedValueOnce(JSON.stringify(response))
    .mockResolvedValueOnce(JSON.stringify(corrected));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  const repair = generate.mock.calls[1]![0].prompt;
  for (const diagnostic of [
    'notes_editor_unsupported_condition:overview',
    'notes_editor_unsupported_pronoun:overview',
    'notes_editor_quantity_scope:s0:item:0',
  ])
    expect(repair).toContain(diagnostic);
  expect(result.overview).toBe(corrected.overview!.text);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
});

it('preserves multilingual summary guidance without inventing action attribution', async () => {
  const { provider, source, generate } = fixture('Маша отправит отчет завтра.');
  const response = {
    title: { text: 'План отчета', sources: ['R0'] },
    overview: { text: 'Обсудили отправку отчета.', sources: ['R0'] },
    sections: [
      {
        title: 'Отчет',
        items: [
          {
            kind: 'action',
            text: 'Отправить отчет',
            owner: 'Milo',
            due: 'завтра',
            sources: ['R0'],
          },
        ],
      },
    ],
  };
  generate.mockResolvedValue(JSON.stringify(response));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
  for (const [request] of generate.mock.calls) {
    expect(request.prompt).toContain(notesMultilingualGuidance);
  }
});

it('can publish multilingual discussion without unproved commitment metadata', async () => {
  const { provider, source, generate } = fixture(
    'Обсудили план нового отчета.',
  );
  generate.mockResolvedValue(
    JSON.stringify({
      title: { text: 'План отчета', sources: ['R0'] },
      overview: { text: 'Обсудили план нового отчета.', sources: ['R0'] },
      sections: [
        {
          title: 'Отчет',
          items: [
            {
              kind: 'point',
              text: 'Обсудили план нового отчета.',
              owner: null,
              due: null,
              sources: ['R0'],
            },
          ],
        },
      ],
    }),
  );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(result.title).toBe('План отчета');
  expect(result.all_action_items).toEqual([]);
  expect(generate.mock.calls[0]![0].prompt).toContain(
    notesMultilingualGuidance,
  );
});

const knownArtifact =
  '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
const qualifyResponse = (
  request: { onOllamaArtifact?: (digest: string) => void },
  raw: string,
  digest = knownArtifact,
) => {
  request.onOllamaArtifact?.(digest);
  return raw;
};
const overviewResponse = (text = 'Milo will send the outline.') =>
  JSON.stringify({
    resolutions: [
      {
        id: 'overview',
        kind: 'point',
        text,
        owner: null,
        due: null,
        discussion: null,
      },
    ],
  });

it('authors a verified complete-packet overview before ordinary strict publication without granting body-review proof', async () => {
  const { provider, source, response, generate } = fixture();
  response.overview.text = 'Milo has already sent the outline.';
  generate
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, JSON.stringify(response)),
    )
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, overviewResponse()),
    );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  const request = generate.mock.calls[1]![0];
  expect(request.prompt).toContain('I will send the outline.');
  expect(request.prompt).not.toContain(response.overview.text);
  expect(request.notesBudget).toEqual({
    contextTokens: 16384,
    outputTokens: 1536,
  });
  expect(result.overview).toBe('Milo will send the outline.');
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
  ]);
  expect(result.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  expect(result.generation_metadata?.source_overview_review_version).toBe(1);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
  expect(result.generation_metadata).not.toHaveProperty('audit_status');
  expect(
    parseAnalysisDocumentV3(JSON.stringify(result))?.generation_metadata
      ?.source_overview_review_version,
  ).toBe(1);
});

it('retains strict body ownership checks after independent overview authoring', async () => {
  const { provider, source, response, generate } = fixture();
  response.sections[0]!.items[0]!.owner = 'Nora';
  generate.mockImplementation(async (r) =>
    qualifyResponse(
      r,
      r.task === 'notesAudit' ? overviewResponse() : JSON.stringify(response),
    ),
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesWriter',
  ]);
});

it('retains strict overview source checks after protocol parsing', async () => {
  const { provider, source, response, generate } = fixture();
  generate.mockImplementation(async (r) =>
    qualifyResponse(
      r,
      r.task === 'notesAudit'
        ? overviewResponse('He will send the outline.')
        : JSON.stringify(response),
    ),
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_semantic_review_incomplete');
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
  expect(generate.mock.calls[2]![0].prompt).toContain('Correct overview');
});

it('keeps the existing writer schema repair before attempting the overview', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockResolvedValueOnce('{bad json')
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, JSON.stringify(response)),
    )
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, overviewResponse()),
    );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(result.overview).toBe('Milo will send the outline.');
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesWriter',
    'notesAudit',
  ]);
});

it('bounds overview protocol repair without granting publication to an invalid response', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, JSON.stringify(response)),
    )
    .mockImplementation(async (r) => qualifyResponse(r, '{"resolutions":[]}'));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_semantic_review_incomplete');
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
});

it('keeps overview authoring inside the existing publication deadline', async () => {
  const { provider, source, response, generate } = fixture();
  generate.mockImplementation(async (r) =>
    qualifyResponse(r, JSON.stringify(response)),
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', {
      source,
      optionalReviewDeadlineAtMs: Date.now() - 1,
    }),
  ).rejects.toThrow('notes_review_budget_exhausted');
  expect(generate).toHaveBeenCalledOnce();
});

it('does not enable the overview profile from the configured model name alone', async () => {
  const { provider, source, generate } = fixture();
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(result.generation_metadata).not.toHaveProperty(
    'source_overview_review_version',
  );
});

it('refuses an overview generated after the installed artifact changes between stages', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, JSON.stringify(response)),
    )
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, overviewResponse(), 'different-digest'),
    );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_semantic_review_incomplete');
  expect(generate).toHaveBeenCalledTimes(2);
});

it('resumes overview authoring after foreground capture preemption without resetting its deadline', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, JSON.stringify(response)),
    )
    .mockRejectedValueOnce(
      new DOMException('foreground_preempted', 'AbortError'),
    )
    .mockImplementationOnce(async (r) =>
      qualifyResponse(r, overviewResponse()),
    );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(result.overview).toBe('Milo will send the outline.');
  expect(generate.mock.calls.map(([r]) => r.task)).toEqual([
    'notesWriter',
    'notesAudit',
    'notesAudit',
  ]);
  expect(generate.mock.calls[1]![0].signal).toBe(
    generate.mock.calls[2]![0].signal,
  );
});
