import { LLMProvider, ExtractedEntities } from './provider'
import { getSummaryPrompt, getSpeakerIdentityPrompt, getTitlePrompt, getEntitiesPrompt } from './prompts'

export class OpenAIProvider implements LLMProvider {
    name = 'OpenAI'
    requiresApiKey = true
    private baseUrl = 'https://api.openai.com/v1'

    constructor(private apiKey: string) { }

    async isAvailable(): Promise<boolean> {
        return !!this.apiKey
    }

    async generateSummary(transcript: string, userNotes?: string): Promise<string> {
        const prompt = getSummaryPrompt(transcript, userNotes)

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an intelligent meeting assistant.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            })
        })

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.choices[0].message.content
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const prompt = getSpeakerIdentityPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that extracts speaker information.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3
                })
            })

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.statusText}`)
            }

            const data = await response.json()
            const name = data.choices[0].message.content.trim()

            // Validate it's a reasonable name (not a sentence)
            if (name && name.length < 20 && !name.includes(' ') && name !== 'Unknown') {
                return name
            }
            return null
        } catch (e) {
            console.error('[OpenAI] Failed to extract speaker identity:', e)
            return null
        }
    }

    async generateTitle(transcript: string): Promise<string> {
        const prompt = getTitlePrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that generates concise meeting titles.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.5
                })
            })

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.statusText}`)
            }

            const data = await response.json()
            const title = data.choices[0].message.content.trim()

            // Validate and clean the title
            if (title && title.length < 100) {
                return title.replace(/["']/g, '')
            }
            return 'Meeting'
        } catch (e) {
            console.error('[OpenAI] Failed to generate title:', e)
            return 'Meeting'
        }
    }

    async extractEntities(transcript: string): Promise<ExtractedEntities> {
        const prompt = getEntitiesPrompt(transcript)

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are an expert at extracting structured entities from meeting transcripts. Always respond with valid JSON only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    response_format: { type: 'json_object' }
                })
            })

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.statusText}`)
            }

            const data = await response.json()
            const jsonStr = data.choices[0].message.content.trim()
            const parsed = JSON.parse(jsonStr)

            return {
                people: Array.isArray(parsed.people) ? parsed.people : [],
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
                decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                projects: Array.isArray(parsed.projects) ? parsed.projects : []
            }
        } catch (e) {
            console.error('[OpenAI] Failed to extract entities:', e)
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

