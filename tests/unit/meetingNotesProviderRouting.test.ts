import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAnalysisDocumentV3 } from '../../electron/llm/analysisDocumentV3';
import { LocalModelMemoryError } from '../../electron/llm/localModelMemory';
import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';
import { buildNotesResponseSchema } from '../../electron/llm/meetingNotesSchema';
import * as semanticReview from '../../electron/llm/meetingNotesSemanticReview';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import {
  UnifiedLLMProvider,
  getOllamaTimeoutMs,
} from '../../electron/llm/unifiedProvider';
import {
  makeDirectNotesFixture,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';
import kindCorrection from '../manual/fixtures/meetingNotesV10KindCorrection.json';

const compactWriterResponse = (
  draft: ReturnType<typeof makeDirectNotesFixture>['draft'],
) => ({
  title: draft.title
    ? { text: draft.title.text, sources: draft.title.sources }
    : null,
  // This fictional provider answer authors its own supported summary; it is not
  // an application fallback or a claim that arbitrary writer output is correct.
  overview: {
    text: 'Milo will send the outline.',
    sources: draft.sections[0]!.items[0]!.sources,
  },
  sections: draft.sections.map((section) => ({
    title: section.title.text,
    items: section.items.map(({ kind, text, owner, due, sources }) => ({
      kind,
      text,
      owner,
      due,
      sources,
    })),
  })),
});

// These are unit tests: exhausted response queues must never reach a live model.
let unexpectedTransportAttempts = 0;
beforeEach(() => {
  unexpectedTransportAttempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      if (String(url).endsWith('/api/tags'))
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen3.5:9b' }] }),
        };
      unexpectedTransportAttempts += 1;
      throw new Error('unexpected_live_transport');
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(
    unexpectedTransportAttempts,
    'Unit tests must never escape to live transport',
  ).toBe(0);
});

it('applies the captured real-model kind correction on the explicit legacy final-only diagnostic without repair or loss of discussion', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce(JSON.stringify(kindCorrection.writer))
    .mockResolvedValueOnce(JSON.stringify(kindCorrection.audit));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: createNotesSource(
      JSON.stringify({ segments: kindCorrection.segments }),
    ),
    hierarchyAuditStrategy: 'final_only',
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.all_action_items).toHaveLength(1);
  expect(result.all_action_items[0]).toMatchObject({
    assignee: 'Dana',
    due: 'Wednesday',
  });
  const narrative = result.topics
    .flatMap((topic) => [
      topic.summary,
      ...topic.key_points.map((point) => point.text),
    ])
    .join(' ');
  expect(narrative).toContain('Ava withdraws');
  expect(narrative).toContain(
    'Ben can draft the announcement if legal approves',
  );
});

it('forwards cancellation through entity extraction after publication', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce('{}');
  const signal = new AbortController().signal;
  await provider.extractEntities('Synthetic discussion', undefined, { signal });
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({ task: 'entities', signal }),
  );
});

it.each(['legacy', 'detected', 'generic'] as const)(
  'uses the configured general model or Gemma default for %s settings',
  async (mode) => {
    const fixture = makeDirectNotesFixture();
    const model = 'installed-alternative:12b';
    const provider = new UnifiedLLMProvider(
      'ollama',
      mode === 'legacy'
        ? { llm_model: model }
        : mode === 'generic'
          ? { ollama_model: model }
          : {},
    );
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: model }] }),
    }));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(provider as never, 'generateText').mockResolvedValueOnce(
      JSON.stringify(compactWriterResponse(fixture.draft)),
    );
    const result = await provider.generateStructuredAnalysis('', '', 'auto', {
      source: fixture.source,
    });
    expect(result.generation_metadata?.model).toBe(
      mode === 'detected' ? 'gemma4:12b' : model,
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('pins Gemma for the writer-only product path without discovery or semantic review', async () => {
  const fixture = makeDirectNotesFixture();
  const provider = new UnifiedLLMProvider('ollama', {});
  const bodies: any[] = [];
  let tags = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      if (String(url).endsWith('/api/tags')) {
        tags++;
        throw new Error('unexpected_model_discovery');
      }
      const body = JSON.parse(init.body);
      bodies.push(body);
      expect(bodies).toHaveLength(1);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            message: {
              content: JSON.stringify(compactWriterResponse(fixture.draft)),
            },
            done: true,
            done_reason: 'stop',
          }),
      };
    }),
  );
  const review = vi.spyOn(semanticReview, 'reviewSourceBoundNotes');
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
  });
  expect(tags).toBe(0);
  expect(bodies.map((body) => body.model)).toEqual(['gemma4:12b']);
  expect(bodies[0].format).toEqual(
    buildNotesResponseSchema('compact_draft', ['R0']),
  );
  expect(bodies[0].options.num_predict).toBe(2048);
  expect(bodies[0].options.num_ctx).toBeLessThanOrEqual(16384);
  expect(bodies[0].options.num_ctx).toBeGreaterThanOrEqual(
    estimateNotesTokens(bodies[0].messages[0].content) + 2048 + 512,
  );
  expect(review).not.toHaveBeenCalled();
  expect(result.generation_metadata?.model).toBe('gemma4:12b');
  expect(
    result.generation_metadata?.source_action_review_version,
  ).toBeUndefined();
  expect(result.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  expect(result.generation_metadata?.audit_status).toBeUndefined();
  expect(result.generation_metadata?.audit_change_count).toBeUndefined();
  expect(result.generation_metadata?.source_provenance?.source_revision).toBe(
    fixture.source.revision,
  );
  expect(parseAnalysisDocumentV3(JSON.stringify(result))).not.toBeNull();
});

