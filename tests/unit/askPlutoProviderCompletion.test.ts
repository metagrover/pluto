import { expect, it, vi } from 'vitest';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
it.each(['length', 'missing-done'])(
  'rejects %s output instead of declaring it complete',
  async (reason) => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'gemma4:12b',
    });
    vi.spyOn(provider as any, 'resolveOllamaModel').mockResolvedValue(
      'gemma4:12b',
    );
    vi.spyOn(provider as any, 'reconcileOllamaResidency').mockResolvedValue(
      undefined,
    );
    vi.spyOn(provider as any, 'ollamaStream').mockImplementation(
      async (_path: any, _options: any, onChunk: any) => {
        onChunk(
          `${JSON.stringify({
            response: 'Morgan owns the report.',
            done: reason === 'length',
            ...(reason === 'length' ? { done_reason: 'length' } : {}),
          })}\n`,
        );
        return { ok: true, status: 200, statusText: 'OK' };
      },
    );
    await expect(
      provider.answerAskPluto('Synthetic question', {
        mode: 'fast',
        onToken: () => {},
      }),
    ).rejects.toThrow('ask_pluto_response_incomplete');
  },
);

it('accepts a terminal stop packet split across transport chunks', async () => {
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
  });
  vi.spyOn(provider as any, 'resolveOllamaModel').mockResolvedValue(
    'gemma4:12b',
  );
  vi.spyOn(provider as any, 'reconcileOllamaResidency').mockResolvedValue(
    undefined,
  );
  vi.spyOn(provider as any, 'ollamaStream').mockImplementation(
    async (_path: any, _options: any, onChunk: any) => {
      onChunk(`${JSON.stringify({ response: 'Morgan owns the report.' })}\n`);
      onChunk('{"done":tr');
      onChunk('ue,"done_reason":"stop"}');
      return { ok: true, status: 200, statusText: 'OK' };
    },
  );
  await expect(
    provider.answerAskPluto('Synthetic question', {
      mode: 'fast',
      onToken: () => {},
    }),
  ).resolves.toBe('Morgan owns the report.');
});
