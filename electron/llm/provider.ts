import type { ProjectQualificationProposal } from '../../src/utils/projectQualification';
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
    role?: string; // Explicit job title or function, never inferred from proximity
    role_evidence?: string; // Exact transcript quote connecting this person to the role
  }>;
  topics: Array<{
    name: string;
    importance: 'high' | 'medium' | 'low';
  }>;
  action_items: Array<{
    description: string;
    assignee?: string; // Name of person responsible
    due_date?: string; // Natural language date like "Friday", "next week"
    evidence?: string; // Source quote retained for commitment reconciliation
  }>;
  decisions: Array<{
    description: string;
    rationale?: string; // Why this decision was made
  }>;
  projects?: Array<{
    name: string;
    context?: string; // Brief description
    qualification?: ProjectQualificationProposal;
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
      | 'assigned_to'
      | 'belongs_to';
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

export class SecondaryExtractionError extends Error {
  readonly code: 'value_signals_failed' | 'entity_extraction_failed';

  constructor(
    code: 'value_signals_failed' | 'entity_extraction_failed',
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'SecondaryExtractionError';
    this.code = code;
  }
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
    template?: import('./prompts').MeetingNotesTemplate,
    options?: {
      signal?: AbortSignal;
      knownTerms?: string[];
      source?: import('./meetingNotesTypes').NotesSource;
      trustedUserTerms?: string[];
      entityHints?: string[];
      contextTokens?: number;
      /** Explicit benchmark experiment; product callers retain every-node audits. */
      hierarchyAuditStrategy?: 'every_node' | 'final_only';
      stageCache?: import('./meetingNotesStageCache').NotesStageCache;
      cacheKey?: string;
      onStage?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onRepair?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onStageEvent?: import('./meetingNotesRunMetrics').NotesStageObserver;
      onPlan?: (plan: { plannedLeafCount: number }) => void;
      onRepartition?: () => void;
      workClass?: import('./llmWorkClass').LLMWorkClass;
    },
  ): Promise<import('./analysisTypes').AnalysisDocumentV3>;
  /** Precompute one closed hierarchy leaf without auditing or publishing it. */
  precomputeStructuredAnalysisLeaf(
    transcript: string,
    userNotes: string,
    template: import('./prompts').MeetingNotesTemplate,
    options: {
      signal?: AbortSignal;
      knownTerms?: string[];
      source?: import('./meetingNotesTypes').NotesSource;
      trustedUserTerms?: string[];
      entityHints?: string[];
      contextTokens?: number;
      stageCache: import('./meetingNotesStageCache').NotesStageCache;
      cacheKey: string;
      onStage?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onRepair?: (task: import('./meetingNotesTypes').NotesTask) => void;
      onStageEvent?: import('./meetingNotesRunMetrics').NotesStageObserver;
      workClass?: import('./llmWorkClass').LLMWorkClass;
    },
  ): Promise<'generated' | 'reused' | 'discarded'>;
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
    options?: {
      signal?: AbortSignal;
      workClass?: import('./llmWorkClass').LLMWorkClass;
    },
  ): Promise<InternalSignalDocument>;
  extractSpeakerIdentity(transcript: string): Promise<string | null>;
  generateTitle(transcript: string): Promise<string>;
  synthesizeKnowledgeDocument(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      purpose?: 'projectScope' | 'commitmentReconciliation' | 'dreaming';
      responseSchema?: Record<string, unknown>;
      model?: string;
      promptVersion?: string;
      workClass?: import('./llmWorkClass').LLMWorkClass;
      onStart?: () => void;
    },
  ): Promise<string>;
  answerAskPluto(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      mode?: 'fast' | 'deep';
      live?: boolean;
      onStart?: () => void;
      onToken?: (delta: string) => void;
    },
  ): Promise<string>;
  classifyQueryIntent(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      workClass?: import('./llmWorkClass').LLMWorkClass;
    },
  ): Promise<string>;
  extractEntities(
    transcript: string,
    context?: EntityExtractionContext,
    options?: { signal?: AbortSignal },
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
  ollama_fast_model?: string;
  ollama_structured_thinking?: boolean;
  ollama_seed?: number;
  gemini_model?: string;
  openai_model?: string;
  claude_model?: string;
}
