import { createHash } from 'node:crypto';
import { ChatGPTError } from '../chatgpt/auth';
import { getChatGPTAuth } from '../chatgpt/runtime';
import type { LLMProvider, LLMSettings, ProviderType } from './provider';
import { CLOUD_CONSENT_VERSION, isCloudProvider } from './providerCatalog';
import { UnifiedLLMProvider } from './unifiedProvider';

let pendingProviderPromise: Promise<LLMProvider> | null = null;
let lastSettingsHash: string | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute

function getSettingsHash(settings: LLMSettings): string {
  const type = settings.llm_provider || 'ollama';
  const activeSettings = {
    ollama: [
      settings.ollama_model,
      settings.ollama_fast_model,
      settings.ollama_structured_thinking,
      settings.ollama_seed,
    ],
    gemini: [settings.gemini_model, settings.gemini_api_key],
    openai: [settings.openai_model, settings.openai_api_key],
    chatgpt: [settings.chatgpt_model],
    openrouter: [settings.openrouter_model, settings.openrouter_api_key],
    claude: [settings.claude_model, settings.claude_api_key],
  }[type];
  return createHash('sha256')
    .update(
      JSON.stringify({
        type,
        activeSettings,
        consent:
          type === 'ollama' ? undefined : settings.cloud_consents?.[type],
      }),
    )
    .digest('hex');
}

export async function getProvider(settings: LLMSettings): Promise<LLMProvider> {
  const currentHash = getSettingsHash(settings);

  // 1. If we have a pending/completed promise for this exact hash, wait and reuse.
  if (pendingProviderPromise && lastSettingsHash === currentHash) {
    const now = Date.now();
    // Cache the "available" status for HEALTH_CHECK_INTERVAL
    if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
      return pendingProviderPromise;
    }

    const provider = await pendingProviderPromise;
    // Health check to handle service restarts
    if (await provider.isAvailable()) {
      lastHealthCheck = now;
      return provider;
    }
    // If unhealthy, clear and initialize fresh
    pendingProviderPromise = null;
    lastHealthCheck = 0;
  }

  // 2. Clear old state if settings changed
  if (lastSettingsHash !== currentHash) {
    pendingProviderPromise = null;
    lastSettingsHash = currentHash;
  }

  // 3. Start initialization if no pending promise exists
  if (!pendingProviderPromise) {
    const initialization = (async (): Promise<LLMProvider> => {
      const providerType: ProviderType = settings.llm_provider || 'ollama';
      let providerInstance: LLMProvider;

      console.log(
        `[LLM Factory] Loading fresh provider instance: ${providerType} (hash: ${currentHash.substring(0, 8)}...)`,
      );

      switch (providerType) {
        case 'ollama': {
          const ollama = new UnifiedLLMProvider('ollama', settings);
          if (await ollama.isAvailable()) {
            console.log('[LLM Factory] Ollama is available');
            providerInstance = ollama;
          } else {
            throw Object.assign(
              new Error(
                'Ollama is not running. Start Ollama or explicitly select a configured cloud provider in Settings.',
              ),
              { code: 'provider_unavailable' },
            );
          }
          break;
        }

        case 'gemini': {
          if (!settings.gemini_api_key) {
            throw new Error('Gemini API key not configured');
          }
          providerInstance = new UnifiedLLMProvider('gemini', settings);
          break;
        }

        case 'chatgpt': {
          if (!getChatGPTAuth().status().planEnabled) {
            throw new ChatGPTError('chatgpt_sign_in_required');
          }
          providerInstance = new UnifiedLLMProvider('chatgpt', settings);
          break;
        }

        case 'openai': {
          if (!settings.openai_api_key) {
            throw new Error('OpenAI API key not configured');
          }
          providerInstance = new UnifiedLLMProvider('openai', settings);
          break;
        }

        case 'openrouter': {
          if (!settings.openrouter_api_key) {
            throw new Error('OpenRouter API key not configured');
          }
          providerInstance = new UnifiedLLMProvider('openrouter', settings);
          break;
        }

        case 'claude': {
          if (!settings.claude_api_key) {
            throw new Error('Claude API key not configured');
          }
          providerInstance = new UnifiedLLMProvider('claude', settings);
          break;
        }

        default:
          throw new Error(`Unknown provider type: ${providerType}`);
      }

      if (
        isCloudProvider(providerType) &&
        settings.cloud_consents?.[providerType] !== CLOUD_CONSENT_VERSION
      ) {
        throw new Error(`${providerType}_cloud_consent_required`);
      }
      return providerInstance;
    })();
    const guarded = initialization.catch((error) => {
      // A rejected initialization is not a cached provider. Retry must probe
      // the service again after it restarts, even with unchanged settings.
      if (pendingProviderPromise === guarded) {
        pendingProviderPromise = null;
        lastHealthCheck = 0;
      }
      throw error;
    });
    pendingProviderPromise = guarded;
  }

  return pendingProviderPromise;
}

