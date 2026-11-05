import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTAuth } from '../../electron/chatgpt/auth';
import { initializeChatGPTAuth } from '../../electron/chatgpt/runtime';
import { createMemoryChatGPTUsage } from '../../electron/chatgpt/usage';
import {
  canOfferChatGPTMemoryFallback,
  chatGPTMemoryFallbackSettings,
  isLocalMemoryRefusal,
} from '../../electron/llm/chatGPTMemoryFallback';
import type { InferenceRequest } from '../../electron/llm/inferenceTypes';
import { LocalModelMemoryError } from '../../electron/llm/localModelMemory';
import type { LLMSettings } from '../../electron/llm/provider';
import { CLOUD_CONSENT_VERSION } from '../../electron/llm/providerCatalog';
import { executeChatGPT } from '../../electron/llm/transports/chatGPT';

const ready = { connected: true, planEnabled: true };
const local: LLMSettings = {
  llm_provider: 'ollama',
  chatgpt_model: 'account-model',
  cloud_consents: { chatgpt: CLOUD_CONSENT_VERSION },
};

describe('offering ChatGPT after a local memory refusal', () => {
  it('offers only with current consent, a model and a usable plan', () => {
    expect(canOfferChatGPTMemoryFallback(local, ready)).toBe(true);
    expect(
      canOfferChatGPTMemoryFallback(
        { ...local, llm_provider: undefined },
        ready,
      ),
    ).toBe(true);
    for (const [settings, status] of [
      [{ ...local, cloud_consents: {} }, ready],
      [{ ...local, cloud_consents: { chatgpt: 'old' } }, ready],
      [{ ...local, chatgpt_model: ' ' }, ready],
      [{ ...local, llm_provider: 'chatgpt' }, ready],
      [{ ...local, llm_provider: 'gemini' }, ready],
      [local, { connected: true, planEnabled: false }],
      [local, { ...ready, usageLimited: true }],
      [local, undefined],
    ] as const)
      expect(
        canOfferChatGPTMemoryFallback(settings as LLMSettings, status),
      ).toBe(false);
  });

  it('marks the one question it sends without storing a provider change', () => {
    const settings = chatGPTMemoryFallbackSettings(local);
    expect(settings).toMatchObject({
      llm_provider: 'chatgpt',
      chatgpt_memory_fallback: true,
      chatgpt_model: 'account-model',
    });
    expect(local.llm_provider).toBe('ollama');
  });

  it('recognizes only memory refusals', () => {
    expect(isLocalMemoryRefusal(new LocalModelMemoryError('short'))).toBe(true);
    expect(isLocalMemoryRefusal(new Error('timeout'))).toBe(false);
  });
});

describe('ChatGPT guard for a memory fallback question', () => {
  const request: InferenceRequest = {
    task: 'askPluto',
    model: 'account-model',
    messages: [{ role: 'user', content: 'Fictional question.' }],
    egress: { classification: 'selected_meeting_context', userInitiated: true },
  };
  let settings: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const auth = new ChatGPTAuth({
      load: () =>
        JSON.stringify({
          clientId: 'oaiapp_test',
          subject: 'fictional-user',
          scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'],
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
          expiresAt: Date.now() + 3600_000,
        }),
      save: vi.fn(),
      getHostId: () => 'urn:uuid:test',
      saveHostId: vi.fn(),
      openBrowser: vi.fn(),
    });
    settings = new Map([
      ['llm_provider', 'ollama'],
      ['cloud_consent_chatgpt', CLOUD_CONSENT_VERSION],
    ]);
    initializeChatGPTAuth(auth, createMemoryChatGPTUsage(), (key) =>
      settings.get(key),
    );
    fetchMock = vi.fn(
      async () =>
        new Response(
          [
            { type: 'response.output_text.delta', delta: 'Answer.' },
            {
              type: 'response.completed',
              response: {
                status: 'completed',
                model: 'account-model',
                usage: {},
              },
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses an ordinary request while Ollama is selected', async () => {
    await expect(executeChatGPT(request)).rejects.toMatchObject({
      code: 'chatgpt_not_selected',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a question the person chose for ChatGPT', async () => {
    await expect(
      executeChatGPT({
        ...request,
        egress: { ...request.egress, memoryFallback: true },
      }),
    ).resolves.toMatchObject({ text: 'Answer.' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('still requires current cloud consent', async () => {
    settings.set('cloud_consent_chatgpt', 'withdrawn');
    await expect(
      executeChatGPT({
        ...request,
        egress: { ...request.egress, memoryFallback: true },
      }),
    ).rejects.toMatchObject({ code: 'chatgpt_cloud_consent_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
