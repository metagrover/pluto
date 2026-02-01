import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMProvider, ExtractedEntities } from './llm/provider'

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

        const prompt = `You are an intelligent meeting assistant. Analyze this conversation transcript${userNotes ? ' and the user\'s notes' : ''} to provide:

1. **Summary**: A concise 2-3 sentence overview of what was discussed
2. **Key Points**: Main topics and important information mentioned
3. **Action Items**: Any tasks, follow-ups, or commitments mentioned (use "- [ ]" checkbox format)
4. **Decisions**: Any decisions or conclusions reached

${userNotes ? `\nUser Notes Context:\n${userNotes}\n` : ''}

Format your response in clean markdown with clear sections.

Transcript:
${transcript}`

        const result = await model.generateContent(prompt)
        const response = await result.response
        return response.text()
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

        const prompt = `Analyze this conversation transcript and identify who the OTHER person is (not "You").

Look for:
- Names mentioned in introductions or conversation
- Context clues about who they are
- Any identifying information

If you can identify the other person, respond with ONLY their first name (e.g., "Sarah" or "John").
If you cannot identify them with confidence, respond with exactly: "Unknown"

Transcript:
${transcript}`

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

        const prompt = `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${transcript.substring(0, 1000)}`

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

        const prompt = `You are an expert at extracting structured information from meeting transcripts.

Analyze the following transcript and extract:

1. **People**: Names of people mentioned or participating (include any role/title if mentioned)
2. **Topics**: Main subjects discussed (rate importance as high/medium/low)
3. **Action Items**: Tasks, follow-ups, or commitments made (include who is responsible and any deadline)
4. **Decisions**: Explicit decisions or conclusions reached (include rationale if given)
5. **Projects**: Project names or work streams mentioned

Rules:
- Only include entities that are clearly mentioned or implied
- For action items, "assignee" should be a name if mentioned, otherwise omit
- For due dates, use the exact phrase from the transcript (e.g., "by Friday", "next week")
- Be conservative - only extract what's clearly present, don't infer too much

Respond with valid JSON in this exact format:
{
  "people": [{"name": "string", "role": "string or omit"}],
  "topics": [{"name": "string", "importance": "high|medium|low"}],
  "action_items": [{"description": "string", "assignee": "string or omit", "due_date": "string or omit"}],
  "decisions": [{"description": "string", "rationale": "string or omit"}],
  "projects": [{"name": "string", "context": "string or omit"}]
}

Transcript:
${transcript}`

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