it.each(['extractInternalSignals', 'extractEntities'] as const)(
  'does not log private malformed output from %s',
  async (method) => {
    const provider = new UnifiedLLMProvider('ollama', {});
    vi.spyOn(provider as never, 'generateText').mockRejectedValue(
      new SyntaxError('Invalid JSON near PRIVATE_MEETING_MARKER'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(provider[method]('PRIVATE_MEETING_MARKER')).rejects.toThrow(
      /failed/,
    );
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().map(String).join(' ')).not.toContain(
      'PRIVATE_MEETING_MARKER',
    );
  },
);

it.each(['notesWriter', 'notesAudit', 'notesMerge'])(
  'gives %s the established analysis capacity deadline',
  (task) => {
    expect(getOllamaTimeoutMs(task)).toBe(getOllamaTimeoutMs('topicAnalysis'));
  },
);

it.each(['ollama', 'openai', 'openrouter', 'claude', 'gemini'] as const)(
  'routes raw and indexed %s callers through the explicit legacy final-only diagnostic',
  async (kind) => {
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider(kind, {});
    const generate = vi
      .spyOn(provider as never, 'generateText')
      .mockRejectedValue(new Error('unexpected_notes_request'))
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(JSON.stringify(fixture.audit));
    const result = await provider.generateStructuredAnalysis(
      fixture.source.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n'),
      '',
      'auto',
      { hierarchyAuditStrategy: 'final_only' },
    );
    expect(
      generate.mock.calls.map(
        ([request]) => (request as { task: string }).task,
      ),
    ).toEqual(['notesWriter', 'notesAudit']);
    for (const [request] of generate.mock.calls) {
      const schema = (request as { notesResponseSchema?: unknown })
        .notesResponseSchema;
      if (['ollama', 'openai', 'openrouter'].includes(kind))
        expect(schema).toBeDefined();
      else expect(schema).toBeUndefined();
    }
    expect(result.generation_metadata?.prompt_version).toBe('notes-v87');
    expect(result.generation_metadata?.pipeline_version).toBe(
      'writer-audit-v1',
    );
    expect(result.all_action_items).toHaveLength(1);
  },
);

it('uses only the compact writer for ordinary local product notes', async () => {
  const fixture = makeDirectNotesFixture();
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce(
      JSON.stringify(compactWriterResponse(fixture.draft)),
    );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
    compactWriterContract: true,
  });
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
  ]);
  expect(generate.mock.calls[0]![0].prompt).not.toContain(
    'BEGIN UNTRUSTED WRITER DRAFT',
  );
  expect(result.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  expect(
    result.generation_metadata?.source_action_review_version,
  ).toBeUndefined();
  expect(result.generation_metadata?.prompt_version).toBe('notes-v87');
});

