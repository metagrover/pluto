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
import type { LLMSettings } from '../../electron/llm/provider';
import {
  UnifiedLLMProvider,
  calculateOllamaContextBudget,
  deduplicateExtractedItems,
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
  beforeEach(() => {
    vi.clearAllMocks();
    geminiGetGenerativeModelMock.mockReset();
    geminiGenerateContentMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('uses explicit structured-thinking and seed capabilities without model-name checks', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    installFetchMock((_url, init) => {
      requestBodies.push(parseRequestBody(init));
      return jsonResponse({
        response: JSON.stringify({
          topics: [{ title: 'Synthetic', start_segment: 0, end_segment: 0 }],
        }),
      });
    });
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'synthetic-model:latest',
      ollama_structured_thinking: false,
      ollama_seed: 42,
    });

    await provider.generateStructuredAnalysis('Nira: Synthetic update.');

    expect(requestBodies.length).toBeGreaterThan(0);
    for (const body of requestBodies) {
      expect(body.think).toBe(false);
      expect(body.options).toMatchObject({ seed: 42 });
    }
  });

  it('waits for the local generation slot before starting another Ollama timeout', async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let generationCalls = 0;
    const fetchMock = installFetchMock((_url, _init) => {
      generationCalls += 1;
      return generationCalls === 1
        ? firstResponse
        : jsonResponse({ response: validAnalysisMarkdown });
    });
    const firstProvider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    const secondProvider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    const first = firstProvider.synthesizeKnowledgeDocument('knowledge');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = secondProvider.generateUserAnalysisMarkdown('analysis');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst?.(jsonResponse({ response: '{}' }));
    await expect(first).resolves.toBe('{}');
    await expect(second).resolves.toBe(validAnalysisMarkdown);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps Phi for non-analysis tasks when auto-detecting ollama model', async () => {
    let selectedModel = '';
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'kimike:latest' },
            { name: 'phi4-mini:3.8b:latest' },
            { name: 'qwen3.5:9b' },
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

    expect(selectedModel).toBe('phi4-mini:3.8b:latest');
  });

  it('prefers promoted Qwen for structured meeting analysis', async () => {
    const selectedModels: string[] = [];
    installFetchMock((url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'phi4-mini:3.8b' }, { name: 'qwen3.5:9b' }],
        });
      }
      const body = parseRequestBody(init);
      selectedModels.push(String(body.model));
      if (selectedModels.length === 1) {
        return jsonResponse({
          response: JSON.stringify({
            topics: [{ title: 'Synthetic', start_segment: 0, end_segment: 0 }],
          }),
        });
      }
      return jsonResponse({
        response: JSON.stringify({
          summary: 'Synthetic summary.',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        }),
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {});
    const analysis = await provider.generateStructuredAnalysis(
      'Nira: Synthetic update.',
    );

    expect(analysis.generation_metadata?.model).toBe('qwen3.5:9b');
    expect(selectedModels).toEqual(['qwen3.5:9b', 'qwen3.5:9b']);
  });

  it('avoids embedding-only ollama models during auto-detection', async () => {
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

    expect(selectedModel).toBe('kimike:latest');
  });

  it('analyzes only the transcript lines assigned to each Ollama topic', async () => {
    const topicPrompts: string[] = [];
    let segmentationTemperature: number | undefined;
    const topicTemperatures: number[] = [];
    installFetchMock((url, init) => {
      expect(url).toContain('/api/generate');
      const body = parseRequestBody(init);
      const prompt = String(body.prompt || '');
      const options = body.options as Record<string, unknown>;
      if (prompt.includes('meeting topic segmenter')) {
        segmentationTemperature = Number(options.temperature);
        return jsonResponse({
          response: JSON.stringify({
            topics: [
              { title: 'Alpha topic', start_segment: 0, end_segment: 0 },
              { title: 'Beta topic', start_segment: 1, end_segment: 1 },
            ],
          }),
        });
      }
      if (prompt.includes('global meeting-notes editor')) {
        return jsonResponse({
          response: JSON.stringify({
            overview: 'Edited summary.',
            topics: [
              {
                title: 'Combined topic',
                summary: 'Combined summary.',
                key_points: [],
                decisions: [],
                action_items: [],
                open_questions: [],
              },
            ],
            all_action_items: [],
            all_decisions: [],
            meeting_type: 'general',
          }),
        });
      }
      topicPrompts.push(prompt);
      topicTemperatures.push(Number(options.temperature));
      return jsonResponse({
        response: JSON.stringify({
          summary: 'Grounded summary',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        }),
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    await provider.generateStructuredAnalysis(
      ['Me: alpha-only detail', 'Them: beta-only detail'].join('\n'),
    );

    expect(topicPrompts).toHaveLength(2);
    expect(topicPrompts[0]).toContain('alpha-only detail');
    expect(topicPrompts[0]).not.toContain('beta-only detail');
    expect(topicPrompts[1]).toContain('beta-only detail');
    expect(topicPrompts[1]).not.toContain('alpha-only detail');
    expect(segmentationTemperature).toBe(0.1);
    expect(topicTemperatures).toEqual([0.1, 0.1]);
  });

  it('covers transcript lines omitted between Ollama topic ranges exactly once', async () => {
    const topicPrompts: string[] = [];
    installFetchMock((_url, init) => {
      const body = parseRequestBody(init);
      const prompt = String(body.prompt || '');
      if (prompt.includes('meeting topic segmenter')) {
        return jsonResponse({
          response: JSON.stringify({
            topics: [
              { title: 'Opening', start_segment: 0, end_segment: 0 },
              { title: 'Closing', start_segment: 3, end_segment: 3 },
            ],
          }),
        });
      }
      if (prompt.includes('global meeting-notes editor')) {
        return jsonResponse({
          response: JSON.stringify({
            overview: 'Edited summary.',
            topics: [
              {
                title: 'Combined topic',
                summary: 'Combined summary.',
                key_points: [],
                decisions: [],
                action_items: [],
                open_questions: [],
              },
            ],
            all_action_items: [],
            all_decisions: [],
            meeting_type: 'general',
          }),
        });
      }
      topicPrompts.push(prompt);
      return jsonResponse({
        response: JSON.stringify({
          summary: 'Grounded summary',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        }),
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });
    await provider.generateStructuredAnalysis(
      [
        'Me: detail-zero',
        'Me: detail-one',
        'Me: detail-two',
        'Me: detail-three',
      ].join('\n'),
    );

    const combinedPrompts = topicPrompts.join('\n');
    for (const detail of [
      'detail-zero',
      'detail-one',
      'detail-two',
      'detail-three',
    ]) {
      expect(combinedPrompts.split(detail)).toHaveLength(2);
    }
  });

  it('globally edits multi-topic Ollama analysis once', async () => {
    const prompts: string[] = [];
    installFetchMock((_url, init) => {
      const body = parseRequestBody(init);
      const prompt = String(body.prompt || '');
      prompts.push(prompt);
      if (prompt.includes('meeting topic segmenter')) {
        return jsonResponse({
          response: JSON.stringify({
            topics: [
              { title: 'Cloud-code access', start_segment: 0, end_segment: 0 },
              { title: 'Tooling access', start_segment: 1, end_segment: 1 },
            ],
          }),
        });
      }
      if (prompt.includes('global meeting-notes editor')) {
        expect(prompt).toContain('Cloud Code is available');
        expect(prompt).toContain('Cloud-code access');
        return jsonResponse({
          response: JSON.stringify({
            overview: 'The edited executive summary.',
            topics: [
              {
                title: 'Cloud Code access',
                summary: 'Access remains constrained.',
                key_points: [],
                decisions: [],
                action_items: [],
                open_questions: [],
                transcript_range: [0, 1],
              },
            ],
            all_action_items: [],
            all_decisions: [],
            meeting_type: 'team_sync',
          }),
        });
      }
      return jsonResponse({
        response: JSON.stringify({
          summary: 'A local topic summary.',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        }),
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const analysis = await provider.generateStructuredAnalysis(
      [
        'Me: Cloud Code is available in the workspace.',
        'Them: Tooling access remains constrained.',
      ].join('\n'),
    );

    expect(
      prompts.filter((prompt) =>
        prompt.includes('global meeting-notes editor'),
      ),
    ).toHaveLength(1);
    expect(analysis.overview).toBe('The edited executive summary.');
    expect(analysis.topics).toHaveLength(1);
    expect(analysis.topics[0].title).toBe('Cloud Code access');
  });

  it('falls back to the local draft when global editing returns invalid JSON', async () => {
    installFetchMock((_url, init) => {
      const body = parseRequestBody(init);
      const prompt = String(body.prompt || '');
      if (prompt.includes('meeting topic segmenter')) {
        return jsonResponse({
          response: JSON.stringify({
            topics: [
              { title: 'Alpha topic', start_segment: 0, end_segment: 0 },
              { title: 'Beta topic', start_segment: 1, end_segment: 1 },
            ],
          }),
        });
      }
      if (prompt.includes('global meeting-notes editor')) {
        return jsonResponse({ response: '{invalid json' });
      }
      return jsonResponse({
        response: JSON.stringify({
          summary: 'A grounded local summary.',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        }),
      });
    });

    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const analysis = await provider.generateStructuredAnalysis(
      ['Me: Alpha detail.', 'Them: Beta detail.'].join('\n'),
    );

    expect(analysis.topics.map((topic) => topic.title)).toEqual([
      'Alpha topic',
      'Beta topic',
    ]);
    expect(analysis.generation_metadata?.error_categories).toContain(
      'editorial_invalid_json',
    );
  });

  it('falls back to default ollama model when model listing fails', async () => {
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

    expect(selectedModel).toBe('phi4-mini:3.8b');
  });

  it('stops the multi-pass pipeline after a local model timeout', async () => {
    const fetchMock = installFetchMock(() =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'phi4-mini:3.8b',
    });

    await expect(
      provider.generateStructuredAnalysis('Me: status update'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('retries structured analysis once before succeeding on repaired JSON', async () => {
    let structuredCalls = 0;
    installFetchMock((url, init) => {
      expect(url).toContain('/chat/completions');
      const body = parseRequestBody(init);
      const messages = Array.isArray(body.messages)
        ? (body.messages as Array<{ role: string; content: string }>)
        : [];

      if (
        messages.some((m) =>
          m.content?.includes('Repair this meeting analysis JSON'),
        )
      ) {
        return jsonResponse({
          choices: [
            { message: { content: JSON.stringify(validStructuredAnalysis) } },
          ],
        });
      }

      structuredCalls += 1;
      return jsonResponse({
        choices: [{ message: { content: '{invalid json' } }],
      });
    });

    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test-key',
      openai_model: 'gpt-4.1-mini',
    });
    const analysis = await provider.generateStructuredAnalysis(
      [
        'Sarah: We discussed GraphQL but did not decide on it.',
        'Deepak: Agreed, we will use REST for the rollout.',
        "Sarah: I'll send the rollout email by Friday.",
      ].join('\n'),
    );

    expect(structuredCalls).toBe(1);
    expect(analysis.quality.retry_count).toBe(1);
    expect(analysis.generation_metadata?.error_categories).toContain(
      'repair_succeeded',
    );
    expect(analysis.generation_metadata?.provider).toBe('openai');
  });

  it('drops unsupported decisions and clears unsupported action item owner and due fields', async () => {
    installFetchMock((url) => {
      expect(url).toContain('/chat/completions');
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...validStructuredAnalysis,
                topics: [
                  {
                    ...validStructuredAnalysis.topics[0],
                    decisions: [
                      {
                        text: 'Use GraphQL for the rollout',
                        evidence: 'We discussed GraphQL as one option.',
                      },
                      {
                        text: 'Use REST for the rollout',
                        evidence: 'Agreed, we will use REST for the rollout.',
                      },
                    ],
                    action_items: [
                      {
                        text: 'Send rollout email',
                        assignee: 'Bob',
                        due: 'next Tuesday',
                        evidence: "I'll send the rollout email.",
                      },
                    ],
                  },
                ],
                all_decisions: [
                  {
                    text: 'Use GraphQL for the rollout',
                    evidence: 'We discussed GraphQL as one option.',
                  },
                  {
                    text: 'Use REST for the rollout',
                    evidence: 'Agreed, we will use REST for the rollout.',
                  },
                ],
                all_action_items: [
                  {
                    text: 'Send rollout email',
                    assignee: 'Bob',
                    due: 'next Tuesday',
                    evidence: "I'll send the rollout email.",
                  },
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
    const analysis = await provider.generateStructuredAnalysis(
      [
        'Sarah: We discussed GraphQL as one option.',
        'Deepak: Agreed, we will use REST for the rollout.',
        "Sarah: I'll send the rollout email.",
      ].join('\n'),
    );

    expect(analysis.all_decisions).toEqual([
      {
        text: 'Use REST for the rollout',
        evidence: 'Agreed, we will use REST for the rollout.',
      },
    ]);
    expect(analysis.all_action_items).toEqual([
      {
        text: 'Send rollout email',
        evidence: "I'll send the rollout email.",
        topic: 'API migration',
      },
    ]);
    expect(analysis.generation_metadata?.error_categories).toEqual(
      expect.arrayContaining([
        'unsupported_decision',
        'unsupported_action_item_owner',
        'unsupported_action_item_due',
      ]),
    );
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
    expect(settings.ollama_structured_thinking).toBe(false);
    expect(settings.ollama_seed).toBeUndefined();
  });
});

describe('Ollama Budgeting & Adaptive Windowing', () => {
  it('bounds meeting analysis requests while preserving the knowledge-doc budget', () => {
    expect(getOllamaTimeoutMs('topicSegmentation')).toBe(90_000);
    expect(getOllamaTimeoutMs('topicAnalysis')).toBe(90_000);
    expect(getOllamaTimeoutMs('knowledgeDoc')).toBe(900_000);
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
