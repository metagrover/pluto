/**
 * Stored meeting transcript shape (v2) + pipeline provenance.
 * Legacy meetings remain a raw JSON array of segments.
 */

export const TRANSCRIPT_JSON_SCHEMA_VERSION = 2;

/** Bump when attribution / merge / ASR routing logic changes materially. */
export const TRANSCRIPT_PIPELINE_VERSION = '1.1.0';

export type CanonicalTranscriptSource = 'mic' | 'mix';

export type StoredTranscriptV2 = {
  schemaVersion: typeof TRANSCRIPT_JSON_SCHEMA_VERSION;
  pipelineVersion: string;
  /** Full-session decode used for canonical hydration text. */
  canonicalSource: CanonicalTranscriptSource;
  /** Second stripLikelyMeBleed pass after hydration + cross-turn repairs. */
  postHydrationBleedPass: boolean;
  /** Count of Me segments dropped in post-hydration bleed pass (0 if none). */
  postHydrationBleedDroppedMe?: number;
  segments: unknown[];
};

export function buildTranscriptJsonPayload(
  segments: unknown[],
  options: {
    canonicalSource: CanonicalTranscriptSource;
    postHydrationBleedPass: boolean;
    postHydrationBleedDroppedMe?: number;
  },
): StoredTranscriptV2 {
  return {
    schemaVersion: TRANSCRIPT_JSON_SCHEMA_VERSION,
    pipelineVersion: TRANSCRIPT_PIPELINE_VERSION,
    canonicalSource: options.canonicalSource,
    postHydrationBleedPass: options.postHydrationBleedPass,
    postHydrationBleedDroppedMe: options.postHydrationBleedDroppedMe,
    segments,
  };
}
