import type { LLMProvider, LLMSettings, ProviderType } from './provider';
import { UnifiedLLMProvider } from './unifiedProvider';

export async function getProvider(settings: LLMSettings): Promise<LLMProvider> {
  const providerType: ProviderType = settings.llm_provider || 'ollama';

  console.log(`[LLM Factory] Attempting to load provider: ${providerType}`);

  switch (providerType) {
    case 'ollama': {
      const ollama = new UnifiedLLMProvider('ollama', settings);
      if (await ollama.isAvailable()) {
        console.log('[LLM Factory] Ollama is available');
        return ollama;
      }
      console.warn(
        '[LLM Factory] Ollama not available, falling back to cloud provider',
      );

      // Fallback to cloud provider if available
      if (settings.gemini_api_key) {
        console.log('[LLM Factory] Falling back to Gemini');
        return new UnifiedLLMProvider('gemini', settings);
      }
      if (settings.openai_api_key) {
        console.log('[LLM Factory] Falling back to OpenAI');
        return new UnifiedLLMProvider('openai', settings);
      }
      if (settings.claude_api_key) {
        console.log('[LLM Factory] Falling back to Claude');
        return new UnifiedLLMProvider('claude', settings);
      }

      throw new Error(
        'Ollama is not running and no cloud API keys configured. Please install Ollama or add an API key in settings.',
      );
    }

    case 'gemini': {
      if (!settings.gemini_api_key) {
        throw new Error('Gemini API key not configured');
      }
      return new UnifiedLLMProvider('gemini', settings);
    }

    case 'openai': {
      if (!settings.openai_api_key) {
        throw new Error('OpenAI API key not configured');
      }
      return new UnifiedLLMProvider('openai', settings);
    }

    case 'claude': {
      if (!settings.claude_api_key) {
        throw new Error('Claude API key not configured');
      }
      return new UnifiedLLMProvider('claude', settings);
    }

    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
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
