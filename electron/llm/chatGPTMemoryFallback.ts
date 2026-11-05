import { getChatGPTAuth } from '../chatgpt/runtime';
import type { LLMSettings } from './provider';
import { CLOUD_CONSENT_VERSION } from './providerCatalog';

const readChatGPTStatus = () => {
  try {
    return getChatGPTAuth().status();
  } catch {
    return undefined;
  }
};

/**
 * When local memory protection refuses an Ask Pluto question, Pluto can offer
 * to send that one question to ChatGPT. It offers only when the person already
 * accepted ChatGPT's cloud terms, is signed in with a usable plan, and chose a
 * ChatGPT model. Nothing is sent unless they choose it for that question.
 */
export const canOfferChatGPTMemoryFallback = (
  settings: LLMSettings,
  status = readChatGPTStatus(),
): boolean =>
  (!settings.llm_provider || settings.llm_provider === 'ollama') &&
  settings.cloud_consents?.chatgpt === CLOUD_CONSENT_VERSION &&
  Boolean(settings.chatgpt_model?.trim()) &&
  status?.planEnabled === true &&
  status.usageLimited !== true;

/** Settings for the one question the person chose to send to ChatGPT. */
export const chatGPTMemoryFallbackSettings = (
  settings: LLMSettings,
): LLMSettings => ({
  ...settings,
  llm_provider: 'chatgpt',
  chatgpt_memory_fallback: true,
});

export const isLocalMemoryRefusal = (error: unknown): boolean =>
  error instanceof Error && error.name === 'LocalModelMemoryError';

export const CHATGPT_FALLBACK_UNAVAILABLE_MESSAGE =
  'ChatGPT isn’t available for this answer. Check that you’re signed in to ChatGPT in Settings, then try again.';