let cachedSettings: LLMSettings | null = null;
let lastSettingsFetch = 0;
const SETTINGS_CACHE_MS = 10_000;

export async function getAllSettings(db: {
  getSetting: (key: string) => unknown;
}): Promise<LLMSettings> {
  const now = Date.now();
  if (cachedSettings && now - lastSettingsFetch < SETTINGS_CACHE_MS) {
    return cachedSettings;
  }

  const getStringSetting = (key: string): string | undefined => {
    const value = db.getSetting(key);
    return typeof value === 'string' ? value : undefined;
  };
  const getBooleanSetting = (key: string): boolean | undefined => {
    const value = db.getSetting(key);
    if (value === true || value === 1 || value === 'true') return true;
    if (value === false || value === 0 || value === 'false') return false;
    return undefined;
  };
  const getIntegerSetting = (key: string): number | undefined => {
    const raw = db.getSetting(key);
    if (
      typeof raw !== 'number' &&
      (typeof raw !== 'string' || raw.trim().length === 0)
    ) {
      return undefined;
    }
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : undefined;
  };
  const providerValue = db.getSetting('llm_provider');
  const allowedProviders: ProviderType[] = [
    'ollama',
    'gemini',
    'openai',
    'chatgpt',
    'openrouter',
    'claude',
  ];
  const llmProvider =
    typeof providerValue === 'string' &&
    allowedProviders.includes(providerValue as ProviderType)
      ? (providerValue as ProviderType)
      : 'ollama';

  const settings: LLMSettings = {
    llm_provider: llmProvider,
    gemini_api_key: getStringSetting('gemini_api_key'),
    openai_api_key: getStringSetting('openai_api_key'),
    openrouter_api_key: getStringSetting('openrouter_api_key'),
    claude_api_key: getStringSetting('claude_api_key'),
    llm_model: getStringSetting('llm_model'),
    ollama_model: getStringSetting('ollama_model'),
    ollama_fast_model: getStringSetting('ollama_fast_model'),
    ollama_structured_thinking: getBooleanSetting('ollama_structured_thinking'),
    ollama_seed: getIntegerSetting('ollama_seed'),
    gemini_model: getStringSetting('gemini_model'),
    openai_model: getStringSetting('openai_model'),
    chatgpt_model: getStringSetting('chatgpt_model'),
    openrouter_model: getStringSetting('openrouter_model'),
    claude_model: getStringSetting('claude_model'),
    cloud_consents: {
      gemini: getStringSetting('cloud_consent_gemini'),
      openai: getStringSetting('cloud_consent_openai'),
      chatgpt: getStringSetting('cloud_consent_chatgpt'),
      openrouter: getStringSetting('cloud_consent_openrouter'),
      claude: getStringSetting('cloud_consent_claude'),
    },
  };

  cachedSettings = settings;
  lastSettingsFetch = now;
  return settings;
}

export function invalidateProviderCache() {
  pendingProviderPromise = null;
  lastSettingsHash = null;
  lastHealthCheck = 0;
  invalidateSettingsCache();
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  lastSettingsFetch = 0;
}
