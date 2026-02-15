import { GoogleGenerativeAI } from '@google/generative-ai'
import { AnalysisArtifacts, EntityExtractionContext, ExtractedEntities, InternalSignalDocument, InternalSignalTag, LLMProvider, LLMSettings, ProviderType } from './provider'
import { analysisDocumentToMarkdown, fallbackAnalysisDocument, parseAnalysisMarkdown } from './analysisDocument'
import { getEntitiesPrompt, getSpeakerIdentityPrompt, getSummaryPrompt, getSummaryRepairPrompt, getTitlePrompt, getValueSignalsPrompt } from './prompts'

const OLLAMA_TIMEOUT_MS = 120_000
const OLLAMA_DEFAULT_MODEL = 'llama3.2'

type LLMTask = 'summary' | 'summaryRepair' | 'speaker' | 'title' | 'entities' | 'valueSignals'

type PersonEntity = ExtractedEntities['people'][number]
type TopicEntity = ExtractedEntities['topics'][number]
type ActionItemEntity = ExtractedEntities['action_items'][number]
type DecisionEntity = ExtractedEntities['decisions'][number]
type ProjectEntity = NonNullable<ExtractedEntities['projects']>[number]
type RelationshipEntity = NonNullable<ExtractedEntities['relationships']>[number]
type InternalSignalRecord = Record<keyof InternalSignalDocument, unknown>

interface TextGenerationOptions {
    prompt: string
    task: LLMTask
    jsonMode?: boolean
}

export class UnifiedLLMProvider implements LLMProvider {
    name: string
    requiresApiKey: boolean

    private openAIBaseUrl = 'https://api.openai.com/v1'
    private claudeBaseUrl = 'https://api.anthropic.com/v1'
    private ollamaBaseUrl = 'http://localhost:11434'
    private geminiClient: GoogleGenerativeAI | null = null
    private cachedOllamaModel: string | null = null

    constructor(
        private providerType: ProviderType,
        private settings: LLMSettings
    ) {
        this.name = this.getProviderName(providerType)
        this.requiresApiKey = providerType !== 'ollama'
    }

    async isAvailable(): Promise<boolean> {
        switch (this.providerType) {
            case 'ollama': {
                try {
                    const response = await this.ollamaFetch('/api/tags')
                    return response.ok
                } catch (e) {
                    console.warn('[Ollama] Not available:', e)
                    return false
                }
            }
            case 'gemini':
                return !!this.settings.gemini_api_key
            case 'openai':
                return !!this.settings.openai_api_key
            case 'claude':
                return !!this.settings.claude_api_key
            default:
                return false
        }
    }

    async generateSummary(transcript: string, userNotes?: string): Promise<string> {
        const artifacts = await this.generateAnalysisArtifacts(transcript, userNotes)
        return artifacts.markdown
    }

    async generateUserAnalysisMarkdown(transcript: string, userNotes?: string): Promise<string> {
        const prompt = getSummaryPrompt(transcript, userNotes)
        return this.generateText({ prompt, task: 'summary' })
    }

    async extractInternalSignals(transcript: string, summary?: string): Promise<InternalSignalDocument> {
        const prompt = getValueSignalsPrompt(transcript, summary)

        try {
            const raw = await this.generateText({ prompt, task: 'valueSignals', jsonMode: true })
            const parsed = JSON.parse(this.cleanJsonText(raw)) as Partial<InternalSignalRecord>
            return {
                analysis_schema_version: 2,
                continuity: this.asStringArray(parsed.continuity),
                accountability_risks: this.asStringArray(parsed.accountability_risks),
                decision_impacts: this.asStringArray(parsed.decision_impacts),
                extra_tags: this.normalizeTags(parsed.extra_tags)
            }
        } catch (e) {
            console.error(`[${this.name}] Failed to extract internal signals:`, e)
            return this.emptyInternalSignals()
        }
    }

    async extractValueSignals(transcript: string, summary?: string): Promise<InternalSignalDocument> {
        return this.extractInternalSignals(transcript, summary)
    }

    async generateAnalysisArtifacts(transcript: string, userNotes?: string): Promise<AnalysisArtifacts> {
        const firstDraft = await this.generateUserAnalysisMarkdown(transcript, userNotes)
        let retryCount = 0
        let parsed = parseAnalysisMarkdown(firstDraft, retryCount)

        if (parsed.issues.length > 0) {
            retryCount = 1
            try {
                const repairPrompt = getSummaryRepairPrompt(transcript, firstDraft, userNotes)
                const repaired = await this.generateText({ prompt: repairPrompt, task: 'summaryRepair' })
                parsed = parseAnalysisMarkdown(repaired, retryCount)
            } catch (e) {
                console.error(`[${this.name}] Analysis repair failed:`, e)
            }
        }

        const document = parsed.issues.length > 0
            ? fallbackAnalysisDocument(retryCount, parsed.issues)
            : {
                ...parsed.document,
                quality: {
                    ...parsed.document.quality,
                    retry_count: retryCount
                }
            }

        const markdown = analysisDocumentToMarkdown(document)
        const signals = await this.extractInternalSignals(transcript, markdown)

        return {
            markdown,
            analysis: document,
            signals
        }
    }

