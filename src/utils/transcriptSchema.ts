/**
 * Stored meeting transcript shape (v2) + pipeline provenance.
 * Legacy meetings remain a raw JSON array of segments.
 */

export const TRANSCRIPT_JSON_SCHEMA_VERSION = 2;

import type { LiveTranscriptResponsivenessSummary } from './liveTranscriptResponsiveness.ts';
import type { StopToValidatedLatencySummary } from './stopToValidatedLatency.ts';
/** Bump when attribution / merge / ASR routing logic changes materially. */
import type {
  TranscriptIntegrityEvidence,
  TranscriptIntegrityReason,
  TranscriptLifecycleStatus,
} from './transcriptIntegrity.ts';

export const TRANSCRIPT_PIPELINE_VERSION = '3.0.0';

export type CanonicalTranscriptSource = 'mic' | 'mix' | 'recovered_channels';
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
  diarizationRuntime?: {
    engine: 'sherpa-onnx';
    engineVersion: string;
    modelChecksums: string[];
  };
};

export type TranscriptSpeakerAttributionSource =
  | 'diarization'
  | 'local_diarization_acoustic'
  | 'channel_fallback';

export type TranscriptSpeakerAttributionFallbackReason =
  | 'diarization_disabled'
  | 'missing_diarization_audio'
  | 'diarization_error'
  | 'no_diarization_segments'
  | 'not_enough_speakers'
  | 'no_candidates'
  | 'low_me_overlap'
  | 'low_them_overlap'
  | 'ambiguous_speaker'
  | 'low_confidence'
  | 'missing_acoustic_evidence'
  | 'inconclusive_acoustic_evidence'
  | 'model_missing'
  | 'model_checksum_mismatch'
  | 'unknown_diarization_fallback';

export type StoredTranscriptSpeakerAttribution = {
  source: TranscriptSpeakerAttributionSource;
  confidence: number;
  diarizationAttempted: boolean;
  mappingApplied: boolean;
  fallbackReason?: TranscriptSpeakerAttributionFallbackReason;
  nearEndEvidenceAttempted?: boolean;
  engineVersion?: string;
  modelChecksums?: string[];
  injectedLocalWindows?: number;
  falseMeEvidenceSeconds?: number;
  missedMeEvidenceSeconds?: number;
};

export type StoredTranscriptIntegrity = TranscriptIntegrityEvidence & {
  reasons: TranscriptIntegrityReason[];
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
  speakerAttribution?: StoredTranscriptSpeakerAttribution;
  liveTranscriptResponsiveness?: LiveTranscriptResponsivenessSummary;
  stopToValidatedLatency?: StopToValidatedLatencySummary;
  lifecycleStatus?: TranscriptLifecycleStatus;
  integrity?: StoredTranscriptIntegrity;
  segments: unknown[];
};

const normalizeSpeakerAttributionFallbackReason = (
  reason?: string,
): TranscriptSpeakerAttributionFallbackReason | undefined => {
  if (!reason || !reason.trim()) return undefined;

  switch (reason.trim().toLowerCase().replace(/\s+/g, '_')) {
    case 'diarization_disabled':
    case 'missing_diarization_audio':
    case 'diarization_error':
    case 'no_diarization_segments':
    case 'not_enough_speakers':
    case 'no_candidates':
    case 'low_me_overlap':
    case 'low_them_overlap':
    case 'ambiguous_speaker':
    case 'low_confidence':
    case 'missing_acoustic_evidence':
    case 'inconclusive_acoustic_evidence':
    case 'model_missing':
    case 'model_checksum_mismatch':
      return reason
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_') as TranscriptSpeakerAttributionFallbackReason;
    default:
      return 'unknown_diarization_fallback';
  }
};