it('emits a complete provisional bullet on actual streamed transport before writer completion', async () => {
  const fixture = makeDirectNotesFixture();
  const item = {
    kind: 'action',
    text: 'Send the outline',
    owner: 'Milo',
    due: null,
    sources: ['R0'],
  };
  const prefix = `{"title":{"text":"Outline Review","sources":["R0"]},"overview":{"text":"Milo will send the outline.","sources":["R0"]},"sections":[{"title":"Outline","items":[${JSON.stringify(item)}`;
  let calls = 0;
  let writerFinished = false;
  let release: () => void = () => {};
  const previewSeen = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onDraft = vi.fn((draft, _phase?: 'streaming' | 'complete') => {
    if (!writerFinished) {
      expect(draft.sections[0].items[0].text).toBe('Send the outline');
      release();
    }
  });
  const packet = (content: string, done: boolean) =>
    new TextEncoder().encode(
      `${JSON.stringify({ message: { content }, done, ...(done ? { done_reason: 'stop' } : {}) })}\n`,
    );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      calls++;
      expect(calls).toBe(1);
      let first = true;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (first) {
              first = false;
              controller.enqueue(packet(prefix, false));
              return;
            }
            await previewSeen;
            writerFinished = true;
            controller.enqueue(packet(']}]}', true));
            controller.close();
          },
        }),
      );
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {});
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
    compactWriterContract: true,
    onDraft,
  });
  expect(onDraft).toHaveBeenCalled();
  expect(onDraft.mock.calls[0]?.[1]).toBe('streaming');
  expect(onDraft.mock.calls.at(-1)?.[1]).toBe('complete');
  expect(calls).toBe(1);
  expect(result.all_action_items[0]).toMatchObject(fixture.expectedAction);
});

it('repairs malformed writer JSON once without adding a model review', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce('invalid')
    .mockResolvedValueOnce(JSON.stringify(compactWriterResponse(f.draft)));
  const onStage = vi.fn();
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
    onStage,
  });
  expect(onStage.mock.calls.flat()).toEqual(['notesWriter', 'notesWriter']);
  expect(result.quality.retry_count).toBe(1);
  expect(
    generate.mock.calls.map(([r]) => (r as { task: string }).task),
  ).toEqual(['notesWriter', 'notesWriter']);
});

it.each(['notes_writer_timeout', 'notes_audit_timeout'])(
  'rejects %s without publishing a local fallback or repairing transport',
  async (error) => {
    const f = makeDirectNotesFixture();
    const p = new UnifiedLLMProvider('ollama', {});
    const generate = vi
      .spyOn(p as never, 'generateText')
      .mockRejectedValue(new Error('unexpected_notes_request'));
    if (error.includes('audit'))
      generate.mockResolvedValueOnce(JSON.stringify(f.draft));
    generate.mockRejectedValueOnce(new Error(error));
    await expect(
      p.generateStructuredAnalysis('', '', 'auto', {
        source: f.source,
        ...(error.includes('audit')
          ? { hierarchyAuditStrategy: 'final_only' as const }
          : {}),
      }),
    ).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(error.includes('audit') ? 2 : 1);
  },
);

it('reuses the validated writer cache without another model stage', async () => {
  const fixture = makeDirectNotesFixture();
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce(
      JSON.stringify(compactWriterResponse(fixture.draft)),
    );
  const options = {
    source: fixture.source,
    stageCache: new NotesStageCache(),
    cacheKey: 'same-run-inputs',
  };
  const first = await provider.generateStructuredAnalysis(
    '',
    '',
    'auto',
    options,
  );
  const second = await provider.generateStructuredAnalysis(
    '',
    '',
    'auto',
    options,
  );
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
  ]);
  expect(second.all_action_items).toEqual(first.all_action_items);
  expect(
    second.generation_metadata?.source_action_review_version,
  ).toBeUndefined();
});

it('rejects a cancelled caller before requesting any stage', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const controller = new AbortController();
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'));
  controller.abort();
  await expect(
    p.generateStructuredAnalysis('', '', 'auto', {
      source: f.source,
      signal: controller.signal,
    }),
  ).rejects.toThrow('notes_cancelled');
  expect(generate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('resumes a preempted writer without repairing it or rerunning a completed writer', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockRejectedValueOnce(
      new DOMException('foreground_preempted', 'AbortError'),
    )
    .mockResolvedValueOnce(JSON.stringify(compactWriterResponse(f.draft)));
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
  });
  expect(result.quality.retry_count).toBe(0);
  expect(generate).toHaveBeenCalledTimes(2);
});

