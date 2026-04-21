/**
 * Stored meeting transcript shape (v2) + pipeline provenance.
 * Legacy meetings remain a raw JSON array of segments.
 */

export const TRANSCRIPT_JSON_SCHEMA_VERSION = 2;

/** Bump when attribution / merge / ASR routing logic changes materially. */
export const TRANSCRIPT_PIPELINE_VERSION = '1.2.0';

export type CanonicalTranscriptSource = 'mic' | 'mix';
export type TranscriptPipelineMode = 'legacy' | 'canonical_session_v2';

export type TranscriptTranscriptionMeta = {
  backend: string;
  preset: string;
  model: string;
  device: string;
  computeType: string;
  canonicalSource?: CanonicalTranscriptSource;
  diarization: boolean;
  elapsedMs: number;
  providerLabel?: string;
  warnings?: string[];
};

export type StoredTranscriptV2 = {
  schemaVersion: typeof TRANSCRIPT_JSON_SCHEMA_VERSION;
  pipelineVersion: string;
  pipelineMode?: TranscriptPipelineMode;
  sessionFallbackUsed?: boolean;
  sessionFallbackReasons?: string[];
  /** Full-session decode used for canonical hydration text. */
  canonicalSource: CanonicalTranscriptSource;
  /** Second stripLikelyMeBleed pass after hydration + cross-turn repairs. */
  postHydrationBleedPass: boolean;
  /** Count of Me segments dropped in post-hydration bleed pass (0 if none). */
  postHydrationBleedDroppedMe?: number;
  /** Primary transcript path used for the saved transcript, typically chunk STT. */
  transcription?: TranscriptTranscriptionMeta;
  /** Optional full-session fallback metadata when session recovery ran. */
  sessionFallbackTranscription?: TranscriptTranscriptionMeta;
  segments: unknown[];
};

export function buildTranscriptJsonPayload(
  segments: unknown[],
  options: {
    pipelineMode?: TranscriptPipelineMode;
    sessionFallbackUsed?: boolean;
    sessionFallbackReasons?: string[];
    canonicalSource: CanonicalTranscriptSource;
    postHydrationBleedPass: boolean;
    postHydrationBleedDroppedMe?: number;
    transcription?: TranscriptTranscriptionMeta;
    sessionFallbackTranscription?: TranscriptTranscriptionMeta;
  },
): StoredTranscriptV2 {
  return {
    schemaVersion: TRANSCRIPT_JSON_SCHEMA_VERSION,
    pipelineVersion: TRANSCRIPT_PIPELINE_VERSION,
    pipelineMode: options.pipelineMode,
    sessionFallbackUsed: options.sessionFallbackUsed,
    sessionFallbackReasons: options.sessionFallbackReasons,
    canonicalSource: options.canonicalSource,
    postHydrationBleedPass: options.postHydrationBleedPass,
    postHydrationBleedDroppedMe: options.postHydrationBleedDroppedMe,
    transcription: options.transcription,
    sessionFallbackTranscription: options.sessionFallbackTranscription,
    segments,
  };
}
