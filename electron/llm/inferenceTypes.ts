export type ProviderId =
  | 'ollama'
  | 'chatgpt'
  | 'openai'
  | 'openrouter'
  | 'gemini'
  | 'claude';

export type CloudProviderId = Exclude<ProviderId, 'ollama'>;
export type ApiKeyProviderId = Exclude<CloudProviderId, 'chatgpt'>;

export interface ContextEvidence {
  sourceId: string;
  kind: 'transcript' | 'note' | 'commitment' | 'person' | 'project' | 'turn';
  text: string;
  speaker?: string;
}

/** A local-only selection manifest. Adapters receive its bounded messages, never a database handle. */
export interface ContextBundle {
  evidence: ContextEvidence[];
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  tokenBudget: number;
  sourceRevision?: string;
}

export interface InferenceRequest {
  task: string;
  workClass?: import('./llmWorkClass').LLMWorkClass;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  responseSchema?: Record<string, unknown>;
  /** Strict mode only accepts a provider-specific JSON Schema subset. */
  responseSchemaStrict?: boolean;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  /** Additional attempts after a 429 response. Defaults to no retry. */
  rateLimitRetries?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  egress: {
    classification: 'local' | 'selected_meeting_context';
    userInitiated: boolean;
    /** The person chose ChatGPT for this question after a local memory refusal. */
    memoryFallback?: boolean;
  };
}

export interface InferenceResult {
  text: string;
  finishReason: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  latencyMs: number;
  requestedModel: string;
  resolvedModel: string;
  provider: ProviderId;
  upstream?: string;
  costUsd?: number;
}

export interface ProviderCredentialStatus {
  provider: ApiKeyProviderId;
  configured: boolean;
  available: boolean;
  /** Redacted display-only hint. Never contains the complete credential. */
  maskedHint?: string;
  error?: 'secure_storage_unavailable' | 'credential_unreadable';
}
