import { afterEach, expect, it, vi } from 'vitest';
import type { NotesStageEvent } from '../../electron/llm/meetingNotesRunMetrics';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
const gemini = vi.hoisted(() => ({ model: vi.fn(), generate: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config: unknown) {
      gemini.model(config);
      return { generateContent: gemini.generate };
    }
  },
}));

it('bounds Claude output and rejects max-token termination', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body).max_tokens).toBe(2048);
      return {
        ok: true,
        json: async () => ({
          content: [{ text: '{}' }],
          stop_reason: 'max_tokens',
        }),
      };
    }),
  );
  const provider = new UnifiedLLMProvider('claude', {
    claude_api_key: 'test',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).rejects.toThrow(
    'notes_output_truncated',
  );
});

it('passes cancellation to Gemini transport and bounds/rejects its truncated output', async () => {
  const controller = new AbortController();
  gemini.generate.mockResolvedValueOnce({
    response: {
      text: () => '{}',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    },
  });
  const provider = new UnifiedLLMProvider('gemini', {
    gemini_api_key: 'test',
  }) as unknown as Transport;
  await expect(
    provider.generateText({ ...request, signal: controller.signal }),
  ).rejects.toThrow('notes_output_truncated');
  expect(gemini.generate).toHaveBeenCalledWith('Return JSON', {
    signal: controller.signal,
  });
  expect(gemini.model).toHaveBeenCalledWith(
    expect.objectContaining({
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['PRIVATE_MARKER input too long', 'notes_input_overflow'],
  ['PRIVATE_MARKER model missing', 'notes_provider_error'],
])(
  'classifies Electron HTTP errors without leaking their bodies: %s',
  async (body, code) => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
    });
    const stream = vi
      .spyOn(provider as never, 'ollamaStream')
      .mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        errorBody: JSON.stringify({ error: body }),
      });
    try {
      await expect(
        (provider as unknown as Transport).generateText(request),
      ).rejects.toThrow(new RegExp(`^${code}$`));
    } finally {
      stream.mockRestore();
    }
  },
);

it.each([true, false])(
  'uses Ollama chat for notes and returns only final content (thinking=%s)',
  async (thinking) => {
    const fetcher = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/api/chat');
      expect(JSON.parse(init.body)).toMatchObject({
        messages: [{ role: 'user', content: 'Return JSON' }],
        think: thinking,
        format: 'json',
        stream: true,
        options: { num_ctx: 16384, num_predict: 2048 },
      });
      expect(JSON.parse(init.body)).not.toHaveProperty('prompt');
      return {
        ok: true,
        text: async () =>
          [
            JSON.stringify({ message: { thinking: 'PRIVATE_REASONING' } }),
            JSON.stringify({ message: { content: '{' } }),
            JSON.stringify({ message: { content: '}' } }),
            JSON.stringify({ done: true, done_reason: 'stop' }),
          ].join('\n'),
      };
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'qwen3.5:9b',
      ollama_structured_thinking: thinking,
    }) as unknown as Transport;
    await expect(provider.generateText(request)).resolves.toBe('{}');
  },
);

it('classifies reported provider input overflow without exposing error bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({
        error: {
          code: 'context_length_exceeded',
          message: 'PRIVATE_MARKER maximum context length exceeded',
        },
      }),
    })),
  );
  const provider = new UnifiedLLMProvider('openai', {
    openai_api_key: 'test',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).rejects.toThrow(
    /^notes_input_overflow$/,
  );
});

it('rejects a stream that closes without a completion packet even if the JSON looks complete', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => '{"response":"{}"}\n' })),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'qwen3.5:9b',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).rejects.toThrow(
    'notes_output_incomplete',
  );
});
type Transport = {
  generateText(options: {
    task: 'notesWriter';
    prompt: string;
    jsonMode: boolean;
    notesBudget: { contextTokens: number; outputTokens: number };
    signal?: AbortSignal;
    notesStageObserver?: (event: NotesStageEvent) => void;
  }): Promise<string>;
};
const request = {
  task: 'notesWriter' as const,
  prompt: 'Return JSON',
  jsonMode: true,
  notesBudget: { contextTokens: 16384, outputTokens: 2048 },
};

it('decodes chat packets split at every byte without leaking reasoning or duplicating the final packet', async () => {
  const payload = new TextEncoder().encode(
    [
      JSON.stringify({ message: { thinking: 'PRIVATE_REASONING' } }),
      JSON.stringify({ message: { content: '{"text":"café"}' } }),
      JSON.stringify({ done: true, done_reason: 'stop' }),
    ].join('\n'),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of payload)
                controller.enqueue(Uint8Array.of(byte));
              controller.close();
            },
          }),
        ),
    ),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'qwen3.5:9b',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).resolves.toBe('{"text":"café"}');
});

it('forwards notes output limits to OpenAI and rejects length termination even for valid JSON', async () => {
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body).max_completion_tokens).toBe(2048);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{}' }, finish_reason: 'length' }],
      }),
    };
  });
  vi.stubGlobal('fetch', fetcher);
  const provider = new UnifiedLLMProvider('openai', {
    openai_api_key: 'test',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).rejects.toThrow(
    'notes_output_truncated',
  );
});

it('rejects an oversized notes request before cloud transport', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const provider = new UnifiedLLMProvider('openai', {
    openai_api_key: 'test',
  }) as unknown as Transport;
  await expect(
    provider.generateText({ ...request, prompt: 'X'.repeat(50_000) }),
  ).rejects.toThrow('notes_context_exhausted');
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads the final Ollama metrics-only packet and rejects a truncated stream', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/tags'))
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen3.5:9b' }] }),
        };
      expect(JSON.parse(init.body).stream).toBe(true);
      return {
        ok: true,
        text: async () =>
          '{"response":"{}"}\n{"done":true,"done_reason":"length","eval_count":2048}\n',
      };
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'qwen3.5:9b',
  }) as unknown as Transport;
  await expect(provider.generateText(request)).rejects.toThrow(
    'notes_output_truncated',
  );
});

it('reports Ollama queue, active time, and terminal token metrics without raw packets', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      text: async () =>
        [
          JSON.stringify({ message: { content: '{}' } }),
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 321,
            eval_count: 45,
            prompt_eval_duration: 20_000_000,
            eval_duration: 30_000_000,
          }),
        ].join('\n'),
    })),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'qwen3.5:9b',
  }) as unknown as Transport;
  const events: NotesStageEvent[] = [];

  await expect(
    provider.generateText({
      ...request,
      notesStageObserver: (event) => events.push(event),
    }),
  ).resolves.toBe('{}');

  expect(events.map((event) => event.phase)).toEqual([
    'queued',
    'started',
    'finished',
  ]);
  expect(events[2]).toMatchObject({
    outcome: 'complete',
    inputTokens: 321,
    outputTokens: 45,
  });
  expect(JSON.stringify(events)).not.toContain('{}');
});

it('reports cloud truncation exactly once with null token counts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{}' }, finish_reason: 'length' }],
      }),
    })),
  );
  const provider = new UnifiedLLMProvider('openai', {
    openai_api_key: 'test',
  }) as unknown as Transport;
  const events: NotesStageEvent[] = [];

  await expect(
    provider.generateText({
      ...request,
      notesStageObserver: (event) => events.push(event),
    }),
  ).rejects.toThrow('notes_output_truncated');

  expect(events.filter((event) => event.phase === 'finished')).toEqual([
    expect.objectContaining({
      outcome: 'truncated',
      inputTokens: null,
      outputTokens: null,
    }),
  ]);
});
