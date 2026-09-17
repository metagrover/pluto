export type ProviderId =
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'gemini'
  | 'claude';

export type CloudProviderId = Exclude<ProviderId, 'ollama'>;

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
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  responseSchema?: Record<string, unknown>;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  egress: {
    classification: 'local' | 'selected_meeting_context';
    userInitiated: boolean;
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
  provider: CloudProviderId;
  configured: boolean;
  available: boolean;
  /** Redacted display-only hint. Never contains the complete credential. */
  maskedHint?: string;
  error?: 'secure_storage_unavailable' | 'credential_unreadable';
}