it('routes one privacy-safe stage observer through every notes transport attempt', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const observer = vi.fn();
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockResolvedValueOnce(JSON.stringify(compactWriterResponse(f.draft)));

  await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
    onStageEvent: observer,
  });

  expect(generate).toHaveBeenCalledTimes(1);
  expect(
    generate.mock.calls.map(
      ([options]) =>
        (options as { notesStageObserver?: unknown }).notesStageObserver,
    ),
  ).toEqual([observer]);
});

it('precomputes one closed leaf with background priority and no audit', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValueOnce(
      JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: {
              text: 'Context',
              sources: [
                {
                  segment: source.segments[0]!.index,
                  start: 0,
                  end: source.segments[0]!.text.length,
                },
              ],
            },
            items: [],
          },
        ],
      }),
    );

  await expect(
    provider.precomputeStructuredAnalysisLeaf('', '', 'auto', {
      source,
      contextTokens: 16_384,
      stageCache: new NotesStageCache(),
      cacheKey: 'compatible-config',
      workClass: 'background',
    }),
  ).resolves.toBe('generated');

  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({ task: 'notesWriter', workClass: 'background' }),
  );
});

it('precomputes the compact product contract at background priority', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 443 }, (_, i) => ({
      speaker: 'Milo',
      text: `Dense meeting detail ${i}. Follow-up context.`,
    })),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
  });
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValueOnce(
      JSON.stringify({
        title: {
          text: 'Meeting Context',
          sources: ['R0'],
        },
        sections: [
          {
            title: 'Context',
            items: [
              {
                kind: 'point',
                text: source.segments[0].text,
                owner: null,
                due: null,
                sources: ['R0'],
              },
            ],
          },
        ],
      }),
    );
  await expect(
    provider.precomputeStructuredAnalysisLeaf('', '', 'auto', {
      source,
      contextTokens: 16384,
      compactWriterContract: true,
      stageCache: new NotesStageCache(),
      cacheKey: 'compact-config',
      workClass: 'background',
    }),
  ).resolves.toBe('generated');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      task: 'notesWriter',
      workClass: 'background',
      notesResponseSchema: expect.objectContaining({
        properties: expect.objectContaining({
          sections: expect.objectContaining({
            items: expect.objectContaining({
              properties: expect.objectContaining({
                title: expect.objectContaining({ type: 'string' }),
              }),
            }),
          }),
        }),
      }),
    }),
  );
}, 15_000);

