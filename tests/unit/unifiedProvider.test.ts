import os from 'node:os';
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
import * as modelMemory from '../../electron/llm/localModelMemory';
import { setLocalModelMemoryProbeReader } from '../../electron/llm/localModelMemoryProbe';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import * as ollamaTransport from '../../electron/llm/ollamaHttpTransport';
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
  releaseIdleOllamaModel,
  runWithLocalTranscription,
  setLocalTranscriptionModelUnloader,
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
  it('repartitions the full source after an initial cold memory refusal without reducing output', async () => {
    const source = createNotesSource(
      JSON.stringify({
        segments: Array.from({ length: 16 }, (_, index) => ({
          speaker: 'Observer',
          text: `Specimen group ${index} has a recorded mass of ${index + 20} grams. The observation was recorded under controlled lighting at the laboratory bench. `.repeat(
            3,
          ),
        })),
      }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
      ollama_fast_model: 'phi4-mini:3.8b',
    });
    const requests: Array<{ context: number; output: number }> = [];
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockRejectedValueOnce(
        new modelMemory.LocalModelMemoryError('Cold capacity', 6144),
      )
      .mockImplementation(async (request) => {
        requests.push({
          context: request.notesBudget!.contextTokens,
          output: request.notesBudget!.outputTokens,
        });
        const packet = request.prompt
          .split('BEGIN SOURCE DATA')[1]!
          .split('END SOURCE DATA')[0]!;
        const rows = packet
          .trim()
          .split('\n')
          .map((row) => JSON.parse(row) as string[]);
        return JSON.stringify({
          title: { text: 'Laboratory observations', sources: [rows[0]![0]] },
          overview: {
            text: 'The observer reviewed recorded specimen measurements.',
            sources: [rows[0]![0]],
          },
          sections: [
            {
              title: 'Recorded measurements',
              items: rows.map((row) => ({
                kind: 'point',
                text: 'The observer recorded the measurements described for this specimen group.',
                owner: null,
                due: null,
                sources: [row[0]],
              })),
            },
          ],
        });
      });
    try {
      const analysis = await provider.generateStructuredAnalysis(
        '',
        '',
        'auto',
        { source },
      );
      expect(requests.length).toBeGreaterThan(1);
      expect(
        requests.every(
          (request) => request.context === 6144 && request.output === 2048,
        ),
      ).toBe(true);
      const spans = Object.values(
        analysis.generation_metadata!.source_provenance!.blocks,
      ).flatMap((block) => block.sources);
      for (const segment of source.segments) {
        const covered = spans
          .filter((span) => span.segment === segment.index)
          .sort((a, b) => a.start - b.start);
        let end = 0;
        for (const span of covered) {
          expect(span.start).toBeLessThanOrEqual(end);
          end = Math.max(end, span.end);
        }
        expect(end).toBe(segment.text.length);
      }
    } finally {
      generate.mockRestore();
    }
  });

  it.each([undefined, 16384, 32768])(
    'does not retry a refusal without a smaller context (%s)',
    async (maxContextTokens) => {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'gemma4:12b',
      });
      const refusal = new modelMemory.LocalModelMemoryError(
        'Capacity',
        maxContextTokens,
      );
      const generate = vi
        .spyOn(provider, 'generateText')
        .mockRejectedValue(refusal);
      try {
        await expect(
          provider.generateStructuredAnalysis(
            'Observer: The specimen is blue.',
            '',
            'auto',
          ),
        ).rejects.toBe(refusal);
        expect(generate).toHaveBeenCalledTimes(1);
      } finally {
        generate.mockRestore();
      }
    },
  );

  it('does not restart notes after a model response has already consumed the call budget', async () => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const refusal = new modelMemory.LocalModelMemoryError('Capacity', 6144);
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockResolvedValueOnce('not JSON')
      .mockRejectedValue(refusal);
    try {
      await expect(
        provider.generateStructuredAnalysis(
          'Observer: The specimen is blue.',
          '',
          'auto',
        ),
      ).rejects.toBe(refusal);
      expect(generate).toHaveBeenCalledTimes(2);
    } finally {
      generate.mockRestore();
    }
  });

  it('honors cancellation before memory repartitioning', async () => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    const controller = new AbortController();
    const cancelled = new Error('Stopped by user');
    const generate = vi
      .spyOn(provider, 'generateText')
      .mockImplementation(async () => {
        controller.abort(cancelled);
        throw new modelMemory.LocalModelMemoryError('Capacity', 6144);
      });
    try {
      await expect(
        provider.generateStructuredAnalysis(
          'Observer: The specimen is blue.',
          '',
          'auto',
          { signal: controller.signal },
        ),
      ).rejects.toBe(cancelled);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      generate.mockRestore();
    }
  });

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

  it('versions notes and source review cache identity as notes-v97', () => {
    expect(STRUCTURED_ANALYSIS_PROMPT_VERSION).toBe('notes-v97');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    geminiGetGenerativeModelMock.mockReset();
    geminiGenerateContentMock.mockReset();
  });

  afterEach(() => {
    setLocalTranscriptionModelUnloader();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('budgets enough output for the bounded terminology proposal list', () => {
    expect(
      calculateOllamaContextBudget('', 'terminologyReconciliation').num_predict,
    ).toBe(2048);
  });

  it('waits for native model unloading before sending a local generation request', async () => {
    let finishUnload!: () => void;
    const unload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
    );
    setLocalTranscriptionModelUnloader(unload);
    const request = installFetchMock(() =>
      jsonResponse({ response: '{}', done: true, done_reason: 'stop' }),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'fixture-model',
    });
    const generating = provider.synthesizeKnowledgeDocument(
      'Fictional source notes',
    );
    await vi.waitFor(() => expect(unload).toHaveBeenCalledOnce());
    expect(request).not.toHaveBeenCalled();
    finishUnload();
    await expect(generating).resolves.toBe('{}');
    expect(request).toHaveBeenCalledOnce();
  });

  it('uses configured ollama model directly', async () => {
    let selectedModel = '';
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toContain('/api/generate');
      const body = parseRequestBody(init);
      selectedModel = String(body.model);
      return jsonResponse({
        response: validAnalysisMarkdown,
        done: true,
        done_reason: 'stop',
      });
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
    let unloaded = false;
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          events.push(`unload:${String(body.model)}`);
          unloaded = true;
          return jsonResponse({ done: true });
        }
        events.push(`generate:${String(body.model)}`);
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        });
      },
      () => {
        events.push('discover');
        return jsonResponse({
          models: unloaded
            ? []
            : [{ name: ' gemma4:12b ' }, { model: 'GEMMA4:12B' }],
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
      'discover',
      'generate:phi4-mini:3.8b',
    ]);
  });

  it('waits for observed unload before starting the next model', async () => {
    let unloaded = false;
    let confirmUnload!: () => void;
    const confirmed = new Promise<void>((resolve) => {
      confirmUnload = resolve;
    });
    const events: string[] = [];
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          unloaded = true;
          events.push('unload:accepted');
          return jsonResponse({ done: true });
        }
        events.push('generate');
        return jsonResponse({ response: 'Ready', done: true });
      },
      async () => {
        if (!unloaded)
          return jsonResponse({ models: [{ name: 'gemma4:12b' }] });
        events.push('unload:checking');
        await confirmed;
        events.push('unload:confirmed');
        return jsonResponse({ models: [] });
      },
    );
    const answer = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    }).generateUserAnalysisMarkdown('Maya: Ready.');
    await vi.waitFor(() => expect(events).toContain('unload:checking'));
    expect(events).not.toContain('generate');
    confirmUnload();
    await expect(answer).resolves.toBe('Ready');
    expect(events).toEqual([
      'unload:accepted',
      'unload:checking',
      'unload:confirmed',
      'generate',
    ]);
  });

  it('refuses generation when an accepted unload cannot be verified', async () => {
    let unloaded = false;
    const fetchMock = installFetchMock(
      (_url, init) => {
        expect(parseRequestBody(init).keep_alive).toBe(0);
        unloaded = true;
        return jsonResponse({ done: true });
      },
      () =>
        unloaded
          ? jsonResponse({ models: 'invalid' })
          : jsonResponse({ models: [{ name: 'gemma4:12b' }] }),
    );
    await expect(
      new UnifiedLLMProvider('ollama', {
        ollama_model: 'phi4-mini:3.8b',
      }).generateUserAnalysisMarkdown('Maya: Ready.'),
    ).rejects.toThrow('ollama_residency_cleanup_failed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retains matching Ollama residency before generation', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        requestBodies.push(body);
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        });
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
      keep_alive: '2h',
    });
  });

  it('fails closed when Ollama residency discovery fails', async () => {
    const fetchMock = installFetchMock(
      () =>
        jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        }),
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
      () =>
        jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        }),
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
    let firstUnloaded = false;
    let generationStarted = false;
    const fetchMock = installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive !== 0) {
          generationStarted = true;
          return jsonResponse({
            response: validAnalysisMarkdown,
            done: true,
            done_reason: 'stop',
          });
        }
        unloadCalls += 1;
        if (unloadCalls === 1) {
          return new Promise<Response>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              firstUnloaded = true;
              resolve(jsonResponse({ done: true }));
            }, 25_000);
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
          models: [
            ...(firstUnloaded ? [] : [{ name: 'gemma4:12b' }]),
            { name: 'qwen3.5:9b' },
          ],
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

  it('gives rich project profiles enough output room while keeping ordinary scope reviews bounded', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    installFetchMock((_url, init) => {
      bodies.push(parseRequestBody(init));
      return jsonResponse({ response: '{}', done: true, done_reason: 'stop' });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    await provider.synthesizeKnowledgeDocument('Profile source evidence', {
      purpose: 'projectScope',
      budget: { contextTokens: 32768, outputTokens: 8192 },
    });
    expect(bodies[0]).toMatchObject({
      options: { num_ctx: 9216, num_predict: 8192 },
      think: false,
    });
    await provider.synthesizeKnowledgeDocument('Ordinary scope review', {
      purpose: 'projectScope',
    });
    expect(bodies[1]).toMatchObject({ options: { num_predict: 2500 } });
    await expect(
      provider.synthesizeKnowledgeDocument('X'.repeat(40000), {
        purpose: 'projectScope',
        budget: { contextTokens: 32768, outputTokens: 8192 },
      }),
    ).rejects.toThrow('notes_context_exhausted');
    expect(bodies).toHaveLength(2);
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

  it('keeps project review behind notes while chat can preempt notes', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const fetchMock = installFetchMock((_url, init) => {
      if (signals.length)
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        });
      signals.push(init!.signal!);
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
    const notes = (
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
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      review = provider.synthesizeKnowledgeDocument('review', {
        purpose: 'projectScope',
        signal: controller.signal,
      });
      await Promise.resolve();
      expect(signals[0].aborted).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        provider.answerAskPluto('question', { mode: 'fast' }),
      ).resolves.toBe(validAnalysisMarkdown);
      await expect(notes).resolves.toMatchObject({
        name: 'AbortError',
        message: 'foreground_preempted',
      });
      await expect(review).resolves.toBe(validAnalysisMarkdown);
    } finally {
      controller.abort();
      await Promise.allSettled([notes, review]);
    }
  });

  it('uses configured Fast and Deep models while preserving mode budgets', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock((_url, init) => {
      requestBodies.push(parseRequestBody(init));
      return jsonResponse({
        response: 'Grounded answer',
        done: true,
        done_reason: 'stop',
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-analysis-model',
      ollama_fast_model: 'configured-fast-model',
    });

    await provider.answerAskPluto('Who owns this?', { mode: 'fast' });
    await provider.answerAskPluto('Compare these meetings', { mode: 'deep' });

    expect(requestBodies[0]).toMatchObject({
      model: 'configured-fast-model',
      think: false,
    });
    expect(requestBodies[0].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 768,
      draft_num_predict: 0,
    });
    expect(requestBodies[1]).toMatchObject({
      model: 'configured-analysis-model',
      think: false,
    });
    expect(requestBodies[1].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 1024,
      draft_num_predict: 0,
      top_k: 40,
      top_p: 1,
    });
  });

  it('uses a larger JSON budget for structured deep prep requests', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      requestBody = parseRequestBody(init);
      return jsonResponse({
        response: '{"overview":[]}',
        done: true,
        done_reason: 'stop',
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });

    await provider.answerAskPluto('Prepare this meeting', {
      mode: 'deep',
      jsonMode: true,
    });

    expect(requestBody.format).toBe('json');
    expect(requestBody.options).toMatchObject({
      num_ctx: 4096,
      num_predict: 1024,
    });
  });

  it('uses a bounded non-thinking Ollama request for live Ask Pluto', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      requestBody = parseRequestBody(init);
      return jsonResponse({
        message: { content: 'Live answer' },
        done: true,
        done_reason: 'stop',
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });

    const responseSchema = {
      type: 'object',
      properties: { points: { type: 'array' } },
    };
    await provider.answerAskPluto('What are we discussing?', {
      live: true,
      jsonMode: true,
      responseSchema,
    });

    expect(requestBody.think).toBe(false);
    expect(requestBody.format).toEqual(responseSchema);
    expect(requestBody.options).toMatchObject({
      num_ctx: 4096,
      num_predict: 768,
    });
  });

  it('uses plain text without JSON grammar for live answer editing', async () => {
    let requestBody: Record<string, unknown> = {};
    installFetchMock((_url, init) => {
      requestBody = parseRequestBody(init);
      return jsonResponse({
        message: { content: 'Revised answer' },
        done: true,
        done_reason: 'stop',
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    await provider.answerAskPluto('Edit this grounded answer as plain text.', {
      live: true,
      jsonMode: false,
    });
    expect(requestBody.format).toBeUndefined();
    expect(JSON.stringify(requestBody.messages)).toContain(
      'requested output format',
    );
    expect(JSON.stringify(requestBody.messages)).not.toContain(
      'requested JSON format',
    );
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
                  `${JSON.stringify({ message: { content: 'Complete answer.' }, done: true })}\n`,
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

  describe('local Ask Pluto streaming deadlines', () => {
    function delayedStream(
      packets: Array<{ at: number; response: string; done?: boolean }>,
    ) {
      const encoder = new TextEncoder();
      installFetchMock(
        (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                const timers = packets.map((packet) =>
                  setTimeout(() => {
                    controller.enqueue(
                      encoder.encode(
                        `${JSON.stringify({ response: packet.response, done: packet.done === true })}\n`,
                      ),
                    );
                    if (packet.done) controller.close();
                  }, packet.at),
                );
                const abort = () => {
                  timers.forEach(clearTimeout);
                  controller.error(init?.signal?.reason);
                };
                init?.signal?.addEventListener('abort', abort, { once: true });
              },
            }),
            { status: 200 },
          ),
      );
      return new UnifiedLLMProvider('ollama', { ollama_model: 'qwen3.5:9b' });
    }

    it.each(['fast', 'deep'] as const)(
      'keeps a progressing %s answer alive beyond 90 seconds',
      async (mode) => {
        vi.useFakeTimers();
        const provider = delayedStream([
          { at: 75_000, response: 'First ' },
          { at: 95_000, response: 'second ' },
          { at: 110_000, response: 'complete.', done: true },
        ]);
        const onToken = vi.fn();
        const outcome = provider
          .answerAskPluto('Fictional evidence question', { mode, onToken })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        await vi.advanceTimersByTimeAsync(75_000);
        expect(onToken).toHaveBeenCalledWith('First ');
        await vi.advanceTimersByTimeAsync(35_000);
        await expect(outcome).resolves.toEqual({
          value: 'First second complete.',
        });
      },
    );

    it('times out deep generation that remains silent during the startup allowance', async () => {
      vi.useFakeTimers();
      const provider = delayedStream([]);
      const outcome = provider
        .answerAskPluto('Fictional evidence question', {
          mode: 'deep',
          onToken: vi.fn(),
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(outcome).resolves.toMatchObject({
        error: expect.objectContaining({ name: 'TimeoutError' }),
      });
    });

    it('times out a deep stream that becomes silent after a token', async () => {
      vi.useFakeTimers();
      const provider = delayedStream([{ at: 75_000, response: 'First ' }]);
      const onToken = vi.fn();
      const outcome = provider
        .answerAskPluto('Fictional evidence question', {
          mode: 'deep',
          onToken,
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await vi.advanceTimersByTimeAsync(75_000);
      expect(onToken).toHaveBeenCalledWith('First ');
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(outcome).resolves.toMatchObject({
        error: expect.objectContaining({ name: 'TimeoutError' }),
      });
    });

    it('preserves caller cancellation after deep streaming starts', async () => {
      vi.useFakeTimers();
      const provider = delayedStream([{ at: 75_000, response: 'First ' }]);
      const controller = new AbortController();
      const onToken = vi.fn();
      const outcome = provider
        .answerAskPluto('Fictional evidence question', {
          mode: 'deep',
          signal: controller.signal,
          onToken,
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await vi.advanceTimersByTimeAsync(75_000);
      expect(onToken).toHaveBeenCalledWith('First ');
      controller.abort(new DOMException('cancelled', 'AbortError'));
      await expect(outcome).resolves.toMatchObject({
        error: expect.objectContaining({
          name: 'AbortError',
          message: 'cancelled',
        }),
      });
    });
  });

  it('reports when an Ask Pluto request is admitted to the provider', async () => {
    installFetchMock(() =>
      jsonResponse({
        response: 'Grounded answer',
        done: true,
        done_reason: 'stop',
      }),
    );
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
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preempts active dreaming for foreground meeting analysis', async () => {
    let generationCalls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      generationCalls += 1;
      if (generationCalls > 1) {
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lets foreground inference preempt serialized dreaming cleanup', async () => {
    let calls = 0;
    const fetchMock = installFetchMock((_url, init) => {
      calls += 1;
      if (calls > 1)
        return jsonResponse({
          response: 'Ready',
          done: true,
          done_reason: 'stop',
        });
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
          done: true,
          done_reason: 'stop',
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

  it.each(['fast', 'deep'] as const)(
    'does not substitute another role after a configured %s model fails',
    async (mode) => {
      const requested: string[] = [];
      installFetchMock((_url, init) => {
        requested.push(String(parseRequestBody(init).model));
        return jsonResponse({}, false, 'Unavailable');
      });
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'configured-analysis-model',
        ollama_fast_model: 'configured-fast-model',
      });
      await expect(
        provider.answerAskPluto('Fictional question', { mode }),
      ).rejects.toThrow('Unavailable');
      expect(requested).toEqual([
        mode === 'fast' ? 'configured-fast-model' : 'configured-analysis-model',
      ]);
    },
  );

  it('uses Phi for saved Fast and active chat while keeping Gemma for Deep', async () => {
    const selectedModels: string[] = [];
    let resident = true;
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
        if (url.endsWith('/api/generate') || url.endsWith('/api/chat')) {
          const body = parseRequestBody(init);
          selectedModels.push(String(body.model));
          if (body.keep_alive === 0) resident = false;
          return jsonResponse({
            response: 'Grounded answer',
            done: true,
            done_reason: 'stop',
            message: { content: 'Grounded answer' },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      () => jsonResponse({ models: resident ? [{ name: 'gemma4:12b' }] : [] }),
    );

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.answerAskPluto('Who owns this?', { mode: 'fast' });
    await provider.answerAskPluto('Compare these meetings', { mode: 'deep' });
    await provider.answerAskPluto('What are we discussing?', { live: true });

    expect(selectedModels).toEqual([
      'gemma4:12b',
      'phi4-mini:3.8b',
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
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        });
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
        return jsonResponse({
          response: validAnalysisMarkdown,
          done: true,
          done_reason: 'stop',
        });
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
      num_ctx: 4096,
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

  it.each(['askPluto', 'askPlutoDeep'])(
    'fits full project notes and a complete answer within the %s context budget',
    (task) => {
      const prompt = 'Evidence and instructions. '
        .repeat(1200)
        .slice(0, 32_000);
      const budget = calculateOllamaContextBudget(prompt, task);
      expect(budget.num_ctx).toBeLessThanOrEqual(12288);
      expect(budget.num_ctx).toBeGreaterThanOrEqual(
        Math.ceil(prompt.length / 3) + budget.num_predict,
      );
      expect(budget.num_predict).toBe(task === 'askPluto' ? 768 : 1024);
    },
  );

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

it.each(['recovered', 'pressure', 'cancelled'] as const)(
  'shares the bounded page-reclaim wait after idle cleanup across providers: %s',
  async (outcome) => {
    const electron = Object.getOwnPropertyDescriptor(
      process.versions,
      'electron',
    );
    Object.defineProperty(process.versions, 'electron', {
      value: 'test',
      configurable: true,
    });
    const watcher = vi
      .spyOn(modelMemory, 'watchLocalModelMemory')
      .mockReturnValue({
        signal: new AbortController().signal,
        start: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
        setResidentCheck: vi.fn(),
      });
    let resident = false;
    let unloaded = false;
    let lowReads = 0;
    let generations = 0;
    const controller = new AbortController();
    const memory = vi
      .spyOn(modelMemory, 'readLocalModelMemory')
      .mockImplementation(async () => {
        const low = unloaded && (outcome !== 'recovered' || lowReads === 0);
        if (low) {
          lowReads++;
          if (outcome === 'cancelled') controller.abort();
        }
        return { available: (low ? 7 : 14) * 1024 ** 3, total: 16 * 1024 ** 3 };
      });
    const http = vi
      .spyOn(ollamaTransport, 'ollamaHttpFetch')
      .mockImplementation(async (url, init) => {
        if (url.endsWith('/api/ps'))
          return jsonResponse({
            models: resident
              ? [
                  {
                    name: 'phi4-mini:3.8b',
                    digest: 'phi-test',
                    context_length: 4096,
                  },
                ]
              : [],
          });
        if (url.endsWith('/api/tags'))
          return jsonResponse({
            models: [
              {
                name: 'phi4-mini:3.8b',
                digest: 'phi-test',
                size: 3 * 1024 ** 3,
              },
            ],
          });
        if (parseRequestBody(init).keep_alive === 0) {
          resident = false;
          unloaded = true;
          return jsonResponse({ done: true });
        }
        resident = true;
        generations++;
        return jsonResponse({
          response: 'Fictional answer.',
          done: true,
          done_reason: 'stop',
        });
      });
    const stream = vi
      .spyOn(ollamaTransport, 'ollamaHttpStream')
      .mockImplementation(async (_url, _init, onChunk) => {
        resident = true;
        generations++;
        onChunk(
          `${JSON.stringify({ response: 'Fictional answer.', done: true, done_reason: 'stop' })}\n`,
        );
        return { ok: true, status: 200, statusText: 'OK' };
      });
    try {
      const first = new UnifiedLLMProvider('ollama', {
        ollama_fast_model: 'phi4-mini:3.8b',
      });
      await first.answerAskPluto('A fictional question.', { mode: 'fast' });
      await releaseIdleOllamaModel(0);
      expect(resident).toBe(false);
      const second = new UnifiedLLMProvider('ollama', {
        ollama_fast_model: 'phi4-mini:3.8b',
      });
      const answer = second.answerAskPluto('A fictional follow-up.', {
        mode: 'fast',
        signal: controller.signal,
      });
      if (outcome === 'recovered')
        await expect(answer).resolves.toBe('Fictional answer.');
      else if (outcome === 'pressure')
        await expect(answer).rejects.toThrow('Not enough memory');
      else await expect(answer).rejects.toThrow();
      expect(lowReads).toBeGreaterThan(0);
      expect(generations).toBe(outcome === 'recovered' ? 2 : 1);
    } finally {
      await releaseIdleOllamaModel(0);
      memory.mockRestore();
      watcher.mockRestore();
      http.mockRestore();
      stream.mockRestore();
      if (electron)
        Object.defineProperty(process.versions, 'electron', electron);
      else Reflect.deleteProperty(process.versions, 'electron');
    }
  },
);

it.each([
  { residentContext: 8192, expectedContext: 8192, unload: false },
  { residentContext: 16384, expectedContext: 2048, unload: true },
  { residentContext: 1024, expectedContext: 2048, unload: true },
  { residentContext: undefined, expectedContext: 2048, unload: false },
])(
  'reuses only a resident context within the request cap: $residentContext',
  async ({ residentContext, expectedContext, unload }) => {
    let resident = residentContext !== undefined;
    const events: string[] = [];
    const fetchMock = installFetchMock(
      (_url, init) => {
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          events.push('unload');
          resident = false;
          return jsonResponse({ done: true });
        }
        events.push('generate');
        return new Response(
          `${JSON.stringify({ done: true, done_reason: 'stop', message: { content: '{}' } })}\n`,
        );
      },
      () =>
        jsonResponse({
          models: resident
            ? [{ name: 'phi4-mini:3.8b', context_length: residentContext }]
            : [],
        }),
    );
    try {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'phi4-mini:3.8b',
      });
      await provider.generateText({
        prompt: 'Milo discussed access.',
        task: 'notesWriter',
        notesModel: 'phi4-mini:3.8b',
        notesBudget: { contextTokens: 8192, outputTokens: 1024 },
      });
      const generated = fetchMock.mock.calls
        .map(([, init]) => parseRequestBody(init))
        .find((body) => body.keep_alive !== 0)!;
      expect(generated.options).toMatchObject({
        num_ctx: expectedContext,
        num_predict: 1024,
      });
      expect(events).toEqual(unload ? ['unload', 'generate'] : ['generate']);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it('requires cold-load capacity after unloading an undersized resident context', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    'electron',
  );
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  const transport = vi
    .spyOn(ollamaTransport, 'ollamaHttpFetch')
    .mockImplementation((input, init) => fetch(input, init));
  const memory = vi
    .spyOn(modelMemory, 'readLocalModelMemory')
    .mockResolvedValue({ available: 6 * 1024 ** 3, total: 16 * 1024 ** 3 });
  const capacity = vi.spyOn(modelMemory, 'assertLocalModelMemoryCapacity');
  let resident = true;
  const events: string[] = [];
  installFetchMock(
    (url, init) => {
      if (url.endsWith('/api/tags'))
        return jsonResponse({
          models: [{ name: 'phi4-mini:3.8b', size: 2 * 1024 ** 3 }],
        });
      expect(parseRequestBody(init).keep_alive).toBe(0);
      events.push('unload');
      resident = false;
      return jsonResponse({ done: true });
    },
    () =>
      jsonResponse({
        models: resident
          ? [{ name: 'phi4-mini:3.8b', context_length: 1024 }]
          : [],
      }),
  );
  try {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    await expect(
      provider.generateText({
        prompt: 'Milo discussed access.',
        task: 'notesWriter',
        notesModel: 'phi4-mini:3.8b',
        notesBudget: { contextTokens: 8192, outputTokens: 1024 },
      }),
    ).rejects.toThrow('Not enough memory');
    expect(capacity).toHaveBeenCalledWith(
      expect.objectContaining({ resident: false, contextTokens: 2048 }),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
  } finally {
    memory.mockRestore();
    capacity.mockRestore();
    transport.mockRestore();
    vi.unstubAllGlobals();
    if (descriptor)
      Object.defineProperty(process.versions, 'electron', descriptor);
    else Reflect.deleteProperty(process.versions, 'electron');
  }
});

it.each([
  { coldFreeGiB: 14, allowed: true, cleanupFails: false },
  { coldFreeGiB: 14, allowed: true, cleanupFails: true },
  { coldFreeGiB: 7, allowed: false, cleanupFails: false },
])(
  'rechecks cold-load admission after reclaiming a resident model: $allowed',
  async ({ coldFreeGiB, allowed, cleanupFails }) => {
    const nativeWatcher = vi
      .spyOn(modelMemory, 'watchLocalModelMemory')
      .mockReturnValue({
        signal: new AbortController().signal,
        start: vi.fn(async () => {}),
        dispose: vi.fn(async () => {
          if (cleanupFails) throw new Error('monitor cleanup failed');
        }),
        setResidentCheck: vi.fn(),
      });
    const originalElectron = Object.getOwnPropertyDescriptor(
      process.versions,
      'electron',
    );
    Object.defineProperty(process.versions, 'electron', {
      value: 'test',
      configurable: true,
    });
    const transport = vi
      .spyOn(ollamaTransport, 'ollamaHttpFetch')
      .mockImplementation((input, init) => fetch(input, init));
    let resident = true;
    const events: string[] = [];
    const memory = vi
      .spyOn(modelMemory, 'readLocalModelMemory')
      .mockResolvedValueOnce({
        available: 4.01 * 1024 ** 3,
        total: 16 * 1024 ** 3,
      })
      .mockResolvedValue({
        available: coldFreeGiB * 1024 ** 3,
        total: 16 * 1024 ** 3,
      });
    installFetchMock(
      (url, init) => {
        if (url.endsWith('/api/tags'))
          return jsonResponse({
            models: [{ name: 'phi4-mini:3.8b', size: 3 * 1024 ** 3 }],
          });
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          events.push('unload');
          resident = false;
          return jsonResponse({ done: true });
        }
        events.push('generate');
        return jsonResponse({
          response: 'Saved context.',
          done: true,
          done_reason: 'stop',
        });
      },
      () =>
        jsonResponse({ models: resident ? [{ name: 'phi4-mini:3.8b' }] : [] }),
    );
    try {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'phi4-mini:3.8b',
      });
      const generation = provider.generateUserAnalysisMarkdown(
        'Maya: Saved context.',
      );
      if (cleanupFails)
        await expect(generation).rejects.toThrow('monitor cleanup failed');
      else if (allowed) await generation;
      else await expect(generation).rejects.toThrow('Not enough memory');
      expect(events[0]).toBe('unload');
      if (cleanupFails) expect(events.at(-1)).toBe('unload');
      expect(events.filter((event) => event === 'generate')).toHaveLength(
        allowed ? 1 : 0,
      );
      if (allowed) expect(memory).toHaveBeenCalledTimes(2);
      else expect(memory.mock.calls.length).toBeGreaterThan(2);
    } finally {
      nativeWatcher.mockRestore();
      memory.mockRestore();
      transport.mockRestore();
      vi.unstubAllGlobals();
      if (originalElectron)
        Object.defineProperty(process.versions, 'electron', originalElectron);
      else Reflect.deleteProperty(process.versions, 'electron');
    }
  },
);

it.each([
  {
    context: 2048,
    digestMatches: true,
    nameMatches: true,
    statusOk: true,
    verified: true,
  },
  {
    context: 1024,
    digestMatches: true,
    nameMatches: true,
    statusOk: true,
    verified: false,
  },
  {
    context: 8192,
    digestMatches: true,
    nameMatches: true,
    statusOk: true,
    verified: false,
  },
  {
    context: 2048,
    digestMatches: false,
    nameMatches: true,
    statusOk: true,
    verified: false,
  },
  {
    context: 2048,
    digestMatches: true,
    nameMatches: false,
    statusOk: true,
    verified: false,
  },
  {
    context: 2048,
    digestMatches: true,
    nameMatches: true,
    statusOk: false,
    verified: false,
  },
])(
  'qualifies watchdog steady state only for exact model artifact and active context ($context, $digestMatches, $nameMatches, $statusOk)',
  async ({ context, digestMatches, nameMatches, statusOk, verified }) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      process.versions,
      'electron',
    );
    Object.defineProperty(process.versions, 'electron', {
      value: 'test',
      configurable: true,
    });
    const digest =
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
    let probe: (() => Promise<boolean>) | undefined;
    let generating = false;
    const watcher = vi
      .spyOn(modelMemory, 'watchLocalModelMemory')
      .mockReturnValue({
        signal: new AbortController().signal,
        dispose: vi.fn(async () => {}),
        start: vi.fn(async () => {}),
        setResidentCheck: vi.fn((modelDigest, check) => {
          expect(modelDigest).toBe(digest);
          probe = check;
        }),
      });
    const transport = vi
      .spyOn(ollamaTransport, 'ollamaHttpFetch')
      .mockImplementation((input, init) => fetch(input, init));
    const memory = vi
      .spyOn(modelMemory, 'readLocalModelMemory')
      .mockResolvedValue({ available: 14 * 1024 ** 3, total: 16 * 1024 ** 3 });
    const stream = vi
      .spyOn(ollamaTransport, 'ollamaHttpStream')
      .mockImplementation(async (_url, _init, onChunk) => {
        generating = true;
        expect(probe).toBeDefined();
        await expect(probe!()).resolves.toBe(verified);
        onChunk(
          `${JSON.stringify({
            response: 'Done.',
            message: { content: 'Done.' },
            done: true,
          })}\n`,
        );
        return { ok: true, status: 200, statusText: 'OK' };
      });
    installFetchMock(
      (url) => {
        expect(url.endsWith('/api/tags')).toBe(true);
        return jsonResponse({
          models: [{ name: 'gemma4:12b', size: 7_556_508_396, digest }],
        });
      },
      () =>
        generating
          ? jsonResponse(
              {
                models: [
                  {
                    name: nameMatches ? 'gemma4:12b' : 'other-model',
                    digest: digestMatches ? digest : 'other-digest',
                    context_length: context,
                  },
                ],
              },
              statusOk,
            )
          : jsonResponse({ models: [] }),
    );
    try {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'gemma4:12b',
      });
      await expect(
        provider.generateText({
          prompt: 'A short meeting.',
          task: 'notesWriter',
          notesModel: 'gemma4:12b',
          notesBudget: { contextTokens: 8192, outputTokens: 1024 },
        }),
      ).resolves.toBe('Done.');
    } finally {
      watcher.mockRestore();
      transport.mockRestore();
      memory.mockRestore();
      stream.mockRestore();
      vi.unstubAllGlobals();
      if (descriptor)
        Object.defineProperty(process.versions, 'electron', descriptor);
      else Reflect.deleteProperty(process.versions, 'electron');
    }
  },
);

it.each([
  {
    task: 'title' as const,
    residentContext: null,
    repeat: true,
    expectedContext: 2048,
    output: 64,
    unload: false,
  },
  {
    task: 'title' as const,
    residentContext: 7168,
    expectedContext: 7168,
    output: 64,
    unload: false,
  },
  {
    task: 'valueSignals' as const,
    residentContext: null,
    expectedContext: 3072,
    output: 2500,
    unload: false,
  },
  {
    task: 'valueSignals' as const,
    residentContext: 7168,
    expectedContext: 7168,
    output: 2500,
    unload: false,
  },
  {
    task: 'title' as const,
    residentContext: 512,
    expectedContext: 2048,
    output: 64,
    unload: true,
  },
  {
    task: 'title' as const,
    residentContext: 20000,
    expectedContext: 2048,
    output: 64,
    unload: true,
  },
])(
  'keeps Gemma secondary allocation bounded and starts its watcher only after admission ($task, $residentContext)',
  async (row) => {
    const { task, residentContext, expectedContext, output, unload } = row;
    const descriptor = Object.getOwnPropertyDescriptor(
      process.versions,
      'electron',
    );
    Object.defineProperty(process.versions, 'electron', {
      value: 'test',
      configurable: true,
    });
    const start = vi.fn(async () => {});
    const digest =
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
    const watcher = vi
      .spyOn(modelMemory, 'watchLocalModelMemory')
      .mockReturnValue({
        signal: new AbortController().signal,
        dispose: vi.fn(async () => {}),
        setResidentCheck: vi.fn(),
        start,
      });
    const originalCapacity = modelMemory.assertLocalModelMemoryCapacity;
    const capacity = vi
      .spyOn(modelMemory, 'assertLocalModelMemoryCapacity')
      .mockImplementation((input) => {
        expect(start).not.toHaveBeenCalled();
        originalCapacity(input);
      });
    const memory = vi
      .spyOn(modelMemory, 'readLocalModelMemory')
      .mockResolvedValue({ available: 14 * 1024 ** 3, total: 16 * 1024 ** 3 });
    let context: number | null = residentContext;
    let unloaded = false;
    let options: unknown;
    const transport = vi
      .spyOn(ollamaTransport, 'ollamaHttpFetch')
      .mockImplementation(async (url, init) => {
        if (url.endsWith('/api/ps'))
          return jsonResponse({
            models:
              context === null
                ? []
                : [{ name: 'gemma4:12b', context_length: context, digest }],
          });
        if (url.endsWith('/api/tags'))
          return jsonResponse({
            models: [{ name: 'gemma4:12b', size: 7_556_508_396, digest }],
          });
        const body = parseRequestBody(init);
        if (body.keep_alive === 0) {
          context = null;
          unloaded = true;
          return jsonResponse({ done: true });
        }
        expect(start).toHaveBeenCalledOnce();
        options = body.options;
        context = Math.max(
          2048,
          Number((options as { num_ctx: number }).num_ctx),
        );
        return jsonResponse({ response: 'Done.' });
      });
    const stream = vi
      .spyOn(ollamaTransport, 'ollamaHttpStream')
      .mockImplementation(async (_url, init, onChunk) => {
        expect(start).toHaveBeenCalledOnce();
        options = parseRequestBody(init).options;
        context = Math.max(
          2048,
          Number((options as { num_ctx: number }).num_ctx),
        );
        onChunk(
          `${JSON.stringify({
            response: 'Done.',
            message: { content: 'Done.' },
            done: true,
          })}\n`,
        );
        return { ok: true, status: 200, statusText: 'OK' };
      });
    try {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'gemma4:12b',
      });
      // Prior successful same-provider residency; external first use is tested below.
      if (residentContext !== null)
        (
          provider as unknown as {
            establishedGemmaAllocation: {
              model: string;
              contextTokens: number;
            };
          }
        ).establishedGemmaAllocation = {
          model: 'gemma4:12b',
          contextTokens: residentContext,
        };
      await expect(
        provider.generateText({ prompt: 'A short meeting.', task }),
      ).resolves.toBe('Done.');
      expect(options).toMatchObject({
        num_ctx: expectedContext,
        num_predict: output,
        num_batch: 128,
        draft_num_predict: 0,
      });
      expect(unloaded).toBe(unload);
      expect(capacity).toHaveBeenCalledWith(
        expect.objectContaining({
          resident: residentContext !== null && !unload,
          contextTokens: expectedContext,
        }),
      );
      if ('repeat' in row && row.repeat) {
        start.mockClear();
        capacity.mockClear();
        await expect(
          provider.generateText({ prompt: 'Another short meeting.', task }),
        ).resolves.toBe('Done.');
        expect(unloaded).toBe(false);
        expect(options).toMatchObject({ num_ctx: 2048, num_predict: output });
        expect(capacity).toHaveBeenCalledWith(
          expect.objectContaining({ resident: true, contextTokens: 2048 }),
        );
        start.mockClear();
        capacity.mockClear();
        await expect(
          provider.generateText({
            prompt: 'Small.',
            task: 'notesWriter',
            notesModel: 'gemma4:12b',
            notesBudget: { contextTokens: 1024, outputTokens: 64 },
          }),
        ).rejects.toThrow('notes_input_overflow');
        expect(start).not.toHaveBeenCalled();
        expect(capacity).not.toHaveBeenCalled();
        expect(unloaded).toBe(true);
      }
    } finally {
      watcher.mockRestore();
      capacity.mockRestore();
      memory.mockRestore();
      transport.mockRestore();
      stream.mockRestore();
      if (descriptor)
        Object.defineProperty(process.versions, 'electron', descriptor);
      else Reflect.deleteProperty(process.versions, 'electron');
    }
  },
);

it.each([
  { outcome: 'recovered' },
  { outcome: 'timeout' },
  { outcome: 'aborted' },
  { outcome: 'resident-again' },
])(
  'waits only for memory released by a confirmed unload ($outcome)',
  async ({ outcome }) => {
    const nativeWatcher = vi
      .spyOn(modelMemory, 'watchLocalModelMemory')
      .mockReturnValue({
        signal: new AbortController().signal,
        start: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
        setResidentCheck: vi.fn(),
      });
    vi.useFakeTimers();
    const descriptor = Object.getOwnPropertyDescriptor(
      process.versions,
      'electron',
    );
    Object.defineProperty(process.versions, 'electron', {
      value: 'test',
      configurable: true,
    });
    const controller = new AbortController();
    const digest =
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
    let resident = true;
    let reads = 0;
    let generates = 0;
    let emptyChecks = 0;
    let reappeared = false;
    const memory = vi
      .spyOn(modelMemory, 'readLocalModelMemory')
      .mockImplementation(async () => ({
        available:
          (++reads === 1 ? 3 : outcome === 'recovered' && reads >= 3 ? 14 : 8) *
          1024 ** 3,
        total: 16 * 1024 ** 3,
      }));
    const transport = vi
      .spyOn(ollamaTransport, 'ollamaHttpFetch')
      .mockImplementation(async (url, init) => {
        if (url.endsWith('/api/ps')) {
          if (
            !resident &&
            ++emptyChecks >= 3 &&
            outcome === 'resident-again' &&
            !reappeared
          ) {
            resident = true;
            reappeared = true;
          }
          return jsonResponse({
            models: resident
              ? [{ name: 'gemma4:12b', context_length: 7168, digest }]
              : [],
          });
        }
        if (url.endsWith('/api/tags'))
          return jsonResponse({
            models: [{ name: 'gemma4:12b', size: 7_556_508_396, digest }],
          });
        if (parseRequestBody(init).keep_alive === 0) {
          resident = false;
          return jsonResponse({ done: true });
        }
        generates++;
        return jsonResponse({ response: 'Done.', done: true });
      });
    try {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: 'gemma4:12b',
      });
      // Exercise reclamation from a previously confirmed same-provider allocation.
      (
        provider as unknown as {
          establishedGemmaAllocation: { model: string; contextTokens: number };
        }
      ).establishedGemmaAllocation = {
        model: 'gemma4:12b',
        contextTokens: 7168,
      };
      const result = provider
        .generateText({
          prompt: 'Short meeting.',
          task: 'title',
          signal: controller.signal,
        })
        .then(
          () => 'generated',
          (error: Error) => error.name,
        );
      if (outcome === 'aborted')
        setTimeout(
          () => controller.abort(new DOMException('cancelled', 'AbortError')),
          50,
        );
      await vi.advanceTimersByTimeAsync(2_200);
      expect(await result).toBe(
        outcome === 'recovered'
          ? 'generated'
          : outcome === 'aborted'
            ? 'AbortError'
            : 'LocalModelMemoryError',
      );
      expect(generates).toBe(outcome === 'recovered' ? 1 : 0);
      if (outcome === 'recovered') expect(reads).toBe(3);
      if (outcome === 'timeout') expect(reads).toBeLessThanOrEqual(23);
    } finally {
      nativeWatcher.mockRestore();
      memory.mockRestore();
      transport.mockRestore();
      vi.useRealTimers();
      if (descriptor)
        Object.defineProperty(process.versions, 'electron', descriptor);
      else Reflect.deleteProperty(process.versions, 'electron');
    }
  },
);

it('unloads externally resident Gemma before POST then reuses bounded placement across writer audit and secondary tasks', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const totalMemory = vi.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);
  const descriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    'electron',
  );
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  const digest =
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
  const memory = vi
    .spyOn(modelMemory, 'readLocalModelMemory')
    .mockResolvedValue({ available: 14 * 1024 ** 3, total: 16 * 1024 ** 3 });
  const capacity = vi.spyOn(modelMemory, 'assertLocalModelMemoryCapacity');
  let releaseMonitor!: () => void;
  const monitorReady = new Promise<void>((resolve) => {
    releaseMonitor = resolve;
  });
  const startMonitor = vi.fn(async () => {
    await monitorReady;
  });
  const watcher = vi
    .spyOn(modelMemory, 'watchLocalModelMemory')
    .mockImplementation(() => ({
      signal: new AbortController().signal,
      start: startMonitor,
      dispose: vi.fn(async () => {}),
      setResidentCheck: vi.fn(),
    }));
  let context: number | null = 7168;
  let unloads = 0;
  const options: Record<string, unknown>[] = [];
  const accept = (init?: RequestInit) => {
    const body = parseRequestBody(init);
    const requestOptions = body.options as Record<string, unknown>;
    options.push(requestOptions);
    context = Number(requestOptions.num_ctx);
  };
  const transport = vi
    .spyOn(ollamaTransport, 'ollamaHttpFetch')
    .mockImplementation(async (url, init) => {
      if (url.endsWith('/api/ps'))
        return jsonResponse({
          models:
            context === null
              ? []
              : [{ name: 'gemma4:12b', digest, context_length: context }],
        });
      if (url.endsWith('/api/tags'))
        return jsonResponse({
          models: [{ name: 'gemma4:12b', digest, size: 7_556_508_396 }],
        });
      if (parseRequestBody(init).keep_alive === 0) {
        unloads++;
        context = null;
        return jsonResponse({ done: true });
      }
      accept(init);
      return jsonResponse({ response: 'Done.', done: true });
    });
  const stream = vi
    .spyOn(ollamaTransport, 'ollamaHttpStream')
    .mockImplementation(async (_url, init, onChunk) => {
      accept(init);
      onChunk(
        `${JSON.stringify({
          response: 'Done.',
          message: { content: 'Done.' },
          done: true,
        })}\n`,
      );
      return { ok: true, status: 200, statusText: 'OK' };
    });
  try {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    for (const task of ['notesWriter', 'notesAudit'] as const) {
      const generated = provider.generateText({
        prompt: 'Fictional meeting. '.repeat(550),
        task,
        notesModel: 'gemma4:12b',
        notesBudget: { contextTokens: 8192, outputTokens: 2048 },
      });
      if (task === 'notesWriter') {
        await vi.waitFor(() => expect(startMonitor).toHaveBeenCalledOnce());
        expect(options).toHaveLength(0);
        expect(unloads).toBe(1);
        expect(capacity).toHaveBeenCalledWith(
          expect.objectContaining({ resident: false, contextTokens: 7168 }),
        );
        releaseMonitor();
      }
      await expect(generated).resolves.toBe('Done.');
    }
    for (const task of ['title', 'valueSignals'] as const)
      await expect(
        provider.generateText({ prompt: 'A short meeting.', task }),
      ).resolves.toBe('Done.');
    expect(unloads).toBe(1);
    expect(options).toHaveLength(4);
    for (const item of options)
      expect(item).toMatchObject({
        num_ctx: 7168,
        num_thread: 8,
        num_batch: 128,
        num_gpu: 16,
        use_mmap: true,
        draft_num_predict: 0,
      });
    expect(options.map((o) => o.num_predict)).toEqual([2048, 2048, 64, 2500]);
    expect(capacity.mock.calls.map(([input]) => input.resident)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    totalMemory.mockRestore();
    memory.mockRestore();
    capacity.mockRestore();
    watcher.mockRestore();
    transport.mockRestore();
    stream.mockRestore();
    if (descriptor)
      Object.defineProperty(process.versions, 'electron', descriptor);
    else Reflect.deleteProperty(process.versions, 'electron');
  }
});

it('blocks native admission when first-use reconciliation leaves an unconfirmed external resident', async () => {
  const electron = Object.getOwnPropertyDescriptor(
    process.versions,
    'electron',
  );
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  let resident = true;
  let allowUnload = false;
  const nativeRun = vi.fn(async () => {});
  const http = vi
    .spyOn(ollamaTransport, 'ollamaHttpFetch')
    .mockImplementation(async (url, init) => {
      if (url.endsWith('/api/ps'))
        return jsonResponse({
          models: resident ? [{ name: 'gemma4:12b' }] : [],
        });
      expect(parseRequestBody(init).keep_alive).toBe(0);
      if (allowUnload) resident = false;
      return jsonResponse({ done: true }, allowUnload);
    });
  try {
    await expect(
      new UnifiedLLMProvider('ollama', {
        ollama_fast_model: 'phi4-mini:3.8b',
      }).generateText({
        prompt: 'A fictional question.',
        task: 'askPlutoLive',
      }),
    ).rejects.toThrow('ollama_residency_cleanup_failed');
    await expect(
      runWithLocalTranscription(nativeRun, new AbortController().signal),
    ).rejects.toThrow('ollama_residency_cleanup_failed');
    expect(nativeRun).not.toHaveBeenCalled();
    expect(resident).toBe(true);
    allowUnload = true;
    await runWithLocalTranscription(nativeRun, new AbortController().signal);
    expect(resident).toBe(false);
    expect(nativeRun).toHaveBeenCalledOnce();
  } finally {
    allowUnload = true;
    await runWithLocalTranscription(
      async () => {},
      new AbortController().signal,
    );
    http.mockRestore();
    if (electron) Object.defineProperty(process.versions, 'electron', electron);
    else Reflect.deleteProperty(process.versions, 'electron');
  }
});

it('blocks native admission after a watchdog abort until failed Ollama cleanup is retried and confirmed empty', async () => {
  const electron = Object.getOwnPropertyDescriptor(
    process.versions,
    'electron',
  );
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  const watchdog = new AbortController();
  const events: string[] = [];
  vi.spyOn(modelMemory, 'watchLocalModelMemory').mockReturnValue({
    signal: watchdog.signal,
    start: vi.fn(async () => {}),
    setResidentCheck: vi.fn(),
    dispose: vi.fn(async () => {
      events.push('monitor-disposed');
    }),
  });
  vi.spyOn(modelMemory, 'readLocalModelMemory').mockResolvedValue({
    available: 14 * 1024 ** 3,
    total: 16 * 1024 ** 3,
  });
  const digest =
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
  let resident = false;
  let unloads = 0;
  let confirmEmpty!: () => void;
  const empty = new Promise<void>((resolve) => {
    confirmEmpty = resolve;
  });
  vi.spyOn(ollamaTransport, 'ollamaHttpFetch').mockImplementation(
    async (url, init) => {
      if (url.endsWith('/api/tags'))
        return jsonResponse({
          models: [{ name: 'gemma4:12b', digest, size: 7_556_508_396 }],
        });
      if (url.endsWith('/api/ps')) {
        if (unloads === 2) {
          events.push('unload-confirmation-pending');
          await empty;
          resident = false;
          events.push('residency-empty');
        }
        return jsonResponse({
          models: resident
            ? [{ name: 'gemma4:12b', digest, context_length: 7168 }]
            : [],
        });
      }
      expect(parseRequestBody(init).keep_alive).toBe(0);
      unloads++;
      events.push(unloads === 1 ? 'unload-failed' : 'unload-retried');
      return jsonResponse({ done: true }, unloads !== 1);
    },
  );
  vi.spyOn(ollamaTransport, 'ollamaHttpStream').mockImplementation(
    async (_url, init) => {
      resident = true;
      events.push('generation-active');
      return await new Promise((_, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            events.push('transport-aborted');
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    },
  );
  const nativeRun = vi.fn(async () => {
    events.push('native-started');
  });
  const controller = new AbortController();
  let native: Promise<void> | undefined;
  try {
    const generation = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    }).generateText({ prompt: 'A fictional meeting.', task: 'notesWriter' });
    const stopped = expect(generation).rejects.toThrow(
      'watchdog memory refusal',
    );
    await vi.waitFor(() => expect(events).toContain('generation-active'));
    watchdog.abort(
      new modelMemory.LocalModelMemoryError('watchdog memory refusal'),
    );
    await stopped;
    expect(resident).toBe(true);
    expect(events).toEqual([
      'generation-active',
      'transport-aborted',
      'monitor-disposed',
      'unload-failed',
    ]);
    native = runWithLocalTranscription(nativeRun, controller.signal);
    await vi.waitFor(() =>
      expect(events).toContain('unload-confirmation-pending'),
    );
    expect(nativeRun).not.toHaveBeenCalled();
    expect(resident).toBe(true);
    confirmEmpty();
    await native;
    expect(nativeRun).toHaveBeenCalledOnce();
    expect(events.slice(-4)).toEqual([
      'unload-retried',
      'unload-confirmation-pending',
      'residency-empty',
      'native-started',
    ]);
    expect(resident).toBe(false);
  } finally {
    confirmEmpty();
    watchdog.abort();
    controller.abort();
    await native?.catch(() => {});
    vi.restoreAllMocks();
    if (electron) Object.defineProperty(process.versions, 'electron', electron);
    else Reflect.deleteProperty(process.versions, 'electron');
  }
});

it('refuses a stale addon missing the kernel export before any generation POST', async () => {
  const electron = Object.getOwnPropertyDescriptor(
    process.versions,
    'electron',
  );
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  setLocalModelMemoryProbeReader();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const stream = vi
    .spyOn(ollamaTransport, 'ollamaHttpStream')
    .mockRejectedValue(Error('Generation must not start'));
  const transport = vi
    .spyOn(ollamaTransport, 'ollamaHttpFetch')
    .mockImplementation(async (url) => {
      if (url.endsWith('/api/tags'))
        return jsonResponse({
          models: [
            {
              name: 'gemma4:12b',
              digest:
                '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
              size: 7556508396,
            },
          ],
        });
      if (url.endsWith('/api/ps')) return jsonResponse({ models: [] });
      return jsonResponse({ done: true });
    });
  try {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    await expect(
      provider.generateText({
        prompt: 'The fictional team discussed a schedule.',
        task: 'notesWriter',
        jsonMode: true,
        notesBudget: { contextTokens: 8192, outputTokens: 2048 },
        notesModel: 'gemma4:12b',
      }),
    ).rejects.toMatchObject({ name: 'LocalModelMemoryError' });
    expect(stream).not.toHaveBeenCalled();
    for (const [url, init] of transport.mock.calls) {
      if (url.endsWith('/api/generate'))
        expect(parseRequestBody(init).keep_alive).toBe(0);
      expect(url.endsWith('/api/chat')).toBe(false);
    }
  } finally {
    vi.restoreAllMocks();
    setLocalModelMemoryProbeReader();
    if (electron) Object.defineProperty(process.versions, 'electron', electron);
    else Reflect.deleteProperty(process.versions, 'electron');
  }
});
