import { LLMProvider, ExtractedEntities } from './provider'
import { getSummaryPrompt, getSpeakerIdentityPrompt, getTitlePrompt, getEntitiesPrompt } from './prompts'

export class OllamaProvider implements LLMProvider {
    name = 'Ollama (Local)'
    requiresApiKey = false
    private baseUrl = 'http://localhost:11434'

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`)
            return response.ok
        } catch (e) {
            console.warn('[Ollama] Not available:', e)
            return false
        }
    }

    async generateSummary(transcript: string, userNotes?: string): Promise<string> {
        const prompt = getSummaryPrompt(transcript, userNotes)

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.2',
                prompt: prompt,
                stream: false
            })
        })

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.response
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const prompt = getSpeakerIdentityPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama3.2',
                    prompt: prompt,
                    stream: false
                })
            })

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`)
            }

            const data = await response.json()
            const name = data.response.trim()

            // Validate it's a reasonable name (not a sentence)
            if (name && name.length < 20 && !name.includes(' ') && name !== 'Unknown') {
                return name
            }
            return null
        } catch (e) {
            console.error('[Ollama] Failed to extract speaker identity:', e)
            return null
        }
    }

    async generateTitle(transcript: string): Promise<string> {
        const prompt = getTitlePrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama3.2',
                    prompt: prompt,
                    stream: false
                })
            })

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`)
            }

            const data = await response.json()
            const title = data.response.trim()

            // Validate and clean the title
            if (title && title.length < 100) {
                return title.replace(/[\"']/g, '')
            }
            return 'Meeting'
        } catch (e) {
            console.error('[Ollama] Failed to generate title:', e)
            return 'Meeting'
        }
    }

    async extractEntities(transcript: string): Promise<ExtractedEntities> {
        const prompt = getEntitiesPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama3.2',
                    prompt: prompt,
                    stream: false,
                    format: 'json'
                })
            })

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`)
            }

            const data = await response.json()
            const jsonStr = data.response.trim()

            // Parse and validate the response
            const parsed = JSON.parse(jsonStr)

            // Ensure all required arrays exist
            return {
                people: Array.isArray(parsed.people) ? parsed.people : [],
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
                decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                projects: Array.isArray(parsed.projects) ? parsed.projects : []
            }
        } catch (e) {
            console.error('[Ollama] Failed to extract entities:', e)
            // Return empty result on failure
            return {
                people: [],
                topics: [],
                action_items: [],
                decisions: [],
                projects: []
            }
        }
    }
}

