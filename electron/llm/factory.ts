import { LLMProvider, ProviderType, LLMSettings } from './provider'
import { OllamaProvider } from './ollama'
import { GeminiProvider } from '../gemini'
import { OpenAIProvider } from './openai'
import { ClaudeProvider } from './claude'

export async function getProvider(settings: LLMSettings): Promise<LLMProvider> {
    const providerType: ProviderType = settings.llm_provider || 'ollama'

    console.log(`[LLM Factory] Attempting to load provider: ${providerType}`)

    switch (providerType) {
        case 'ollama': {
            const ollama = new OllamaProvider()
            if (await ollama.isAvailable()) {
                console.log('[LLM Factory] Ollama is available')
                return ollama
            }
            console.warn('[LLM Factory] Ollama not available, falling back to cloud provider')

            // Fallback to cloud provider if available
            if (settings.gemini_api_key) {
                console.log('[LLM Factory] Falling back to Gemini')
                return new GeminiProvider(settings.gemini_api_key)
            }
            if (settings.openai_api_key) {
                console.log('[LLM Factory] Falling back to OpenAI')
                return new OpenAIProvider(settings.openai_api_key)
            }
            if (settings.claude_api_key) {
                console.log('[LLM Factory] Falling back to Claude')
                return new ClaudeProvider(settings.claude_api_key)
            }

            throw new Error('Ollama is not running and no cloud API keys configured. Please install Ollama or add an API key in settings.')
        }

        case 'gemini': {
            if (!settings.gemini_api_key) {
                throw new Error('Gemini API key not configured')
            }
            return new GeminiProvider(settings.gemini_api_key)
        }

        case 'openai': {
            if (!settings.openai_api_key) {
                throw new Error('OpenAI API key not configured')
            }
            return new OpenAIProvider(settings.openai_api_key)
        }

        case 'claude': {
            if (!settings.claude_api_key) {
                throw new Error('Claude API key not configured')
            }
            return new ClaudeProvider(settings.claude_api_key)
        }

        default:
            throw new Error(`Unknown provider type: ${providerType}`)
    }
}

export async function getAllSettings(db: any): Promise<LLMSettings> {
    return {
        llm_provider: db.getSetting('llm_provider') as ProviderType || 'ollama',
        gemini_api_key: db.getSetting('gemini_api_key') || undefined,
        openai_api_key: db.getSetting('openai_api_key') || undefined,
        claude_api_key: db.getSetting('claude_api_key') || undefined
    }
}
