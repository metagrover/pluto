// Structured entity extraction result
export interface ExtractedEntities {
  people: Array<{
    name: string;
    role?: string; // e.g., "Manager", "Designer", inferred from context
  }>;
  topics: Array<{
    name: string;
    importance: 'high' | 'medium' | 'low';
  }>;
  action_items: Array<{
    description: string;
    assignee?: string; // Name of person responsible
    due_date?: string; // Natural language date like "Friday", "next week"
  }>;
  decisions: Array<{
    description: string;
    rationale?: string; // Why this decision was made
  }>;
  projects?: Array<{
    name: string;
    context?: string; // Brief description
  }>;
  relationships?: Array<{
    source: string;
    target: string;
    relationship:
      | 'works_on'
      | 'impacts'
      | 'relates_to'
      | 'involved_in'
      | 'produced'
      | 'assigned_to';
    context?: string;
  }>;
}

export interface InternalSignalTag {
  tag: string;
  confidence: number;
}

export interface InternalSignalDocument {
  analysis_schema_version: number;
  continuity: string[];
  accountability_risks: string[];
  decision_impacts: string[];
  extra_tags: InternalSignalTag[];
}

export interface AnalysisQuality {
  format_pass: boolean;
  retry_count: number;
  fallback_used: boolean;
  issues: string[];
}

export interface AnalysisDocument {
  analysis_schema_version: number;
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
  quality: AnalysisQuality;
}

export interface AnalysisArtifacts {
  markdown: string;
  analysis: AnalysisDocument;
  signals: InternalSignalDocument;
}

export type ValueGainSignals = InternalSignalDocument;

export interface ExtractionPriorityHints {
  prioritized_terms: string[];
  relationship_bias: Record<string, number>;
}

export interface EntityExtractionContext {
  summary?: string;
  valueSignals?: InternalSignalDocument;
  priorityHints?: ExtractionPriorityHints;
}

export interface LLMProvider {
  name: string;
  requiresApiKey: boolean;
  isAvailable(): Promise<boolean>;
  generateSummary(transcript: string, userNotes?: string): Promise<string>;
  generateUserAnalysisMarkdown(
    transcript: string,
    userNotes?: string,
  ): Promise<string>;
  extractInternalSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument>;
  generateAnalysisArtifacts(
    transcript: string,
    userNotes?: string,
  ): Promise<AnalysisArtifacts>;
  extractValueSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument>;
  extractSpeakerIdentity(transcript: string): Promise<string | null>;
  generateTitle(transcript: string): Promise<string>;
  extractEntities(
    transcript: string,
    context?: EntityExtractionContext,
  ): Promise<ExtractedEntities>;
}

export type ProviderType = 'ollama' | 'gemini' | 'openai' | 'claude';

export interface LLMSettings {
  llm_provider?: ProviderType;
  gemini_api_key?: string;
  openai_api_key?: string;
  claude_api_key?: string;
  llm_model?: string;
  ollama_model?: string;
  gemini_model?: string;
  openai_model?: string;
  claude_model?: string;
}
