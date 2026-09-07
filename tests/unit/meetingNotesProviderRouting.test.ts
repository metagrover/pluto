import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildNotesResponseSchema } from '../../electron/llm/meetingNotesSchema';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import {
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from '../../electron/llm/meetingNotesTypes';
import {
  UnifiedLLMProvider,
  getOllamaTimeoutMs,
} from '../../electron/llm/unifiedProvider';
import {
  makeDirectNotesFixture,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';
import kindCorrection from '../manual/fixtures/meetingNotesV10KindCorrection.json';

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

it('applies the captured real-model kind correction on the shipped legacy default without repair or loss of discussion', async () => {
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
    vi.spyOn(provider as never, 'generateText')
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(JSON.stringify(fixture.audit));
    const result = await provider.generateStructuredAnalysis('', '', 'auto', {
      source: fixture.source,
    });
    expect(result.generation_metadata?.model).toBe(
      mode === 'detected' ? 'gemma4:12b' : model,
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('pins Gemma across writer and audit without model discovery', async () => {
  const fixture = makeDirectNotesFixture();
  const provider = new UnifiedLLMProvider('ollama', {});
  let tags = 0;
  const requests: string[] = [];
  const responses = [fixture.draft, fixture.audit];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      if (String(url).endsWith('/api/tags')) {
        tags += 1;
        return tags === 1
          ? { ok: false }
          : {
              ok: true,
              json: async () => ({ models: [{ name: 'different-model:12b' }] }),
            };
      }
      requests.push(JSON.parse(init.body).model);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            message: { content: JSON.stringify(responses.shift()) },
            done: true,
            done_reason: 'stop',
          }),
      };
    }),
  );
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
  });
  expect(tags).toBe(0);
  expect(requests).toEqual(['gemma4:12b', 'gemma4:12b']);
  expect(result.generation_metadata?.model).toBe('gemma4:12b');
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

it.each(['ollama', 'openai', 'claude', 'gemini'] as const)(
  'routes raw and indexed %s callers through the shipped legacy two-stage contract',
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
    );
    expect(
      generate.mock.calls.map(
        ([request]) => (request as { task: string }).task,
      ),
    ).toEqual(['notesWriter', 'notesAudit']);
    for (const [request] of generate.mock.calls) {
      const schema = (request as { notesResponseSchema?: unknown })
        .notesResponseSchema;
      if (kind === 'ollama') expect(schema).toBeDefined();
      else expect(schema).toBeUndefined();
    }
    expect(result.generation_metadata?.prompt_version).toBe('notes-v29');
    expect(result.generation_metadata?.pipeline_version).toBe(
      'writer-audit-v1',
    );
    expect(result.all_action_items).toHaveLength(1);
  },
);

it('routes the compact product writer through the complete-document editor', async () => {
  const fixture = makeDirectNotesFixture();
  const source = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
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
    .mockResolvedValueOnce(JSON.stringify(fixture.draft));

  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
    compactWriterContract: true,
  });

  expect(
    generate.mock.calls.map(([request]) => (request as { task: string }).task),
  ).toEqual(['notesWriter', 'notesAudit']);
  expect(
    generate.mock.calls.map(([request]) =>
      (request as { prompt: string }).prompt.includes(
        'complete corrected document',
      ),
    ),
  ).toEqual([false, true]);
  expect(result.generation_metadata?.pipeline_version).toBe('writer-editor-v1');
  expect(result.generation_metadata?.prompt_version).toBe('notes-v29');
});

it.each([
  ['openai provider', new UnifiedLLMProvider('openai', {}), true, undefined],
  [
    'missing compact contract',
    new UnifiedLLMProvider('ollama', {}),
    false,
    undefined,
  ],
  [
    'deterministic-only review',
    new UnifiedLLMProvider('ollama', {}),
    true,
    'deterministic_only' as const,
  ],
])(
  'rejects source-first notes with an incompatible %s',
  async (_label, provider, compact, strategy) => {
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: makeDirectNotesFixture().source,
        sourceFirstReconciliation: true,
        compactWriterContract: compact,
        hierarchyAuditStrategy: strategy,
      }),
    ).rejects.toThrow('notes_source_first_configuration_invalid');
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([
  [
    'missing',
    [{ name: 'gemma4:12b', digest: 'other' }],
    'notes_source_first_model_unavailable',
  ],
  [
    'wrong digest',
    [{ name: PHI_NOTES_EXPERIMENT_MODEL, digest: 'wrong' }],
    'notes_source_first_model_digest_mismatch',
  ],
])(
  'fails closed when the exact Phi model is %s',
  async (_label, models, error) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/tags'))
          return { ok: true, json: async () => ({ models }) };
        throw new Error('unexpected_live_transport');
      }),
    );
    const provider = new UnifiedLLMProvider('ollama', {});
    const generate = vi.spyOn(provider as never, 'generateText');
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: makeDirectNotesFixture().source,
        sourceFirstReconciliation: true,
        compactWriterContract: true,
      }),
    ).rejects.toThrow(error);
    expect(generate).not.toHaveBeenCalled();
  },
);

