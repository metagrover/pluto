import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const geminiGetGenerativeModelMock = vi.fn();
const geminiGenerateContentMock = vi.fn();

vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(apiKey: string) {
      void apiKey;
    }

    getGenerativeModel(config: unknown) {
      geminiGetGenerativeModelMock(config);
      return {
        generateContent: (prompt: string) => geminiGenerateContentMock(prompt),
      };
    }
  }

  return { GoogleGenerativeAI: MockGoogleGenerativeAI };
});

import { getAllSettings, getProvider } from '../../electron/llm/factory';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type { LLMSettings } from '../../electron/llm/provider';
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
) => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      return await handler(url, init);
    },
  );
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
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
      expect(parseRequestBody(init).response_format).toEqual({
        type: 'json_object',
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

  it('versions recoverable local notes as notes-v28', () => {
    expect(STRUCTURED_ANALYSIS_PROMPT_VERSION).toBe('notes-v28');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    geminiGetGenerativeModelMock.mockReset();
    geminiGenerateContentMock.mockReset();
  });

  afterEach(() => {
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

  it('keeps synchronous Ask Pluto visible while preserving the larger Deep budget', async () => {
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
      model: 'phi4-mini:3.8b',
      think: false,
    });
    expect(requestBodies[0].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 192,
    });
    expect(requestBodies[1]).toMatchObject({
      model: 'phi4-mini:3.8b',
      keep_alive: 0,
      stream: false,
    });
    expect(requestBodies[2]).toMatchObject({
      model: 'qwen3.5:9b',
      think: false,
    });
    expect(requestBodies[2].options).toMatchObject({
      num_ctx: 4096,
      num_predict: 512,
      top_k: 40,
      top_p: 1,
    });
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

  it('defaults Quick chat to Phi while Deep chat uses Gemma 4', async () => {
    const selectedModels: string[] = [];
    installFetchMock((url, init) => {
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
    });

    const provider = new UnifiedLLMProvider('ollama', {});
    await provider.answerAskPluto('Who owns this?', { mode: 'fast' });
    await provider.answerAskPluto('Compare these meetings', { mode: 'deep' });

    expect(selectedModels).toEqual([
      'phi4-mini:3.8b',
      'phi4-mini:3.8b',
      'gemma4:12b',
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
      response: Promise.resolve({
        text: () =>
          JSON.stringify({
            people: [{ name: 'Sarah Chen' }],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [],
            relationships: [],
          }),
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
      model: 'gemini-2.0-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });
  });
});

describe('LLM factory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back from unavailable ollama to openai', async () => {
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

    const provider = await getProvider(settings);
    expect(provider.name).toBe('OpenAI');
    expect(provider).toBeInstanceOf(UnifiedLLMProvider);
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
    expect(getOllamaActiveGenerationTimeoutMs(512)).toBe(376_000);
    expect(getOllamaActiveGenerationTimeoutMs(4_096)).toBe(1_200_000);
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

  it('uses separate bounded budgets for fast and deep Ask Pluto answers', () => {
    expect(calculateOllamaContextBudget('transcript', 'title')).toEqual({
      num_ctx: 8192,
      num_predict: 2500,
    });
    expect(calculateOllamaContextBudget('question', 'askPluto')).toEqual({
      num_ctx: 4096,
      num_predict: 192,
    });
    expect(calculateOllamaContextBudget('question', 'askPlutoDeep')).toEqual({
      num_ctx: 4096,
      num_predict: 512,
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
