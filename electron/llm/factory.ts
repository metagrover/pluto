import type { LLMProvider, LLMSettings, ProviderType } from './provider';
import { UnifiedLLMProvider } from './unifiedProvider';

let cachedProvider: LLMProvider | null = null;
let lastSettingsHash: string | null = null;

function getSettingsHash(settings: LLMSettings): string {
  return JSON.stringify({
    type: settings.llm_provider || 'ollama',
    ollama: settings.ollama_model,
    llm: settings.llm_model,
    gemini: settings.gemini_model,
    openai: settings.openai_model,
    claude: settings.claude_model,
    hasGemini: !!settings.gemini_api_key,
    hasOpenAI: !!settings.openai_api_key,
    hasClaude: !!settings.claude_api_key,
  });
}

export async function getProvider(settings: LLMSettings): Promise<LLMProvider> {
  const currentHash = getSettingsHash(settings);

  if (cachedProvider && lastSettingsHash === currentHash) {
    if (await cachedProvider.isAvailable()) {
      return cachedProvider;
    }
  }

  const providerType: ProviderType = settings.llm_provider || 'ollama';
  let providerInstance: LLMProvider;

  console.log(`[LLM Factory] Loading fresh provider instance: ${providerType}`);

  switch (providerType) {
    case 'ollama': {
      const ollama = new UnifiedLLMProvider('ollama', settings);
      if (await ollama.isAvailable()) {
        console.log('[LLM Factory] Ollama is available');
        providerInstance = ollama;
        break;
      }
      console.warn(
        '[LLM Factory] Ollama not available, falling back to cloud provider',
      );

      if (settings.gemini_api_key) {
        console.log('[LLM Factory] Falling back to Gemini');
        providerInstance = new UnifiedLLMProvider('gemini', settings);
      } else if (settings.openai_api_key) {
        console.log('[LLM Factory] Falling back to OpenAI');
        providerInstance = new UnifiedLLMProvider('openai', settings);
      } else if (settings.claude_api_key) {
        console.log('[LLM Factory] Falling back to Claude');
        providerInstance = new UnifiedLLMProvider('claude', settings);
      } else {
        throw new Error(
          'Ollama is not running and no cloud API keys configured. Please install Ollama or add an API key in settings.',
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

    case 'openai': {
      if (!settings.openai_api_key) {
        throw new Error('OpenAI API key not configured');
      }
      providerInstance = new UnifiedLLMProvider('openai', settings);
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

  cachedProvider = providerInstance;
  lastSettingsHash = currentHash;
  return providerInstance;
}


export async function getAllSettings(db: {
  getSetting: (key: string) => unknown;
}): Promise<LLMSettings> {
  const getStringSetting = (key: string): string | undefined => {
    const value = db.getSetting(key);
    return typeof value === 'string' ? value : undefined;
  };
  const providerValue = db.getSetting('llm_provider');
  const allowedProviders: ProviderType[] = [
    'ollama',
    'gemini',
    'openai',
    'claude',
  ];
  const llmProvider =
    typeof providerValue === 'string' &&
    allowedProviders.includes(providerValue as ProviderType)
      ? (providerValue as ProviderType)
      : 'ollama';

  return {
    llm_provider: llmProvider,
    gemini_api_key: getStringSetting('gemini_api_key'),
    openai_api_key: getStringSetting('openai_api_key'),
    claude_api_key: getStringSetting('claude_api_key'),
    llm_model: getStringSetting('llm_model'),
    ollama_model: getStringSetting('ollama_model'),
    gemini_model: getStringSetting('gemini_model'),
    openai_model: getStringSetting('openai_model'),
    claude_model: getStringSetting('claude_model'),
  };
}
