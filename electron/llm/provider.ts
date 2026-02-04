// Structured entity extraction result
export interface ExtractedEntities {
    people: Array<{
        name: string
        role?: string // e.g., "Manager", "Designer", inferred from context
    }>
    topics: Array<{
        name: string
        importance: 'high' | 'medium' | 'low'
    }>
    action_items: Array<{
        description: string
        assignee?: string // Name of person responsible
        due_date?: string // Natural language date like "Friday", "next week"
    }>
    decisions: Array<{
        description: string
        rationale?: string // Why this decision was made
    }>
    projects?: Array<{
        name: string
        context?: string // Brief description
    }>
    relationships?: Array<{
        source: string
        target: string
        relationship: 'works_on' | 'impacts' | 'relates_to' | 'involved_in' | 'produced' | 'assigned_to'
        context?: string
    }>
}

export interface LLMProvider {
    name: string
    requiresApiKey: boolean
    isAvailable(): Promise<boolean>
    generateSummary(transcript: string, userNotes?: string): Promise<string>
    extractSpeakerIdentity(transcript: string): Promise<string | null>
    generateTitle(transcript: string): Promise<string>
    extractEntities(transcript: string): Promise<ExtractedEntities>
}

export type ProviderType = 'ollama' | 'gemini' | 'openai' | 'claude'

export interface LLMSettings {
    llm_provider?: ProviderType
    gemini_api_key?: string
    openai_api_key?: string
    claude_api_key?: string
}
