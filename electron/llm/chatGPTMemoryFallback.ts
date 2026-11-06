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

type OfferSurface = 'ask' | 'meeting' | 'note';

const offers = new WeakMap<
  object,
  Map<OfferSurface, { question: string; expiresAt: number }>
>();

export const offerChatGPTMemoryFallback = (
  owner: object,
  surface: OfferSurface,
  question: string,
) => {
  let pending = offers.get(owner);
  if (!pending) {
    pending = new Map();
    offers.set(owner, pending);
  }
  pending.set(surface, { question, expiresAt: Date.now() + 5 * 60_000 });
  return { chatGPTFallback: 'available' as const };
};

export const consumeChatGPTMemoryFallback = (
  owner: object,
  surface: OfferSurface,
  question: string,
): boolean => {
  const pending = offers.get(owner);
  const offer = pending?.get(surface);
  pending?.delete(surface);
  return Boolean(
    offer && offer.question === question && offer.expiresAt >= Date.now(),
  );
};

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