    async extractSpeakerIdentity(transcript: string): Promise<string | null> {
        const prompt = getSpeakerIdentityPrompt(transcript)

        try {
            const name = (await this.generateText({ prompt, task: 'speaker' })).trim()
            if (name && name.length < 20 && !name.includes(' ') && name !== 'Unknown') {
                return name
            }
            return null
        } catch (e) {
            console.error(`[${this.name}] Failed to extract speaker identity:`, e)
            return null
        }
    }

    async generateTitle(transcript: string): Promise<string> {
        const prompt = getTitlePrompt(transcript)

        try {
            const title = (await this.generateText({ prompt, task: 'title' })).trim()
            if (title && title.length < 100) {
                return title.replace(/["']/g, '')
            }
            return 'Meeting'
        } catch (e) {
            console.error(`[${this.name}] Failed to generate title:`, e)
            return 'Meeting'
        }
    }

    async extractEntities(transcript: string, context?: EntityExtractionContext): Promise<ExtractedEntities> {
        const prompt = getEntitiesPrompt(transcript, context)

        try {
            const raw = await this.generateText({ prompt, task: 'entities', jsonMode: true })
            const parsed = JSON.parse(this.cleanJsonText(raw)) as Record<string, unknown>
            return {
                people: this.asArray<PersonEntity>(parsed.people),
                topics: this.asArray<TopicEntity>(parsed.topics),
                action_items: this.asArray<ActionItemEntity>(parsed.action_items),
                decisions: this.asArray<DecisionEntity>(parsed.decisions),
                projects: this.asArray<ProjectEntity>(parsed.projects),
                relationships: this.asArray<RelationshipEntity>(parsed.relationships)
            }
        } catch (e) {
            console.error(`[${this.name}] Failed to extract entities:`, e)
            return this.emptyEntities()
        }
    }

    private getProviderName(provider: ProviderType): string {
        switch (provider) {
            case 'ollama':
                return 'Ollama (Local)'
            case 'gemini':
                return 'Google Gemini'
            case 'openai':
                return 'OpenAI'
            case 'claude':
                return 'Anthropic Claude'
            default:
                return 'LLM'
        }
    }

    private async generateText(options: TextGenerationOptions): Promise<string> {
        switch (this.providerType) {
            case 'openai':
                return this.generateWithOpenAI(options)
            case 'claude':
                return this.generateWithClaude(options)
            case 'gemini':
                return this.generateWithGemini(options)
            case 'ollama':
                return this.generateWithOllama(options)
            default:
                throw new Error(`Unsupported provider: ${this.providerType}`)
        }
    }

    private async generateWithOpenAI({ prompt, task, jsonMode }: TextGenerationOptions): Promise<string> {
        if (!this.settings.openai_api_key) {
            throw new Error('OpenAI API key not configured')
        }

        const body: Record<string, unknown> = {
            model: this.settings.openai_model || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: this.getSystemInstruction(task) },
                { role: 'user', content: prompt }
            ],
            temperature: this.getTemperature(task)
        }

        if (jsonMode) {
            body.response_format = { type: 'json_object' }
        }

        const response = await fetch(`${this.openAIBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.settings.openai_api_key}`
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.choices?.[0]?.message?.content ?? ''
    }

    private async generateWithClaude({ prompt, task }: TextGenerationOptions): Promise<string> {
        if (!this.settings.claude_api_key) {
            throw new Error('Claude API key not configured')
        }

        const response = await fetch(`${this.claudeBaseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.settings.claude_api_key,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.settings.claude_model || 'claude-3-haiku-20240307',
                max_tokens: this.getClaudeMaxTokens(task),
                messages: [{ role: 'user', content: prompt }]
            })
        })

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.content?.[0]?.text ?? ''
    }

    private async generateWithGemini({ prompt, jsonMode }: TextGenerationOptions): Promise<string> {
        const client = this.getGeminiClient()
        const modelName = this.settings.gemini_model || 'gemini-1.5-flash'

        const model = client.getGenerativeModel(
            jsonMode
                ? {
                    model: modelName,
                    generationConfig: { responseMimeType: 'application/json' }
                }
                : { model: modelName }
        )

        const result = await model.generateContent(prompt)
        const response = await result.response
        return response.text()
    }

    private async generateWithOllama({ prompt, jsonMode }: TextGenerationOptions): Promise<string> {
        const model = await this.resolveOllamaModel()
        const requestBody: Record<string, unknown> = {
            model,
            prompt,
            stream: false
        }

        if (jsonMode) {
            requestBody.format = 'json'
        }

        const response = await this.ollamaFetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`)
        }

        const data = await response.json()
        return data.response ?? ''
    }

