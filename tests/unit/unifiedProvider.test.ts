import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const geminiGetGenerativeModelMock = vi.fn();
const geminiGenerateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContent: (request: unknown) => {
        geminiGetGenerativeModelMock(request);
        return geminiGenerateContentMock(request);
      },
    };

    constructor(config: unknown) {
      void config;
    }
  }

  return { GoogleGenAI: MockGoogleGenAI };
});

import {
  getAllSettings,
  getProvider,
  invalidateProviderCache,
} from '../../electron/llm/factory';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type { LLMSettings } from '../../electron/llm/provider';
import {
  executeOpenAICompatible,
  inferenceTransportErrorRationale,
} from '../../electron/llm/transports/openAICompatible';
import {
  STRUCTURED_ANALYSIS_PROMPT_VERSION,
  UnifiedLLMProvider,
  calculateOllamaContextBudget,
  deduplicateExtractedItems,
  getOllamaActiveGenerationTimeoutMs,
  getOllamaTimeoutMs,
  sliceTranscriptWindows,
} from '../../electron/llm/unifiedProvider';

const validAnalysisMarkdown = `## Summary
Security hardening progress is visible and practical.

## Key Points
- Prompt-injection defense remains an open challenge.
- The maintainer integrated AI checks to reduce low-hanging vulnerabilities.

## Action Items
- [ ] Draft a disclosure template for fix-oriented reports.

## Decisions
- Keep stronger hosted models for production-facing paths.`;

const jsonResponse = (
  payload: unknown,
  ok = true,
  statusText = 'OK',
): Response => {
  return {
    ok,
    statusText,
    json: async () => payload,
  } as unknown as Response;
};

const validStructuredAnalysis = {
  overview: 'The team aligned on the API migration and a release follow-up.',
  topics: [
    {
      title: 'API migration',
      summary: 'The group discussed migration status and next steps.',
      key_points: [{ text: 'GraphQL came up as an option under discussion.' }],
      decisions: [{ text: 'Use REST for the rollout' }],
      action_items: [
        {
          text: 'Send rollout email',
          assignee: 'Sarah',
          due: 'Friday',
        },
      ],
      open_questions: [],
      transcript_range: [0, 2],
    },
  ],
  all_action_items: [
    { text: 'Send rollout email', assignee: 'Sarah', due: 'Friday' },
  ],
  all_decisions: [{ text: 'Use REST for the rollout' }],
  meeting_type: 'team_sync',
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
};

const parseRequestBody = (init?: RequestInit): Record<string, unknown> => {
  if (typeof init?.body !== 'string') {
    return {};
  }
  return JSON.parse(init.body) as Record<string, unknown>;
};

const installFetchMock = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  residencyHandler: (
    url: string,
    init?: RequestInit,
  ) => Response | Promise<Response> = () => jsonResponse({ models: [] }),
) => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      return await handler(url, init);
    },
  );
  vi.stubGlobal('fetch', (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    return url.endsWith('/api/ps')
      ? await residencyHandler(url, init)
      : await fetchMock(input, init);
  }) as typeof fetch);
  return fetchMock;
};

