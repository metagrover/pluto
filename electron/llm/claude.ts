import { LLMProvider, ExtractedEntities } from './provider'
import { getSummaryPrompt, getSpeakerIdentityPrompt, getTitlePrompt, getEntitiesPrompt } from './prompts'

export class ClaudeProvider implements LLMProvider {
    name = 'Anthropic Claude'
    requiresApiKey = true
    private baseUrl = 'https://api.anthropic.com/v1'

    constructor(private apiKey: string) { }

    async isAvailable(): Promise<boolean> {
        return !!this.apiKey
    }

    async generateSummary(transcript: string, userNotes?: string): Promise<string> {
        const prompt = getSummaryPrompt(transcript, userNotes)

        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [
                    { role: 'user', content: prompt }
                ]
            })
        })

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.content[0].text
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const prompt = getSpeakerIdentityPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 50,
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            })

            if (!response.ok) {
                throw new Error(`Claude API error: ${response.statusText}`)
            }

            const data = await response.json()
            const name = data.content[0].text.trim()

            // Validate it's a reasonable name (not a sentence)
            if (name && name.length < 20 && !name.includes(' ') && name !== 'Unknown') {
                return name
            }
            return null
        } catch (e) {
            console.error('[Claude] Failed to extract speaker identity:', e)
            return null
        }
    }

    async generateTitle(transcript: string): Promise<string> {
        const prompt = getTitlePrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 50,
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            })

            if (!response.ok) {
                throw new Error(`Claude API error: ${response.statusText}`)
            }

            const data = await response.json()
            const title = data.content[0].text.trim()

            // Validate and clean the title
            if (title && title.length < 100) {
                return title.replace(/[\"']/g, '')
            }
            return 'Meeting'
        } catch (e) {
            console.error('[Claude] Failed to generate title:', e)
            return 'Meeting'
        }
    }

    async extractEntities(transcript: string): Promise<ExtractedEntities> {
        const prompt = getEntitiesPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 2048,
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            })

            if (!response.ok) {
                throw new Error(`Claude API error: ${response.statusText}`)
            }

            const data = await response.json()
            let jsonStr = data.content[0].text.trim()

            // Remove markdown code blocks if present
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
            }

            const parsed = JSON.parse(jsonStr)

            return {
                people: Array.isArray(parsed.people) ? parsed.people : [],
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
                decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                projects: Array.isArray(parsed.projects) ? parsed.projects : []
            }
        } catch (e) {
            console.error('[Claude] Failed to extract entities:', e)
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

