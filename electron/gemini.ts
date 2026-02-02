import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMProvider, ExtractedEntities } from './llm/provider'
import { getSummaryPrompt, getSpeakerIdentityPrompt, getTitlePrompt, getEntitiesPrompt } from './llm/prompts'

export class GeminiProvider implements LLMProvider {
    name = 'Google Gemini'
    requiresApiKey = true
    private genAI: GoogleGenerativeAI

    constructor(private apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey)
    }

    async isAvailable(): Promise<boolean> {
        return !!this.apiKey
    }

    async generateSummary(transcript: string, userNotes?: string): Promise<string> {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const prompt = getSummaryPrompt(transcript, userNotes)

        const result = await model.generateContent(prompt)
        const response = await result.response
        return response.text()
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const prompt = getSpeakerIdentityPrompt(transcript)

        try {
            const result = await model.generateContent(prompt)
            const response = await result.response
            const name = response.text().trim()

            // Validate it's a reasonable name (not a sentence)
            if (name && name.length < 20 && !name.includes(' ') && name !== 'Unknown') {
                return name
            }
            return null
        } catch (e) {
            console.error('[Gemini] Failed to extract speaker identity:', e)
            return null
        }
    }

    async generateTitle(transcript: string): Promise<string> {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const prompt = getTitlePrompt(transcript)

        try {
            const result = await model.generateContent(prompt)
            const response = await result.response
            const title = response.text().trim()

            // Validate and clean the title
            if (title && title.length < 100) {
                return title.replace(/[\"']/g, '')
            }
            return 'Meeting'
        } catch (e) {
            console.error('[Gemini] Failed to generate title:', e)
            return 'Meeting'
        }
    }

    async extractEntities(transcript: string): Promise<ExtractedEntities> {
        const model = this.genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                responseMimeType: "application/json"
            }
        })

        const prompt = getEntitiesPrompt(transcript)

        try {
            const result = await model.generateContent(prompt)
            const response = await result.response
            const jsonStr = response.text().trim()
            const parsed = JSON.parse(jsonStr)

            return {
                people: Array.isArray(parsed.people) ? parsed.people : [],
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
                decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                projects: Array.isArray(parsed.projects) ? parsed.projects : []
            }
        } catch (e) {
            console.error('[Gemini] Failed to extract entities:', e)
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

// Legacy exports for backward compatibility (will be removed)
export const generateSummary = async (transcript: string, apiKey: string) => {
    const provider = new GeminiProvider(apiKey)
    return provider.generateSummary(transcript)
}

export const extractSpeakerIdentity = async (transcript: string, apiKey: string): Promise<string | null> => {
    const provider = new GeminiProvider(apiKey)
    return provider.extractSpeakerIdentity(transcript)
}