describe('UnifiedLLMProvider', () => {
  it('routes an indexed source through exactly one writer and one audit with the configured model', async () => {
    const sourceText = 'I will send the outline.';
    const source = createNotesSource(
      JSON.stringify({ segments: [{ speaker: 'Milo', text: sourceText }] }),
    );
    const span = { segment: 0, start: 0, end: sourceText.length };
    const responses = [
      {
        meetingType: 'general',
        overview: null,
        sections: [
          {
            title: { text: 'Outline', sources: [span] },
            items: [
              {
                kind: 'action',
                text: 'Send the outline',
                sources: [span],
                owner: 'Milo',
                due: null,
              },
            ],
          },
        ],
      },
      {
        changes: [],
        verdicts: [
          { target: 's0:title', status: 'supported', sources: [span] },
          { target: 's0:item:0', status: 'supported', sources: [span] },
        ],
        dispositions: [],
        terminology: [],
      },
    ];
    const fetchMock = installFetchMock((_url, init) =>
      jsonResponse({
        choices: [{ message: { content: JSON.stringify(responses.shift()) } }],
      }),
    );
    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
      openai_model: 'configured-analysis-model',
    });

    const analysis = await provider.generateStructuredAnalysis(
      'Milo: I will send the outline.',
      '',
      'auto',
      { source, contextTokens: 16384 },
    );

    expect(analysis.all_action_items).toEqual([
      expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(parseRequestBody(init).response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { strict: false },
      });
      expect(parseRequestBody(init).format).toBeUndefined();
    }
    expect(
      fetchMock.mock.calls.map(([, init]) => parseRequestBody(init).model),
    ).toEqual(['configured-analysis-model', 'configured-analysis-model']);
    expect(
      fetchMock.mock.calls.map(
        ([, init]) =>
          (parseRequestBody(init).messages as Array<{ content: string }>)[0]
            ?.content,
      ),
    ).toEqual([
      'You are a source-grounded meeting notes writer. Always respond with valid JSON only.',
      'You are a source-grounded meeting notes auditor. Always respond with valid JSON only.',
    ]);
  });

  it('versions compact writer-editor notes as notes-v33', () => {
    expect(STRUCTURED_ANALYSIS_PROMPT_VERSION).toBe('notes-v33');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    geminiGetGenerativeModelMock.mockReset();
    geminiGenerateContentMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('budgets enough output for the bounded terminology proposal list', () => {
    expect(
      calculateOllamaContextBudget('', 'terminologyReconciliation').num_predict,
    ).toBe(2048);
  });

  it('uses configured ollama model directly', async () => {
    let selectedModel = '';
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toContain('/api/generate');
      const body = parseRequestBody(init);
      selectedModel = String(body.model);
      return jsonResponse({ response: validAnalysisMarkdown });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'kimike:latest',
    });
    const summary = await provider.generateUserAnalysisMarkdown(
      'Speaker A: status update',
    );

    expect(summary).toBe(validAnalysisMarkdown);
    expect(selectedModel).toBe('kimike:latest');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unloads deduplicated non-target Ollama residency before generation after restart', async () => {
    const events: string[] = [];
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          events.push(`unload:${String(body.model)}`);
          return jsonResponse({ done: true });
        }
        events.push(`generate:${String(body.model)}`);
        return jsonResponse({ response: validAnalysisMarkdown });
      },
      () => {
        events.push('discover');
        return jsonResponse({
          models: [{ name: ' gemma4:12b ' }, { model: 'GEMMA4:12B' }],
        });
      },
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    await expect(
      provider.generateUserAnalysisMarkdown('Speaker A: status update'),
    ).resolves.toBe(validAnalysisMarkdown);

    expect(events).toEqual([
      'discover',
      'unload:gemma4:12b',
      'generate:phi4-mini:3.8b',
    ]);
  });

  it('retains matching Ollama residency before generation', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        requestBodies.push(body);
        return jsonResponse({ response: validAnalysisMarkdown });
      },
      () =>
        jsonResponse({
          models: [{ name: 'PHI4-MINI:3.8B' }],
        }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    await provider.generateUserAnalysisMarkdown('Speaker A: status update');

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      model: 'phi4-mini:3.8b',
      keep_alive: '1h',
    });
  });

  it('fails closed when Ollama residency discovery fails', async () => {
    const fetchMock = installFetchMock(
      () => jsonResponse({ response: validAnalysisMarkdown }),
      () => jsonResponse({ error: 'unavailable' }, false, 'Unavailable'),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    await expect(
      provider.generateUserAnalysisMarkdown('Speaker A: status update'),
    ).rejects.toThrow('ollama_residency_discovery_failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when required Ollama residency cleanup fails', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        requestBodies.push(body);
        return jsonResponse({ error: 'busy' }, false, 'Conflict');
      },
      () => jsonResponse({ models: [{ name: 'gemma4:12b' }] }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    await expect(
      provider.generateUserAnalysisMarkdown('Speaker A: status update'),
    ).rejects.toThrow('ollama_residency_cleanup_failed');
    expect(requestBodies).toEqual([
      expect.objectContaining({ model: 'gemma4:12b', keep_alive: 0 }),
    ]);
  });

  it('propagates cancellation during Ollama residency discovery without generating', async () => {
    const fetchMock = installFetchMock(
      () => jsonResponse({ response: validAnalysisMarkdown }),
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    const controller = new AbortController();
    const answer = provider.answerAskPluto('Who owns this?', {
      signal: controller.signal,
    });
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(answer).rejects.toMatchObject({
      name: 'AbortError',
      message: 'cancelled',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds cleanup across multiple non-target Ollama residents', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let unloadCalls = 0;
    let generationStarted = false;
    const fetchMock = installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive !== 0) {
          generationStarted = true;
          return jsonResponse({ response: validAnalysisMarkdown });
        }
        unloadCalls += 1;
        if (unloadCalls === 1) {
          return new Promise<Response>((resolve, reject) => {
            const timeoutId = setTimeout(
              () => resolve(jsonResponse({ done: true })),
              25_000,
            );
            init?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timeoutId);
                reject(init.signal?.reason);
              },
              { once: true },
            );
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        });
      },
      () =>
        jsonResponse({
          models: [{ name: 'gemma4:12b' }, { name: 'qwen3.5:9b' }],
        }),
    );
    let settled = false;
    const outcome = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    })
      .answerAskPluto('Who owns this?', { signal: controller.signal })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(unloadCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(unloadCalls).toBe(2);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(settled).toBe(true);
      await expect(outcome).resolves.toMatchObject({
        error: expect.objectContaining({
          message: 'ollama_residency_cleanup_failed',
        }),
      });
      expect(generationStarted).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      controller.abort(new DOMException('test cleanup', 'AbortError'));
      await vi.runAllTimersAsync();
      await outcome;
      vi.useRealTimers();
    }
  });

  it('reserves enough Ollama context for complete knowledge JSON output', async () => {
    let options: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      const body = parseRequestBody(init);
      options = body.options as Record<string, unknown>;
      return jsonResponse({ response: '{}' });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    await provider.synthesizeKnowledgeDocument('x'.repeat(12_000));

    expect(options.num_predict).toBe(4096);
    expect(Number(options.num_ctx)).toBeGreaterThanOrEqual(8192);
  });

  it('honors the fixed local dreaming model over saved model settings', async () => {
    let body: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      body = parseRequestBody(init);
      return jsonResponse({
        response: '{"status":"no_change","proposals":[]}',
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'legacy-saved-model',
      ollama_fast_model: 'quick-saved-model',
    });

    await provider.synthesizeKnowledgeDocument('dream', {
      purpose: 'dreaming',
      model: 'gemma4:12b',
      promptVersion: 'dreaming-proposals-v1',
      responseSchema: { type: 'object' },
    });

    expect(body).toMatchObject({
      model: 'gemma4:12b',
      format: { type: 'object' },
    });
  });

  it('refuses to route dreaming through a hosted provider', async () => {
    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
    });
    await expect(
      provider.synthesizeKnowledgeDocument('dream', {
        purpose: 'dreaming',
        model: 'gemma4:12b',
        promptVersion: 'dreaming-proposals-v1',
      }),
    ).rejects.toThrow('dreaming_local_provider_required');
  });

  it('uses bounded non-thinking JSON for project scope without changing knowledge synthesis', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    installFetchMock((_url, init) => {
      bodies.push(parseRequestBody(init));
      return jsonResponse({ response: '{}', done: true, done_reason: 'stop' });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
      ollama_structured_thinking: true,
    });
    await provider.synthesizeKnowledgeDocument('x'.repeat(90_000), {
      purpose: 'projectScope',
    });
    await provider.synthesizeKnowledgeDocument('knowledge');
    expect(bodies[0]).toMatchObject({
      model: 'qwen3.5:9b',
      format: 'json',
      stream: true,
      think: false,
      options: { num_predict: 2500, num_ctx: 16384 },
    });
    expect(bodies[1]).toMatchObject({
      think: true,
      options: { num_predict: 4096 },
    });
  });

  it.each(['ollama', 'openai'] as const)(
    'constrains %s project scope responses to the supplied schema',
    async (providerType) => {
      const responseSchema = {
        type: 'object',
        properties: { projects: { type: 'array', items: { type: 'string' } } },
        required: ['projects'],
        additionalProperties: false,
      };
      const bodies: Array<Record<string, unknown>> = [];
      installFetchMock((_url, init) => {
        bodies.push(parseRequestBody(init));
        return jsonResponse({
          response: '{"projects":[]}',
          done: true,
          done_reason: 'stop',
          choices: [{ message: { content: '{"projects":[]}' } }],
        });
      });
      const provider = new UnifiedLLMProvider(providerType, {
        ollama_model: 'qwen3.5:9b',
        openai_api_key: 'test-key',
      });

      await expect(
        provider.synthesizeKnowledgeDocument('review', {
          purpose: 'projectScope',
          responseSchema,
        }),
      ).resolves.toBe('{"projects":[]}');
      expect(
        providerType === 'ollama'
          ? bodies[0].format
          : bodies[0].response_format,
      ).toEqual(
        providerType === 'ollama'
          ? responseSchema
          : {
              type: 'json_schema',
              json_schema: {
                name: 'projectScopeReview',
                schema: responseSchema,
                strict: true,
              },
            },
      );
    },
  );

  it.each([
    ['missing completion', { response: '{"projects":[]}' }],
    [
      'output limit',
      { response: '{"projects":[]}', done: true, done_reason: 'length' },
    ],
  ])('rejects project scope output with %s', async (_reason, packet) => {
    installFetchMock(() => new Response(`${JSON.stringify(packet)}\n`));
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });

    await expect(
      provider.synthesizeKnowledgeDocument('review', {
        purpose: 'projectScope',
      }),
    ).rejects.toThrow('project_scope_response_incomplete');
  });

  it('lets visible project scope preempt resumable notes and yield to chat', async () => {
    const signals: AbortSignal[] = [];
    const controller = new AbortController();
    const fetchMock = installFetchMock((_url, init) => {
      if (signals.length >= 2)
        return jsonResponse({ response: validAnalysisMarkdown });
      signals.push(init!.signal!);
      if (init!.signal!.aborted) return Promise.reject(init!.signal!.reason);
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener(
          'abort',
          () => reject(init!.signal!.reason),
          { once: true },
        ),
      );
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const knowledge = (
      provider as unknown as {
        generateText(options: {
          prompt: string;
          task: string;
          signal: AbortSignal;
        }): Promise<string>;
      }
    )
      .generateText({
        prompt: 'notes',
        task: 'notesWriter',
        signal: controller.signal,
      })
      .catch((error) => error);
    let review: Promise<unknown> | undefined;
    let analysis: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      review = provider
        .synthesizeKnowledgeDocument('review', {
          purpose: 'projectScope',
          signal: controller.signal,
        })
        .catch((error) => error);
      await vi.waitFor(() => expect(signals[0].aborted).toBe(true), {
        timeout: 500,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      analysis = provider.answerAskPluto('question', { mode: 'fast' });
      await expect(review).resolves.toMatchObject({
        name: 'AbortError',
        message: 'foreground_preempted',
      });
      await expect(analysis).resolves.toBe(validAnalysisMarkdown);
      await expect(knowledge).resolves.toMatchObject({
        name: 'AbortError',
        message: 'foreground_preempted',
      });
    } finally {
      controller.abort();
      await Promise.allSettled([knowledge, review, analysis]);
    }
  });

  it('keeps saved Ask Pluto on one model while preserving mode budgets', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock((_url, init) => {
      requestBodies.push(parseRequestBody(init));
      return jsonResponse({ response: 'Grounded answer' });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
      ollama_fast_model: 'phi4-mini:3.8b',
    });

    await provider.answerAskPluto('Who owns this?', { mode: 'fast' });
    await provider.answerAskPluto('Compare these meetings', { mode: 'deep' });

    expect(requestBodies[0]).toMatchObject({
      model: 'qwen3.5:9b',
      think: false,
    });
    expect(requestBodies[0].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 768,
    });
    expect(requestBodies[1]).toMatchObject({
      model: 'qwen3.5:9b',
      think: false,
    });
    expect(requestBodies[1].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 1024,
      top_k: 40,
      top_p: 1,
    });
  });

  it('uses a bounded non-thinking Ollama request for live Ask Pluto', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      requestBody = parseRequestBody(init);
      return jsonResponse({ response: 'Live answer' });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });

    await provider.answerAskPluto('What are we discussing?', { live: true });

    expect(requestBody.think).toBe(false);
    expect(requestBody.options).toMatchObject({
      num_ctx: 8192,
      num_predict: 768,
    });
  });

  it('finishes live Ask Pluto on Ollama done without waiting for transport close', async () => {
    let streamCancelled = false;
    const encoder = new TextEncoder();
    installFetchMock(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({ response: 'Complete answer.', done: true })}\n`,
                ),
              );
            },
            cancel() {
              streamCancelled = true;
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const onToken = vi.fn();

    await expect(
      provider.answerAskPluto('What happened?', { live: true, onToken }),
    ).resolves.toBe('Complete answer.');
    expect(onToken).toHaveBeenCalledWith('Complete answer.');
    expect(streamCancelled).toBe(true);
  });

  it('reports when an Ask Pluto request is admitted to the provider', async () => {
    installFetchMock(() => jsonResponse({ response: 'Grounded answer' }));
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const onStart = vi.fn();

    await provider.answerAskPluto('Who owns this?', { onStart });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('keeps Ask Pluto intent classification non-thinking even when structured thinking is enabled', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      requestBody = parseRequestBody(init);
      return jsonResponse({ response: '{"intent":"factual"}' });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
      ollama_structured_thinking: true,
    });

    await provider.classifyQueryIntent('Classify this query.');

    expect(requestBody).toMatchObject({
      model: 'phi4-mini:3.8b',
      think: false,
      format: 'json',
    });
    expect(requestBody.options).toMatchObject({ num_predict: 128 });
  });

  it('propagates Ask Pluto cancellation to the active Ollama transport', async () => {
    installFetchMock(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const controller = new AbortController();
    const answer = provider.answerAskPluto('Compare these meetings', {
      mode: 'deep',
      signal: controller.signal,
    });
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preempts active knowledge generation for meeting analysis', async () => {
    let generationCalls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      generationCalls += 1;
      if (generationCalls > 1) {
        return jsonResponse({ response: validAnalysisMarkdown });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const firstProvider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    const secondProvider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    const first = firstProvider.synthesizeKnowledgeDocument('knowledge');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstOutcome = expect(first).rejects.toMatchObject({
      name: 'AbortError',
      message: 'foreground_preempted',
    });
    const second = secondProvider.generateUserAnalysisMarkdown('analysis');
    await firstOutcome;
    await expect(second).resolves.toBe(validAnalysisMarkdown);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preempts active dreaming for foreground meeting analysis', async () => {
    let generationCalls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      generationCalls += 1;
      if (generationCalls > 1) {
        return jsonResponse({ response: validAnalysisMarkdown });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });

    const dreaming = provider.synthesizeKnowledgeDocument('dream', {
      purpose: 'dreaming',
      model: 'gemma4:12b',
      promptVersion: 'dreaming-proposals-v1',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const foreground = provider.generateUserAnalysisMarkdown('analysis');

    await expect(dreaming).rejects.toMatchObject({
      name: 'AbortError',
      message: 'foreground_preempted',
    });
    await expect(foreground).resolves.toBe(validAnalysisMarkdown);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets foreground inference preempt serialized dreaming cleanup', async () => {
    let calls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      calls += 1;
      if (calls > 1) return jsonResponse({ response: 'Ready' });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const cleanup = provider.unloadModel('gemma4:12b');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const answer = provider.answerAskPluto('Are you ready?');

    await expect(cleanup).resolves.toBeUndefined();
    await expect(answer).resolves.toBe('Ready');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preempts background title generation for Ask Pluto', async () => {
    let generationCalls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      generationCalls += 1;
      if (generationCalls === 2) {
        expect(parseRequestBody(init)).toMatchObject({
          model: 'qwen3.5:9b',
          keep_alive: 0,
          stream: false,
        });
        return jsonResponse({ response: '' });
      }
      if (generationCalls > 2) {
        return jsonResponse({
          response: 'The current meeting is about pricing.',
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
      ollama_fast_model: 'phi4-mini:3.8b',
    });

    const title = provider.generateTitle('A meeting transcript');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const answer = provider.answerAskPluto('What is this meeting about?');

    await expect(title).resolves.toBe('Meeting');
    await expect(answer).resolves.toBe('The current meeting is about pricing.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses Gemma 4 as the single default across general-purpose tasks', async () => {
    const selectedModels: string[] = [];
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'kimike:latest' },
            { name: 'phi4-mini:3.8b:latest' },
            { name: 'qwen3.5:9b' },
            { name: 'gemma4:12b' },
          ],
        });
      }
      if (url.endsWith('/api/generate')) {
        const body = parseRequestBody(init);
        selectedModels.push(String(body.model));
        const prompt = String(body.prompt || '');
        if (prompt.includes('generate a concise, descriptive meeting title')) {
          return jsonResponse({ response: 'Synthetic Title' });
        }
        if (prompt.includes('extracting hidden internal signals')) {
          return jsonResponse({
            response: JSON.stringify({
              continuity: [],
              accountability_risks: [],
              decision_impacts: [],
              extra_tags: [],
            }),
          });
        }
        return jsonResponse({
          response: JSON.stringify({
            people: [],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [],
            relationships: [],
          }),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.generateTitle('Speaker A: status update');
    await provider.extractValueSignals('Speaker A: status update');
    await provider.extractEntities('Speaker A: status update');

    expect(selectedModels).toEqual(['gemma4:12b', 'gemma4:12b', 'gemma4:12b']);
  });

  it('uses Gemma for saved chat and Phi for active meeting chat', async () => {
    const selectedModels: string[] = [];
    installFetchMock(
      (url, init) => {
        if (url.endsWith('/api/tags')) {
          return jsonResponse({
            models: [
              { name: 'phi4-mini:3.8b' },
              { name: 'qwen3.5:9b' },
              { name: 'gemma4:12b' },
            ],
          });
        }
        if (url.endsWith('/api/generate')) {
          const body = parseRequestBody(init);
          selectedModels.push(String(body.model));
          return jsonResponse({ response: 'Grounded answer' });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      () => jsonResponse({ models: [{ name: 'gemma4:12b' }] }),
    );

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.answerAskPluto('Who owns this?', { mode: 'fast' });
    await provider.answerAskPluto('Compare these meetings', { mode: 'deep' });
    await provider.answerAskPluto('What are we discussing?', { live: true });

    expect(selectedModels).toEqual([
      'gemma4:12b',
      'gemma4:12b',
      'gemma4:12b',
      'phi4-mini:3.8b',
    ]);
  });

  it('does not substitute an arbitrary installed model for Gemma 4', async () => {
    let selectedModel = '';
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'nomic-embed-text:latest' },
            { name: 'kimike:latest' },
          ],
        });
      }
      if (url.endsWith('/api/generate')) {
        const body = parseRequestBody(init);
        selectedModel = String(body.model);
        return jsonResponse({ response: validAnalysisMarkdown });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.generateUserAnalysisMarkdown('Speaker A: status update');

    expect(selectedModel).toBe('gemma4:12b');
  });

  it('uses Gemma 4 without a model-discovery dependency', async () => {
    let selectedModel = '';
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({}, false, 'unavailable');
      }
      if (url.endsWith('/api/generate')) {
        const body = parseRequestBody(init);
        selectedModel = String(body.model);
        return jsonResponse({ response: validAnalysisMarkdown });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.generateUserAnalysisMarkdown('Speaker A: status update');

    expect(selectedModel).toBe('gemma4:12b');
  });

  it('routes openai user-analysis generation through chat completions', async () => {
    let usedModel = '';
    installFetchMock((url, init) => {
      expect(url).toContain('/chat/completions');
      const body = parseRequestBody(init);
      expect(body.store).toBe(false);
      usedModel = String(body.model);
      return jsonResponse({
        choices: [{ message: { content: validAnalysisMarkdown } }],
      });
    });

    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
      openai_model: 'gpt-4.1-mini',
    });

    const summary = await provider.generateUserAnalysisMarkdown(
      'Speaker A: status update',
    );
    expect(summary).toBe(validAnalysisMarkdown);
    expect(usedModel).toBe('gpt-4.1-mini');
  });

  it('routes OpenRouter statelessly with zero-data-retention requirements', async () => {
    installFetchMock((url, init) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      const body = parseRequestBody(init);
      expect(body).not.toHaveProperty('store');
      expect(body.provider).toEqual({
        zdr: true,
        data_collection: 'deny',
        require_parameters: true,
      });
      expect(body.model).toBe('openai/gpt-4o-mini');
      return jsonResponse({
        model: 'openai/gpt-4o-mini',
        choices: [{ message: { content: validAnalysisMarkdown } }],
      });
    });

    const provider = new UnifiedLLMProvider('openrouter', {
      openrouter_api_key: 'test-key',
      openrouter_model: 'openai/gpt-4o-mini',
    });
    await expect(
      provider.generateUserAnalysisMarkdown('Speaker A: status update'),
    ).resolves.toBe(validAnalysisMarkdown);
  });

  it('classifies OpenRouter endpoint-routing 404s without retaining the response body', async () => {
    installFetchMock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'No endpoints found for this model.' },
        }),
      } as Response),
    );

    const error = await executeOpenAICompatible('openrouter', 'test-key', {
      task: 'askPluto',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
      egress: {
        classification: 'selected_meeting_context',
        userInitiated: true,
      },
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      status: 404,
      provider: 'openrouter',
      code: 'openrouter_no_eligible_endpoint',
    });
    expect(inferenceTransportErrorRationale(error)).toContain(
      'zero-retention endpoint',
    );
    expect(String(error)).not.toContain('No endpoints found');
  });

  it('honors Retry-After and retries an eligible OpenRouter 429 once', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '2',
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          model: 'openai/gpt-4o-mini',
          choices: [{ message: { content: 'Recovered' } }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = executeOpenAICompatible('openrouter', 'test-key', {
      task: 'notesWriter',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Summarize' }],
      rateLimitRetries: 1,
      egress: {
        classification: 'selected_meeting_context',
        userInitiated: true,
      },
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels an OpenRouter request while waiting to retry a 429', async () => {
    const controller = new AbortController();
    const cancellation = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '30',
            },
          }),
        ),
      ),
    );

    const pending = executeOpenAICompatible('openrouter', 'test-key', {
      task: 'notesWriter',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Summarize' }],
      rateLimitRetries: 1,
      signal: controller.signal,
      egress: {
        classification: 'selected_meeting_context',
        userInitiated: true,
      },
    });
    await Promise.resolve();
    controller.abort(cancellation);

    await expect(pending).rejects.toBe(cancellation);
  });

  it('normalizes OpenAI shorthand model IDs for OpenRouter', async () => {
    installFetchMock((_url, init) => {
      expect(parseRequestBody(init).model).toBe('openai/gpt-4o-mini');
      return jsonResponse({
        model: 'openai/gpt-4o-mini',
        choices: [{ message: { content: validAnalysisMarkdown } }],
      });
    });

    const provider = new UnifiedLLMProvider('openrouter', {
      openrouter_api_key: 'test-key',
      openrouter_model: 'gpt-4o-mini',
    });
    await expect(
      provider.generateUserAnalysisMarkdown('Speaker A: status update'),
    ).resolves.toBe(validAnalysisMarkdown);
  });

  it('extracts internal signals in openai JSON mode with normalized tags', async () => {
    installFetchMock((url, init) => {
      expect(url).toContain('/chat/completions');
      const body = parseRequestBody(init);
      expect(body.response_format).toEqual({ type: 'json_object' });
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                continuity: ['Security hardening remains an ongoing stream'],
                accountability_risks: [
                  'Most fixes bottleneck on one maintainer',
                ],
                decision_impacts: ['Integrated AI validation for skills'],
                extra_tags: [
                  { tag: 'Maintainer Bandwidth', confidence: 0.9 },
                  { tag: 'maintainer-bandwidth', confidence: 0.7 },
                  { tag: 'responsible-disclosure', confidence: 0.8 },
                ],
              }),
            },
          },
        ],
      });
    });

    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
    });
    const signals = await provider.extractInternalSignals('Speaker A: update');

    expect(signals.analysis_schema_version).toBe(2);
    expect(signals.continuity).toEqual([
      'Security hardening remains an ongoing stream',
    ]);
    expect(signals.accountability_risks).toEqual([
      'Most fixes bottleneck on one maintainer',
    ]);
    expect(signals.decision_impacts).toEqual([
      'Integrated AI validation for skills',
    ]);
    expect(signals.extra_tags).toEqual([
      { tag: 'maintainer-bandwidth', confidence: 0.9 },
      { tag: 'responsible-disclosure', confidence: 0.8 },
    ]);
  });

  it('retries analysis once and falls back to safe skeleton when still invalid', async () => {
    let callCount = 0;
    installFetchMock((url, init) => {
      expect(url).toContain('/chat/completions');
      const body = parseRequestBody(init);
      const messages = Array.isArray(body.messages)
        ? (body.messages as Array<{ role: string; content: string }>)
        : [];

      callCount += 1;
      if (messages.some((m) => m.content?.includes('internal signals'))) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  continuity: [],
                  accountability_risks: [],
                  decision_impacts: [],
                  extra_tags: [],
                }),
              },
            },
          ],
        });
      }

      return jsonResponse({ choices: [{ message: { content: 'invalid' } }] });
    });

    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
    });
    const artifacts =
      await provider.generateAnalysisArtifacts('Speaker A: update');

    expect(callCount).toBeGreaterThanOrEqual(3); // draft + repair + signals
    expect(artifacts.analysis.quality.fallback_used).toBe(true);
    expect(artifacts.analysis.quality.retry_count).toBe(1);
    expect(artifacts.markdown).toContain('## Summary');
    expect(artifacts.markdown).toContain('## Action Items');
  });

  it('routes claude title generation with short max token budget', async () => {
    let maxTokens = 0;
    installFetchMock((url, init) => {
      expect(url).toContain('/messages');
      const body = parseRequestBody(init);
      maxTokens = Number(body.max_tokens);
      return jsonResponse({ content: [{ text: 'Roadmap Review' }] });
    });

    const provider = new UnifiedLLMProvider('claude', {
      claude_api_key: 'test-key',
    });
    const title = await provider.generateTitle('Speaker A: roadmap review');

    expect(title).toBe('Roadmap Review');
    expect(maxTokens).toBe(50);
  });

  it('keeps Ollama title generation short and non-thinking', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'gemma4:12b' }] });
      }
      requestBody = parseRequestBody(init);
      return jsonResponse({ response: 'Quarterly Roadmap Review' });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const title = await provider.generateTitle('The roadmap review concluded.');

    expect(title).toBe('Quarterly Roadmap Review');
    expect(requestBody.think).toBe(false);
    expect(requestBody.options).toMatchObject({
      num_ctx: 8192,
      num_predict: 64,
    });
    expect(requestBody.prompt).toContain(
      'Never return a generic placeholder such as Meeting',
    );
  });

  it('keeps Ollama dreaming generation non-thinking for thinking models', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'gemma4:12b' }] });
      }
      requestBody = parseRequestBody(init);
      return jsonResponse({
        response: '{"status":"no_change","proposals":[]}',
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    await provider.synthesizeKnowledgeDocument('Consolidate project updates', {
      purpose: 'dreaming',
      model: 'gemma4:12b',
      promptVersion: 'dreaming-proposals-v2',
      responseSchema: { type: 'object' },
    });

    expect(requestBody.think).toBe(false);
  });

  it('strips a model response label from a generated title', async () => {
    installFetchMock(() =>
      jsonResponse({ content: [{ text: 'Title: Roadmap Review' }] }),
    );

    const provider = new UnifiedLLMProvider('claude', {
      claude_api_key: 'test-key',
    });

    await expect(
      provider.generateTitle('Speaker A: roadmap review'),
    ).resolves.toBe('Roadmap Review');
  });

  it('falls back when a generated title contains only a response label', async () => {
    installFetchMock(() => jsonResponse({ content: [{ text: 'TITLE:   ' }] }));

    const provider = new UnifiedLLMProvider('claude', {
      claude_api_key: 'test-key',
    });

    await expect(
      provider.generateTitle('Speaker A: roadmap review'),
    ).resolves.toBe('Meeting');
  });

  it('routes gemini entities extraction in JSON mode', async () => {
    geminiGenerateContentMock.mockResolvedValue({
      text: JSON.stringify({
        people: [{ name: 'Sarah Chen' }],
        topics: [],
        action_items: [],
        decisions: [],
        projects: [],
        relationships: [],
      }),
    });

    const provider = new UnifiedLLMProvider('gemini', {
      gemini_api_key: 'test-key',
      gemini_model: 'gemini-2.0-flash',
    });

    const entities = await provider.extractEntities(
      'Speaker A: Sarah owns API migration',
    );

    expect(entities.people.map((p) => p.name)).toEqual(['Sarah Chen']);
    expect(geminiGetGenerativeModelMock).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash',
      contents: expect.any(String),
      config: { responseMimeType: 'application/json' },
    });
  });
});

describe('LLM factory', () => {
  afterEach(() => {
    invalidateProviderCache();
    vi.unstubAllGlobals();
  });

  it('does not silently fall back from unavailable ollama to cloud', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({}, false, 'unavailable');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const settings: LLMSettings = {
      llm_provider: 'ollama',
      openai_api_key: 'fallback-openai',
    };

    await expect(getProvider(settings)).rejects.toThrow(
      'explicitly select a configured cloud provider',
    );
  });

  it('requires current consent for a configured cloud provider', async () => {
    await expect(
      getProvider({ llm_provider: 'openai', openai_api_key: 'test-key' }),
    ).rejects.toThrow('openai_cloud_consent_required');
  });

  it('normalizes invalid provider setting to ollama', async () => {
    const db = {
      getSetting: (key: string): unknown => {
        if (key === 'llm_provider') return 'not-a-provider';
        if (key === 'openai_api_key') return 'openai-key';
        if (key === 'ollama_model') return 123; // non-string should be discarded
        if (key === 'ollama_structured_thinking') return 'false';
        if (key === 'ollama_seed') return null;
        return undefined;
      },
    };

    const settings = await getAllSettings(db);
    expect(settings.llm_provider).toBe('ollama');
    expect(settings.openai_api_key).toBe('openai-key');
    expect(settings.ollama_model).toBeUndefined();
    expect(settings).not.toHaveProperty('ollama_analysis_model');
    expect(settings.ollama_structured_thinking).toBe(false);
    expect(settings.ollama_seed).toBeUndefined();
  });
});

describe('Ollama Budgeting & Adaptive Windowing', () => {
  it('bounds meeting analysis requests while preserving the knowledge-doc budget', () => {
    expect(getOllamaTimeoutMs('topicSegmentation')).toBe(300_000);
    expect(getOllamaTimeoutMs('topicAnalysis')).toBe(300_000);
    expect(getOllamaTimeoutMs('knowledgeDoc')).toBe(900_000);
    expect(getOllamaTimeoutMs('projectScopeReview')).toBe(180_000);
    expect(getOllamaActiveGenerationTimeoutMs(512)).toBe(376_000);
    expect(getOllamaActiveGenerationTimeoutMs(4_096)).toBe(1_200_000);
    expect(getOllamaTimeoutMs('askPlutoLive')).toBe(20_000);
  });

  it('uses a compact context and output budget for live Ask Pluto', () => {
    expect(
      calculateOllamaContextBudget('a'.repeat(1_000), 'askPlutoLive'),
    ).toEqual({
      num_ctx: 8192,
      num_predict: 768,
    });
  });

  it('calculateOllamaContextBudget allocates up to 16384 context tokens for long analysis prompts', () => {
    const longPrompt = 'a'.repeat(30_000); // ~10,000 tokens
    const budget = calculateOllamaContextBudget(
      longPrompt,
      'structuredAnalysis',
    );
    expect(budget.num_ctx).toBeGreaterThanOrEqual(12288);
    expect(budget.num_predict).toBe(4096);
  });

  it('bounds the global editor output to a concise complete document', () => {
    const budget = calculateOllamaContextBudget(
      'a'.repeat(30_000),
      'analysisEditorial',
    );

    expect(budget.num_ctx).toBeGreaterThanOrEqual(12288);
    expect(budget.num_predict).toBe(2048);
  });

  it('uses separate bounded budgets for titles and Ask Pluto answers', () => {
    expect(calculateOllamaContextBudget('transcript', 'title')).toEqual({
      num_ctx: 8192,
      num_predict: 64,
    });
    expect(calculateOllamaContextBudget('question', 'askPluto')).toEqual({
      num_ctx: 4096,
      num_predict: 768,
    });
    expect(calculateOllamaContextBudget('question', 'askPlutoDeep')).toEqual({
      num_ctx: 4096,
      num_predict: 1024,
    });
  });

  it('sliceTranscriptWindows slices transcript into overlapping windows when line count exceeds maxLinesPerWindow', () => {
    const lines = Array.from(
      { length: 300 },
      (_, i) => `[Me] (${i * 5}s): Line content ${i}`,
    ).join('\n');
    const windows = sliceTranscriptWindows(lines, 100);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].startSegment).toBe(0);
    expect(windows[0].endSegment).toBeLessThan(300);
  });

  it('deduplicateExtractedItems merges duplicate action items and respects distinct assignees', () => {
    const items = [
      {
        text: 'Deploy the Snowflake integration script on Friday.',
        assignee: 'Alain',
      },
      {
        text: 'Deploy Snowflake integration script on Friday',
        assignee: 'Alain',
      },
      {
        text: 'Deploy Snowflake integration script on Friday',
        assignee: 'Deepak',
      },
      { text: 'Write project timeline documentation.', assignee: 'Deepak' },
    ];
    const deduped = deduplicateExtractedItems(
      items,
      (item) => item.text,
      (item) => item.assignee,
    );
    expect(deduped.length).toBe(3);
    expect(deduped[0].text).toBe(
      'Deploy the Snowflake integration script on Friday.',
    );
  });
});