export function buildTranscriptSpeakerAttribution(options: {
  diarizationEnabled: boolean;
  diarizationAttempted?: boolean;
  mappingApplied?: boolean;
  confidence?: number;
  fallbackReason?: string;
  acousticEvidenceAttempted?: boolean;
  engineVersion?: string;
  modelChecksums?: string[];
  injectedLocalWindows?: number;
  falseMeEvidenceSeconds?: number;
  missedMeEvidenceSeconds?: number;
}): StoredTranscriptSpeakerAttribution {
  const diarizationAttempted = options.diarizationAttempted === true;
  const mappingApplied = options.mappingApplied === true;
  const confidence = Number.isFinite(options.confidence)
    ? Math.max(0, Math.min(1, Number(options.confidence)))
    : 0;
  const acousticMetadata = options.acousticEvidenceAttempted
    ? {
        nearEndEvidenceAttempted: true as const,
        ...(options.engineVersion
          ? { engineVersion: options.engineVersion }
          : {}),
        ...(options.modelChecksums
          ? { modelChecksums: options.modelChecksums }
          : {}),
        ...(options.injectedLocalWindows !== undefined
          ? { injectedLocalWindows: options.injectedLocalWindows }
          : {}),
        ...(options.falseMeEvidenceSeconds !== undefined
          ? { falseMeEvidenceSeconds: options.falseMeEvidenceSeconds }
          : {}),
        ...(options.missedMeEvidenceSeconds !== undefined
          ? { missedMeEvidenceSeconds: options.missedMeEvidenceSeconds }
          : {}),
      }
    : {};

  if (mappingApplied) {
    return {
      source: options.acousticEvidenceAttempted
        ? 'local_diarization_acoustic'
        : 'diarization',
      confidence,
      diarizationAttempted,
      mappingApplied: true,
      ...acousticMetadata,
    };
  }

  const fallbackReason =
    normalizeSpeakerAttributionFallbackReason(options.fallbackReason) ??
    (options.diarizationEnabled
      ? diarizationAttempted
        ? 'unknown_diarization_fallback'
        : 'missing_diarization_audio'
      : 'diarization_disabled');

  return {
    source: 'channel_fallback',
    confidence,
    diarizationAttempted,
    mappingApplied: false,
    fallbackReason,
    ...acousticMetadata,
  };
}

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
    speakerAttribution?: StoredTranscriptSpeakerAttribution;
    liveTranscriptResponsiveness?: LiveTranscriptResponsivenessSummary;
    stopToValidatedLatency?: StopToValidatedLatencySummary;
    lifecycleStatus?: TranscriptLifecycleStatus;
    integrity?: StoredTranscriptIntegrity;
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
    speakerAttribution: options.speakerAttribution,
    ...(options.liveTranscriptResponsiveness
      ? {
          liveTranscriptResponsiveness: options.liveTranscriptResponsiveness,
        }
      : {}),
    ...(options.stopToValidatedLatency
      ? { stopToValidatedLatency: options.stopToValidatedLatency }
      : {}),
    lifecycleStatus: options.lifecycleStatus,
    integrity: options.integrity,
    segments,
  };
}

export const withTranscriptLifecycleStatus = (
  transcriptJson: string | null | undefined,
  lifecycleStatus: 'validating' | 'needs_attention',
) => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as unknown;
    return JSON.stringify(
      Array.isArray(parsed)
        ? { segments: parsed, lifecycleStatus }
        : { ...(parsed as Record<string, unknown>), lifecycleStatus },
    );
  } catch {
    return JSON.stringify({ segments: [], lifecycleStatus });
  }
};

const WHISPER_HALLUCINATION_PATTERNS = [
  /thank\s+you\s+for\s+watching/i,
  /subtitles?\s+by/i,
  /amara\.org/i,
  /subscribe\s+to\s+my\s+channel/i,
  /thanks?\s+for\s+watching/i,
];

export function scrubTranscriptArtifacts(text: string): string {
  if (!text) return '';
  let cleaned = text;
  for (const pattern of WHISPER_HALLUCINATION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }
  if (/^[\s.,!?-]+$/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export function mergeAdjacentSpeakerSegments<
  T extends { speaker?: string; start: number; end: number; text: string },
>(segments: T[]): T[] {
  if (!segments || segments.length === 0) return [];
  const result: T[] = [];
  let current: T | null = null;

  for (const seg of segments) {
    const cleanText = scrubTranscriptArtifacts(seg.text);
    if (!cleanText) continue;

    if (!current) {
      current = { ...seg, text: cleanText };
      continue;
    }

    const sameSpeaker =
      (current.speaker || 'Unknown') === (seg.speaker || 'Unknown');
    const closeGap = seg.start - current.end <= 1.5;

    if (sameSpeaker && closeGap) {
      current.end = Math.max(current.end, seg.end);
      const endsWithPunct = /[.!?]$/.test(current.text);
      current.text = endsWithPunct
        ? `${current.text} ${cleanText}`.trim()
        : `${current.text}. ${cleanText}`.trim();
    } else {
      result.push(current);
      current = { ...seg, text: cleanText };
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