    private getGeminiClient(): GoogleGenerativeAI {
        if (!this.settings.gemini_api_key) {
            throw new Error('Gemini API key not configured')
        }
        if (!this.geminiClient) {
            this.geminiClient = new GoogleGenerativeAI(this.settings.gemini_api_key)
        }
        return this.geminiClient
    }

    private async resolveOllamaModel(): Promise<string> {
        const configuredModel = (this.settings.ollama_model || this.settings.llm_model || '').trim()
        if (configuredModel) {
            return configuredModel
        }

        if (this.cachedOllamaModel) {
            return this.cachedOllamaModel
        }

        try {
            const response = await this.ollamaFetch('/api/tags')
            if (!response.ok) {
                return OLLAMA_DEFAULT_MODEL
            }
            const data = await response.json()
            const models: string[] = Array.isArray(data.models)
                ? data.models
                    .map((item: { name?: string }) => item?.name)
                    .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
                : []

            if (models.length > 0) {
                const defaultCandidate = models.find((name) =>
                    name === OLLAMA_DEFAULT_MODEL || name.startsWith(`${OLLAMA_DEFAULT_MODEL}:`)
                )
                if (defaultCandidate) {
                    this.cachedOllamaModel = defaultCandidate
                    return defaultCandidate
                }

                // Avoid obvious embedding-only models for text generation tasks.
                const nonEmbeddingCandidate = models.find((name) => !/(^|[-_:])(embed|embedding|bge|e5|gte)([-_:]|$)/i.test(name))
                if (nonEmbeddingCandidate) {
                    this.cachedOllamaModel = nonEmbeddingCandidate
                    return nonEmbeddingCandidate
                }

                this.cachedOllamaModel = models[0]
                return models[0]
            }
        } catch (e) {
            console.warn('[Ollama] Failed to auto-detect model, using default:', e)
        }

        return OLLAMA_DEFAULT_MODEL
    }

    private async ollamaFetch(path: string, options?: RequestInit): Promise<Response> {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)

        try {
            return await fetch(`${this.ollamaBaseUrl}${path}`, {
                ...options,
                signal: controller.signal
            })
        } finally {
            clearTimeout(timeoutId)
        }
    }

    private getSystemInstruction(task: LLMTask): string {
        if (task === 'entities') {
            return 'You are an expert at extracting structured entities from meeting transcripts. Always respond with valid JSON only.'
        }
        if (task === 'valueSignals') {
            return 'You are an expert at classifying conversation value signals. Always respond with valid JSON only.'
        }
        if (task === 'summaryRepair') {
            return 'You are a strict formatting assistant. Return only corrected markdown.'
        }
        if (task === 'title') {
            return 'You are a helpful assistant that generates concise meeting titles.'
        }
        if (task === 'speaker') {
            return 'You are a helpful assistant that extracts speaker information.'
        }
        return 'You are an intelligent meeting assistant.'
    }

    private getTemperature(task: LLMTask): number {
        if (task === 'summary') return 0.7
        if (task === 'summaryRepair') return 0.2
        if (task === 'valueSignals') return 0.2
        if (task === 'title') return 0.5
        return 0.3
    }

    private getClaudeMaxTokens(task: LLMTask): number {
        if (task === 'summary') return 1024
        if (task === 'summaryRepair') return 1024
        if (task === 'entities') return 2048
        if (task === 'valueSignals') return 512
        return 50
    }

    private cleanJsonText(value: string): string {
        const trimmed = value.trim()
        if (trimmed.startsWith('```')) {
            return trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        }
        return trimmed
    }

    private asArray<T>(value: unknown): T[] {
        return Array.isArray(value) ? (value as T[]) : []
    }

    private asStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return []
        }
        return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .slice(0, 3)
    }

    private normalizeTag(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
    }

    private normalizeTags(value: unknown): InternalSignalTag[] {
        if (!Array.isArray(value)) {
            return []
        }

        const dedupe = new Map<string, number>()
        for (const entry of value) {
            if (!entry || typeof entry !== 'object') continue
            const record = entry as Record<string, unknown>
            const rawTag = typeof record.tag === 'string' ? record.tag : ''
            const normalizedTag = this.normalizeTag(rawTag)
            if (!normalizedTag) continue
            const rawConfidence = typeof record.confidence === 'number' ? record.confidence : 0.5
            const confidence = Math.max(0, Math.min(1, Number(rawConfidence)))
            const existing = dedupe.get(normalizedTag)
            if (existing === undefined || confidence > existing) {
                dedupe.set(normalizedTag, confidence)
            }
        }

        return Array.from(dedupe.entries())
            .map(([tag, confidence]) => ({ tag, confidence }))
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 8)
    }

    private emptyEntities(): ExtractedEntities {
        return {
            people: [],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [],
            relationships: []
        }
    }

    private emptyInternalSignals(): InternalSignalDocument {
        return {
            analysis_schema_version: 2,
            continuity: [],
            accountability_risks: [],
            decision_impacts: [],
            extra_tags: []
        }
    }
}