it('preserves configured model, thinking, seed and request budgets on actual transport', async () => {
  const f = makeDirectNotesFixture();
  const outputs = [f.draft, f.audit];
  const requests: Record<string, unknown>[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      if (!outputs.length) throw new Error('unexpected_notes_request');
      urls.push(String(url));
      const body = JSON.parse(init.body);
      requests.push(body);
      return {
        ok: true,
        text: async () =>
          `${JSON.stringify({
            message: {
              role: 'assistant',
              content: JSON.stringify(outputs.shift()),
            },
            done: true,
            done_reason: 'stop',
          })}\n`,
      };
    }),
  );
  try {
    const p = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-model',
      ollama_structured_thinking: false,
      ollama_seed: 42,
    });
    const result = await p.generateStructuredAnalysis('', '', 'auto', {
      source: f.source,
      hierarchyAuditStrategy: 'final_only',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.format).toMatchObject({
      type: 'object',
      required: ['meetingType', 'overview', 'sections'],
      additionalProperties: false,
    });
    expect(requests[1]?.format).toMatchObject({
      type: 'object',
      required: ['changes', 'verdicts', 'dispositions', 'terminology'],
      additionalProperties: false,
    });
    expect(requests.map((request) => request.format)).toEqual([
      buildNotesResponseSchema('draft', ['R0']),
      buildNotesResponseSchema('audit', ['R0']),
    ]);
    expect(urls.every((url) => url.endsWith('/api/chat'))).toBe(true);
    for (const request of requests)
      expect(request).toMatchObject({
        model: 'configured-model',
        think: false,
        stream: true,
        options: { seed: 42 },
      });
    for (const request of requests) {
      const options = request.options as {
        num_ctx: number;
        num_predict: number;
      };
      const prompt = (request.messages as Array<{ content: string }>)
        .map((message) => message.content)
        .join('');
      expect(options.num_ctx).toBeLessThan(16384);
      expect(options.num_ctx).toBeGreaterThanOrEqual(
        estimateNotesTokens(prompt) + options.num_predict + 512,
      );
    }
    expect(
      requests.map((r) => (r.options as { num_predict: number }).num_predict),
    ).toEqual([2048, 1536]);
    expect(result.generation_metadata?.model).toBe('configured-model');
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each(['unknown source label', 'nested text', 'missing review target'])(
  'keeps the same exact schema on one repair and rejects %s without publishing',
  async (failure) => {
    const f = makeDirectNotesFixture();
    const encode = (value: unknown) =>
      JSON.stringify(value, (key, entry) =>
        key === 'sources' ? ['R0'] : entry,
      );
    const writer = JSON.parse(encode(f.draft));
    const audit = JSON.parse(encode(f.audit));
    const outputs: string[] = [];
    if (failure === 'missing review target') {
      audit.verdicts.pop();
      outputs.push(
        encode(writer),
        JSON.stringify(audit),
        JSON.stringify(audit),
      );
    } else {
      if (failure === 'unknown source label')
        writer.sections[0].items[0].sources = ['R99'];
      else writer.sections[0].items[0].text = { text: 'Send the outline' };
      outputs.push(JSON.stringify(writer), JSON.stringify(writer));
    }
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const content = outputs.shift();
      if (!content) throw new Error('unexpected_notes_request');
      return {
        ok: true,
        text: async () =>
          `${JSON.stringify({ message: { role: 'assistant', content }, done: true, done_reason: 'stop' })}\n`,
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (String(url).endsWith('/api/ps'))
          return Response.json({ models: [] });
        return fetchMock(url, init);
      }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-model',
    });
    const auditFailure = failure === 'missing review target';
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: f.source,
        hierarchyAuditStrategy: 'final_only',
      }),
    ).rejects.toThrow(
      auditFailure ? 'notes_audit_invalid' : 'notes_writer_invalid',
    );
    expect(fetchMock).toHaveBeenCalledTimes(auditFailure ? 3 : 2);
    const attempts = auditFailure ? requests.slice(1) : requests;
    const schema = buildNotesResponseSchema(auditFailure ? 'audit' : 'draft', [
      'R0',
    ]);
    expect(attempts.map((request) => request.format)).toEqual([schema, schema]);
    expect(JSON.stringify(attempts[1]?.messages)).toContain(
      'Repair the prior response',
    );
  },
);

it('fails a schema-rejecting local transport without retrying as unconstrained JSON', async () => {
  const f = makeDirectNotesFixture();
  const fetchMock = vi.fn(async () => ({
    ok: false,
    statusText: 'schema unsupported',
    text: async () => '',
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      return fetchMock(url, init);
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'configured-model',
  });
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source: f.source }),
  ).rejects.toThrow('notes_provider_error');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('fails a missing explicitly configured notes model without falling back', async () => {
  const f = makeDirectNotesFixture();
  const fetcher = vi.fn(async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => JSON.stringify({ error: 'model not found' }),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      return fetcher(url, init);
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'installed-old-model',
  });
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source: f.source }),
  ).rejects.toThrow('notes_provider_error');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [
    string,
    { body: string },
  ];
  expect(url).toMatch(/\/api\/chat$/);
  expect(JSON.parse(init.body).model).toBe('installed-old-model');
});

it.each([
  'notesWriter',
  'notesAudit',
  'notesMerge',
  'entities',
  'askPlutoDeep',
] as const)(
  'uses the configured general model for saved work: %s',
  async (task) => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'generic-model',
      ollama_fast_model: 'fast-model',
    });
    const resolver = provider as unknown as {
      resolveOllamaModel(task: string): Promise<string>;
    };
    expect(await resolver.resolveOllamaModel(task)).toBe('generic-model');
  },
);

it.each([
  'askPluto',
  'askPlutoLive',
  'queryClassification',
  'askPlutoScope',
] as const)(
  'uses the configured quick model for fast chat and routing: %s',
  async (task) => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'generic-model',
      ollama_fast_model: 'fast-model',
    });
    const resolver = provider as unknown as {
      resolveOllamaModel(task: string): Promise<string>;
    };
    expect(await resolver.resolveOllamaModel(task)).toBe('fast-model');
  },
);

