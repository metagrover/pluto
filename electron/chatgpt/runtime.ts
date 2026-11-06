import { CLOUD_CONSENT_VERSION } from '../llm/providerCatalog';
import { type ChatGPTAuth, ChatGPTError } from './auth';
import { type ChatGPTUsage, createMemoryChatGPTUsage } from './usage';

let auth: ChatGPTAuth | undefined;
let usage = createMemoryChatGPTUsage();
let getSetting: ((key: string) => unknown) | undefined;
let controller = new AbortController();
let authSignal: AbortSignal | undefined;
let inferenceSignal: AbortSignal | undefined;

export function initializeChatGPTAuth(
  instance: ChatGPTAuth,
  usageController: ChatGPTUsage,
  readSetting: (key: string) => unknown,
) {
  auth = instance;
  usage = usageController;
  getSetting = readSetting;
  cancelChatGPTInference();
}

export function getChatGPTUsage(): ChatGPTUsage {
  return usage;
}

export function getChatGPTAuth(): ChatGPTAuth {
  if (!auth) throw new Error('chatgpt_runtime_not_initialized');
  return auth;
}

/**
 * ChatGPT runs only when it is the selected provider, or for one question the
 * person chose to send after a local memory refusal. Cloud consent is always
 * required.
 */
export function assertChatGPTSelected(memoryFallback = false) {
  if (!getSetting) throw new Error('chatgpt_runtime_not_initialized');
  const provider = getSetting('llm_provider');
  if (
    provider !== 'chatgpt' &&
    !(memoryFallback && (!provider || provider === 'ollama'))
  )
    throw new ChatGPTError('chatgpt_not_selected');
  if (getSetting('cloud_consent_chatgpt') !== CLOUD_CONSENT_VERSION)
    throw new ChatGPTError('chatgpt_cloud_consent_required');
}

export function cancelChatGPTInference(reason?: Error) {
  controller.abort(reason);
  controller = new AbortController();
  inferenceSignal = undefined;
}

export function getChatGPTInferenceSignal(): AbortSignal {
  const currentAuthSignal = getChatGPTAuth().inferenceSignal();
  if (!inferenceSignal || authSignal !== currentAuthSignal) {
    authSignal = currentAuthSignal;
    inferenceSignal = AbortSignal.any([authSignal, controller.signal]);
  }
  return inferenceSignal;
}
