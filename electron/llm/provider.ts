// Re-export v3 analysis types for centralized access
export type {
  AnalysisErrorCategory,
  AnalysisGenerationMetadata,
  AnalysisGenerationPath,
  AnalysisProvider,
  AnalysisDocumentV3,
  AnalysisQualityV3,
  TopicSection,
  TopicPoint,
  DecisionV3,
  ActionItemV3,
  MeetingType,
  UserEditsMap,
  UserEdit,
} from './analysisTypes';

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

/** @deprecated Use AnalysisDocumentV3 from analysisTypes for v3 pipeline */
export interface AnalysisDocument {
  analysis_schema_version: number;
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
  quality: AnalysisQuality;
}

/** @deprecated No longer returned from v3 pipeline */
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
  /** v3: Generate topic-structured analysis document */
  generateStructuredAnalysis(
    transcript: string,
    userNotes?: string,
  ): Promise<import('./analysisTypes').AnalysisDocumentV3>;
  /** @deprecated Use generateStructuredAnalysis for v3 pipeline */
  generateSummary(transcript: string, userNotes?: string): Promise<string>;
  /** @deprecated Use generateStructuredAnalysis for v3 pipeline */
  generateUserAnalysisMarkdown(
    transcript: string,
    userNotes?: string,
  ): Promise<string>;
  extractInternalSignals(
    transcript: string,
    summary?: string,
  ): Promise<InternalSignalDocument>;
  /** @deprecated Use generateStructuredAnalysis for v3 pipeline */
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
  synthesizeKnowledgeDocument(prompt: string): Promise<string>;
  answerAskPluto(prompt: string): Promise<string>;
  classifyQueryIntent(prompt: string): Promise<string>;
  extractEntities(
    transcript: string,
    context?: EntityExtractionContext,
  ): Promise<ExtractedEntities>;
  generateFollowUpDrafts(params: {
    meetingTitle: string;
    participants?: string[];
    actionItems: string[];
    decisions: string[];
    discussionPoints?: string[];
    customPrompt?: string;
  }): Promise<{ drafts: Array<{ title: string; content: string }> }>;
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