it.each(['chatgpt'] as const)(
  'uses the existing %s semantic-review capacity deadline and preserves caller cancellation',
  async (kind) => {
    vi.useFakeTimers();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(
          () => controller.abort(new DOMException('deadline', 'TimeoutError')),
          milliseconds,
        );
        return controller.signal;
      });
    let callback:
      | Parameters<typeof semanticReview.reviewSourceBoundNotes>[1]
      | undefined;
    vi.spyOn(semanticReview, 'reviewSourceBoundNotes').mockImplementation(
      async (notes, generate) => {
        callback = generate;
        return notes;
      },
    );
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider(kind, { chatgpt_model: 'terra' });
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValue('review');
    const controller = new AbortController();
    try {
      await provider.generateStructuredAnalysis('', '', 'auto', {
        source: fixture.source,
        hierarchyAuditStrategy: 'deterministic_only',
        signal: controller.signal,
      });
      expect(callback).toBeDefined();
      await callback!({ prompt: 'review', responseSchema: {} });
      expect(timeout).toHaveBeenLastCalledWith(90_000);
      const signal = generate.mock.calls.at(-1)![0].signal!;
      await vi.advanceTimersByTimeAsync(90_001);
      expect(signal.aborted).toBe(true);
      controller.abort();
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(['chatgpt'] as const)(
  'bounds mandatory %s review by the existing publication deadline',
  async (kind) => {
    let callback:
      | Parameters<typeof semanticReview.reviewSourceBoundNotes>[1]
      | undefined;
    vi.spyOn(semanticReview, 'reviewSourceBoundNotes').mockImplementation(
      async (notes, generate) => {
        callback = generate;
        return notes;
      },
    );
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider(kind, { chatgpt_model: 'terra' });
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValue('review');
    await provider.generateStructuredAnalysis('', '', 'auto', {
      source: fixture.source,
      hierarchyAuditStrategy: 'deterministic_only',
      optionalReviewDeadlineAtMs: Date.now() + 120_000,
    });
    expect(callback).toBeDefined();
    await expect(
      callback!({ prompt: 'review', responseSchema: {} }),
    ).resolves.toBe('review');
    expect(generate).toHaveBeenCalledTimes(2);
  },
);

it.each([
  { kind: 'chatgpt', remaining: 120_000, expected: 90_000 },
  { kind: 'chatgpt', remaining: 90_000, expected: null },
] as const)(
  'preserves the publication boundary for $kind with $remaining remaining',
  async ({ kind, remaining, expected }) => {
    vi.useFakeTimers();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(
          () => controller.abort(new DOMException('deadline', 'TimeoutError')),
          milliseconds,
        );
        return controller.signal;
      });
    let callback:
      | Parameters<typeof semanticReview.reviewSourceBoundNotes>[1]
      | undefined;
    vi.spyOn(semanticReview, 'reviewSourceBoundNotes').mockImplementation(
      async (notes, generate) => {
        callback = generate;
        return notes;
      },
    );
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider(kind, { chatgpt_model: 'terra' });
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValue('review');
    try {
      await provider.generateStructuredAnalysis('', '', 'auto', {
        source: fixture.source,
        hierarchyAuditStrategy: 'deterministic_only',
        optionalReviewDeadlineAtMs: Date.now() + remaining,
      });
      const calls = generate.mock.calls.length;
      if (expected === null) {
        await expect(
          callback!({ prompt: 'review', responseSchema: {} }),
        ).rejects.toThrow('semantic_review_publication_reserve');
        expect(generate).toHaveBeenCalledTimes(calls);
      } else {
        await callback!({ prompt: 'review', responseSchema: {} });
        expect(timeout).toHaveBeenLastCalledWith(expected);
        const signal = generate.mock.calls.at(-1)![0].signal!;
        await vi.advanceTimersByTimeAsync(expected - 1);
        expect(signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal.aborted).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(['memory', 'abort'] as const)(
  'does not repair a local writer %s refusal',
  async (mode) => {
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const controller = new AbortController();
    const failure =
      mode === 'memory'
        ? new LocalModelMemoryError('Memory reserve reached')
        : new DOMException('Caller stopped notes', 'AbortError');
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockImplementationOnce(async () => {
        if (mode === 'abort') controller.abort(failure);
        throw failure;
      });
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: fixture.source,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
    ]);
  },
);