it('pins the exact Phi identity and selects reconciliation then editor schemas', async () => {
  const fixture = makeDirectNotesFixture();
  const evidence = fixture.draft.sections[0]!.items[0]!.sources[0]!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).endsWith('/api/tags'))
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                name: PHI_NOTES_EXPERIMENT_MODEL,
                digest: PHI_NOTES_EXPERIMENT_DIGEST,
              },
            ],
          }),
        };
      throw new Error('unexpected_live_transport');
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    llm_model: 'configured-control:12b',
  });
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValueOnce(
      JSON.stringify({
        facts: [],
        actions: [
          {
            text: 'Send the outline',
            owner: 'Milo',
            due: null,
            sources: ['R0'],
          },
        ],
        decisions: [],
        questions: [],
      }),
    )
    .mockImplementationOnce(async (request: { prompt: string }) => {
      const inventory = JSON.parse(
        request.prompt.match(
          /BEGIN SOURCE INVENTORY\n([\s\S]*?)\nEND SOURCE INVENTORY/,
        )?.[1] ?? '[]',
      ) as Array<Record<string, unknown>>;
      return JSON.stringify({
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Outline', sources: ['R0'] },
            items: inventory,
          },
        ],
        dispositions: [],
        terminology: [],
      });
    });

  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: fixture.source,
    sourceFirstReconciliation: true,
    compactWriterContract: true,
  });

  expect(generate).toHaveBeenCalledTimes(2);
  expect(
    generate.mock.calls.map(
      ([request]) => (request as { notesModel: string }).notesModel,
    ),
  ).toEqual([PHI_NOTES_EXPERIMENT_MODEL, PHI_NOTES_EXPERIMENT_MODEL]);
  const schemas = generate.mock.calls.map(
    ([request]) =>
      (request as { notesResponseSchema: { properties: object } })
        .notesResponseSchema.properties,
  );
  expect(schemas[0]).toHaveProperty('facts');
  expect(schemas[1]).toHaveProperty('meetingType');
  expect(result.generation_metadata).toMatchObject({
    model: PHI_NOTES_EXPERIMENT_MODEL,
    pipeline_version: 'notes-v30-source-first',
  });
  expect(result.all_action_items[0]).toMatchObject({
    text: 'Send the outline',
    evidence: fixture.source.segments[evidence.segment]!.text,
  });
});

it('repairs malformed writer output once and still requires an independent legacy audit', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce('invalid')
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const onStage = vi.fn();
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
    onStage,
  });
  expect(onStage.mock.calls.flat()).toEqual([
    'notesWriter',
    'notesWriter',
    'notesAudit',
  ]);
  expect(result.quality.retry_count).toBe(1);
  expect(
    generate.mock.calls.map(([r]) => (r as { task: string }).task),
  ).toEqual(['notesWriter', 'notesWriter', 'notesAudit']);
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
      p.generateStructuredAnalysis('', '', 'auto', { source: f.source }),
    ).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(error.includes('audit') ? 2 : 1);
  },
);

it('reuses only the validated writer after audit failure and audits again on manual regeneration', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValue(new Error('unexpected_notes_request'))
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockRejectedValueOnce(new Error('notes_audit_timeout'))
    .mockResolvedValueOnce(JSON.stringify(f.audit))
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const options = {
    source: f.source,
    stageCache: new NotesStageCache(),
    cacheKey: 'same-run-inputs',
  };
  await expect(
    p.generateStructuredAnalysis('', '', 'auto', options),
  ).rejects.toThrow('notes_audit_timeout');
  await p.generateStructuredAnalysis('', '', 'auto', options);
  await p.generateStructuredAnalysis('', '', 'auto', options);
  expect(
    generate.mock.calls.map(([r]) => (r as { task: string }).task),
  ).toEqual(['notesWriter', 'notesAudit', 'notesAudit', 'notesAudit']);
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
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
  });
  expect(result.quality.retry_count).toBe(0);
  expect(generate).toHaveBeenCalledTimes(3);
});

it('routes one privacy-safe stage observer through every notes transport attempt', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const observer = vi.fn();
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit));

  await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
    onStageEvent: observer,
  });

  expect(generate).toHaveBeenCalledTimes(2);
  expect(
    generate.mock.calls.map(
      ([options]) =>
        (options as { notesStageObserver?: unknown }).notesStageObserver,
    ),
  ).toEqual([observer, observer]);
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
        options: { seed: 42, num_ctx: 16384 },
      });
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
      provider.generateStructuredAnalysis('', '', 'auto', { source: f.source }),
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
  'askPluto',
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

it.each(['askPlutoLive', 'queryClassification'] as const)(
  'uses the configured quick model for active meeting work: %s',
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
