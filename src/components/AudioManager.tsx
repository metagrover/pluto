import { useEffect, useRef, useState } from 'react';
import {
  buildInitialValidatedMeetingPayload,
  markStopToValidatedLatencyUnavailable,
  persistDerivedAfterLatencyPatch,
  persistTranscriptThenRunLatencyPatchAndDownstream,
  startStopToValidatedLatencyAfterAcceptedStop,
} from '../services/diarizationFirstFinalization';
import { runRecordingTranscriptValidation } from '../services/recordingTranscriptValidation';
import {
  beginRetryLease,
  buildRetryDeadline,
} from '../services/transcriptValidationRetryLease';
import type { AnalysisDocumentV3 } from '../types';
import {
  deriveAttributionEvidence,
  injectLocalEvidenceWindows,
  mapDiarizationFromAcousticEvidence,
} from '../utils/acousticSpeakerAttribution';
import {
  analysisDocumentV3ToMarkdown,
  parseAnalysisDocumentV3Json,
} from '../utils/analysisDocument';
import {
  computeRms,
  createWavBlob,
  decodeFloat32PcmChunk,
  isCaptureChunkPairReady,
  resolvePcmTimelineSampleRate,
  trimPcmLeadingOverflow,
} from '../utils/audio';
import { startBoundedSampler } from '../utils/boundedSampler';
import { shouldUseMixForCanonicalTranscript } from '../utils/canonicalTranscriptEnv';
import { createCaptureActivitySession } from '../utils/captureActivitySession';
import { createCaptureJournalMutationCoordinator } from '../utils/captureJournalMutationCoordinator';
import {
  attachCaptureUnloadGuard,
  isCaptureSessionAlreadyActiveError,
} from '../utils/captureSessionGuard';
import { resolveProductionDiarizationProvider } from '../utils/diarizationProvider';
import {
  type LiveTranscriptResponsivenessSummary,
  createLiveTranscriptResponsivenessRuntime,
} from '../utils/liveTranscriptResponsiveness';
import { LiveTranscriptionQueue } from '../utils/liveTranscriptionQueue';
import { isGrantedStatus } from '../utils/permissions';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildRecoverableSealFailureMeeting,
  buildSpeakerAttributionRetryPlan,
  createSealedCaptureActivityHandoff,
  planForegroundTranscriptValidation,
  resolveFinalizationCleanupPaths,
  sealCaptureJournalBeforeFinalization,
} from '../utils/recordingFinalization';
import { getSessionFallbackDecision } from '../utils/sessionTranscriptionFallback';
import {
  type SpeakerActivityWindow,
  type WordTimestamp,
  applyCrossTurnAttributionRepairs,
  applyDiarizationRefinement,
  assignSpeakersToCanonicalSegments,
  decideNextSpeaker,
  dropShortCrossSpeakerEchoes,
  resolveCrossChannelDuplicates,
  resolveCrossChannelNearDuplicates,
  shouldApplyFullSessionMeRecovery,
  shouldDropBySpeakerActivity,
  splitCanonicalSegmentsAtChannelBoundaries,
  splitSegmentsAtDiarizationBoundaries,
  stripLikelyMeBleedSegments,
} from '../utils/speakerAttribution';
import {
  type StopToValidatedLatencySummary,
  createStopToValidatedLatencyAccumulator,
} from '../utils/stopToValidatedLatency';
import {
  type TimedAudioChunk,
  shouldUseSystemAudioReconstructionFallback,
} from '../utils/systemAudioReconstruction';
import type { CaptureActivityEvidence } from '../utils/transcriptActivityEvidence';
import { canonicalizeTranscriptCheckpointConfig } from '../utils/transcriptCheckpointConfig';
import { evaluateLiveTranscriptCoverage } from '../utils/transcriptIntegrity';
import {
  type CanonicalTranscriptSource,
  type StoredTranscriptSpeakerAttribution,
  type TranscriptPipelineMode,
  type TranscriptTranscriptionMeta,
  buildTranscriptJsonPayload,
  buildTranscriptSpeakerAttribution,
  withTranscriptLifecycleStatus,
} from '../utils/transcriptSchema';
import { TRANSCRIPTION_TUNING } from '../utils/transcriptionConfig';
import {
  type TranscriptionSettings,
  resolveLiveChunkComputeType,
  resolveLiveChunkModel,
  resolveTranscriptionLanguage,
  resolveTranscriptionSettings,
} from '../utils/transcriptionSettings';
import {
  KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
  type TranscriptionVocabularySelection,
} from '../utils/transcriptionVocabulary';
import {
  type CaptureHealth,
  type CaptureHealthState,
  type LiveTranscriptIntegrity,
  type LiveTranscriptSegment,
  resolveSystemCaptureHealth,
  scheduleSystemCaptureTimeout,
  withCaptureDurabilityWarning,
} from './features/recordingWorkspaceModel';

interface AudioManagerProps {
  onTranscript: (text: string) => void;
  onSessionComplete: (meetingId?: string | number) => void;
  onRecordingChange?: (isRecording: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onSpeakingChange?: (speaker: 'Me' | 'Them' | null) => void;
  onLiveTranscript?: (segments: LiveTranscriptSegment[]) => void;
  onInterimTranscript?: (text: string) => void;
  onCaptureHealthChange?: (health: CaptureHealthState) => void;
  onLiveTranscriptIntegrityChange?: (state: LiveTranscriptIntegrity) => void;
  onRecordingStarted?: (startedAtMs: number) => void;
  userNotes?: string;
  userTitle?: string;
  participants?: string[];
  systemAudioStatus?: string;
  transcriptionSettings?: TranscriptionSettings;

  onStopSessionRef?: React.MutableRefObject<
    ((endReason?: string) => void) | null
  >;
  onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
}

interface TranscriptionSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  speaker: string;
  words?: WordTimestamp[];
}

type MicChunkFormat = 'webm' | 'ogg' | 'wav';
type NativeAudioChunk =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | { type: 'Buffer'; data: number[] }
  | null
  | undefined;

const isBufferJson = (
  chunk: unknown,
): chunk is { type: 'Buffer'; data: number[] } => {
  if (!chunk || typeof chunk !== 'object') return false;
  const record = chunk as { type?: unknown; data?: unknown };
  return record.type === 'Buffer' && Array.isArray(record.data);
};

interface PendingMicChunk {
  blob: Blob;
  format: MicChunkFormat;
  chunkStartSec: number;
  chunkEndSec: number;
}

type JournalManifestState = {
  schemaVersion: 3;
  generation: string;
  revision: number;
};

type JournalAudioReceipt = {
  meetingId: string;
  generation: string;
  manifestRevision: number;
  source: 'mic' | 'system';
  sequence: number;
  checksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  repairAudioRelativePath: string | null;
};

type JournalRawChunkState = {
  checksumSha256: string;
  format: MicChunkFormat;
};

type JournalCheckpointState = {
  transcriptChecksumSha256: string;
};

interface InternalSignalTag {
  tag: string;
  confidence: number;
}

interface InternalSignalDocument {
  analysis_schema_version: number;
  continuity: string[];
  accountability_risks: string[];
  decision_impacts: string[];
  extra_tags: InternalSignalTag[];
}

interface AnalysisQuality {
  format_pass: boolean;
  retry_count: number;
  fallback_used: boolean;
  issues: string[];
}

interface AnalysisDocument {
  analysis_schema_version: number;
  summary: string[];
  key_points: string[];
  action_items: string[];
  decisions: string[];
  quality: AnalysisQuality;
}

interface AnalysisArtifacts {
  analysis: AnalysisDocumentV3 | AnalysisDocument;
  signals: InternalSignalDocument;
}

const emptyValueSignals = (): InternalSignalDocument => ({
  analysis_schema_version: 2,
  continuity: [],
  accountability_risks: [],
  decision_impacts: [],
  extra_tags: [],
});

const emptyAnalysisDocument = (): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: 'Missing analysis document',
  topics: [],
  all_action_items: [],
  all_decisions: [],
  meeting_type: 'general',
  quality: {
    format_pass: false,
    retry_count: 1,
    fallback_used: true,
    issues: ['Missing analysis document'],
  },
});

const TRANSCRIPT_DEBUG_ENABLED: boolean =
  (typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.PLUTO_TRANSCRIPT_DEBUG === '1') ||
  Boolean(
    (globalThis as unknown as { __PLUTO_TRANSCRIPT_DEBUG__?: unknown })
      .__PLUTO_TRANSCRIPT_DEBUG__ === true,
  );

/** One-line pipeline summary (canonical splits, hydration mode, diarization). */
const TRANSCRIPT_PIPELINE_LOG: boolean =
  TRANSCRIPT_DEBUG_ENABLED ||
  (typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.PLUTO_TRANSCRIPT_PIPELINE_LOG === '1');

const normalizeSignalTag = (value: unknown): InternalSignalTag | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const tag =
    typeof record.tag === 'string' ? record.tag.trim().toLowerCase() : '';
  if (!tag) return null;
  const confidence =
    typeof record.confidence === 'number' ? record.confidence : 0.5;
  return {
    tag,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
};

const normalizeSignalList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
};

const normalizeValueSignals = (value: unknown): InternalSignalDocument => {
  if (!value || typeof value !== 'object') {
    return emptyValueSignals();
  }
  const record = value as Record<string, unknown>;
  const rawTags = Array.isArray(record.extra_tags) ? record.extra_tags : [];
  const dedupedTags = new Map<string, number>();
  for (const rawTag of rawTags) {
    const tag = normalizeSignalTag(rawTag);
    if (!tag) continue;
    const existing = dedupedTags.get(tag.tag);
    if (existing === undefined || tag.confidence > existing) {
      dedupedTags.set(tag.tag, tag.confidence);
    }
  }
  return {
    analysis_schema_version: 2,
    continuity: normalizeSignalList(record.continuity),
    accountability_risks: normalizeSignalList(record.accountability_risks),
    decision_impacts: normalizeSignalList(record.decision_impacts),
    extra_tags: Array.from(dedupedTags.entries())
      .map(([tag, confidence]) => ({ tag, confidence }))
      .slice(0, 8),
  };
};
// We keep these for v2 compatibility but prefer the v3 utilities in new code.
// The raw artifacts now return v3 by default.
const normalizeAnalysisDocument = (
  value: unknown,
): AnalysisDocumentV3 | AnalysisDocument => {
  if (!value || typeof value !== 'object') {
    return emptyAnalysisDocument();
  }
  const record = value as Record<string, unknown>;

  if (record.analysis_schema_version === 3) {
    // Rely on the imported parseAnalysisDocumentV3Json for normalization
    const v3Doc = parseAnalysisDocumentV3Json(JSON.stringify(value));
    return v3Doc || emptyAnalysisDocument();
  }

  // legacy v2 normalization
  const normalizeList = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  };
  const quality =
    record.quality && typeof record.quality === 'object'
      ? (record.quality as Record<string, unknown>)
      : {};
  return {
    analysis_schema_version: 2,
    summary: normalizeList(record.summary),
    key_points: normalizeList(record.key_points),
    action_items: normalizeList(record.action_items),
    decisions: normalizeList(record.decisions),
    quality: {
      format_pass: Boolean(quality.format_pass),
      retry_count:
        typeof quality.retry_count === 'number' ? quality.retry_count : 0,
      fallback_used: Boolean(quality.fallback_used),
      issues: Array.isArray(quality.issues)
        ? quality.issues.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
    },
  };
};

const analysisDocumentToMarkdownV2 = (doc: AnalysisDocument): string => {
  const summaryBody =
    doc.summary.length > 0
      ? doc.summary.join('\n\n')
      : 'No summary was generated for this meeting.';
  const keyPointsBody =
    doc.key_points.length > 0
      ? doc.key_points.map((item) => `- ${item}`).join('\n')
      : '- No key points were captured.';
  const actionItemsBody =
    doc.action_items.length > 0
      ? doc.action_items.map((item) => `- [ ] ${item}`).join('\n')
      : '- [ ] No concrete action items were explicitly committed.';
  const decisionsBody =
    doc.decisions.length > 0
      ? doc.decisions.map((item) => `- ${item}`).join('\n')
      : '- No explicit decisions were made.';

  return [
    '## Summary',
    summaryBody,
    '',
    '## Key Points',
    keyPointsBody,
    '',
    '## Action Items',
    actionItemsBody,
    '',
    '## Decisions',
    decisionsBody,
  ].join('\n');
};

const analysisDocumentToMarkdown = (
  doc: AnalysisDocument | AnalysisDocumentV3,
): string => {
  if (doc.analysis_schema_version === 3) {
    return analysisDocumentV3ToMarkdown(doc as AnalysisDocumentV3);
  }
  return analysisDocumentToMarkdownV2(doc as AnalysisDocument);
};

export const AudioManager = ({
  onTranscript,
  onSessionComplete,
  onRecordingChange,
  onProcessingChange,
  userNotes = '',
  userTitle = '',
  participants = [],
  transcriptionSettings,
  onStopSessionRef,
  onStartSessionRef,
  onSpeakingChange,
  onLiveTranscript,
  onInterimTranscript,
  onCaptureHealthChange,
  onLiveTranscriptIntegrityChange,
  onRecordingStarted,
  systemAudioStatus = 'unknown',
}: AudioManagerProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const captureHealthRef = useRef<CaptureHealthState>({
    microphone: 'healthy',
    systemAudio: 'healthy',
    captureDurability: 'healthy',
  });

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
  const [isProcessing, setIsProcessing] = useState(false);

  const resolvedTranscriptionSettings = resolveTranscriptionSettings(
    transcriptionSettings,
  );
  const CHUNK_SECONDS =
    resolvedTranscriptionSettings.backend === 'local_alt_apple_silicon'
      ? 5
      : 30;
  const resolvedLanguage = resolveTranscriptionLanguage(
    transcriptionSettings?.language,
  );
  const resolvedChunkModel = resolveLiveChunkModel(
    resolvedTranscriptionSettings.model,
  );
  const resolvedChunkComputeType = resolveLiveChunkComputeType(
    resolvedTranscriptionSettings.computeType,
  );
  const buildTranscriptionOptions = (
    overrides: Record<string, unknown> = {},
  ) => {
    const canonicalSource =
      overrides.canonicalSource === 'mic' || overrides.canonicalSource === 'mix'
        ? (overrides.canonicalSource as CanonicalTranscriptSource)
        : null;
    const isChunkTranscription = canonicalSource === null;

    return {
      backend: resolvedTranscriptionSettings.backend,
      preset: resolvedTranscriptionSettings.preset,
      model: isChunkTranscription
        ? resolvedChunkModel
        : resolvedTranscriptionSettings.model,
      device: resolvedTranscriptionSettings.device,
      computeType: isChunkTranscription
        ? resolvedChunkComputeType
        : resolvedTranscriptionSettings.computeType,
      language: resolvedLanguage,
      meetingId: currentMeetingIdRef.current,
      wordTimestamps: !isChunkTranscription,
      initialPrompt:
        transcriptionVocabularyRef.current.initialPrompt ?? undefined,
      vocabularyHintPolicyVersion:
        transcriptionVocabularyRef.current.provenance.policyVersion,
      vocabularyHintCount:
        transcriptionVocabularyRef.current.provenance.hintCount,
      ...overrides,
    };
  };
  // Mic/system channel ownership already provides the user-facing Me/Them
  // labels. Keep speaker clustering off the stop critical path so the
  // checkpoint transcript can become visible immediately.
  const diarizationEnabled = false;

  // Refs - Dual Recording for source-based speaker labeling
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micMimeTypeRef = useRef<string | null>(null);

  const micChunksRef = useRef<Blob[]>([]);
  const systemChunksRef = useRef<Blob[]>([]);

  const micChunkIndexRef = useRef(0);
  const systemChunkIndexRef = useRef(0);

  const systemPcmChunksRef = useRef<Float32Array[]>([]);
  const fullSessionSystemPcmChunksRef = useRef<Float32Array[]>([]);
  const systemPcmCarryoverBytesRef = useRef<Uint8Array>(new Uint8Array(0));
  const systemPcmSampleRateRef = useRef(48000);
  const systemChunkDecodeDropCountRef = useRef(0);
  const micPcmChunksRef = useRef<Float32Array[]>([]);
  const micPcmSampleRateRef = useRef(48000);
  const micPcmSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micPcmSinkRef = useRef<GainNode | null>(null);
  const nativeAudioListenerRef = useRef<
    | ((
        event: unknown,
        chunk: Uint8Array | ArrayBuffer | null | undefined,
      ) => void)
    | null
  >(null);
  const systemAudioChunkSeenRef = useRef(false);
  const systemAudioHealthRef = useRef<CaptureHealth>('warning');
  const cancelSystemAudioHealthTimeoutRef = useRef<(() => void) | null>(null);

  const stopSpeakingSamplerRef = useRef<(() => void) | null>(null);
  const lastSpeakerRef = useRef<'Me' | 'Them' | null>(null);
  const lastSpeakerTsRef = useRef<number>(0);
  const speakerTimelineRef = useRef<SpeakerActivityWindow[]>([]);
  const captureActivitySessionRef = useRef<ReturnType<
    typeof createCaptureActivitySession
  > | null>(null);
  const activeSpeakerWindowRef = useRef<{
    speaker: 'Me' | 'Them';
    startTime: number;
  } | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);

  const hasMicRecorderRef = useRef(false);
  const hasSystemRecorderRef = useRef(false);

  const pendingMicChunksRef = useRef(new Map<number, PendingMicChunk>());
  const pendingSystemChunksRef = useRef(new Map<number, Blob>());
  const lastMicChunkBoundarySecRef = useRef(0);
  const systemRmsRef = useRef<number>(0);
  const systemRmsUpdatedAtRef = useRef<number>(0);
  const savedSystemChunkAudioRef = useRef<Map<number, TimedAudioChunk>>(
    new Map(),
  );
  const processingQueueRef = useRef(
    new LiveTranscriptionQueue({
      onError: (error) => {
        console.error('[Pluto] Background transcription job failed:', error);
      },
    }),
  );
  const liveTranscriptionGenerationRef = useRef(0);
  const transcriptionVocabularyRef = useRef<TranscriptionVocabularySelection>({
    initialPrompt: null,
    provenance: {
      policyVersion: KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
      hintCount: 0,
    },
  });
  const liveTranscriptResponsivenessRef = useRef(
    createLiveTranscriptResponsivenessRuntime({
      now: () => performance.now(),
    }),
  );
  const frozenLiveTranscriptResponsivenessRef =
    useRef<LiveTranscriptResponsivenessSummary | null>(null);
  const stopToValidatedLatencyRef = useRef(
    createStopToValidatedLatencyAccumulator(),
  );
  const processedMicSegmentsRef = useRef<TranscriptionSegment[]>([]);
  const zeroMicChunkStreakRef = useRef(0);
  const micChunkConversionFailuresRef = useRef(0);
  const disableMicChunkTranscriptionRef = useRef(false);
  const micWebmInitSegmentRef = useRef<ArrayBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const recordingEndedAtRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const visStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const isRecordingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const currentMeetingIdRef = useRef<string | null>(null);
  const captureJournalStateRef = useRef<JournalManifestState | null>(null);
  const captureJournalRawChunksRef = useRef(
    new Map<string, JournalRawChunkState>(),
  );
  const captureJournalReceiptsRef = useRef(
    new Map<string, JournalAudioReceipt>(),
  );
  const captureJournalCheckpointsRef = useRef(
    new Map<string, JournalCheckpointState>(),
  );
  const captureJournalMutationCoordinatorRef = useRef(
    createCaptureJournalMutationCoordinator(),
  );

  // Keep state refs in sync
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  const publishCaptureHealth = (health: CaptureHealthState) => {
    captureHealthRef.current = health;
    onCaptureHealthChange?.(health);
  };

  const warnCaptureDurability = () => {
    publishCaptureHealth(
      withCaptureDurabilityWarning(captureHealthRef.current),
    );
  };

  // --- Native Capture Logic ---
  // Functions defined below, event listeners set up after

  const journalTupleKey = (source: 'mic' | 'system', sequence: number) =>
    `${source}:${sequence}`;

  const sha256Hex = async (value: string) => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };

  const refreshCaptureJournalState = async (meetingId: string) => {
    const manifest = (await window.ipcRenderer.invoke(
      'AUDIO_CAPTURE_JOURNAL_READ',
      { meetingId },
    )) as JournalManifestState;
    if (manifest?.schemaVersion !== 3) return null;
    captureJournalStateRef.current = manifest;
    return manifest;
  };

  const appendCaptureJournalBlob = async ({
    meetingId,
    source,
    sequence,
    chunkStartSec,
    chunkEndSec,
    format,
    blob,
  }: {
    meetingId: string;
    source: 'mic' | 'system';
    sequence: number;
    chunkStartSec: number;
    chunkEndSec: number;
    format: MicChunkFormat;
    blob: Blob;
  }): Promise<JournalAudioReceipt | null> => {
    const data = await blob.arrayBuffer();
    const journalData =
      source === 'mic' &&
      format === 'webm' &&
      sequence > 0 &&
      micWebmInitSegmentRef.current
        ? prependWebmInitSegment(micWebmInitSegmentRef.current, data)
        : data;
    return await captureJournalMutationCoordinatorRef.current.run(async () => {
      const state =
        captureJournalStateRef.current ??
        (await refreshCaptureJournalState(meetingId));
      if (!state) return null;
      if (source === 'mic') {
        const current = await refreshCaptureJournalState(meetingId);
        if (!current) return null;
        const authorized = (await window.ipcRenderer.invoke(
          'AUDIO_CAPTURE_JOURNAL_INTERVAL_AUTHORIZE',
          {
            meetingId,
            generation: current.generation,
            expectedRevision: current.revision,
            sequence,
            chunkStartSec,
            chunkEndSec,
          },
        )) as JournalManifestState;
        captureJournalStateRef.current = authorized;
      }
      const current = await refreshCaptureJournalState(meetingId);
      if (!current) return null;
      const rawManifest = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_RAW_APPEND',
        {
          meetingId,
          generation: current.generation,
          expectedRevision: current.revision,
          source,
          sequence,
          format,
          data: journalData,
        },
      )) as JournalManifestState & {
        intervals?: Array<{
          sequence: number;
          sources: Record<
            'mic' | 'system',
            { disposition: string; rawChecksumSha256?: string }
          >;
        }>;
      };
      captureJournalStateRef.current = rawManifest;
      const rawChecksumSha256 = rawManifest.intervals?.find(
        (interval) => interval.sequence === sequence,
      )?.sources[source]?.rawChecksumSha256;
      if (!rawChecksumSha256) return null;
      captureJournalRawChunksRef.current.set(
        journalTupleKey(source, sequence),
        {
          checksumSha256: rawChecksumSha256,
          format,
        },
      );
      if (format !== 'wav') return null;
      const complete = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE',
        {
          meetingId,
          generation: rawManifest.generation,
          expectedRevision: rawManifest.revision,
          source,
          sequence,
          rawChecksumSha256,
          repairData: data,
        },
      )) as { manifest: JournalManifestState; receipt: JournalAudioReceipt };
      captureJournalStateRef.current = complete.manifest;
      captureJournalReceiptsRef.current.set(
        journalTupleKey(source, sequence),
        complete.receipt,
      );
      return complete.receipt;
    });
  };

  const completeCaptureJournalChunkFromPath = async ({
    meetingId,
    source,
    sequence,
    repairPath,
  }: {
    meetingId: string;
    source: 'mic' | 'system';
    sequence: number;
    repairPath: string;
  }) => {
    return await captureJournalMutationCoordinatorRef.current.run(async () => {
      const tuple = journalTupleKey(source, sequence);
      const existing = captureJournalReceiptsRef.current.get(tuple);
      if (existing) return existing;
      const raw = captureJournalRawChunksRef.current.get(tuple);
      const current = await refreshCaptureJournalState(meetingId);
      if (!raw || !current) return null;
      const complete = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE',
        {
          meetingId,
          generation: current.generation,
          expectedRevision: current.revision,
          source,
          sequence,
          rawChecksumSha256: raw.checksumSha256,
          repairPath,
        },
      )) as { manifest: JournalManifestState; receipt: JournalAudioReceipt };
      captureJournalStateRef.current = complete.manifest;
      captureJournalReceiptsRef.current.set(tuple, complete.receipt);
      return complete.receipt;
    });
  };

  const buildTranscriptCheckpointConfig = () => {
    const resolved = resolveTranscriptionSettings(transcriptionSettings);
    const language = resolveTranscriptionLanguage(resolved.language);
    return {
      backend: resolved.backend,
      computeType: resolvedChunkComputeType,
      device: resolved.device,
      languageMode: language ? ('fixed' as const) : ('detected' as const),
      requestedLanguage: language?.toLowerCase() || null,
      model: resolvedChunkModel,
      pipelineVersion: 'live_chunk_v1' as const,
      preset: resolved.preset,
    };
  };

  const persistTranscriptCheckpoint = async ({
    meetingId,
    source,
    sequence,
    segments,
    backendResult,
    disposition = 'transcribed',
  }: {
    meetingId: string;
    source: 'mic' | 'system';
    sequence: number;
    segments: TranscriptionSegment[];
    backendResult?: { language?: string; meta?: Record<string, unknown> };
    disposition?:
      | 'transcribed'
      | 'verified_silence'
      | 'conversion_failed'
      | 'transcription_failed'
      | 'cancelled';
  }) => {
    return await captureJournalMutationCoordinatorRef.current.run(async () => {
      const tuple = journalTupleKey(source, sequence);
      const receipt = captureJournalReceiptsRef.current.get(tuple);
      if (!receipt) return null;
      const config = buildTranscriptCheckpointConfig();
      const configKey = await sha256Hex(
        canonicalizeTranscriptCheckpointConfig(config),
      );
      const sidecar = {
        schemaVersion: 1 as const,
        meetingId,
        source: source,
        sequence,
        chunkChecksumSha256: receipt.checksumSha256,
        chunkStartSec: receipt.chunkStartSec,
        chunkEndSec: receipt.chunkEndSec,
        transcriptionConfig: config,
        backendResult: {
          detectedLanguage:
            typeof backendResult?.language === 'string'
              ? backendResult.language.toLowerCase()
              : null,
          providerLabel:
            typeof backendResult?.meta?.providerLabel === 'string'
              ? backendResult.meta.providerLabel
              : 'local',
        },
        segments: segments.map((segment) => ({
          start: Math.max(0, segment.startTime - receipt.chunkStartSec),
          end: Math.max(0, segment.endTime - receipt.chunkStartSec),
          text: segment.text,
          ...(segment.words
            ? {
                words: segment.words.map((word) => ({
                  word: word.word,
                  start: Math.max(0, word.start - receipt.chunkStartSec),
                  end: Math.max(0, word.end - receipt.chunkStartSec),
                })),
              }
            : {}),
        })),
      };
      const current = await refreshCaptureJournalState(meetingId);
      if (!current) return null;
      const saved = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_CHECKPOINT_APPEND',
        {
          receipt,
          expectedManifestRevision: current.revision,
          transcriptionConfigKey: configKey,
          sidecar,
          disposition,
        },
      )) as {
        manifest: JournalManifestState;
        checkpoint: JournalCheckpointState;
      };
      captureJournalStateRef.current = saved.manifest;
      captureJournalCheckpointsRef.current.set(tuple, saved.checkpoint);
      return saved.checkpoint;
    });
  };

  const persistTranscriptAcceptanceFrame = async ({
    meetingId,
    sequence,
    chunkStartSec,
    chunkEndSec,
    micSegments,
    systemSegments,
    micMeanRms,
    systemMeanRms,
    systemExpected,
  }: {
    meetingId: string;
    sequence: number;
    chunkStartSec: number;
    chunkEndSec: number;
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
    micMeanRms: number | null;
    systemMeanRms: number | null;
    systemExpected: boolean;
  }) => {
    const micCheckpoint = captureJournalCheckpointsRef.current.get(
      journalTupleKey('mic', sequence),
    );
    const systemCheckpoint = captureJournalCheckpointsRef.current.get(
      journalTupleKey('system', sequence),
    );
    if (!micCheckpoint || (systemExpected && !systemCheckpoint)) return null;
    const activityInputs = {
      chunkStartSec,
      chunkEndSec,
      micMeanRms: micMeanRms ?? 0,
      systemMeanRms: systemMeanRms ?? 0,
      micActivitySeconds: getSpeakerActivityCoverage(
        chunkStartSec,
        chunkEndSec,
        'Me',
      ),
      systemActivitySeconds: getSpeakerActivityCoverage(
        chunkStartSec,
        chunkEndSec,
        'Them',
      ),
      evidence: {
        clock: {
          kind: 'meeting_relative_seconds',
          origin: 'recording_start',
        },
        thresholds: {
          rms: TRANSCRIPTION_TUNING.speaking.rmsThreshold,
          dominanceRatio: TRANSCRIPTION_TUNING.speaking.ratio,
          minimumSwitchIntervalMs: TRANSCRIPTION_TUNING.speaking.minIntervalMs,
        },
        algorithmVersion: 'speaker_activity_v1',
        serializationVersion: 1,
        windows:
          captureActivitySessionRef.current
            ?.windows()
            .filter(
              (window) =>
                window.endTime > chunkStartSec &&
                window.startTime < chunkEndSec,
            ) ?? [],
      },
    };
    const activityEvidenceDigestSha256 = await sha256Hex(
      JSON.stringify(activityInputs),
    );
    const sidecar = {
      schemaVersion: 1,
      meetingId,
      sequence,
      arbitrationVersion: 'chunk_arbitration_v1',
      activityInputs,
      segments: [
        ...micSegments.map((segment) => ({
          source: 'mic',
          start: segment.startTime + chunkStartSec,
          end: segment.endTime + chunkStartSec,
          text: segment.text,
          words: segment.words,
        })),
        ...systemSegments.map((segment) => ({
          source: 'system',
          start: segment.startTime + chunkStartSec,
          end: segment.endTime + chunkStartSec,
          text: segment.text,
          words: segment.words,
        })),
      ],
    };
    return await captureJournalMutationCoordinatorRef.current.run(async () => {
      const current = await refreshCaptureJournalState(meetingId);
      if (!current) return null;
      const saved = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_ACCEPTANCE_APPEND',
        {
          meetingId,
          generation: current.generation,
          expectedRevision: current.revision,
          sequence,
          micCheckpointChecksumSha256:
            micCheckpoint?.transcriptChecksumSha256 ?? null,
          systemCheckpointChecksumSha256:
            systemCheckpoint?.transcriptChecksumSha256 ?? null,
          activityEvidenceDigestSha256,
          sidecar,
        },
      )) as { manifest: JournalManifestState };
      captureJournalStateRef.current = saved.manifest;
      return saved;
    });
  };

  const hasCompleteCaptureJournalCheckpoints = async (meetingId: string) => {
    const manifest = (await window.ipcRenderer.invoke(
      'AUDIO_CAPTURE_JOURNAL_READ',
      { meetingId },
    )) as {
      schemaVersion?: number;
      lifecycleState?: string;
      generation?: string;
      revision?: number;
      intervals?: Array<{
        sequence: number;
        sources: Record<'mic' | 'system', { disposition: string }>;
      }>;
      transcriptCheckpoints?: Array<{
        source: 'mic' | 'system';
        sequence: number;
        disposition: string;
      }>;
      acceptanceFrames?: Array<{ sequence: number }>;
    };
    if (
      manifest.schemaVersion !== 3 ||
      manifest.lifecycleState !== 'sealed' ||
      !Array.isArray(manifest.intervals) ||
      !Array.isArray(manifest.transcriptCheckpoints) ||
      !Array.isArray(manifest.acceptanceFrames)
    ) {
      return false;
    }
    const checkpoints = new Set(
      manifest.transcriptCheckpoints
        .filter(
          (checkpoint) =>
            checkpoint.disposition === 'transcribed' ||
            checkpoint.disposition === 'verified_silence',
        )
        .map((checkpoint) =>
          journalTupleKey(checkpoint.source, checkpoint.sequence),
        ),
    );
    const acceptanceSequences = new Set(
      manifest.acceptanceFrames.map((frame) => frame.sequence),
    );
    const structurallyComplete = manifest.intervals.every(
      (interval) =>
        acceptanceSequences.has(interval.sequence) &&
        (['mic', 'system'] as const).every((source) => {
          const disposition = interval.sources[source]?.disposition;
          if (
            disposition === 'verified_silence' ||
            disposition === 'source_unavailable'
          ) {
            return true;
          }
          return (
            disposition === 'captured' &&
            checkpoints.has(journalTupleKey(source, interval.sequence))
          );
        }),
    );
    if (!structurallyComplete) return false;
    try {
      const verified = (await window.ipcRenderer.invoke(
        'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT',
        {
          meetingId,
          expectedConfigKey: await sha256Hex(
            canonicalizeTranscriptCheckpointConfig(
              buildTranscriptCheckpointConfig(),
            ),
          ),
        },
      )) as { generation?: string; revision?: number };
      return (
        verified.generation === manifest.generation &&
        verified.revision === manifest.revision
      );
    } catch {
      return false;
    }
  };

  const abortUnstartedCapture = async (meetingId: string) => {
    try {
      await window.ipcRenderer.invoke('AUDIO_CAPTURE_JOURNAL_ABORT_START', {
        meetingId,
      });
    } catch (error) {
      console.warn('[Pluto] Failed to release unstarted capture');
    }
  };

  const startSession = async () => {
    if (
      isRecordingRef.current ||
      isProcessingRef.current ||
      stopInFlightRef.current
    ) {
      console.warn('[Pluto] Ignoring duplicate start request');
      return;
    }

    try {
      const meetingId = crypto.randomUUID();
      currentMeetingIdRef.current = meetingId;
      transcriptionVocabularyRef.current = {
        initialPrompt: null,
        provenance: {
          policyVersion: KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
          hintCount: 0,
        },
      };
      liveTranscriptionGenerationRef.current += 1;
      processingQueueRef.current = new LiveTranscriptionQueue({
        onError: (error) => {
          console.error('[Pluto] Background transcription job failed:', error);
        },
      });
      startTimeRef.current = Date.now();
      stopToValidatedLatencyRef.current =
        createStopToValidatedLatencyAccumulator();
      liveTranscriptResponsivenessRef.current.acceptStart();
      frozenLiveTranscriptResponsivenessRef.current = null;
      captureActivitySessionRef.current = createCaptureActivitySession({
        producer: {
          clock: {
            kind: 'meeting_relative_seconds',
            origin: 'recording_start',
          },
          thresholds: {
            rms: TRANSCRIPTION_TUNING.speaking.rmsThreshold,
            dominanceRatio: TRANSCRIPTION_TUNING.speaking.ratio,
            minimumSwitchIntervalMs:
              TRANSCRIPTION_TUNING.speaking.minIntervalMs,
          },
          algorithmVersion: 'speaker_activity_v1',
        },
        persistSnapshot: async (activityEvidence) => {
          await captureJournalMutationCoordinatorRef.current.run(async () => {
            const manifest = (await window.ipcRenderer.invoke(
              'AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE',
              { meetingId, activityEvidence },
            )) as JournalManifestState;
            captureJournalStateRef.current = manifest;
          });
        },
      });
      console.log('[Pluto] Starting recording session (Robust Mic First)...');
      try {
        const manifest = (await window.ipcRenderer.invoke(
          'AUDIO_CAPTURE_JOURNAL_START',
          {
            meetingId,
            startedAtMs: startTimeRef.current,
            sourceAvailability: {
              system: isGrantedStatus(systemAudioStatus)
                ? 'available'
                : 'unavailable_at_start',
            },
          },
        )) as JournalManifestState;
        captureJournalStateRef.current =
          manifest?.schemaVersion === 3 ? manifest : null;
        captureJournalRawChunksRef.current.clear();
        captureJournalReceiptsRef.current.clear();
        captureJournalCheckpointsRef.current.clear();
      } catch (journalErr) {
        if (isCaptureSessionAlreadyActiveError(journalErr)) {
          console.warn(
            '[Pluto] Recording start rejected: capture already active',
          );
          currentMeetingIdRef.current = null;
          liveTranscriptResponsivenessRef.current.abortStart();
          frozenLiveTranscriptResponsivenessRef.current = null;
          captureActivitySessionRef.current = null;
          startTimeRef.current = 0;
          recordingEndedAtRef.current = 0;
          stopInFlightRef.current = false;
          isRecordingRef.current = false;
          setIsRecording(false);
          alert(
            'Another recording is already active. Finish it before starting a new recording.',
          );
          return;
        }
        console.warn(
          '[Pluto] Failed to initialize capture journal:',
          journalErr,
        );
        currentMeetingIdRef.current = null;
        liveTranscriptResponsivenessRef.current.abortStart();
        frozenLiveTranscriptResponsivenessRef.current = null;
        captureActivitySessionRef.current = null;
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        stopInFlightRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);
        alert('Recording could not start securely. Please try again.');
        return;
      }

      try {
        const vocabulary = (await window.ipcRenderer.invoke(
          'GET_TRANSCRIPTION_VOCABULARY',
          { participants },
        )) as TranscriptionVocabularySelection;
        const initialPrompt =
          typeof vocabulary?.initialPrompt === 'string' &&
          vocabulary.initialPrompt.length <= 240
            ? vocabulary.initialPrompt
            : null;
        const hintCount = Number.isInteger(vocabulary?.provenance?.hintCount)
          ? Math.max(0, Math.min(12, vocabulary.provenance.hintCount))
          : 0;
        transcriptionVocabularyRef.current = {
          initialPrompt,
          provenance: {
            policyVersion: KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
            hintCount: initialPrompt ? hintCount : 0,
          },
        };
        console.log(
          '[Pluto] Transcription vocabulary ready',
          transcriptionVocabularyRef.current.provenance,
        );
      } catch {
        console.warn('[Pluto] Transcription vocabulary unavailable');
      }

      onRecordingStarted?.(startTimeRef.current);
      recordingEndedAtRef.current = 0;
      stopInFlightRef.current = false;
      isRecordingRef.current = true;
      setIsRecording(true);
      systemAudioHealthRef.current = 'warning';
      publishCaptureHealth({
        microphone: 'healthy',
        systemAudio: systemAudioHealthRef.current,
        captureDurability: 'healthy',
      });

      // 0. Acquire Microphone Stream (Critical Path)
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Favor local-voice isolation when remote participant audio is present.
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 16000 },
          },
          video: false,
        });
        if (!micStream || micStream.getAudioTracks().length === 0) {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        }
      } catch (micErr) {
        console.warn('[Pluto] Failed to capture microphone:', micErr);
        const micStatus = await window.ipcRenderer.invoke(
          'CHECK_MICROPHONE_PERMISSION',
        );
        window.dispatchEvent(
          new CustomEvent('SHOW_PERMISSION_OVERLAY', {
            detail: { micStatus, systemAudioStatus },
          }),
        );
        await abortUnstartedCapture(meetingId);
        currentMeetingIdRef.current = null;
        liveTranscriptResponsivenessRef.current.abortStart();
        frozenLiveTranscriptResponsivenessRef.current = null;
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        stopInFlightRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);
        return;
      }

      micStreamRef.current = micStream;
      if (micStream) {
        const micTrack = micStream.getAudioTracks()[0];
        if (micTrack) {
          console.log(
            '[Pluto] Mic track:',
            `label="${micTrack.label}", enabled=${micTrack.enabled}, muted=${micTrack.muted}`,
            micTrack.getSettings(),
          );
        }
      }

      // 3. Setup the audio context used for durable PCM capture and bounded
      // acoustic speaker sampling.
      const audioContext = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') await audioContext.resume();

      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micPcmSampleRateRef.current = audioContext.sampleRate;
        micPcmChunksRef.current = [];
        try {
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          const sink = audioContext.createGain();
          sink.gain.value = 0.00001;
          processor.onaudioprocess = (evt: AudioProcessingEvent) => {
            const input = evt.inputBuffer.getChannelData(0);
            if (!input || input.length === 0) return;
            micPcmChunksRef.current.push(new Float32Array(input));
          };
          micSource.connect(processor);
          processor.connect(sink);
          sink.connect(audioContext.destination);
          micPcmSourceRef.current = micSource;
          micPcmProcessorRef.current = processor;
          micPcmSinkRef.current = sink;
          (window as unknown as Record<string, unknown>).__plutoMicProcessor = processor;
          (window as unknown as Record<string, unknown>).__plutoMicSource = micSource;
          console.log(
            `[Pluto] Mic PCM chunk capture active at ${audioContext.sampleRate}Hz`,
          );
        } catch (pcmErr) {
          console.warn(
            '[Pluto] Failed to initialize mic PCM chunk capture, falling back to MediaRecorder chunks:',
            pcmErr,
          );
        }
      }

      startSpeakingMonitor(audioContext, micStream);

      // 4. System Audio: Native AudioCap
      console.log('[Pluto] Starting Native AudioCap...');
      try {
        const nativeStarted =
          await window.ipcRenderer.invoke('NATIVE_AUDIO_START');
        hasSystemRecorderRef.current = nativeStarted === true;
        systemAudioChunkSeenRef.current = false;
        systemAudioHealthRef.current = resolveSystemCaptureHealth({
          nativeStarted: nativeStarted === true,
          validPcmSeen: false,
        });
        publishCaptureHealth({
          microphone: 'healthy',
          systemAudio: systemAudioHealthRef.current,
          captureDurability: captureHealthRef.current.captureDurability,
        });
        if (!nativeStarted) {
          throw new Error('Native system audio capture did not start');
        }
        cancelSystemAudioHealthTimeoutRef.current =
          scheduleSystemCaptureTimeout(() => {
            systemAudioHealthRef.current = resolveSystemCaptureHealth({
              nativeStarted: true,
              validPcmSeen: false,
              timedOut: true,
            });
            publishCaptureHealth({
              microphone: 'healthy',
              systemAudio: systemAudioHealthRef.current,
              captureDurability: captureHealthRef.current.captureDurability,
            });
          }, 3_000);

        // Setup Listener
        const handler = (_: unknown, chunk: NativeAudioChunk) => {
          if (chunk) {
            systemAudioChunkSeenRef.current = true;
            let chunkBytes: Uint8Array | null = null;
            if (chunk instanceof Uint8Array) {
              chunkBytes = new Uint8Array(
                chunk.buffer,
                chunk.byteOffset,
                chunk.byteLength,
              );
            } else if (chunk instanceof ArrayBuffer) {
              chunkBytes = new Uint8Array(chunk);
            } else if (ArrayBuffer.isView(chunk)) {
              chunkBytes = new Uint8Array(
                chunk.buffer,
                chunk.byteOffset,
                chunk.byteLength,
              );
            } else if (isBufferJson(chunk)) {
              chunkBytes = Uint8Array.from(chunk.data);
            }
            if (!chunkBytes || chunkBytes.length === 0) {
              systemChunkDecodeDropCountRef.current += 1;
              if (
                systemChunkDecodeDropCountRef.current <= 3 ||
                systemChunkDecodeDropCountRef.current % 50 === 0
              ) {
                console.warn(
                  `[Pluto] Dropped system chunk bytes: decodeMisses=${systemChunkDecodeDropCountRef.current}, type=${typeof chunk}`,
                );
              }
              return;
            }
            const decoded = decodeFloat32PcmChunk(
              chunkBytes,
              systemPcmCarryoverBytesRef.current,
            );
            systemPcmCarryoverBytesRef.current = decoded.carryoverBytes;
            if (decoded.samples.length === 0) return;
            if (systemAudioHealthRef.current !== 'healthy') {
              cancelSystemAudioHealthTimeoutRef.current?.();
              cancelSystemAudioHealthTimeoutRef.current = null;
              systemAudioHealthRef.current = resolveSystemCaptureHealth({
                nativeStarted: true,
                validPcmSeen: true,
              });
              publishCaptureHealth({
                microphone: 'healthy',
                systemAudio: systemAudioHealthRef.current,
                captureDurability: captureHealthRef.current.captureDurability,
              });
            }
            systemPcmChunksRef.current.push(decoded.samples);
            fullSessionSystemPcmChunksRef.current.push(decoded.samples);
            const rms = computeRms(decoded.samples);
            systemRmsRef.current = rms;
            systemRmsUpdatedAtRef.current = performance.now();
          }
        };
        nativeAudioListenerRef.current = handler;
        window.ipcRenderer.on('NATIVE_AUDIO_CHUNK', handler);
        console.log('[Pluto] Native AudioCap started & listening.');
      } catch (sysErr) {
        hasSystemRecorderRef.current = false;
        systemAudioHealthRef.current = 'unavailable';
        publishCaptureHealth({
          microphone: 'healthy',
          systemAudio: systemAudioHealthRef.current,
          captureDurability: captureHealthRef.current.captureDurability,
        });
        console.warn('[Pluto] System audio failed:', sysErr);
      }

      // 5. Start Recorders Synced
      micChunksRef.current = [];
      systemChunksRef.current = [];
      micChunkIndexRef.current = 0;
      systemChunkIndexRef.current = 0;
      pendingMicChunksRef.current = new Map();
      pendingSystemChunksRef.current = new Map();
      lastMicChunkBoundarySecRef.current = 0;
      processedMicSegmentsRef.current = [];
      micPcmChunksRef.current = [];
      fullSessionSystemPcmChunksRef.current = [];
      systemPcmCarryoverBytesRef.current = new Uint8Array(0);
      systemPcmSampleRateRef.current = 48000;
      systemChunkDecodeDropCountRef.current = 0;
      systemRmsRef.current = 0;
      systemRmsUpdatedAtRef.current = 0;
      savedSystemChunkAudioRef.current = new Map();
      speakerTimelineRef.current = [];
      activeSpeakerWindowRef.current = null;
      zeroMicChunkStreakRef.current = 0;
      micChunkConversionFailuresRef.current = 0;
      disableMicChunkTranscriptionRef.current = false;
      micWebmInitSegmentRef.current = null;

      if (micStream) {
        const micRecorder = new MediaRecorder(micStream, getRecorderOptions());
        micRecorderRef.current = micRecorder;
        micMimeTypeRef.current = micRecorder.mimeType || null;
        console.log(
          `[Pluto] Mic recorder MIME: ${micRecorder.mimeType || 'unknown'}, format: ${getMicFormat()}`,
        );

        micRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            const index = micChunkIndexRef.current++;
            const chunkEndSec = getMeetingElapsedSeconds();
            const chunkStartSec = Math.max(
              0,
              Math.min(lastMicChunkBoundarySecRef.current, chunkEndSec),
            );
            lastMicChunkBoundarySecRef.current = chunkEndSec;
            micChunksRef.current.push(event.data);
            if (index < 3 || event.data.size < 2048) {
              console.log(
                `[Pluto] Mic chunk #${index}: ${event.data.size} bytes`,
              );
            }

            let micBlobForChunk: Blob | null = null;
            let micChunkFormat: MicChunkFormat = getMicFormat();
            if (micPcmChunksRef.current.length > 0) {
              const totalMicLen = micPcmChunksRef.current.reduce(
                (acc, chunk) => acc + chunk.length,
                0,
              );
              const mergedMic = new Float32Array(totalMicLen);
              let micOffset = 0;
              for (const chunk of micPcmChunksRef.current) {
                mergedMic.set(chunk, micOffset);
                micOffset += chunk.length;
              }
              micBlobForChunk = createWavBlob(
                mergedMic,
                micPcmSampleRateRef.current,
                1,
              );
              micPcmChunksRef.current = [];
              micChunkFormat = 'wav';
            }

            const fallbackMicBlob = event.data;
            const finalMicBlob = micBlobForChunk || fallbackMicBlob;
            if (index < 3) {
              console.log(
                `[Pluto] Mic chunk #${index} transcription source: format=${micChunkFormat}, bytes=${finalMicBlob.size}`,
              );
            }

            if (getMicFormat() === 'webm' && !micWebmInitSegmentRef.current) {
              void event.data
                .arrayBuffer()
                .then((chunkBuffer) => {
                  const initSegment = extractWebmInitSegment(chunkBuffer);
                  if (initSegment) {
                    micWebmInitSegmentRef.current = initSegment;
                    console.log(
                      `[Pluto] Captured WebM init segment (${initSegment.byteLength} bytes)`,
                    );
                  }
                })
                .catch((err) => {
                  console.warn(
                    '[Pluto] Failed to inspect mic chunk for WebM init segment:',
                    err,
                  );
                });
            }

            // Package System Audio for this interval
            let systemBlob: Blob | undefined;
            // Flatten pending float chunks
            const floatChunks = systemPcmChunksRef.current;
            if (floatChunks.length > 0) {
              const totalLen = floatChunks.reduce(
                (acc, c) => acc + c.length,
                0,
              );
              const merged = new Float32Array(totalLen);
              let offset = 0;
              for (const c of floatChunks) {
                merged.set(c, offset);
                offset += c.length;
              }
              const chunkDurationSec = Math.max(
                0.2,
                chunkEndSec - chunkStartSec,
              );
              const rawSampleRateEstimate = totalLen / chunkDurationSec;
              if (
                rawSampleRateEstimate >= 8000 &&
                rawSampleRateEstimate <= 768000
              ) {
                systemPcmSampleRateRef.current = resolvePcmTimelineSampleRate(
                  totalLen,
                  chunkDurationSec,
                  systemPcmSampleRateRef.current,
                );
              }
              if (index < 3) {
                console.log(
                  `[Pluto] System chunk #${index} sampleRate estimate: raw=${rawSampleRateEstimate.toFixed(0)}Hz, ` +
                    `using=${systemPcmSampleRateRef.current}Hz, samples=${totalLen}, duration=${chunkDurationSec.toFixed(2)}s`,
                );
              }
              const intervalPcm = trimPcmLeadingOverflow(
                merged,
                systemPcmSampleRateRef.current,
                chunkDurationSec,
              );
              systemBlob = createWavBlob(
                intervalPcm,
                systemPcmSampleRateRef.current,
                1,
              );
              // Clear for next chunk
              systemPcmChunksRef.current = [];
            }

            const meetingIdForChunk = currentMeetingIdRef.current;
            void captureActivitySessionRef.current?.enqueue(async () => {
              if (meetingIdForChunk) {
                await appendCaptureJournalBlob({
                  meetingId: meetingIdForChunk,
                  source: 'mic',
                  sequence: index,
                  chunkStartSec,
                  chunkEndSec,
                  format: micChunkFormat,
                  blob: finalMicBlob,
                });
                if (systemBlob) {
                  await appendCaptureJournalBlob({
                    meetingId: meetingIdForChunk,
                    source: 'system',
                    sequence: index,
                    chunkStartSec,
                    chunkEndSec,
                    format: 'wav',
                    blob: systemBlob,
                  });
                }
              }

              handleChunkBlob(
                'mic',
                index,
                finalMicBlob,
                micChunkFormat,
                chunkStartSec,
                chunkEndSec,
                hasSystemRecorderRef.current,
              );
              if (systemBlob) {
                handleChunkBlob(
                  'system',
                  index,
                  systemBlob,
                  'wav',
                  chunkStartSec,
                  chunkEndSec,
                );
                return;
              }

              const silence = new Float32Array(systemPcmSampleRateRef.current);
              handleChunkBlob(
                'system',
                index,
                createWavBlob(silence, systemPcmSampleRateRef.current, 1),
                'wav',
                chunkStartSec,
                chunkEndSec,
              );
            });
          }
        };

        // AudioCap starts before MediaRecorder so the native tap can become
        // healthy. Discard that setup pre-roll at the synchronization point;
        // otherwise system timestamps can extend beyond the journal interval.
        systemPcmChunksRef.current = [];
        fullSessionSystemPcmChunksRef.current = [];
        systemPcmCarryoverBytesRef.current = new Uint8Array(0);
        micRecorder.start(CHUNK_SECONDS * 1000);
        console.log('[Pluto] Microphone recording started.');
      }

      // 6. No restart loop needed
    } catch (e) {
      console.error('[Pluto] Failed to start session', e);
      const unstartedMeetingId = currentMeetingIdRef.current;
      if (
        unstartedMeetingId &&
        (!micRecorderRef.current || micRecorderRef.current.state === 'inactive')
      ) {
        await abortUnstartedCapture(unstartedMeetingId);
      }
      currentMeetingIdRef.current = null;
      liveTranscriptResponsivenessRef.current.abortStart();
      frozenLiveTranscriptResponsivenessRef.current = null;
      startTimeRef.current = 0;
      recordingEndedAtRef.current = 0;
      stopInFlightRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  // Effect cleared - logic handled in standard recorder flow now
  useEffect(() => {
    // Intentionally empty - we removed IPC listener
  }, []);

  const getMeetingElapsedSeconds = (): number => {
    if (!startTimeRef.current) return 0;
    const effectiveEndAt = recordingEndedAtRef.current || Date.now();
    return Math.max(0, (effectiveEndAt - startTimeRef.current) / 1000);
  };

  const recordSpeakerActivity = (
    nextSpeaker: 'Me' | 'Them' | null,
    nowTime: number,
  ) => {
    captureActivitySessionRef.current?.transitionSpeaker(nextSpeaker, nowTime);
    if (nextSpeaker) {
      if (activeSpeakerWindowRef.current?.speaker !== nextSpeaker) {
        activeSpeakerWindowRef.current = {
          speaker: nextSpeaker,
          startTime: nowTime,
        };
      }
    } else {
      activeSpeakerWindowRef.current = null;
    }
    speakerTimelineRef.current =
      captureActivitySessionRef.current?.windows() ?? [];
  };

  const startSpeakingMonitor = (
    audioContext: AudioContext,
    micStream: MediaStream | null,
  ) => {
    stopSpeakingMonitor();

    let micAnalyser: AnalyserNode | null = null;
    if (micStream && micStream.getAudioTracks().length > 0) {
      micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 256;
      const s = audioContext.createMediaStreamSource(micStream);
      s.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;
    }

    const tick = () => {
      const now = performance.now();
      const micRms = micAnalyser ? computeRmsFromAnalyser(micAnalyser) : 0;
      const systemRmsAgeMs =
        systemRmsUpdatedAtRef.current > 0
          ? now - systemRmsUpdatedAtRef.current
          : Number.POSITIVE_INFINITY;
      const systemRms = systemRmsAgeMs <= 350 ? systemRmsRef.current : 0;

      const nextSpeaker = decideNextSpeaker({
        micRms,
        systemRms,
        threshold: SPEAKING_RMS_THRESHOLD,
        ratio: SPEAKING_RATIO,
      });

      if (
        now - lastSpeakerTsRef.current >= SPEAKING_MIN_INTERVAL_MS &&
        nextSpeaker !== lastSpeakerRef.current
      ) {
        lastSpeakerRef.current = nextSpeaker;
        lastSpeakerTsRef.current = now;
        recordSpeakerActivity(nextSpeaker, getMeetingElapsedSeconds());
        onSpeakingChange?.(nextSpeaker);
      }
    };
    stopSpeakingSamplerRef.current = startBoundedSampler(
      tick,
      TRANSCRIPTION_TUNING.speaking.sampleIntervalMs,
    );
  };

  const stopAllTracks = () => {
    stopSpeakingSamplerRef.current?.();
    stopSpeakingSamplerRef.current = null;
    if (micPcmProcessorRef.current) {
      micPcmProcessorRef.current.onaudioprocess = null;
      micPcmProcessorRef.current.disconnect();
      micPcmProcessorRef.current = null;
    }
    if (micPcmSourceRef.current) {
      micPcmSourceRef.current.disconnect();
      micPcmSourceRef.current = null;
    }
    if (micPcmSinkRef.current) {
      micPcmSinkRef.current.disconnect();
      micPcmSinkRef.current = null;
    }
    micPcmChunksRef.current = [];
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }
  };

  // --- Helpers ---

  const extractTitle = (segments: TranscriptionSegment[]): string => {
    if (segments.length === 0) return 'New Meeting';
    const firstText = segments[0]?.text || '';
    return firstText
      ? firstText.substring(0, 30) + (firstText.length > 30 ? '...' : '')
      : 'New Meeting';
  };

  type RmsData = { windowSec: number; rms: number[] };
  type SpeechWindow = { startSec: number; endSec: number };

  const RMS_WINDOW_SECONDS = TRANSCRIPTION_TUNING.speaking.rmsWindowSeconds;
  const SPEAKING_RMS_THRESHOLD = TRANSCRIPTION_TUNING.speaking.rmsThreshold;
  const SPEAKING_RATIO = TRANSCRIPTION_TUNING.speaking.ratio;
  const SPEAKING_MIN_INTERVAL_MS = TRANSCRIPTION_TUNING.speaking.minIntervalMs;
  const SYSTEM_TRANSCRIBE_MIN_RMS =
    TRANSCRIPTION_TUNING.systemTranscribe.minRms;
  const MIC_TRANSCRIBE_MIN_RMS = TRANSCRIPTION_TUNING.micTranscribe.minRms;
  const MIC_TRANSCRIBE_MIN_SPEAKER_COVERAGE_SECONDS =
    TRANSCRIPTION_TUNING.micTranscribe.minSpeakerCoverageSeconds;
  const MIC_TRANSCRIBE_MIN_SPEAKER_COVERAGE_RATIO =
    TRANSCRIPTION_TUNING.micTranscribe.minSpeakerCoverageRatio;
  const CHUNK_FLUSH_MIN_RMS = TRANSCRIPTION_TUNING.chunkFlush.minRms;
  const CHUNK_FLUSH_MIN_SEGMENT_SECONDS =
    TRANSCRIPTION_TUNING.chunkFlush.minSegmentSeconds;
  const CHUNK_FLUSH_PAD_SECONDS = TRANSCRIPTION_TUNING.chunkFlush.padSeconds;
  const CHUNK_FLUSH_MAX_SEGMENTS = TRANSCRIPTION_TUNING.chunkFlush.maxSegments;
  const CHUNK_FLUSH_MAX_FULL_COVERAGE_RATIO =
    TRANSCRIPTION_TUNING.chunkFlush.maxFullCoverageRatio;
  const ENABLE_CHUNK_ARBITRATION = true;
  const ENABLE_CHUNK_FLUSH = false;
  const getRecorderOptions = (): MediaRecorderOptions | undefined => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    for (const mimeType of candidates) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return { mimeType };
      }
    }
    return undefined;
  };

  const getMicFormat = (): 'webm' | 'ogg' => {
    const mimeType =
      micMimeTypeRef.current || micRecorderRef.current?.mimeType || '';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
  };

  const WEBM_CLUSTER_MAGIC = [0x1f, 0x43, 0xb6, 0x75] as const;

  const findSubarrayOffset = (
    bytes: Uint8Array,
    pattern: readonly number[],
  ): number => {
    if (pattern.length === 0 || bytes.length < pattern.length) return -1;
    for (let i = 0; i <= bytes.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  };

  const extractWebmInitSegment = (buffer: ArrayBuffer): ArrayBuffer | null => {
    const bytes = new Uint8Array(buffer);
    const clusterOffset = findSubarrayOffset(bytes, WEBM_CLUSTER_MAGIC);
    if (clusterOffset <= 0) return null;
    if (clusterOffset > 128 * 1024) {
      // Defensive bound: header should be small; very large offsets are likely malformed.
      return null;
    }
    return bytes.slice(0, clusterOffset).buffer;
  };

  const prependWebmInitSegment = (
    initSegment: ArrayBuffer,
    chunkBuffer: ArrayBuffer,
  ): ArrayBuffer => {
    const init = new Uint8Array(initSegment);
    const chunk = new Uint8Array(chunkBuffer);
    const combined = new Uint8Array(init.byteLength + chunk.byteLength);
    combined.set(init, 0);
    combined.set(chunk, init.byteLength);
    return combined.buffer;
  };

  const computeRmsData = async (audioBuffer: ArrayBuffer): Promise<RmsData> => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Web Audio API unavailable');
    }
    const audioCtx = new AudioContextCtor();
    try {
      const decoded = await audioCtx.decodeAudioData(audioBuffer.slice(0));
      const numChannels = decoded.numberOfChannels;
      const channels = Array.from({ length: numChannels }, (_, i) =>
        decoded.getChannelData(i),
      );
      const length = decoded.length;
      const sampleRate = decoded.sampleRate;
      const windowSize = Math.max(
        1,
        Math.floor(RMS_WINDOW_SECONDS * sampleRate),
      );
      const rms: number[] = [];

      for (let start = 0; start < length; start += windowSize) {
        const end = Math.min(length, start + windowSize);
        let sumSquares = 0;
        let count = 0;
        for (let i = start; i < end; i++) {
          let sample = 0;
          for (let ch = 0; ch < numChannels; ch++) {
            sample += channels[ch][i] || 0;
          }
          sample /= numChannels;
          sumSquares += sample * sample;
          count++;
        }
        const meanSquare = count > 0 ? sumSquares / count : 0;
        rms.push(Math.sqrt(meanSquare));
      }

      return { windowSec: RMS_WINDOW_SECONDS, rms };
    } finally {
      audioCtx.close();
    }
  };

  const computeRmsFromAnalyser = (analyser: AnalyserNode): number => {
    const bufferLength = analyser.fftSize;
    const data = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / bufferLength);
  };

  const meanRms = (data: RmsData | null): number | null => {
    if (!data || !Array.isArray(data.rms) || data.rms.length === 0) return null;
    const total = data.rms.reduce((acc, value) => acc + value, 0);
    return total / data.rms.length;
  };

  const buildSpeechWindows = (
    data: RmsData | null,
    chunkDurationSec: number,
  ): SpeechWindow[] => {
    if (!data || data.rms.length === 0) return [];
    if (!Number.isFinite(chunkDurationSec) || chunkDurationSec <= 0) return [];

    const rawSegments: SpeechWindow[] = [];
    let activeStart: number | null = null;
    const windowSec = Math.max(0.01, data.windowSec);

    for (let i = 0; i < data.rms.length; i++) {
      const startSec = i * windowSec;
      const endSec = Math.min(chunkDurationSec, (i + 1) * windowSec);
      const isActive = data.rms[i] >= CHUNK_FLUSH_MIN_RMS;

      if (isActive && activeStart === null) {
        activeStart = startSec;
      }

      if (!isActive && activeStart !== null) {
        rawSegments.push({ startSec: activeStart, endSec: startSec });
        activeStart = null;
      }

      if (endSec >= chunkDurationSec) {
        break;
      }
    }

    if (activeStart !== null) {
      rawSegments.push({ startSec: activeStart, endSec: chunkDurationSec });
    }

    const filtered = rawSegments.filter(
      (segment) =>
        segment.endSec - segment.startSec >= CHUNK_FLUSH_MIN_SEGMENT_SECONDS,
    );
    if (filtered.length === 0) return [];

    const padded = filtered.map((segment) => ({
      startSec: Math.max(0, segment.startSec - CHUNK_FLUSH_PAD_SECONDS),
      endSec: Math.min(
        chunkDurationSec,
        segment.endSec + CHUNK_FLUSH_PAD_SECONDS,
      ),
    }));

    padded.sort((a, b) => a.startSec - b.startSec);
    const merged: SpeechWindow[] = [];
    for (const segment of padded) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...segment });
        continue;
      }
      if (segment.startSec <= last.endSec) {
        last.endSec = Math.max(last.endSec, segment.endSec);
      } else {
        merged.push({ ...segment });
      }
    }

    if (merged.length > CHUNK_FLUSH_MAX_SEGMENTS) return [];

    if (merged.length === 1) {
      const coverage =
        (merged[0].endSec - merged[0].startSec) /
        Math.max(0.01, chunkDurationSec);
      if (coverage >= CHUNK_FLUSH_MAX_FULL_COVERAGE_RATIO) {
        return [];
      }
    }

    return merged;
  };

  const getSpeakerActivityCoverage = (
    startTime: number,
    endTime: number,
    speaker: 'Me' | 'Them',
  ): number => {
    if (endTime <= startTime) return 0;
    let total = 0;
    for (const window of speakerTimelineRef.current) {
      if (window.speaker !== speaker) continue;
      const overlap = Math.max(
        0,
        Math.min(endTime, window.endTime) -
          Math.max(startTime, window.startTime),
      );
      total += overlap;
    }
    const active = activeSpeakerWindowRef.current;
    if (active && active.speaker === speaker) {
      const activeEnd = getMeetingElapsedSeconds();
      const overlap = Math.max(
        0,
        Math.min(endTime, activeEnd) - Math.max(startTime, active.startTime),
      );
      total += overlap;
    }
    return total;
  };

  const getSegmentWindowRms = (
    data: RmsData | null,
    startTime: number,
    endTime: number,
  ): number | null => {
    if (!data || !Array.isArray(data.rms) || data.rms.length === 0) return null;
    const windowSec = data.windowSec || RMS_WINDOW_SECONDS;
    const safeStart = Math.max(0, startTime);
    const safeEnd = Math.max(safeStart + 0.01, endTime);
    const startIndex = Math.max(0, Math.floor(safeStart / windowSec));
    const endIndex = Math.min(
      data.rms.length - 1,
      Math.max(startIndex, Math.ceil(safeEnd / windowSec) - 1),
    );
    if (endIndex < startIndex) return null;
    let total = 0;
    let count = 0;
    for (let i = startIndex; i <= endIndex; i++) {
      total += data.rms[i] || 0;
      count++;
    }
    return count > 0 ? total / count : null;
  };

  const normalizeTranscriptText = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const tokenSimilarity = (left: string, right: string): number => {
    const leftTokens = new Set(
      normalizeTranscriptText(left).split(' ').filter(Boolean),
    );
    const rightTokens = new Set(
      normalizeTranscriptText(right).split(' ').filter(Boolean),
    );
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

    let intersection = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) intersection++;
    }
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union > 0 ? intersection / union : 0;
  };

  const tokenPrefixSimilarity = (
    left: string,
    right: string,
    maxPrefixTokens = 8,
  ): number => {
    const leftTokens = normalizeTranscriptText(left).split(' ').filter(Boolean);
    const rightTokens = normalizeTranscriptText(right)
      .split(' ')
      .filter(Boolean);
    const sharedLength = Math.min(
      leftTokens.length,
      rightTokens.length,
      maxPrefixTokens,
    );
    if (sharedLength === 0) return 0;
    let matched = 0;
    for (let i = 0; i < sharedLength; i++) {
      if (leftTokens[i] !== rightTokens[i]) break;
      matched++;
    }
    return matched / sharedLength;
  };

  const overlapSeconds = (
    a: TranscriptionSegment,
    b: TranscriptionSegment,
  ): number => {
    return Math.max(
      0,
      Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
    );
  };

  const transcriptQualityScore = (text: string): number => {
    const tokens = normalizeTranscriptText(text).split(' ').filter(Boolean);
    if (tokens.length === 0) return 0;
    const freq = new Map<string, number>();
    let maxTokenFreq = 0;
    for (const token of tokens) {
      const next = (freq.get(token) || 0) + 1;
      freq.set(token, next);
      if (next > maxTokenFreq) maxTokenFreq = next;
    }
    const uniqueRatio = freq.size / tokens.length;
    const lengthBonus = Math.min(0.35, tokens.length * 0.03);
    const repetitionPenalty = Math.max(0, maxTokenFreq - 2) * 0.15;
    return uniqueRatio + lengthBonus - repetitionPenalty;
  };

  const pruneSegmentsByTranscriptQuality = (params: {
    chunkIndex: number;
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  }): {
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  } => {
    const { chunkIndex } = params;
    const qualityTuning = TRANSCRIPTION_TUNING.transcriptQuality;
    const micSegments = params.micSegments.map((segment) => ({ ...segment }));
    const systemSegments = params.systemSegments.map((segment) => ({
      ...segment,
    }));
    if (micSegments.length === 0 || systemSegments.length === 0) {
      return { micSegments, systemSegments };
    }

    const removeMic = new Set<number>();
    const removeSystem = new Set<number>();
    let droppedMic = 0;
    let droppedSystem = 0;

    for (let micIndex = 0; micIndex < micSegments.length; micIndex++) {
      if (removeMic.has(micIndex)) continue;
      const mic = micSegments[micIndex];
      const micWords = normalizeTranscriptText(mic.text)
        .split(' ')
        .filter(Boolean).length;
      if (micWords < qualityTuning.minWords) continue;

      let bestSystemIndex = -1;
      let bestOverlapRatio = 0;
      for (
        let systemIndex = 0;
        systemIndex < systemSegments.length;
        systemIndex++
      ) {
        if (removeSystem.has(systemIndex)) continue;
        const sys = systemSegments[systemIndex];
        const overlap = overlapSeconds(mic, sys);
        if (overlap <= 0) continue;
        const overlapRatio =
          overlap /
          Math.max(
            0.01,
            Math.min(mic.endTime - mic.startTime, sys.endTime - sys.startTime),
          );
        if (overlapRatio > bestOverlapRatio) {
          bestOverlapRatio = overlapRatio;
          bestSystemIndex = systemIndex;
        }
      }

      if (
        bestSystemIndex < 0 ||
        bestOverlapRatio < qualityTuning.minOverlapRatio
      )
        continue;
      const system = systemSegments[bestSystemIndex];
      const systemWords = normalizeTranscriptText(system.text)
        .split(' ')
        .filter(Boolean).length;
      if (systemWords < qualityTuning.minWords) continue;

      const micQuality = transcriptQualityScore(mic.text);
      const systemQuality = transcriptQualityScore(system.text);
      const qualityDelta = micQuality - systemQuality;
      const systemLooksInformative =
        systemWords >= qualityTuning.informativeSystemWords &&
        systemQuality >= qualityTuning.informativeSystemScore;

      if (qualityDelta >= qualityTuning.qualityDelta) {
        const strongMicEdge =
          qualityDelta >= qualityTuning.strongQualityDelta &&
          micWords >= systemWords + qualityTuning.strongWordDelta;
        const shortSystemFragment =
          systemWords <= qualityTuning.shortSystemWords;
        if (!systemLooksInformative || strongMicEdge || shortSystemFragment) {
          removeSystem.add(bestSystemIndex);
          droppedSystem++;
        }
      } else if (qualityDelta <= -qualityTuning.qualityDelta) {
        removeMic.add(micIndex);
        droppedMic++;
      }
    }

    if (droppedMic > 0 || droppedSystem > 0) {
      console.log(
        `[Pluto] Chunk #${chunkIndex} quality prune: dropMe=${droppedMic}, dropThem=${droppedSystem}`,
      );
    }

    return {
      micSegments: micSegments.filter((_, index) => !removeMic.has(index)),
      systemSegments: systemSegments.filter(
        (_, index) => !removeSystem.has(index),
      ),
    };
  };

  const isCompetingUtterancePair = (
    mic: TranscriptionSegment,
    system: TranscriptionSegment,
  ): boolean => {
    const overlapTuning = TRANSCRIPTION_TUNING.competingUtterance;
    const overlap = overlapSeconds(mic, system);
    if (overlap <= 0) return false;
    const micDur = Math.max(0.01, mic.endTime - mic.startTime);
    const sysDur = Math.max(0.01, system.endTime - system.startTime);
    const overlapRatio = overlap / Math.min(micDur, sysDur);
    if (isBleedDuplicate(mic, system)) return true;
    if (
      overlapRatio >= overlapTuning.highOverlapRatio ||
      overlap >= overlapTuning.highOverlapSeconds
    )
      return true;
    if (overlapRatio < overlapTuning.lowOverlapRatio) return false;

    const tokenSim = tokenSimilarity(mic.text, system.text);
    const prefixSim = tokenPrefixSimilarity(mic.text, system.text);
    return (
      tokenSim >= overlapTuning.tokenSimilarity ||
      prefixSim >= overlapTuning.prefixSimilarity
    );
  };

  const selectDominantSpeakerForPair = (
    mic: TranscriptionSegment,
    system: TranscriptionSegment,
    micRmsData: RmsData | null,
    systemRmsData: RmsData | null,
    chunkStartSec: number,
    preferredSpeaker: 'Me' | 'Them' | null,
  ): 'Me' | 'Them' => {
    const dominanceTuning = TRANSCRIPTION_TUNING.dominanceSelection;
    let meScore = 0;
    let themScore = 0;

    const overlapStart =
      chunkStartSec + Math.min(mic.startTime, system.startTime);
    const overlapEnd = chunkStartSec + Math.max(mic.endTime, system.endTime);
    const meCoverage = getSpeakerActivityCoverage(
      overlapStart,
      overlapEnd,
      'Me',
    );
    const themCoverage = getSpeakerActivityCoverage(
      overlapStart,
      overlapEnd,
      'Them',
    );
    const micWords = normalizeTranscriptText(mic.text)
      .split(' ')
      .filter(Boolean).length;
    const sysWords = normalizeTranscriptText(system.text)
      .split(' ')
      .filter(Boolean).length;

    if (isBleedDuplicate(mic, system)) {
      const strongMeDominance =
        meCoverage >=
          Math.max(
            dominanceTuning.strongCoverage,
            themCoverage * dominanceTuning.strongCoverageRatio,
          ) && micWords >= sysWords + dominanceTuning.strongWordDelta;
      return strongMeDominance ? 'Me' : 'Them';
    }

    if (
      meCoverage >= dominanceTuning.moderateCoverage &&
      meCoverage >= themCoverage * dominanceTuning.moderateCoverageRatio
    )
      meScore += 2;
    if (
      themCoverage >= dominanceTuning.moderateCoverage &&
      themCoverage >= meCoverage * dominanceTuning.moderateCoverageRatio
    )
      themScore += 2;

    const micRms = getSegmentWindowRms(micRmsData, mic.startTime, mic.endTime);
    const sysRms = getSegmentWindowRms(
      systemRmsData,
      system.startTime,
      system.endTime,
    );
    if (micRms !== null && sysRms !== null) {
      if (micRms >= sysRms * dominanceTuning.rmsDominanceRatio) meScore += 2;
      else if (sysRms >= micRms * dominanceTuning.rmsDominanceRatio)
        themScore += 2;
    }

    if (micWords >= sysWords + dominanceTuning.wordDelta) meScore += 1;
    else if (sysWords >= micWords + dominanceTuning.wordDelta) themScore += 1;
    if (micWords <= 2 && sysWords >= 5) themScore += 1;
    if (sysWords <= 2 && micWords >= 5) meScore += 1;

    if (preferredSpeaker === 'Me') meScore += 0.2;
    else if (preferredSpeaker === 'Them') themScore += 0.2;

    if (meScore === themScore) {
      if (micWords !== sysWords) return micWords > sysWords ? 'Me' : 'Them';
      const micDur = Math.max(0.01, mic.endTime - mic.startTime);
      const sysDur = Math.max(0.01, system.endTime - system.startTime);
      if (Math.abs(micDur - sysDur) >= 0.3)
        return micDur > sysDur ? 'Me' : 'Them';
      return preferredSpeaker || 'Them';
    }

    return meScore > themScore ? 'Me' : 'Them';
  };

  const maxOverlapRatioWithSegments = (
    segment: TranscriptionSegment,
    others: TranscriptionSegment[],
  ): number => {
    const duration = Math.max(0.01, segment.endTime - segment.startTime);
    let maxRatio = 0;
    for (const other of others) {
      const overlap = overlapSeconds(segment, other);
      if (overlap <= 0) continue;
      const ratio = overlap / duration;
      if (ratio > maxRatio) maxRatio = ratio;
    }
    return maxRatio;
  };

  const pruneSegmentsBySpeakerActivity = (params: {
    chunkIndex: number;
    chunkStartSec: number;
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  }): {
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  } => {
    const { chunkIndex, chunkStartSec } = params;
    const micSegments = params.micSegments.map((segment) => ({ ...segment }));
    const systemSegments = params.systemSegments.map((segment) => ({
      ...segment,
    }));
    if (micSegments.length === 0 || systemSegments.length === 0) {
      return { micSegments, systemSegments };
    }

    const keepMic: TranscriptionSegment[] = [];
    const keepSystem: TranscriptionSegment[] = [];
    let droppedMic = 0;
    let droppedSystem = 0;

    for (const segment of micSegments) {
      const absStart = chunkStartSec + segment.startTime;
      const absEnd = chunkStartSec + segment.endTime;
      const meCoverage = getSpeakerActivityCoverage(absStart, absEnd, 'Me');
      const themCoverage = getSpeakerActivityCoverage(absStart, absEnd, 'Them');
      const overlapWithSystem = maxOverlapRatioWithSegments(
        segment,
        systemSegments,
      );
      const shouldDrop = shouldDropBySpeakerActivity({
        targetSpeaker: 'Me',
        overlapRatio: overlapWithSystem,
        meCoverage,
        themCoverage,
      });
      if (shouldDrop) {
        droppedMic++;
        continue;
      }
      keepMic.push(segment);
    }

    for (const segment of systemSegments) {
      const absStart = chunkStartSec + segment.startTime;
      const absEnd = chunkStartSec + segment.endTime;
      const meCoverage = getSpeakerActivityCoverage(absStart, absEnd, 'Me');
      const themCoverage = getSpeakerActivityCoverage(absStart, absEnd, 'Them');
      const overlapWithMic = maxOverlapRatioWithSegments(segment, keepMic);
      const shouldDrop = shouldDropBySpeakerActivity({
        targetSpeaker: 'Them',
        overlapRatio: overlapWithMic,
        meCoverage,
        themCoverage,
      });
      if (shouldDrop) {
        droppedSystem++;
        continue;
      }
      keepSystem.push(segment);
    }

    if (droppedMic > 0 || droppedSystem > 0) {
      console.log(
        `[Pluto] Chunk #${chunkIndex} activity prune: dropMe=${droppedMic}, dropThem=${droppedSystem}, keptMe=${keepMic.length}, keptThem=${keepSystem.length}`,
      );
    }

    return { micSegments: keepMic, systemSegments: keepSystem };
  };

  const pruneSegmentsByEnergyDominance = (params: {
    chunkIndex: number;
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
    micRmsData: RmsData | null;
    systemRmsData: RmsData | null;
  }): {
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  } => {
    const { chunkIndex, micRmsData, systemRmsData } = params;
    const energyTuning = TRANSCRIPTION_TUNING.energyPrune;
    const micSegments = params.micSegments.map((segment) => ({ ...segment }));
    const systemSegments = params.systemSegments.map((segment) => ({
      ...segment,
    }));
    if (micSegments.length === 0 || systemSegments.length === 0) {
      return { micSegments, systemSegments };
    }

    const keepMic: TranscriptionSegment[] = [];
    let droppedMic = 0;
    for (const segment of micSegments) {
      const overlapRatio = maxOverlapRatioWithSegments(segment, systemSegments);
      if (overlapRatio < energyTuning.minOverlapRatio) {
        keepMic.push(segment);
        continue;
      }
      const micEnergy = getSegmentWindowRms(
        micRmsData,
        segment.startTime,
        segment.endTime,
      );
      const systemEnergy = getSegmentWindowRms(
        systemRmsData,
        segment.startTime,
        segment.endTime,
      );
      const dropForEnergy =
        micEnergy !== null &&
        systemEnergy !== null &&
        systemEnergy >= micEnergy * energyTuning.dominanceRatio;
      if (dropForEnergy) {
        droppedMic++;
        continue;
      }
      keepMic.push(segment);
    }

    const keepSystem: TranscriptionSegment[] = [];
    let droppedSystem = 0;
    for (const segment of systemSegments) {
      const overlapRatio = maxOverlapRatioWithSegments(segment, keepMic);
      if (overlapRatio < energyTuning.minOverlapRatio) {
        keepSystem.push(segment);
        continue;
      }
      const micEnergy = getSegmentWindowRms(
        micRmsData,
        segment.startTime,
        segment.endTime,
      );
      const systemEnergy = getSegmentWindowRms(
        systemRmsData,
        segment.startTime,
        segment.endTime,
      );
      const dropForEnergy =
        micEnergy !== null &&
        systemEnergy !== null &&
        micEnergy >= systemEnergy * energyTuning.dominanceRatio;
      if (dropForEnergy) {
        droppedSystem++;
        continue;
      }
      keepSystem.push(segment);
    }

    if (droppedMic > 0 || droppedSystem > 0) {
      console.log(
        `[Pluto] Chunk #${chunkIndex} energy prune: dropMe=${droppedMic}, dropThem=${droppedSystem}, keptMe=${keepMic.length}, keptThem=${keepSystem.length}`,
      );
    }

    return { micSegments: keepMic, systemSegments: keepSystem };
  };

  const pickPreferredSpeakerForChunk = (
    chunkStartSec: number,
    chunkEndSec: number,
    micMeanRms: number | null,
    systemMeanRms: number | null,
  ): 'Me' | 'Them' | null => {
    const meCoverage = getSpeakerActivityCoverage(
      chunkStartSec,
      chunkEndSec,
      'Me',
    );
    const themCoverage = getSpeakerActivityCoverage(
      chunkStartSec,
      chunkEndSec,
      'Them',
    );
    const minCoverageSeconds =
      TRANSCRIPTION_TUNING.chunkPreference.minCoverageSeconds;
    const coverageRatio = TRANSCRIPTION_TUNING.chunkPreference.coverageRatio;

    if (
      meCoverage >= minCoverageSeconds &&
      meCoverage >= themCoverage * coverageRatio
    )
      return 'Me';
    if (
      themCoverage >= minCoverageSeconds &&
      themCoverage >= meCoverage * coverageRatio
    )
      return 'Them';

    if (micMeanRms !== null && systemMeanRms !== null) {
      return micMeanRms >= systemMeanRms ? 'Me' : 'Them';
    }

    return null;
  };

  const mergeSegmentText = (
    baseText: string,
    incomingText: string,
    speaker: string,
  ): string => {
    const base = baseText.trim();
    const incoming = incomingText.trim();
    if (!base) return incoming;
    if (!incoming) return base;

    const baseNorm = normalizeTranscriptText(base);
    const incomingNorm = normalizeTranscriptText(incoming);

    // Recall-first: only collapse exact duplicates.
    if (speaker === 'Them' || speaker === 'Me') {
      if (incomingNorm === baseNorm) return base;
    }

    const sentenceMatches = base.match(/[^.!?]+[.!?]?/g);
    const sentenceChunks = sentenceMatches
      ? sentenceMatches.map((chunk) => chunk.trim()).filter(Boolean)
      : [base];
    const trailingSentence = sentenceChunks[sentenceChunks.length - 1];
    if (trailingSentence) {
      const trailingSimilarity = tokenSimilarity(trailingSentence, incoming);
      if (trailingSimilarity >= 0.32) {
        const trailingWords = normalizeTranscriptText(trailingSentence)
          .split(' ')
          .filter(Boolean).length;
        const incomingWords = normalizeTranscriptText(incoming)
          .split(' ')
          .filter(Boolean).length;
        const trailingQuality = transcriptQualityScore(trailingSentence);
        const incomingQuality = transcriptQualityScore(incoming);
        if (
          incomingWords >= trailingWords ||
          incomingQuality >= trailingQuality + 0.08
        ) {
          sentenceChunks[sentenceChunks.length - 1] = incoming;
          return sentenceChunks.join(' ').trim();
        }
      }
    }

    return `${base} ${incoming}`;
  };

  const mergeConsecutiveSpeakerSegments = (
    segments: TranscriptionSegment[],
    gapSeconds = 1,
  ): TranscriptionSegment[] => {
    const merged: TranscriptionSegment[] = [];
    for (const segment of segments) {
      const lastSegment = merged[merged.length - 1];
      const gap =
        lastSegment != null
          ? segment.startTime - lastSegment.endTime
          : Number.POSITIVE_INFINITY;

      if (
        lastSegment &&
        lastSegment.speaker === segment.speaker &&
        gap <= gapSeconds
      ) {
        lastSegment.text = mergeSegmentText(
          lastSegment.text,
          segment.text,
          segment.speaker,
        );
        lastSegment.endTime = segment.endTime;
      } else {
        merged.push({ ...segment });
      }
    }
    return merged;
  };

  const splitCanonicalSegmentsForAttribution = (
    segments: TranscriptionSegment[],
  ): TranscriptionSegment[] => {
    const expanded: TranscriptionSegment[] = [];
    for (const segment of segments) {
      const text = (segment.text || '').trim();
      if (!text) continue;
      const pieces = text
        .split(/(?<=[.!?])\s+/)
        .map((piece) => piece.trim())
        .filter(Boolean);
      if (pieces.length <= 1) {
        expanded.push(segment);
        continue;
      }
      const totalWeight = pieces.reduce(
        (sum, piece) => sum + Math.max(1, piece.length),
        0,
      );
      const totalDuration = Math.max(0.01, segment.endTime - segment.startTime);
      let cursor = segment.startTime;
      for (let i = 0; i < pieces.length; i++) {
        const weight = Math.max(1, pieces[i].length);
        const remaining = Math.max(0.01, segment.endTime - cursor);
        const allocated =
          i === pieces.length - 1
            ? remaining
            : Math.max(0.01, totalDuration * (weight / totalWeight));
        const endTime =
          i === pieces.length - 1
            ? segment.endTime
            : Math.min(segment.endTime, cursor + allocated);
        expanded.push({
          ...segment,
          id: `${segment.id}-s${i}`,
          startTime: cursor,
          endTime: Math.max(cursor + 0.01, endTime),
          text: pieces[i],
        });
        cursor = Math.max(cursor + 0.01, endTime);
      }
    }
    return expanded;
  };

  const filterDuplicateSpeakerSegments = (
    segments: TranscriptionSegment[],
    speaker: 'Me' | 'Them',
  ): TranscriptionSegment[] => {
    const filtered: TranscriptionSegment[] = [];
    const recentForSpeaker: TranscriptionSegment[] = [];
    let dropped = 0;

    for (const segment of segments) {
      if (segment.speaker !== speaker) {
        filtered.push(segment);
        continue;
      }

      const segNorm = normalizeTranscriptText(segment.text);
      let duplicatePrev: TranscriptionSegment | null = null;
      const isDuplicate = (() => {
        for (const prev of recentForSpeaker) {
          const gap = segment.startTime - prev.endTime;
          if (gap > 2.5) continue;

          const prevNorm = normalizeTranscriptText(prev.text);
          if (!segNorm || !prevNorm) continue;

          // Exact match (fast path).
          if (segNorm === prevNorm) {
            duplicatePrev = prev;
            return true;
          }

          // Near-duplicate: lexical similarity + light containment.
          const shorter = Math.min(segNorm.length, prevNorm.length);
          const longer = Math.max(segNorm.length, prevNorm.length);
          const lengthRatio = longer / Math.max(1, shorter);

          // If the new segment is a strict extension of the previous one,
          // keep it so we don't lose continuation detail.
          if (lengthRatio >= 1.25) continue;

          const tokenSim = tokenSimilarity(segment.text, prev.text);
          if (tokenSim >= 0.64) {
            duplicatePrev = prev;
            return true;
          }

          const prefixSim = tokenPrefixSimilarity(segment.text, prev.text);
          if (prefixSim >= 0.84) {
            duplicatePrev = prev;
            return true;
          }
          const containsMatch =
            shorter >= 30 &&
            shorter / longer >= 0.9 &&
            (segNorm.includes(prevNorm) || prevNorm.includes(segNorm));
          if (containsMatch) {
            duplicatePrev = prev;
            return true;
          }
        }
        return false;
      })();

      if (isDuplicate) {
        dropped++;
        if (TRANSCRIPT_DEBUG_ENABLED && dropped <= 6 && duplicatePrev) {
          console.log(
            `[Pluto][TranscriptDebug] duplicate(${speaker}) gap~${(
              segment.startTime - duplicatePrev.endTime
            ).toFixed(2)}s tokenSim=${tokenSimilarity(
              segment.text,
              duplicatePrev.text,
            ).toFixed(2)} prefixSim=${tokenPrefixSimilarity(
              segment.text,
              duplicatePrev.text,
            ).toFixed(2)}`,
          );
        }
        continue;
      }

      filtered.push(segment);
      recentForSpeaker.push(segment);
      if (recentForSpeaker.length > 6) {
        recentForSpeaker.shift();
      }
    }

    if (dropped > 0) {
      console.log(
        `[Pluto] Dropped ${dropped} near-duplicate ${speaker} segments`,
      );
    }

    return filtered;
  };

  const tokenizeWithRawWords = (
    text: string,
  ): Array<{ raw: string; norm: string }> => {
    return text
      .trim()
      .split(/\s+/)
      .map((raw) => ({
        raw,
        norm: raw.toLowerCase().replace(/[^a-z0-9]/g, ''),
      }))
      .filter((token) => token.norm.length > 0);
  };

  const trimAdjacentCrossSpeakerEcho = (
    segments: TranscriptionSegment[],
  ): TranscriptionSegment[] => {
    if (segments.length < 2) return segments;
    const trimmed: TranscriptionSegment[] = [];
    let trimmedCount = 0;
    let droppedCount = 0;

    for (const current of segments) {
      if (trimmed.length === 0) {
        trimmed.push({ ...current });
        continue;
      }

      const prev = trimmed[trimmed.length - 1];
      const gapSeconds = current.startTime - prev.endTime;
      if (prev.speaker === current.speaker || gapSeconds > 1.8) {
        trimmed.push({ ...current });
        continue;
      }

      const prevWords = tokenizeWithRawWords(prev.text);
      const currWords = tokenizeWithRawWords(current.text);
      if (prevWords.length < 6 || currWords.length < 6) {
        trimmed.push({ ...current });
        continue;
      }

      const maxMatch = Math.min(24, prevWords.length, currWords.length);
      let matchedPrefixWords = 0;
      for (let k = maxMatch; k >= 6; k--) {
        let isMatch = true;
        for (let i = 0; i < k; i++) {
          const left = prevWords[prevWords.length - k + i]?.norm;
          const right = currWords[i]?.norm;
          if (!left || !right || left !== right) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          const prefixRatio = k / Math.max(1, currWords.length);
          if (prefixRatio >= 0.45) {
            matchedPrefixWords = k;
          }
          break;
        }
      }

      if (matchedPrefixWords === 0) {
        trimmed.push({ ...current });
        continue;
      }

      // Prefer preserving "Them" on cross-speaker overlap by trimming duplicated
      // text from the "Me" side when possible.
      const trimCurrentSegment = current.speaker === 'Me';

      if (!trimCurrentSegment) {
        const prevRawWords = prev.text.trim().split(/\s+/);
        const remainingPrevWords = prevRawWords.length - matchedPrefixWords;
        if (remainingPrevWords < 3) {
          trimmed.pop();
          droppedCount++;
        } else {
          const trimmedPrevText = prevRawWords
            .slice(0, remainingPrevWords)
            .join(' ')
            .trim();
          if (!trimmedPrevText) {
            trimmed.pop();
            droppedCount++;
          } else {
            prev.text = trimmedPrevText;
            trimmedCount++;
          }
        }
        trimmed.push({ ...current });
        continue;
      }

      if (currWords.length - matchedPrefixWords < 3) {
        droppedCount++;
        continue;
      }

      const rawWords = current.text.trim().split(/\s+/);
      const trimmedText = rawWords.slice(matchedPrefixWords).join(' ').trim();
      if (!trimmedText) {
        droppedCount++;
        continue;
      }

      trimmed.push({
        ...current,
        text: trimmedText,
      });
      trimmedCount++;
    }

    if (trimmedCount > 0 || droppedCount > 0) {
      console.log(
        `[Pluto] Cross-speaker boundary echo trim: trimmed=${trimmedCount}, dropped=${droppedCount}`,
      );
    }

    return trimmed;
  };

  const detectProbableAudioPassThrough = (
    segments: TranscriptionSegment[],
  ): {
    probable: boolean;
    overlapPairs: number;
    similarPairs: number;
    meCount: number;
    themCount: number;
  } => {
    const meSegments = segments.filter((segment) => segment.speaker === 'Me');
    const themSegments = segments.filter(
      (segment) => segment.speaker === 'Them',
    );
    if (meSegments.length === 0 || themSegments.length === 0) {
      return {
        probable: false,
        overlapPairs: 0,
        similarPairs: 0,
        meCount: meSegments.length,
        themCount: themSegments.length,
      };
    }

    let overlapPairs = 0;
    let similarPairs = 0;

    for (const me of meSegments) {
      for (const them of themSegments) {
        const overlap = overlapSeconds(me, them);
        if (overlap <= 0) continue;

        const meDur = Math.max(0.01, me.endTime - me.startTime);
        const themDur = Math.max(0.01, them.endTime - them.startTime);
        const overlapRatio = overlap / Math.min(meDur, themDur);
        if (overlapRatio < 0.25) continue;

        overlapPairs++;
        const meNorm = normalizeTranscriptText(me.text);
        const themNorm = normalizeTranscriptText(them.text);
        if (!meNorm || !themNorm) continue;
        const contains =
          (meNorm.includes(themNorm) || themNorm.includes(meNorm)) &&
          Math.min(meNorm.length, themNorm.length) >= 14;
        const tokenSim = tokenSimilarity(meNorm, themNorm);
        const prefixSim = tokenPrefixSimilarity(meNorm, themNorm, 10);
        if (contains || tokenSim >= 0.42 || prefixSim >= 0.55) {
          similarPairs++;
        }
      }
    }

    const overlapDensity =
      overlapPairs /
      Math.max(1, Math.min(meSegments.length, themSegments.length));
    const similarityRatio = similarPairs / Math.max(1, overlapPairs);
    const probable =
      overlapPairs >= 2 && overlapDensity >= 0.3 && similarityRatio >= 0.4;

    return {
      probable,
      overlapPairs,
      similarPairs,
      meCount: meSegments.length,
      themCount: themSegments.length,
    };
  };

  const isBleedDuplicate = (
    mic: TranscriptionSegment,
    system: TranscriptionSegment,
  ): boolean => {
    const overlap = overlapSeconds(mic, system);
    if (overlap <= 0) return false;

    const micDur = Math.max(0.01, mic.endTime - mic.startTime);
    const sysDur = Math.max(0.01, system.endTime - system.startTime);
    const overlapRatio = overlap / Math.min(micDur, sysDur);
    if (overlapRatio < 0.35) return false;

    const micNorm = normalizeTranscriptText(mic.text);
    const sysNorm = normalizeTranscriptText(system.text);
    if (!micNorm || !sysNorm) return false;
    if (micNorm === sysNorm) return true;

    const startDelta = Math.abs(mic.startTime - system.startTime);
    const shorter = Math.min(micNorm.length, sysNorm.length);
    const longer = Math.max(micNorm.length, sysNorm.length);
    const containsMatch =
      shorter >= 30 &&
      shorter / longer >= 0.75 &&
      (micNorm.includes(sysNorm) || sysNorm.includes(micNorm));
    if (containsMatch) return true;

    const prefixSimilarity = tokenPrefixSimilarity(micNorm, sysNorm);
    if (startDelta <= 1.5 && overlapRatio >= 0.35 && prefixSimilarity >= 0.5)
      return true;

    if (startDelta > 4) return false;

    const tokenSim = tokenSimilarity(micNorm, sysNorm);
    if (tokenSim >= 0.66 && overlapRatio >= 0.45) return true;
    if (tokenSim >= 0.52 && overlapRatio >= 0.35 && startDelta <= 1.2)
      return true;

    if (shorter < 24) return false;
    return tokenSim >= 0.6;
  };

  const reconcileChunkSpeakerAttribution = (params: {
    chunkIndex: number;
    chunkStartSec: number;
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
    micRmsData: RmsData | null;
    systemRmsData: RmsData | null;
    preferredSpeaker: 'Me' | 'Them' | null;
  }): {
    micSegments: TranscriptionSegment[];
    systemSegments: TranscriptionSegment[];
  } => {
    const {
      chunkIndex,
      chunkStartSec,
      micRmsData,
      systemRmsData,
      preferredSpeaker,
    } = params;
    const micSegments = params.micSegments.map((segment) => ({ ...segment }));
    const systemSegments = params.systemSegments.map((segment) => ({
      ...segment,
    }));
    if (micSegments.length === 0 || systemSegments.length === 0) {
      return { micSegments, systemSegments };
    }

    const removeMic = new Set<number>();
    const removeSystem = new Set<number>();
    const matchedSystem = new Set<number>();
    let relabeledToMe = 0;
    let relabeledToThem = 0;
    let candidatePairs = 0;

    for (let micIndex = 0; micIndex < micSegments.length; micIndex++) {
      if (removeMic.has(micIndex)) continue;
      const mic = micSegments[micIndex];

      let bestSystemIndex = -1;
      let bestPairScore = 0;
      for (
        let systemIndex = 0;
        systemIndex < systemSegments.length;
        systemIndex++
      ) {
        if (matchedSystem.has(systemIndex) || removeSystem.has(systemIndex))
          continue;
        const system = systemSegments[systemIndex];
        if (!isCompetingUtterancePair(mic, system)) continue;

        const overlap = overlapSeconds(mic, system);
        const overlapRatio =
          overlap /
          Math.max(
            0.01,
            Math.min(
              mic.endTime - mic.startTime,
              system.endTime - system.startTime,
            ),
          );
        const similarity = Math.max(
          tokenSimilarity(mic.text, system.text),
          tokenPrefixSimilarity(mic.text, system.text),
        );
        const pairScore = overlapRatio + similarity;
        if (pairScore > bestPairScore) {
          bestPairScore = pairScore;
          bestSystemIndex = systemIndex;
        }
      }

      if (bestSystemIndex < 0) continue;
      candidatePairs++;
      matchedSystem.add(bestSystemIndex);

      const system = systemSegments[bestSystemIndex];
      const winner = selectDominantSpeakerForPair(
        mic,
        system,
        micRmsData,
        systemRmsData,
        chunkStartSec,
        preferredSpeaker,
      );

      const micNorm = normalizeTranscriptText(mic.text);
      const systemNorm = normalizeTranscriptText(system.text);
      let canonicalText = winner === 'Me' ? mic.text : system.text;
      if (micNorm.length > 0 && systemNorm.length > 0) {
        if (micNorm.includes(systemNorm) && micNorm.length >= systemNorm.length)
          canonicalText = mic.text;
        else if (
          systemNorm.includes(micNorm) &&
          systemNorm.length >= micNorm.length
        )
          canonicalText = system.text;
      }
      const canonicalStart = Math.min(mic.startTime, system.startTime);
      const canonicalEnd = Math.max(mic.endTime, system.endTime);

      if (winner === 'Me') {
        removeSystem.add(bestSystemIndex);
        micSegments[micIndex] = {
          ...mic,
          startTime: canonicalStart,
          endTime: canonicalEnd,
          text: canonicalText,
        };
        relabeledToMe++;
      } else {
        removeMic.add(micIndex);
        systemSegments[bestSystemIndex] = {
          ...system,
          startTime: canonicalStart,
          endTime: canonicalEnd,
          text: canonicalText,
        };
        relabeledToThem++;
      }
    }

    if (candidatePairs > 0 || relabeledToMe > 0 || relabeledToThem > 0) {
      console.log(
        `[Pluto] Chunk #${chunkIndex} timestamp attribution: candidates=${candidatePairs}, toMe=${relabeledToMe}, toThem=${relabeledToThem}, preferred=${preferredSpeaker ?? 'none'}`,
      );
    }

    return {
      micSegments: micSegments.filter((_, index) => !removeMic.has(index)),
      systemSegments: systemSegments.filter(
        (_, index) => !removeSystem.has(index),
      ),
    };
  };

  const stopSpeakingMonitor = () => {
    stopSpeakingSamplerRef.current?.();
    stopSpeakingSamplerRef.current = null;
    micAnalyserRef.current = null;
    activeSpeakerWindowRef.current = null;
    lastSpeakerRef.current = null;
    lastSpeakerTsRef.current = 0;
    onSpeakingChange?.(null);
  };

  const enqueueBackgroundJob = (sequence: number, job: () => Promise<void>) => {
    const admission = processingQueueRef.current.enqueue(sequence, job);
    if (admission === 'replaced') {
      onLiveTranscriptIntegrityChange?.('lagging');
    }
  };

  const handleChunkBlob = (
    type: 'mic' | 'system',
    chunkIndex: number,
    chunkBlob: Blob,
    micFormat: MicChunkFormat = 'webm',
    chunkStartSec?: number,
    chunkEndSec?: number,
    systemExpected = false,
  ) => {
    if (type === 'mic') {
      const fallbackStartSec = chunkIndex * CHUNK_SECONDS;
      pendingMicChunksRef.current.set(chunkIndex, {
        blob: chunkBlob,
        format: micFormat,
        chunkStartSec: chunkStartSec ?? fallbackStartSec,
        chunkEndSec: chunkEndSec ?? fallbackStartSec + CHUNK_SECONDS,
      });
    } else pendingSystemChunksRef.current.set(chunkIndex, chunkBlob);

    // Try to process pair
    // Simple strategy: If we have both (or if system isn't running and we have mic), process.
    // But 'system' might be silent/empty? No, blob is blob.

    const micPending = pendingMicChunksRef.current.get(chunkIndex);
    const micBlob = micPending?.blob;
    const micFormatForChunk = micPending?.format ?? 'webm';
    const systemBlob = pendingSystemChunksRef.current.get(chunkIndex);

    if (
      isCaptureChunkPairReady({
        micReady: Boolean(micBlob),
        systemReady: Boolean(systemBlob),
        systemExpected,
      })
    ) {
      pendingMicChunksRef.current.delete(chunkIndex);
      if (systemBlob) pendingSystemChunksRef.current.delete(chunkIndex);

      const generation = liveTranscriptionGenerationRef.current;
      enqueueBackgroundJob(chunkIndex, () =>
        transcribeChunkPair({
          micBlob,
          micFormat: micFormatForChunk,
          systemBlob,
          chunkIndex,
          chunkStartSec: micPending.chunkStartSec,
          chunkEndSec: micPending.chunkEndSec,
          generation,
        }),
      );
    }
  };

  const transcribeChunkPair = async (opts: {
    micBlob: Blob;
    micFormat: MicChunkFormat;
    systemBlob?: Blob;
    chunkIndex: number;
    chunkStartSec?: number;
    chunkEndSec?: number;
    retryCount?: number;
    generation: number;
  }): Promise<void> => {
    const chunkStartSec =
      typeof opts.chunkStartSec === 'number'
        ? opts.chunkStartSec
        : opts.chunkIndex * CHUNK_SECONDS;
    const chunkEndSec =
      typeof opts.chunkEndSec === 'number'
        ? Math.max(chunkStartSec + 0.01, opts.chunkEndSec)
        : chunkStartSec + CHUNK_SECONDS;
    const chunkWindowPadSec = 0.75;

    const processStream = async (
      label: 'Me' | 'Them',
      blob?: Blob,
      format: 'webm' | 'ogg' | 'wav' = 'webm',
    ): Promise<{
      segments: TranscriptionSegment[];
      rms: RmsData | null;
      conversionFailed: boolean;
      audioPath?: string | null;
    }> => {
      if (label === 'Me' && disableMicChunkTranscriptionRef.current) {
        return {
          segments: [],
          rms: null as RmsData | null,
          conversionFailed: false,
          audioPath: null as string | null,
        };
      }
      if (!blob || blob.size < 128) {
        return {
          segments: [],
          rms: null as RmsData | null,
          conversionFailed: false,
        };
      }
      if (blob.size < 1024) {
        console.log(
          `[Pluto] ${label} chunk is small (${blob.size} bytes), attempting transcription anyway`,
        );
      }
      const buffer = await blob.arrayBuffer();
      let rms: RmsData | null = null;
      try {
        // Only compute RMS if we can decode (might fail for raw chunks if no header, but ours have headers)
        // System WAV has header now. Mic WebM has header.
        rms = await computeRmsData(buffer);
      } catch (e) {
        console.warn(
          `[Pluto] Failed to compute ${label} RMS data:`,
          e instanceof Error ? e.message : e,
        );
      }
      let skipTranscription = false;
      if (label === 'Me') {
        const streamMeanRms = meanRms(rms);
        if (streamMeanRms !== null && streamMeanRms < MIC_TRANSCRIBE_MIN_RMS) {
          if (opts.chunkIndex < 3) {
            console.log(
              `[Pluto] Skipping low-energy Me chunk #${opts.chunkIndex}: rms=${streamMeanRms.toFixed(5)}`,
            );
          }
          skipTranscription = true;
        }

        if (
          !skipTranscription &&
          (speakerTimelineRef.current.length > 0 ||
            activeSpeakerWindowRef.current)
        ) {
          const coverageSeconds = getSpeakerActivityCoverage(
            chunkStartSec,
            chunkEndSec,
            'Me',
          );
          const windowSeconds = Math.max(0.01, chunkEndSec - chunkStartSec);
          const coverageRatio = coverageSeconds / windowSeconds;
          if (
            coverageSeconds < MIC_TRANSCRIBE_MIN_SPEAKER_COVERAGE_SECONDS &&
            coverageRatio < MIC_TRANSCRIBE_MIN_SPEAKER_COVERAGE_RATIO
          ) {
            if (opts.chunkIndex < 3) {
              console.log(
                `[Pluto] Skipping Me chunk #${opts.chunkIndex} due to low speaker activity: ` +
                  `coverage=${coverageSeconds.toFixed(2)}s ratio=${coverageRatio.toFixed(2)}`,
              );
            }
            skipTranscription = true;
          }
        }
      }
      if (label === 'Them') {
        const streamMeanRms = meanRms(rms);
        if (
          streamMeanRms !== null &&
          streamMeanRms < SYSTEM_TRANSCRIBE_MIN_RMS
        ) {
          if (opts.chunkIndex < 3) {
            console.log(
              `[Pluto] Skipping low-energy Them chunk #${opts.chunkIndex}: rms=${streamMeanRms.toFixed(5)}`,
            );
          }
          skipTranscription = true;
        }
      }

      let wavPath: string | null = null;
      let conversionError: unknown = null;
      try {
        wavPath = await window.ipcRenderer.invoke(
          'AUDIO_SAVE_AND_CONVERT',
          buffer,
          format,
          label.toLowerCase(),
        );
      } catch (e) {
        conversionError = e;
      }

      if (
        !wavPath &&
        label === 'Me' &&
        format === 'webm' &&
        micWebmInitSegmentRef.current
      ) {
        try {
          const repairedWebm = prependWebmInitSegment(
            micWebmInitSegmentRef.current,
            buffer,
          );
          wavPath = await window.ipcRenderer.invoke(
            'AUDIO_SAVE_AND_CONVERT',
            repairedWebm,
            format,
            label.toLowerCase(),
          );
          if (wavPath) {
            console.warn(
              `[Pluto] Recovered ${label} chunk via WebM init-segment repair`,
            );
          }
        } catch (repairErr) {
          console.warn(
            `[Pluto] Skip ${label} chunk (convert failed after WebM repair):`,
            (repairErr as Error).message,
          );
        }
      }

      if (!wavPath && label === 'Me') {
        // Fallback: build a cumulative WebM (chunks 0..N) so ffmpeg sees a full container.
        // Then keep only segments that overlap the current chunk window.
        try {
          const cumulativeBlob = new Blob(
            micChunksRef.current.slice(0, opts.chunkIndex + 1),
            { type: micMimeTypeRef.current || 'audio/webm;codecs=opus' },
          );
          const cumulativeBuffer = await cumulativeBlob.arrayBuffer();
          const cumulativeWavPath = await window.ipcRenderer.invoke(
            'AUDIO_SAVE_AND_CONVERT',
            cumulativeBuffer,
            getMicFormat(),
            'me-cumulative',
          );
          if (cumulativeWavPath) {
            const cumulativeResult = await window.ipcRenderer.invoke(
              'WHISPER_TRANSCRIBE',
              cumulativeWavPath,
              buildTranscriptionOptions({ diarize: false }),
            );
            const cumulativeSegments = cumulativeResult?.segments
              ? cumulativeResult.segments
                  .filter((s: { text: string }) => isValidSegment(s.text))
                  .filter(
                    (s: { start: number; end: number }) =>
                      s.end > chunkStartSec - chunkWindowPadSec &&
                      s.start < chunkEndSec + chunkWindowPadSec,
                  )
                  .map((s: { start: number; end: number; text: string }) => ({
                    id: crypto.randomUUID(),
                    startTime: s.start,
                    endTime: s.end,
                    text: s.text.trim(),
                    speaker: label,
                  }))
              : [];
            if (cumulativeSegments.length > 0) {
              console.warn(
                `[Pluto] Recovered ${label} chunk via cumulative WebM fallback: chunk=${opts.chunkIndex}, segments=${cumulativeSegments.length}`,
              );
              return {
                segments: cumulativeSegments,
                rms,
                conversionFailed: false,
                audioPath: cumulativeWavPath,
              };
            }
          }
        } catch (cumulativeErr) {
          console.warn(
            `[Pluto] Cumulative fallback failed for ${label} chunk #${opts.chunkIndex}:`,
            cumulativeErr instanceof Error
              ? cumulativeErr.message
              : cumulativeErr,
          );
        }
      }

      if (!wavPath) {
        if (label !== 'Me') {
          if (conversionError) {
            console.warn(
              `[Pluto] Skip ${label} chunk (convert failed):`,
              (conversionError as Error).message,
            );
          }
          return { segments: [], rms, conversionFailed: true };
        }
        if (conversionError) {
          console.warn(
            `[Pluto] Skip ${label} chunk (convert failed):`,
            (conversionError as Error).message,
          );
        } else {
          console.warn(`[Pluto] Skip ${label} chunk (convert returned null)`);
        }
        return { segments: [], rms, conversionFailed: true };
      }
      if (skipTranscription) {
        return {
          segments: [],
          rms,
          conversionFailed: false,
          audioPath: wavPath,
        };
      }

      const chunkDurationSec = Math.max(0.01, chunkEndSec - chunkStartSec);
      const mapSegments = (
        rawSegments: Array<{
          start: number;
          end: number;
          text: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }>,
        timeOffsetSec: number,
      ): TranscriptionSegment[] =>
        rawSegments
          .filter((s) => isValidSegment(s.text))
          .map((s) => ({
            id: crypto.randomUUID(),
            startTime: s.start + timeOffsetSec,
            endTime: s.end + timeOffsetSec,
            text: s.text.trim(),
            speaker: label,
            words: s.words?.map((w) => ({
              word: w.word,
              start: w.start + timeOffsetSec,
              end: w.end + timeOffsetSec,
            })),
          }));

      if (ENABLE_CHUNK_FLUSH && rms) {
        const speechWindows = buildSpeechWindows(rms, chunkDurationSec);
        if (speechWindows.length > 0) {
          const slicePaths = await window.ipcRenderer.invoke(
            'AUDIO_SLICE_WAV',
            {
              inputPath: wavPath,
              segments: speechWindows,
              outputTag: `${label.toLowerCase()}_${opts.chunkIndex}`,
            },
          );

          if (Array.isArray(slicePaths) && slicePaths.length > 0) {
            const sliceSegments: TranscriptionSegment[] = [];
            let attemptedSlices = 0;
            for (let i = 0; i < slicePaths.length; i++) {
              const slicePath = slicePaths[i];
              const speechWindow = speechWindows[i];
              if (!slicePath || !speechWindow) continue;
              attemptedSlices += 1;
              const sliceResult = await window.ipcRenderer.invoke(
                'WHISPER_TRANSCRIBE',
                slicePath,
                buildTranscriptionOptions({ diarize: false }),
              );
              if (Array.isArray(sliceResult?.segments)) {
                sliceSegments.push(
                  ...mapSegments(
                    sliceResult.segments,
                    chunkStartSec + speechWindow.startSec,
                  ),
                );
              }
            }

            if (attemptedSlices > 0 && sliceSegments.length > 0) {
              console.log(
                `[Pluto] ${label} chunk #${opts.chunkIndex} flush slices=${attemptedSlices}, segments=${sliceSegments.length}`,
              );
              return {
                segments: sliceSegments,
                rms,
                conversionFailed: false,
                audioPath: wavPath,
              };
            }
          }
        }
      }

      const result = await window.ipcRenderer.invoke(
        'WHISPER_TRANSCRIBE',
        wavPath,
        buildTranscriptionOptions({
          diarize: false,
          meetingId: currentMeetingIdRef.current,
        }),
      );
      const segments = Array.isArray(result?.segments)
        ? mapSegments(result.segments, chunkStartSec)
        : [];
      return { segments, rms, conversionFailed: false, audioPath: wavPath };
    };

    const [micResult, systemResult] = await Promise.all([
      processStream('Me', opts.micBlob, opts.micFormat),
      processStream('Them', opts.systemBlob, 'wav'),
    ]);
    if (opts.generation !== liveTranscriptionGenerationRef.current) return;
    const checkpointMeetingId = currentMeetingIdRef.current;
    const micActivitySeconds = getSpeakerActivityCoverage(
      chunkStartSec,
      chunkEndSec,
      'Me',
    );
    const localTranscriptSeconds = micResult.segments.reduce(
      (total: number, segment: TranscriptionSegment) =>
        total + Math.max(0, segment.endTime - segment.startTime),
      0,
    );
    const liveIntegrity = evaluateLiveTranscriptCoverage({
      micActivitySeconds,
      localTranscriptSeconds,
      conversionFailed: micResult.conversionFailed,
      priorRetries: opts.retryCount || 0,
    });
    onLiveTranscriptIntegrityChange?.(liveIntegrity.state);
    if (liveIntegrity.shouldRetry) {
      await transcribeChunkPair({
        ...opts,
        retryCount: (opts.retryCount || 0) + 1,
      });
      return;
    }
    if (checkpointMeetingId) {
      if (micResult.audioPath) {
        await completeCaptureJournalChunkFromPath({
          meetingId: checkpointMeetingId,
          source: 'mic',
          sequence: opts.chunkIndex,
          repairPath: micResult.audioPath,
        });
      }
      if (systemResult.audioPath) {
        await completeCaptureJournalChunkFromPath({
          meetingId: checkpointMeetingId,
          source: 'system',
          sequence: opts.chunkIndex,
          repairPath: systemResult.audioPath,
        });
      }
      await persistTranscriptCheckpoint({
        meetingId: checkpointMeetingId,
        source: 'mic',
        sequence: opts.chunkIndex,
        segments: micResult.segments,
        disposition: micResult.conversionFailed
          ? 'conversion_failed'
          : 'transcribed',
      });
      if (opts.systemBlob) {
        await persistTranscriptCheckpoint({
          meetingId: checkpointMeetingId,
          source: 'system',
          sequence: opts.chunkIndex,
          segments: systemResult.segments,
          disposition: systemResult.conversionFailed
            ? 'conversion_failed'
            : 'transcribed',
        });
      }
    }
    if (systemResult.audioPath) {
      savedSystemChunkAudioRef.current.set(opts.chunkIndex, {
        chunkIndex: opts.chunkIndex,
        path: systemResult.audioPath,
        startSec: chunkStartSec,
        endSec: chunkEndSec,
      });
    }
    if (micResult.conversionFailed) {
      micChunkConversionFailuresRef.current += 1;
      console.warn(
        `[Pluto] Mic chunk conversion failed at chunk #${opts.chunkIndex}`,
      );
      if (
        micChunkConversionFailuresRef.current >= 2 &&
        !disableMicChunkTranscriptionRef.current
      ) {
        disableMicChunkTranscriptionRef.current = true;
        console.warn(
          '[Pluto] Disabling per-chunk Me transcription for this meeting; using full-session recovery path',
        );
      }
    }

    const micSegments: TranscriptionSegment[] = micResult.segments.map(
      (s: TranscriptionSegment) => ({
        ...s,
        startTime: s.startTime - chunkStartSec,
        endTime: s.endTime - chunkStartSec,
      }),
    );

    const systemSegments: TranscriptionSegment[] = systemResult.segments.map(
      (s: TranscriptionSegment) => ({
        ...s,
        startTime: s.startTime - chunkStartSec,
        endTime: s.endTime - chunkStartSec,
      }),
    );
    let filteredMicSegments = micSegments;
    let filteredSystemSegments = systemSegments;
    const micMean = meanRms(micResult.rms);
    const systemMean = meanRms(systemResult.rms);
    const logChunkAttributionStage = (
      reason: string,
      beforeMe: number,
      beforeThem: number,
      afterMe: number,
      afterThem: number,
    ) => {
      if (beforeMe === afterMe && beforeThem === afterThem) return;
      console.log(
        `[Pluto] Chunk #${opts.chunkIndex} attribution ${reason}: ` +
          `Me ${beforeMe}->${afterMe}, Them ${beforeThem}->${afterThem}`,
      );
    };

    console.log(
      `[Pluto] Chunk #${opts.chunkIndex} attribution input: ${JSON.stringify({
        me: micSegments.length,
        them: systemSegments.length,
        micRms: micMean ?? 0,
        systemRms: systemMean ?? 0,
        arbitration: ENABLE_CHUNK_ARBITRATION,
      })}`,
    );

    if (
      ENABLE_CHUNK_ARBITRATION &&
      micSegments.length > 0 &&
      systemSegments.length > 0
    ) {
      const chunkPreferredSpeaker: 'Me' | 'Them' | null =
        pickPreferredSpeakerForChunk(
          chunkStartSec,
          chunkEndSec,
          micMean,
          systemMean,
        );

      const reconciled = reconcileChunkSpeakerAttribution({
        chunkIndex: opts.chunkIndex,
        chunkStartSec,
        micSegments,
        systemSegments,
        micRmsData: micResult.rms,
        systemRmsData: systemResult.rms,
        preferredSpeaker: chunkPreferredSpeaker,
      });
      filteredMicSegments = reconciled.micSegments;
      filteredSystemSegments = reconciled.systemSegments;
      logChunkAttributionStage(
        'reconcile',
        micSegments.length,
        systemSegments.length,
        filteredMicSegments.length,
        filteredSystemSegments.length,
      );

      // Fallback pruning for unresolved bleed when one channel is clearly dominant in this chunk.
      if (
        chunkPreferredSpeaker === 'Them' &&
        filteredMicSegments.length > 0 &&
        filteredSystemSegments.length > 0
      ) {
        const beforeMe = filteredMicSegments.length;
        filteredMicSegments = filteredMicSegments.filter(
          (mic) =>
            !filteredSystemSegments.some((sys) => isBleedDuplicate(mic, sys)),
        );
        logChunkAttributionStage(
          'preferred-them-duplicate-prune',
          beforeMe,
          filteredSystemSegments.length,
          filteredMicSegments.length,
          filteredSystemSegments.length,
        );
      } else if (
        chunkPreferredSpeaker === 'Me' &&
        filteredMicSegments.length > 0 &&
        filteredSystemSegments.length > 0
      ) {
        const beforeThem = filteredSystemSegments.length;
        filteredSystemSegments = filteredSystemSegments.filter(
          (sys) =>
            !filteredMicSegments.some((mic) => isBleedDuplicate(sys, mic)),
        );
        logChunkAttributionStage(
          'preferred-me-duplicate-prune',
          filteredMicSegments.length,
          beforeThem,
          filteredMicSegments.length,
          filteredSystemSegments.length,
        );
      }

      if (filteredMicSegments.length > 0 && filteredSystemSegments.length > 0) {
        const beforeMe = filteredMicSegments.length;
        const beforeThem = filteredSystemSegments.length;
        const activityPruned = pruneSegmentsBySpeakerActivity({
          chunkIndex: opts.chunkIndex,
          chunkStartSec,
          micSegments: filteredMicSegments,
          systemSegments: filteredSystemSegments,
        });
        filteredMicSegments = activityPruned.micSegments;
        filteredSystemSegments = activityPruned.systemSegments;
        logChunkAttributionStage(
          'activity-prune',
          beforeMe,
          beforeThem,
          filteredMicSegments.length,
          filteredSystemSegments.length,
        );
      }

      if (
        filteredMicSegments.length !== micSegments.length ||
        filteredSystemSegments.length !== systemSegments.length
      ) {
        console.log(
          `[Pluto] Chunk #${opts.chunkIndex} arbitration: preferred=${chunkPreferredSpeaker ?? 'none'}, Me ${micSegments.length}->${filteredMicSegments.length}, Them ${systemSegments.length}->${filteredSystemSegments.length}, micRms=${micMean ?? 0}, sysRms=${systemMean ?? 0}`,
        );
      }
    }

    if (filteredMicSegments.length > 0 && filteredSystemSegments.length > 0) {
      const beforeMe = filteredMicSegments.length;
      const beforeThem = filteredSystemSegments.length;
      const energyPruned = pruneSegmentsByEnergyDominance({
        chunkIndex: opts.chunkIndex,
        micSegments: filteredMicSegments,
        systemSegments: filteredSystemSegments,
        micRmsData: micResult.rms,
        systemRmsData: systemResult.rms,
      });
      filteredMicSegments = energyPruned.micSegments;
      filteredSystemSegments = energyPruned.systemSegments;
      logChunkAttributionStage(
        'energy-prune',
        beforeMe,
        beforeThem,
        filteredMicSegments.length,
        filteredSystemSegments.length,
      );
    }

    if (filteredMicSegments.length > 0 && filteredSystemSegments.length > 0) {
      const beforeMe = filteredMicSegments.length;
      const beforeThem = filteredSystemSegments.length;
      const activityPruned = pruneSegmentsBySpeakerActivity({
        chunkIndex: opts.chunkIndex,
        chunkStartSec,
        micSegments: filteredMicSegments,
        systemSegments: filteredSystemSegments,
      });
      filteredMicSegments = activityPruned.micSegments;
      filteredSystemSegments = activityPruned.systemSegments;
      logChunkAttributionStage(
        'post-energy-activity-prune',
        beforeMe,
        beforeThem,
        filteredMicSegments.length,
        filteredSystemSegments.length,
      );
    }

    if (filteredMicSegments.length > 0 && filteredSystemSegments.length > 0) {
      const beforeMe = filteredMicSegments.length;
      const beforeThem = filteredSystemSegments.length;
      const qualityPruned = pruneSegmentsByTranscriptQuality({
        chunkIndex: opts.chunkIndex,
        micSegments: filteredMicSegments,
        systemSegments: filteredSystemSegments,
      });
      filteredMicSegments = qualityPruned.micSegments;
      filteredSystemSegments = qualityPruned.systemSegments;
      logChunkAttributionStage(
        'quality-prune',
        beforeMe,
        beforeThem,
        filteredMicSegments.length,
        filteredSystemSegments.length,
      );
    }

    console.log(
      `[Pluto] Chunk #${opts.chunkIndex} transcript segments: ` +
        `Me=${micSegments.length}->${filteredMicSegments.length}, ` +
        `Them=${systemSegments.length}->${filteredSystemSegments.length}`,
    );
    if (micSegments.length === 0 && systemSegments.length > 0) {
      zeroMicChunkStreakRef.current += 1;
      if (zeroMicChunkStreakRef.current >= 2) {
        console.warn(
          `[Pluto] Mic transcript gap detected: ${zeroMicChunkStreakRef.current} consecutive chunks with no Me segments`,
        );
      }
    } else {
      zeroMicChunkStreakRef.current = 0;
    }

    if (checkpointMeetingId) {
      await persistTranscriptAcceptanceFrame({
        meetingId: checkpointMeetingId,
        sequence: opts.chunkIndex,
        chunkStartSec,
        chunkEndSec,
        micSegments: filteredMicSegments,
        systemSegments: filteredSystemSegments,
        micMeanRms: micMean,
        systemMeanRms: systemMean,
        systemExpected: Boolean(opts.systemBlob),
      });
    }

    // Channel-first strategy: keep per-channel attribution from chunk processing.
    processedMicSegmentsRef.current.push(
      ...filteredMicSegments.map((s: TranscriptionSegment) => ({
        ...s,
        startTime: s.startTime + chunkStartSec,
        endTime: s.endTime + chunkStartSec,
      })),
      ...filteredSystemSegments.map((s: TranscriptionSegment) => ({
        ...s,
        startTime: s.startTime + chunkStartSec,
        endTime: s.endTime + chunkStartSec,
      })),
    );
    const acceptedSegments = [
      ...filteredMicSegments,
      ...filteredSystemSegments,
    ];
    const liveTranscript: LiveTranscriptSegment[] = [
      ...processedMicSegmentsRef.current,
    ]
      .sort((a, b) => a.startTime - b.startTime)
      .map((segment) => ({
        id: segment.id,
        speaker:
          segment.speaker === 'Me' || segment.speaker === 'Them'
            ? segment.speaker
            : 'Unknown',
        text: segment.text,
        timestampMs: segment.startTime * 1_000,
        confirmed: true,
      }));
    liveTranscriptResponsivenessRef.current.publishAcceptedSegments(
      acceptedSegments,
      () => {
        onInterimTranscript?.('');
        onLiveTranscript?.(liveTranscript);
      },
    );
  };

  // Common Whisper Hallucinations to filter out
  const INVALID_PHRASES = [
    'you',
    'mbc',
    'subtitles by',
    'captioned by',
    'watching',
    'subscribe',
    'copyright',
    'all rights reserved',
  ];

  const hasRepeatedPhraseLoop = (tokens: string[]): boolean => {
    if (tokens.length < 10) return false;
    for (let width = 3; width <= 6; width++) {
      if (tokens.length < width * 3) continue;
      const phraseCounts = new Map<string, number>();
      let maxCount = 0;
      for (let i = 0; i <= tokens.length - width; i++) {
        const phrase = tokens.slice(i, i + width).join(' ');
        const next = (phraseCounts.get(phrase) || 0) + 1;
        phraseCounts.set(phrase, next);
        if (next > maxCount) maxCount = next;
      }
      if (maxCount >= 3 && (maxCount * width) / tokens.length >= 0.45) {
        return true;
      }
    }
    return false;
  };

  const hasLongTokenRun = (tokens: string[]): boolean => {
    let longestRun = 1;
    let run = 1;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] === tokens[i - 1]) {
        run++;
        if (run > longestRun) longestRun = run;
      } else {
        run = 1;
      }
    }
    return longestRun >= 4;
  };

  const isValidSegment = (text: string): boolean => {
    const clean = text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ');
    if (clean.length < 2) return false; // Too short
    if (INVALID_PHRASES.includes(clean)) return false;
    const tokens = clean.split(' ').filter(Boolean);
    if (hasLongTokenRun(tokens)) return false;
    if (hasRepeatedPhraseLoop(tokens)) return false;
    if (tokens.length >= 14) {
      const uniqueRatio = new Set(tokens).size / tokens.length;
      if (uniqueRatio < 0.3) return false;
    }
    return true;
  };

  const normalizeValidationText = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const shouldDropUnvalidatedShortThemSegment = (
    segment: TranscriptionSegment,
    fullSessionTexts: string[],
  ): boolean => {
    if (segment.speaker !== 'Them') return false;
    if (fullSessionTexts.length === 0) return false;
    const normalizedSegment = normalizeValidationText(segment.text);
    if (!normalizedSegment) return true;
    const words = normalizedSegment.split(' ').filter(Boolean);
    const durationSec = Math.max(0, segment.endTime - segment.startTime);
    if (words.length >= 3) return false;
    if (durationSec >= 0.85 && words.length >= 2) return false;

    let bestSimilarity = 0;
    for (const candidateRaw of fullSessionTexts) {
      const candidate = normalizeValidationText(candidateRaw);
      if (!candidate) continue;
      if (
        candidate.includes(normalizedSegment) ||
        normalizedSegment.includes(candidate)
      ) {
        return false;
      }
      const similarity = tokenSimilarity(normalizedSegment, candidate);
      if (similarity > bestSimilarity) bestSimilarity = similarity;
    }
    if (bestSimilarity >= 0.08) return false;
    if (
      !hasRepeatedPhraseLoop(words) &&
      !hasLongTokenRun(words) &&
      words.length >= 2
    )
      return false;
    return true;
  };

  const stopSession = async (endReason?: string) => {
    const stopSnapshot = beginRecordingFinalization({
      meetingId: currentMeetingIdRef.current,
      stopInFlight: stopInFlightRef.current,
      recordingStartedAtMs: startTimeRef.current,
      nowMs: Date.now(),
    });
    if (!stopSnapshot) {
      console.warn('[Pluto] Ignoring duplicate or orphaned stop request');
      return;
    }
    stopSpeakingMonitor();
    frozenLiveTranscriptResponsivenessRef.current =
      liveTranscriptResponsivenessRef.current.freezeBeforeFinalization();
    startStopToValidatedLatencyAfterAcceptedStop({
      acceptedStop: stopSnapshot,
      accumulator: stopToValidatedLatencyRef.current,
      nowMs: performance.now(),
    });

    stopInFlightRef.current = true;
    recordingEndedAtRef.current = stopSnapshot.recordingEndedAtMs;
    isProcessingRef.current = true;
    console.log(
      '[Pluto] Stopping session...',
      endReason ? `(reason: ${endReason})` : '',
    );
    setIsProcessing(true);

    const liveQueueAtStop = processingQueueRef.current;

    let primaryAudioPath = '';
    let systemAudioPath = '';
    let mixedAudioPath = '';
    let rebuiltSystemAudioPath = '';
    let sealedActivityEvidence: CaptureActivityEvidence | null = null;

    try {
      // Helper to stop a recorder and get its blob
      const stopRecorder = async (
        recorder: MediaRecorder | null,
        chunks: Blob[],
        mimeTypeOverride?: string | null,
      ): Promise<Blob | null> => {
        if (!recorder || recorder.state === 'inactive') {
          if (chunks.length > 0) {
            const type =
              mimeTypeOverride ||
              recorder?.mimeType ||
              'audio/webm;codecs=opus';
            return new Blob(chunks, { type });
          }
          return null;
        }

        const stopped = new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
        });
        recorder.stop();
        await stopped;

        if (chunks.length === 0) return null;
        const type =
          mimeTypeOverride || recorder?.mimeType || 'audio/webm;codecs=opus';
        return new Blob(chunks, { type });
      };

      // Stop Mic Recorder
      const micBlob = await stopRecorder(
        micRecorderRef.current,
        micChunksRef.current,
        micMimeTypeRef.current,
      );

      // Stop Native Capture
      cancelSystemAudioHealthTimeoutRef.current?.();
      cancelSystemAudioHealthTimeoutRef.current = null;
      await window.ipcRenderer.invoke('NATIVE_AUDIO_STOP');
      if (nativeAudioListenerRef.current) {
        window.ipcRenderer.off(
          'NATIVE_AUDIO_CHUNK',
          nativeAudioListenerRef.current,
        );
        nativeAudioListenerRef.current = null;
      }

      // Finalize System Audio
      let systemBlob: Blob | undefined;
      let finalizedSystemDurationSec = 0;
      if (fullSessionSystemPcmChunksRef.current.length > 0) {
        // Merge remaining
        let totalLen = 0;
        for (const c of fullSessionSystemPcmChunksRef.current)
          totalLen += c.length;
        const merged = new Float32Array(totalLen);
        let offset = 0;
        for (const c of fullSessionSystemPcmChunksRef.current) {
          merged.set(c, offset);
          offset += c.length;
        }
        systemBlob = createWavBlob(merged, systemPcmSampleRateRef.current, 1);
        const approximateDurationSec =
          systemPcmSampleRateRef.current > 0
            ? merged.length / systemPcmSampleRateRef.current
            : 0;
        finalizedSystemDurationSec = approximateDurationSec;
        console.log(
          `[Pluto] Finalized System Audio: ${systemBlob.size} bytes, duration≈${approximateDurationSec.toFixed(2)}s`,
        );
      } else {
        console.warn(
          '[Pluto] Finalized System Audio: no captured system PCM samples were available for the full session',
        );
      }
      if (systemPcmChunksRef.current.length > 0) {
        systemPcmChunksRef.current = [];
      }
      fullSessionSystemPcmChunksRef.current = [];

      // Stop all tracks
      stopAllTracks();

      // Reset refs
      micRecorderRef.current = null;
      micMimeTypeRef.current = null;
      micChunksRef.current = [];
      hasMicRecorderRef.current = false;
      hasSystemRecorderRef.current = false;

      // Cleanup capture-time audio resources.
      stopSpeakingMonitor();
      const frozenDurationSeconds = Math.max(
        0,
        (stopSnapshot.recordingEndedAtMs - stopSnapshot.recordingStartedAtMs) /
          1000,
      );
      await captureActivitySessionRef.current?.closeAt(frozenDurationSeconds);
      speakerTimelineRef.current =
        captureActivitySessionRef.current?.windows() ?? [];
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (visStreamRef.current) {
        for (const track of visStreamRef.current.getTracks()) {
          track.stop();
        }
        visStreamRef.current = null;
      }
      isRecordingRef.current = false;
      setIsRecording(false);

      await captureActivitySessionRef.current?.drain();
      liveQueueAtStop.close({ drainQueued: true });
      const finalIntervalSettled = await liveQueueAtStop.waitForIdle(2_500);
      if (!finalIntervalSettled) {
        const discardedLiveWork = liveQueueAtStop.close();
        if (discardedLiveWork.discardedSequence !== null) {
          console.warn(
            '[Pluto] Discarded queued live transcription after stop-boundary timeout',
          );
        }
      }
      liveTranscriptionGenerationRef.current += 1;
      await window.ipcRenderer
        .invoke('CANCEL_MEETING_TRANSCRIPTION', stopSnapshot.meetingId)
        .catch((error) => {
          console.warn(
            '[Pluto] Failed to cancel active live transcription:',
            error,
          );
          return null;
        });
      pendingMicChunksRef.current.clear();
      pendingSystemChunksRef.current.clear();
      zeroMicChunkStreakRef.current = 0;
      if (!finalIntervalSettled) {
        console.warn(
          '[Pluto] Live transcription did not settle before finalization; stale results are fenced',
        );
      }

      const journalSealOutcome = await sealCaptureJournalBeforeFinalization({
        drainAppends: async () => {
          await captureActivitySessionRef.current?.drain();
          await captureJournalMutationCoordinatorRef.current.drain();
        },
        hasWriteFailure: () =>
          captureActivitySessionRef.current?.hasDurabilityFailure() ?? true,
        seal: async () =>
          await captureJournalMutationCoordinatorRef.current.run(async () => {
            const current = await refreshCaptureJournalState(
              stopSnapshot.meetingId,
            );
            if (current) {
              const stopping = (await window.ipcRenderer.invoke(
                'AUDIO_CAPTURE_JOURNAL_STOP',
                {
                  meetingId: stopSnapshot.meetingId,
                  generation: current.generation,
                  expectedRevision: current.revision,
                },
              )) as JournalManifestState;
              captureJournalStateRef.current = stopping;
            }
            return await window.ipcRenderer.invoke(
              'AUDIO_CAPTURE_JOURNAL_SEAL',
              {
                meetingId: stopSnapshot.meetingId,
                endedAtMs: stopSnapshot.recordingEndedAtMs,
              },
            );
          }),
      });

      if (journalSealOutcome.status === 'recovery_required') {
        console.warn(
          `[Pluto] ${journalSealOutcome.reason}; preserving recovery state`,
        );
        warnCaptureDurability();
        pendingMicChunksRef.current.clear();
        pendingSystemChunksRef.current.clear();
        zeroMicChunkStreakRef.current = 0;
        const degradedMeeting = buildRecoverableSealFailureMeeting({
          snapshot: stopSnapshot,
          title: userTitle,
          userNotes,
          endReason,
          failureReason: journalSealOutcome.reason,
        });
        const stopToValidatedLatency = markStopToValidatedLatencyUnavailable(
          stopToValidatedLatencyRef.current,
          'recovery_required',
        );
        try {
          await window.ipcRenderer.invoke('SAVE_MEETING', {
            ...degradedMeeting,
            participants,
            capture_journal_generation:
              captureJournalStateRef.current?.generation ?? null,
            transcript_json: JSON.stringify(
              buildTranscriptJsonPayload([], {
                canonicalSource: 'mic',
                postHydrationBleedPass: false,
                stopToValidatedLatency,
                lifecycleStatus: 'needs_attention',
              }),
            ),
          });
        } catch {
          throw new Error('Failed to preserve recording recovery state');
        }
        onSessionComplete?.(degradedMeeting.id);
        alert('Recording saved - processing needs recovery');
        return;
      }
      sealedActivityEvidence = journalSealOutcome.activityEvidence;
      const sealedActivityHandoff = createSealedCaptureActivityHandoff(
        journalSealOutcome.activityEvidence,
      );

      if (!currentMeetingIdRef.current) return; // Session aborted or never started

      // Store a single full audio file for playback
      const primaryBlob = micBlob; // Default to mic
      if (primaryBlob && primaryBlob.size > 0) {
        try {
          const buffer = await primaryBlob.arrayBuffer();
          const maybePath = await window.ipcRenderer.invoke(
            'AUDIO_SAVE_AND_CONVERT',
            buffer,
            getMicFormat(),
            'session-mic',
          );
          if (maybePath) primaryAudioPath = maybePath;
        } catch (e) {
          console.warn('[Pluto] Save failed:', e);
        }
      }
      if (systemBlob && systemBlob.size > 0) {
        try {
          const buffer = await systemBlob.arrayBuffer();
          const maybePath = await window.ipcRenderer.invoke(
            'AUDIO_SAVE_AND_CONVERT',
            buffer,
            'wav',
            'session-system',
          );
          if (maybePath) systemAudioPath = maybePath;
        } catch (e) {
          console.warn('[Pluto] System audio save failed:', e);
        }
      }
      const meetingDurationSec = getMeetingElapsedSeconds();
      const savedSystemChunks = Array.from(
        savedSystemChunkAudioRef.current.values(),
      ).sort((left, right) => left.chunkIndex - right.chunkIndex);
      if (
        shouldUseSystemAudioReconstructionFallback({
          primaryDurationSec: finalizedSystemDurationSec,
          meetingDurationSec,
          chunks: savedSystemChunks,
        })
      ) {
        try {
          const rebuiltSystemPath = await window.ipcRenderer.invoke(
            'AUDIO_STITCH_WAV_SEGMENTS',
            {
              segments: savedSystemChunks,
              outputTag: 'session-system-rebuilt',
            },
          );
          if (rebuiltSystemPath) {
            rebuiltSystemAudioPath = rebuiltSystemPath;
            systemAudioPath = rebuiltSystemPath;
            console.warn(
              `[Pluto] Reconstructed session-system from ${savedSystemChunks.length} saved system chunks`,
            );
          }
        } catch (e) {
          console.warn(
            '[Pluto] System audio reconstruction fallback failed:',
            e,
          );
        }
      }
      if (primaryAudioPath && systemAudioPath) {
        try {
          const maybeMixed = await window.ipcRenderer.invoke('AUDIO_MIX_WAV', {
            inputPaths: [primaryAudioPath, systemAudioPath],
            outputTag: 'session-mix',
          });
          if (maybeMixed) mixedAudioPath = maybeMixed;
        } catch (e) {
          console.warn('[Pluto] Mixed audio build failed:', e);
        }
      }
      // Notify completion
      // ... (rest of logic)

      // Live work was closed and bounded before the capture journal was sealed.
      const totalSpeakerWindowSeconds = speakerTimelineRef.current.reduce(
        (sum, window) => sum + Math.max(0, window.endTime - window.startTime),
        0,
      );
      console.log(
        `[Pluto] Speaker activity timeline windows=${speakerTimelineRef.current.length}, totalSeconds=${totalSpeakerWindowSeconds.toFixed(2)}`,
      );
      const collectedSegments = processedMicSegmentsRef.current;
      const collectedSortedSegments = [...collectedSegments].sort(
        (a, b) => a.startTime - b.startTime,
      );
      const baselinePassThroughCheck = detectProbableAudioPassThrough(
        collectedSortedSegments,
      );
      if (baselinePassThroughCheck.probable) {
        console.warn(
          `[Pluto] Early pass-through risk detected before full-session recovery (overlapPairs=${baselinePassThroughCheck.overlapPairs}, similarPairs=${baselinePassThroughCheck.similarPairs}).`,
        );
      }
      let timelineSegments = collectedSegments;
      let fullSessionRecoveredMeSegments: TranscriptionSegment[] = [];
      let fullSessionCanonicalSegments: TranscriptionSegment[] = [];
      let fullSessionValidationTexts: string[] = [];
      let sessionTranscriptionMeta: TranscriptTranscriptionMeta | undefined;
      let sessionCanonicalSource: CanonicalTranscriptSource = 'mic';
      let postHydrationBleedPass = false;
      let postHydrationBleedDroppedMe = 0;
      const transcriptPipeline: Record<string, string | number> = {};
      const chunkMeSegments = collectedSegments.filter(
        (segment) => segment.speaker === 'Me',
      );
      const chunkThemSegments = collectedSegments.filter(
        (segment) => segment.speaker === 'Them',
      );
      const hasChunkMeSegments = chunkMeSegments.length > 0;
      const pipelineMode: TranscriptPipelineMode = 'canonical_session_v2';
      const chunkWordCount = collectedSegments.reduce((total, segment) => {
        return total + segment.text.trim().split(/\s+/).filter(Boolean).length;
      }, 0);
      const provisionalMeetingDurationSeconds = getMeetingElapsedSeconds();
      const provisionalFallbackDecision = getSessionFallbackDecision({
        meetingDurationSeconds: provisionalMeetingDurationSeconds,
        totalSpeakerWindowSeconds,
        segmentCount: collectedSegments.length,
        meSegmentCount: chunkMeSegments.length,
        themSegmentCount: chunkThemSegments.length,
        totalWords: chunkWordCount,
        micChunkConversionFailures: micChunkConversionFailuresRef.current,
        micTranscriptionDisabled: disableMicChunkTranscriptionRef.current,
        systemChunkDecodeDropCount: systemChunkDecodeDropCountRef.current,
      });
      const sessionFallbackDecision = {
        ...provisionalFallbackDecision,
        shouldRun: false,
      };
      transcriptPipeline.sessionFallbackUsed = 0;
      if (provisionalFallbackDecision.reasons.length > 0) {
        transcriptPipeline.provisionalRecoveryReasons =
          provisionalFallbackDecision.reasons.join(',');
      }

      const useMixForCanonical = shouldUseMixForCanonicalTranscript({
        preferMixDefault:
          TRANSCRIPTION_TUNING.canonicalTranscript.preferMixSource === true,
        hasMixedAudioPath: Boolean(mixedAudioPath),
      });
      const canonicalAudioPath =
        sessionFallbackDecision.shouldRun &&
        useMixForCanonical &&
        mixedAudioPath
          ? mixedAudioPath
          : sessionFallbackDecision.shouldRun
            ? primaryAudioPath
            : null;

      const whisperToMicLabeledSegments = (
        whisperResult: unknown,
        speaker: string,
      ): TranscriptionSegment[] => {
        const raw = whisperResult as {
          segments?: Array<{
            start: number;
            end: number;
            text: string;
            words?: Array<{ word: string; start: number; end: number }>;
          }>;
        };
        return raw?.segments
          ? raw.segments
              .filter((s) => isValidSegment(s.text))
              .map((s) => ({
                id: crypto.randomUUID(),
                startTime: s.start,
                endTime: s.end,
                text: s.text.trim(),
                speaker,
                words: s.words?.map((w) => ({
                  word: w.word,
                  start: w.start,
                  end: w.end,
                })),
              }))
          : [];
      };

      const whisperToValidationTexts = (whisperResult: unknown): string[] => {
        const raw = whisperResult as { segments?: Array<{ text: string }> };
        return raw?.segments
          ? raw.segments
              .map((s: { text: string }) => (s.text || '').trim())
              .filter((text: string) => text.length > 0)
          : [];
      };

      const extractTranscriptionMeta = (
        whisperResult: unknown,
      ): TranscriptTranscriptionMeta | undefined => {
        const raw = whisperResult as {
          meta?: TranscriptTranscriptionMeta | null;
        };
        return raw?.meta || undefined;
      };

      if (canonicalAudioPath) {
        try {
          const canonicalSource =
            canonicalAudioPath === mixedAudioPath ? 'mix' : 'mic';
          const canonicalWhisper = await window.ipcRenderer.invoke(
            'WHISPER_TRANSCRIBE',
            canonicalAudioPath,
            buildTranscriptionOptions({
              diarize: false,
              canonicalSource,
            }),
          );
          fullSessionCanonicalSegments = whisperToMicLabeledSegments(
            canonicalWhisper,
            'Unknown',
          );
          fullSessionValidationTexts =
            whisperToValidationTexts(canonicalWhisper);
          sessionCanonicalSource = canonicalSource;
          sessionTranscriptionMeta =
            extractTranscriptionMeta(canonicalWhisper) ||
            sessionTranscriptionMeta;

          if (primaryAudioPath && primaryAudioPath !== canonicalAudioPath) {
            const micOnlyWhisper = await window.ipcRenderer.invoke(
              'WHISPER_TRANSCRIBE',
              primaryAudioPath,
              buildTranscriptionOptions({
                diarize: false,
                canonicalSource: 'mic',
              }),
            );
            fullSessionRecoveredMeSegments = whisperToMicLabeledSegments(
              micOnlyWhisper,
              'Me',
            );
            sessionTranscriptionMeta =
              sessionTranscriptionMeta ||
              extractTranscriptionMeta(micOnlyWhisper);
            console.log(
              `[Pluto] Full-session canonical source=${sessionCanonicalSource} (${fullSessionCanonicalSegments.length} segs); mic recovery=${fullSessionRecoveredMeSegments.length} segs`,
            );
          } else {
            fullSessionRecoveredMeSegments = fullSessionCanonicalSegments;
            console.log(
              `[Pluto] Full-session transcript source=${sessionCanonicalSource}, segments=${fullSessionCanonicalSegments.length}`,
            );
          }

          const recoveredMeSegments = fullSessionRecoveredMeSegments;

          if (recoveredMeSegments.length > 0) {
            if (
              shouldApplyFullSessionMeRecovery({
                hasChunkMeSegments,
                recoveredMeCount: recoveredMeSegments.length,
                bleedLikely: baselinePassThroughCheck.probable,
              })
            ) {
              const nonMeSegments = collectedSegments.filter(
                (segment) => segment.speaker !== 'Me',
              );
              const replacedCount =
                collectedSegments.length - nonMeSegments.length;
              timelineSegments = [...nonMeSegments, ...recoveredMeSegments];
              console.log(
                `[Pluto] Using full-session Me transcript for final assembly: replacedChunkMe=${replacedCount}, recoveredMe=${recoveredMeSegments.length}`,
              );
            } else if (
              !hasChunkMeSegments &&
              baselinePassThroughCheck.probable
            ) {
              console.warn(
                `[Pluto] Skipping full-session Me recovery due to bleed risk: recoveredMe=${recoveredMeSegments.length}`,
              );
            } else {
              console.log(
                `[Pluto] Preserving chunk-level Me attribution: chunkMe=${chunkMeSegments.length}, chunkThem=${chunkThemSegments.length}, recoveredMe=${recoveredMeSegments.length}`,
              );
            }
          } else {
            console.warn(
              '[Pluto] Full session transcription returned no recoverable Me segments',
            );
          }
        } catch (recoveryErr) {
          console.error(
            '[Pluto] Failed full-session transcript / Me recovery:',
            recoveryErr,
          );
        }
      } else {
        console.log(
          '[Pluto] Skipping full-session fallback; chunk transcript looks healthy',
        );
      }

      micChunkConversionFailuresRef.current = 0;
      disableMicChunkTranscriptionRef.current = false;
      micWebmInitSegmentRef.current = null;

      // Merge by timestamp
      const sortedSegments = [...timelineSegments].sort(
        (a, b) => a.startTime - b.startTime,
      );
      const crossChannelResolved =
        resolveCrossChannelDuplicates(sortedSegments);
      let crossChannelSegments =
        crossChannelResolved.segments as TranscriptionSegment[];
      if (TRANSCRIPT_DEBUG_ENABLED) {
        console.log(
          '[Pluto][TranscriptDebug] resolveCrossChannelDuplicates',
          crossChannelResolved.stats,
        );
      }
      if (crossChannelResolved.stats.resolvedPairs > 0) {
        console.log(
          `[Pluto] Cross-channel duplicate resolver: candidates=${crossChannelResolved.stats.candidatePairs}, ` +
            `resolved=${crossChannelResolved.stats.resolvedPairs}, ` +
            `droppedMe=${crossChannelResolved.stats.droppedMe}, droppedThem=${crossChannelResolved.stats.droppedThem}`,
        );
      }

      const nearDupResolved =
        resolveCrossChannelNearDuplicates(crossChannelSegments);
      crossChannelSegments = nearDupResolved.segments as TranscriptionSegment[];
      if (TRANSCRIPT_DEBUG_ENABLED) {
        console.log(
          '[Pluto][TranscriptDebug] resolveCrossChannelNearDuplicates',
          nearDupResolved.stats,
        );
      }
      if (nearDupResolved.stats.resolvedPairs > 0) {
        console.log(
          `[Pluto] Cross-channel near-duplicate merge: candidates=${nearDupResolved.stats.candidatePairs}, ` +
            `resolved=${nearDupResolved.stats.resolvedPairs}, ` +
            `droppedMe=${nearDupResolved.stats.droppedMe}, droppedThem=${nearDupResolved.stats.droppedThem}`,
        );
      }

      if (TRANSCRIPT_DEBUG_ENABLED) {
        const meSegs = crossChannelSegments.filter((s) => s.speaker === 'Me');
        const themSegs = crossChannelSegments.filter(
          (s) => s.speaker === 'Them',
        );
        const candidates: Array<{
          score: number;
          overlap: number;
          overlapRatioMin: number;
          tokenSim: number;
          me: TranscriptionSegment;
          them: TranscriptionSegment;
        }> = [];

        for (const me of meSegs) {
          for (const them of themSegs) {
            const ov = overlapSeconds(me, them);
            if (ov <= 0) continue;
            const minDur = Math.max(
              0.01,
              Math.min(
                me.endTime - me.startTime,
                them.endTime - them.startTime,
              ),
            );
            const overlapRatioMin = ov / minDur;
            if (overlapRatioMin < 0.2) continue;
            const tokenSim = tokenSimilarity(me.text, them.text);
            const score = overlapRatioMin + tokenSim * 0.8;
            candidates.push({
              score,
              overlap: ov,
              overlapRatioMin,
              tokenSim,
              me,
              them,
            });
          }
        }

        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 5);
        console.log(
          '[Pluto][TranscriptDebug] topLikelyMeBleed BEFORE dedupe/trim',
          top.map((c) => ({
            me: `${c.me.startTime.toFixed(1)}-${c.me.endTime.toFixed(1)}`,
            them: `${c.them.startTime.toFixed(1)}-${c.them.endTime.toFixed(1)}`,
            overlap: Number(c.overlap.toFixed(2)),
            overlapRatioMin: Number(c.overlapRatioMin.toFixed(2)),
            tokenSim: Number(c.tokenSim.toFixed(2)),
            mePrefix: c.me.text.slice(0, 40),
          })),
        );
      }

      const dedupedThemSegments = filterDuplicateSpeakerSegments(
        crossChannelSegments,
        'Them',
      );
      if (TRANSCRIPT_DEBUG_ENABLED) {
        const themBefore = crossChannelSegments.filter(
          (s) => s.speaker === 'Them',
        ).length;
        const themAfter = dedupedThemSegments.filter(
          (s) => s.speaker === 'Them',
        ).length;
        console.log('[Pluto][TranscriptDebug] dedupe Them', {
          themBefore,
          themAfter,
          dropped: themBefore - themAfter,
        });
      }
      const dedupedSegments = filterDuplicateSpeakerSegments(
        dedupedThemSegments,
        'Me',
      );
      if (TRANSCRIPT_DEBUG_ENABLED) {
        const meBefore = dedupedThemSegments.filter(
          (s) => s.speaker === 'Me',
        ).length;
        const meAfter = dedupedSegments.filter(
          (s) => s.speaker === 'Me',
        ).length;
        console.log('[Pluto][TranscriptDebug] dedupe Me', {
          meBefore,
          meAfter,
          dropped: meBefore - meAfter,
        });
      }
      const echoTrimmedSegments = trimAdjacentCrossSpeakerEcho(dedupedSegments);
      const shortEchoPruned = dropShortCrossSpeakerEchoes({
        segments: echoTrimmedSegments as TranscriptionSegment[],
      });
      if (TRANSCRIPT_DEBUG_ENABLED) {
        const beforeTrim = dedupedSegments.length;
        const afterTrim = echoTrimmedSegments.length;
        console.log('[Pluto][TranscriptDebug] trimAdjacentCrossSpeakerEcho', {
          before: beforeTrim,
          after: afterTrim,
          dropped: beforeTrim - afterTrim,
        });
        console.log('[Pluto][TranscriptDebug] dropShortCrossSpeakerEchoes', {
          dropped: shortEchoPruned.dropped,
          after: shortEchoPruned.segments.length,
        });
      }
      if (shortEchoPruned.dropped > 0) {
        console.log(
          `[Pluto] Dropped ${shortEchoPruned.dropped} short cross-speaker echo segments`,
        );
      }
      let finalizedSegments =
        shortEchoPruned.segments as TranscriptionSegment[];
      const preCleanupChannelSegments = [
        ...crossChannelSegments,
      ] as TranscriptionSegment[];
      const rawSpeakerCounts = crossChannelSegments.reduce(
        (acc, segment) => {
          if (segment.speaker === 'Me') acc.me++;
          if (segment.speaker === 'Them') acc.them++;
          return acc;
        },
        { me: 0, them: 0 },
      );
      console.log(
        `[Pluto] Raw speaker segment counts: Me=${rawSpeakerCounts.me}, Them=${rawSpeakerCounts.them}`,
      );
      const passThroughCheck =
        detectProbableAudioPassThrough(crossChannelSegments);
      if (passThroughCheck.probable) {
        console.warn(
          `[Pluto] Probable audio pass-through detected (overlapPairs=${passThroughCheck.overlapPairs}, similarPairs=${passThroughCheck.similarPairs}, meSegments=${passThroughCheck.meCount}, themSegments=${passThroughCheck.themCount}).`,
        );
        console.warn(
          '[Pluto] Routing guidance: disable pass-through/mixers, ensure call app + OS default devices match, and prefer a headset.',
        );
      }
      const shouldRunMeBleedCleanup =
        passThroughCheck.probable ||
        (crossChannelResolved.stats.candidatePairs >= 2 &&
          crossChannelResolved.stats.droppedThem > 0);
      if (shouldRunMeBleedCleanup) {
        const activityWindowsForCleanup = [...speakerTimelineRef.current];
        const activeWindow = activeSpeakerWindowRef.current;
        if (activeWindow) {
          activityWindowsForCleanup.push({
            startTime: activeWindow.startTime,
            endTime: getMeetingElapsedSeconds(),
            speaker: activeWindow.speaker,
          });
        }
        const meBleedStripped = stripLikelyMeBleedSegments(
          finalizedSegments,
          activityWindowsForCleanup,
        );

        if (TRANSCRIPT_DEBUG_ENABLED) {
          const meSegs = meBleedStripped.segments.filter(
            (s) => s.speaker === 'Me',
          );
          const themSegs = meBleedStripped.segments.filter(
            (s) => s.speaker === 'Them',
          );
          let bleedPairs = 0;
          for (const me of meSegs) {
            for (const them of themSegs) {
              if (overlapSeconds(me, them) > 0.5) bleedPairs++;
            }
          }
          console.log(
            '[Pluto][TranscriptDebug] after stripLikelyMeBleedSegments',
            {
              droppedMe: meBleedStripped.droppedMe,
              meSegs: meSegs.length,
              themSegs: themSegs.length,
              bleedPairsHalfSec: bleedPairs,
            },
          );
        }
        if (meBleedStripped.droppedMe > 0) {
          finalizedSegments =
            meBleedStripped.segments as TranscriptionSegment[];
          console.warn(
            `[Pluto] Me-bleed cleanup removed segments: droppedMe=${meBleedStripped.droppedMe}, ` +
              `reason=${passThroughCheck.probable ? 'pass-through' : 'duplicate-pressure'}`,
          );
        }
      }
      if (fullSessionValidationTexts.length > 0) {
        const beforeValidation = finalizedSegments.length;
        finalizedSegments = finalizedSegments.filter(
          (segment) =>
            !shouldDropUnvalidatedShortThemSegment(
              segment,
              fullSessionValidationTexts,
            ),
        );
        const droppedByValidation = beforeValidation - finalizedSegments.length;
        if (droppedByValidation > 0) {
          console.warn(
            `[Pluto] Dropped ${droppedByValidation} short Them segments not supported by full-session transcript`,
          );
        }
      }
      if (rawSpeakerCounts.me === 0 && rawSpeakerCounts.them > 0) {
        console.warn(
          '[Pluto] No transcribed mic segments detected. Check selected microphone/input routing.',
        );
      }

      const shouldHydrateFromSession =
        fullSessionCanonicalSegments.length > 0 &&
        preCleanupChannelSegments.length > 0;

      if (shouldHydrateFromSession) {
        const channelSplit = splitCanonicalSegmentsAtChannelBoundaries(
          fullSessionCanonicalSegments,
          preCleanupChannelSegments,
        );
        transcriptPipeline.channelBoundarySplits = channelSplit.splitsApplied;
        if (channelSplit.splitsApplied > 0) {
          console.log(
            `[Pluto] Session fallback channel-boundary splits: ${channelSplit.splitsApplied}`,
          );
        }

        const canonicalForAttribution = splitCanonicalSegmentsForAttribution(
          channelSplit.segments,
        );
        const canonicalAttribution = assignSpeakersToCanonicalSegments({
          canonicalSegments: canonicalForAttribution,
          attributedSegments: preCleanupChannelSegments,
        });
        if (canonicalAttribution.segments.length > 0) {
          finalizedSegments =
            canonicalAttribution.segments as TranscriptionSegment[];
          console.log(
            `[Pluto] Session fallback transcript: segments=${canonicalAttribution.segments.length}, ` +
              `channelSplits=${channelSplit.splitsApplied}, ` +
              `byOverlap=${canonicalAttribution.stats.byOverlap}, ` +
              `fallback=${canonicalAttribution.stats.byFallback}`,
          );
        } else {
          finalizedSegments = fullSessionCanonicalSegments;
          console.warn(
            '[Pluto] Session fallback attribution returned no segments; using session transcript without channel attribution',
          );
        }
      } else if (fullSessionCanonicalSegments.length > 0) {
        finalizedSegments = fullSessionCanonicalSegments;
        console.log(
          '[Pluto] Session fallback: no channel segments, using session transcript directly',
        );
      }

      const diarizationAudioPath =
        mixedAudioPath || systemAudioPath || primaryAudioPath;
      let speakerAttribution: StoredTranscriptSpeakerAttribution =
        buildTranscriptSpeakerAttribution({
          diarizationEnabled,
          diarizationAttempted: false,
          fallbackReason: diarizationEnabled
            ? diarizationAudioPath
              ? 'unknown_diarization_fallback'
              : 'missing_diarization_audio'
            : 'diarization_disabled',
        });
      let diarizationCapabilityReady = true;
      if (
        diarizationEnabled &&
        diarizationAudioPath &&
        resolveProductionDiarizationProvider() === 'sherpa_local'
      ) {
        try {
          const readiness = await window.ipcRenderer.invoke(
            'WHISPER_DIARIZATION_MODEL_STATUS',
          );
          diarizationCapabilityReady = readiness?.ready === true;
        } catch {
          diarizationCapabilityReady = false;
        }
        if (!diarizationCapabilityReady) {
          speakerAttribution = buildTranscriptSpeakerAttribution({
            diarizationEnabled: true,
            diarizationAttempted: false,
            fallbackReason: 'diarization_models_unavailable',
          });
        }
      }
      if (
        diarizationEnabled &&
        diarizationAudioPath &&
        diarizationCapabilityReady
      ) {
        let acousticEvidenceWindows: ReturnType<
          typeof deriveAttributionEvidence
        > = [];
        if (primaryAudioPath && (rebuiltSystemAudioPath || systemAudioPath)) {
          try {
            const energyResult = await window.ipcRenderer.invoke(
              'WHISPER_ALIGNED_ENERGY',
              primaryAudioPath,
              rebuiltSystemAudioPath || systemAudioPath,
            );
            acousticEvidenceWindows = deriveAttributionEvidence(
              Array.isArray(energyResult?.windows) ? energyResult.windows : [],
            );
          } catch (error) {
            console.warn('[Pluto] Acoustic evidence unavailable:', error);
          }
        }

        const runDiarizationRefinementAttempt = async ({
          attemptLabel,
          segments,
          transcriptionOverrides,
        }: {
          attemptLabel: string;
          segments: TranscriptionSegment[];
          transcriptionOverrides?: Partial<Required<TranscriptionSettings>>;
        }): Promise<{
          segments: TranscriptionSegment[];
          mappingConfident: boolean;
          mappingReason: string | null;
          mappingConfidence: number;
          splitsApplied: number;
          relabeled: number;
          injectedLocalWindows: number;
          falseMeEvidenceSeconds: number;
          missedMeEvidenceSeconds: number;
          runtime?: {
            engineVersion: string;
            modelChecksums: string[];
          };
        }> => {
          const diarizationOptions = transcriptionOverrides
            ? {
                backend: transcriptionOverrides.backend,
                preset: transcriptionOverrides.preset,
                model: transcriptionOverrides.model,
                device: transcriptionOverrides.device,
                computeType: transcriptionOverrides.computeType,
              }
            : {};
          const diarizationResult = await window.ipcRenderer.invoke(
            'WHISPER_TRANSCRIBE',
            diarizationAudioPath,
            buildTranscriptionOptions({
              ...diarizationOptions,
              diarize: true,
              diarizationProvider: resolveProductionDiarizationProvider(),
              meetingId: currentMeetingIdRef.current,
            }),
          );
          const diarizationSegments = Array.isArray(diarizationResult?.segments)
            ? diarizationResult.segments
                .filter(
                  (segment: { speaker?: string }) =>
                    typeof segment.speaker === 'string' &&
                    segment.speaker.length > 0,
                )
                .map(
                  (segment: {
                    start: number;
                    end: number;
                    text?: string;
                    speaker: string;
                  }) => ({
                    startTime: segment.start,
                    endTime: segment.end,
                    text: segment.text || '',
                    speaker: segment.speaker,
                  }),
                )
            : [];

          if (diarizationSegments.length === 0) {
            console.log(
              `[Pluto] ${attemptLabel} diarization refinement skipped: no diarization segments`,
            );
            return {
              segments,
              mappingConfident: false,
              mappingReason: 'no diarization segments',
              mappingConfidence: 0,
              splitsApplied: 0,
              relabeled: 0,
              injectedLocalWindows: 0,
              falseMeEvidenceSeconds: 0,
              missedMeEvidenceSeconds: 0,
            };
          }

          const acousticMapping = mapDiarizationFromAcousticEvidence({
            turns: diarizationSegments.map(
              (segment: {
                startTime: number;
                endTime: number;
                speaker: string;
              }) => ({
                startTime: segment.startTime,
                endTime: segment.endTime,
                cluster: String(segment.speaker),
              }),
            ),
            evidenceWindows: acousticEvidenceWindows,
          });
          const mapping = Object.fromEntries(
            Object.entries(acousticMapping.mapping).filter(
              (entry): entry is [string, 'Me' | 'Them'] =>
                entry[1] === 'Me' || entry[1] === 'Them',
            ),
          );
          const mappingConfident = !Object.values(
            acousticMapping.mapping,
          ).includes('Unknown');
          if (!mappingConfident || Object.keys(mapping).length === 0) {
            console.log(
              `[Pluto] ${attemptLabel} acoustic mapping skipped: ${acousticMapping.fallbackReason || 'insufficient confidence'}`,
            );
            return {
              segments,
              mappingConfident: false,
              mappingReason:
                acousticMapping.fallbackReason || 'insufficient confidence',
              mappingConfidence: acousticMapping.confidence,
              splitsApplied: 0,
              relabeled: 0,
              injectedLocalWindows: 0,
              falseMeEvidenceSeconds: acousticMapping.falseMeEvidenceSeconds,
              missedMeEvidenceSeconds: acousticMapping.missedMeEvidenceSeconds,
              runtime: diarizationResult?.meta?.diarizationRuntime,
            };
          }

          let updatedSegments = segments;
          const diarBoundary = splitSegmentsAtDiarizationBoundaries(
            updatedSegments,
            diarizationSegments,
            mapping,
          );
          if (diarBoundary.splitsApplied > 0) {
            updatedSegments = diarBoundary.segments as TranscriptionSegment[];
            console.log(
              `[Pluto] ${attemptLabel} diarization boundary split: applied=${diarBoundary.splitsApplied}, segments=${updatedSegments.length}`,
            );
          }

          const applied = applyDiarizationRefinement({
            segments: updatedSegments,
            diarizationSegments,
            mapping,
          });
          updatedSegments = applied.segments as TranscriptionSegment[];
          const meBeforeInjection = updatedSegments.filter(
            (segment) => segment.speaker === 'Me',
          ).length;
          updatedSegments = injectLocalEvidenceWindows(
            updatedSegments,
            acousticMapping.injectedLocalWindows,
          ) as TranscriptionSegment[];
          const appliedLocalWindows = Math.max(
            0,
            updatedSegments.filter((segment) => segment.speaker === 'Me')
              .length - meBeforeInjection,
          );
          if (applied.relabeled > 0) {
            console.log(
              `[Pluto] ${attemptLabel} acoustic diarization refinement applied: relabeled=${applied.relabeled}, injected=${appliedLocalWindows}, confidence=${acousticMapping.confidence.toFixed(2)}`,
            );
          } else {
            console.log(
              `[Pluto] ${attemptLabel} acoustic diarization refinement kept existing labels: confidence=${acousticMapping.confidence.toFixed(2)}`,
            );
          }

          return {
            segments: updatedSegments,
            mappingConfident: true,
            mappingReason: null,
            mappingConfidence: acousticMapping.confidence,
            splitsApplied: diarBoundary.splitsApplied,
            relabeled: applied.relabeled,
            injectedLocalWindows: appliedLocalWindows,
            falseMeEvidenceSeconds: acousticMapping.falseMeEvidenceSeconds,
            missedMeEvidenceSeconds: acousticMapping.missedMeEvidenceSeconds,
            runtime: diarizationResult?.meta?.diarizationRuntime,
          };
        };

        try {
          const initialDiarizationAttempt =
            await runDiarizationRefinementAttempt({
              attemptLabel: 'Initial',
              segments: finalizedSegments,
            });
          finalizedSegments = initialDiarizationAttempt.segments;
          speakerAttribution = buildTranscriptSpeakerAttribution({
            diarizationEnabled: true,
            diarizationAttempted: true,
            mappingApplied: initialDiarizationAttempt.mappingConfident,
            confidence: initialDiarizationAttempt.mappingConfidence,
            fallbackReason:
              initialDiarizationAttempt.mappingReason ?? undefined,
            acousticEvidenceAttempted: acousticEvidenceWindows.length > 0,
            engineVersion: initialDiarizationAttempt.runtime?.engineVersion,
            modelChecksums: initialDiarizationAttempt.runtime?.modelChecksums,
            injectedLocalWindows:
              initialDiarizationAttempt.injectedLocalWindows,
            falseMeEvidenceSeconds:
              initialDiarizationAttempt.falseMeEvidenceSeconds,
            missedMeEvidenceSeconds:
              initialDiarizationAttempt.missedMeEvidenceSeconds,
          });
          transcriptPipeline.diarizationBoundarySplits =
            initialDiarizationAttempt.splitsApplied;

          const speakerAttributionRetryPlan = buildSpeakerAttributionRetryPlan({
            diarizationEnabled,
            mappingConfident: initialDiarizationAttempt.mappingConfident,
            retryAlreadyUsed: false,
            providerHasStrongerPolicy: false,
            settings: resolvedTranscriptionSettings,
          });
          transcriptPipeline.speakerAttributionRetryPlan =
            speakerAttributionRetryPlan.reason;

          if (
            speakerAttributionRetryPlan.shouldRetry &&
            speakerAttributionRetryPlan.strongerOptions
          ) {
            const { backend, preset, model, device, computeType } =
              speakerAttributionRetryPlan.strongerOptions;
            console.log(
              `[Pluto] Retrying speaker attribution with stronger policy: ${backend}/${preset}/${model}/${computeType}`,
            );
            const retryDiarizationAttempt =
              await runDiarizationRefinementAttempt({
                attemptLabel: 'Retry',
                segments: finalizedSegments,
                transcriptionOverrides: {
                  backend,
                  preset,
                  model,
                  device,
                  computeType,
                  language: resolvedTranscriptionSettings.language,
                },
              });

            speakerAttribution = buildTranscriptSpeakerAttribution({
              diarizationEnabled: true,
              diarizationAttempted: true,
              mappingApplied: retryDiarizationAttempt.mappingConfident,
              confidence: retryDiarizationAttempt.mappingConfidence,
              fallbackReason:
                retryDiarizationAttempt.mappingReason ?? undefined,
              acousticEvidenceAttempted: acousticEvidenceWindows.length > 0,
              engineVersion: retryDiarizationAttempt.runtime?.engineVersion,
              modelChecksums: retryDiarizationAttempt.runtime?.modelChecksums,
              injectedLocalWindows:
                retryDiarizationAttempt.injectedLocalWindows,
              falseMeEvidenceSeconds:
                retryDiarizationAttempt.falseMeEvidenceSeconds,
              missedMeEvidenceSeconds:
                retryDiarizationAttempt.missedMeEvidenceSeconds,
            });

            transcriptPipeline.speakerAttributionRetryUsed = 1;
            transcriptPipeline.speakerAttributionRetryOutcome =
              retryDiarizationAttempt.mappingConfident
                ? 'mapping-confident'
                : (retryDiarizationAttempt.mappingReason ??
                  'insufficient-confidence');

            if (retryDiarizationAttempt.mappingConfident) {
              finalizedSegments = retryDiarizationAttempt.segments;
              transcriptPipeline.diarizationBoundarySplits = Math.max(
                Number(transcriptPipeline.diarizationBoundarySplits || 0),
                retryDiarizationAttempt.splitsApplied,
              );
            }
          } else {
            transcriptPipeline.speakerAttributionRetryUsed = 0;
            transcriptPipeline.speakerAttributionRetryOutcome =
              initialDiarizationAttempt.mappingConfident
                ? 'mapping-confident'
                : (initialDiarizationAttempt.mappingReason ??
                  'insufficient-confidence');
          }
        } catch (e) {
          speakerAttribution = buildTranscriptSpeakerAttribution({
            diarizationEnabled: true,
            diarizationAttempted: true,
            fallbackReason: 'diarization_error',
          });
          console.warn('[Pluto] Diarization refinement failed:', e);
        }
      }

      finalizedSegments = applyCrossTurnAttributionRepairs(
        finalizedSegments,
      ) as TranscriptionSegment[];

      const hasBothSpeakersForPostBleed =
        finalizedSegments.some((s) => s.speaker === 'Me') &&
        finalizedSegments.some((s) => s.speaker === 'Them');
      if (hasBothSpeakersForPostBleed) {
        postHydrationBleedPass = true;
        const activityWindowsPost = [...speakerTimelineRef.current];
        const activeWindowPost = activeSpeakerWindowRef.current;
        if (activeWindowPost) {
          activityWindowsPost.push({
            startTime: activeWindowPost.startTime,
            endTime: getMeetingElapsedSeconds(),
            speaker: activeWindowPost.speaker,
          });
        }
        const postBleed = stripLikelyMeBleedSegments(
          finalizedSegments,
          activityWindowsPost,
        );
        postHydrationBleedDroppedMe = postBleed.droppedMe;
        if (postBleed.droppedMe > 0) {
          finalizedSegments = postBleed.segments as TranscriptionSegment[];
          console.warn(
            `[Pluto] Post-hydration Me-bleed cleanup: droppedMe=${postBleed.droppedMe}`,
          );
        }
      }

      const MERGE_SAME_SPEAKER_GAP_SECONDS = 1;
      const newTranscription = mergeConsecutiveSpeakerSegments(
        finalizedSegments,
        MERGE_SAME_SPEAKER_GAP_SECONDS,
      );
      const mergedSpeakerCounts = newTranscription.reduce(
        (acc, segment) => {
          if (segment.speaker === 'Me') acc.me++;
          if (segment.speaker === 'Them') acc.them++;
          return acc;
        },
        { me: 0, them: 0 },
      );
      const bleedLikelyForRescue =
        baselinePassThroughCheck.probable || passThroughCheck.probable;

      if (
        sessionFallbackDecision.shouldRun &&
        mergedSpeakerCounts.me === 0 &&
        fullSessionRecoveredMeSegments.length > 0 &&
        !bleedLikelyForRescue
      ) {
        console.warn(
          `[Pluto] Applying Me rescue merge from full-session mic transcript: recovered=${fullSessionRecoveredMeSegments.length}`,
        );

        const rescueSorted = [
          ...sortedSegments.filter((segment) => segment.speaker !== 'Me'),
          ...fullSessionRecoveredMeSegments,
        ].sort((a, b) => a.startTime - b.startTime);
        const rescueCrossChannelResolved =
          resolveCrossChannelDuplicates(rescueSorted);
        const rescueDedupedThem = filterDuplicateSpeakerSegments(
          rescueCrossChannelResolved.segments as TranscriptionSegment[],
          'Them',
        );
        const rescueDedupedSegments = filterDuplicateSpeakerSegments(
          rescueDedupedThem,
          'Me',
        );
        const rescueEchoTrimmedSegments = trimAdjacentCrossSpeakerEcho(
          rescueDedupedSegments,
        );
        const rescueShortEchoPruned = dropShortCrossSpeakerEchoes({
          segments: rescueEchoTrimmedSegments as TranscriptionSegment[],
        });
        const rescueFinalizedSegments =
          rescueShortEchoPruned.segments as TranscriptionSegment[];

        const rescuedTranscription = mergeConsecutiveSpeakerSegments(
          rescueFinalizedSegments,
          MERGE_SAME_SPEAKER_GAP_SECONDS,
        );
        newTranscription.length = 0;
        newTranscription.push(...rescuedTranscription);

        mergedSpeakerCounts.me = 0;
        mergedSpeakerCounts.them = 0;
        for (const segment of newTranscription) {
          if (segment.speaker === 'Me') mergedSpeakerCounts.me++;
          if (segment.speaker === 'Them') mergedSpeakerCounts.them++;
        }
      } else if (
        sessionFallbackDecision.shouldRun &&
        mergedSpeakerCounts.me === 0 &&
        fullSessionRecoveredMeSegments.length > 0 &&
        bleedLikelyForRescue
      ) {
        console.warn(
          `[Pluto] Skipping Me rescue merge because bleed risk remains high: recovered=${fullSessionRecoveredMeSegments.length}`,
        );
      }

      console.log(
        `[Pluto] Merged speaker segment counts: Me=${mergedSpeakerCounts.me}, Them=${mergedSpeakerCounts.them}`,
      );

      console.log(
        `[Pluto] Pipeline=${pipelineMode} merged: ${finalizedSegments.length} finalized segments → ${newTranscription.length} merged segments`,
      );

      if (TRANSCRIPT_PIPELINE_LOG) {
        console.log('[Pluto][TranscriptPipeline]', {
          pipelineMode,
          ...transcriptPipeline,
          mergedSegments: newTranscription.length,
          mergedMe: mergedSpeakerCounts.me,
          mergedThem: mergedSpeakerCounts.them,
        });
      }

      const meetingTiming = buildMeetingTiming(stopSnapshot);
      const checkpointEvidenceVerified =
        await hasCompleteCaptureJournalCheckpoints(stopSnapshot.meetingId);
      const foregroundValidationPlan = planForegroundTranscriptValidation({
        checkpointEvidenceVerified,
      });
      const integrityValidation = await sealedActivityHandoff.runValidation(
        async (activityWindows) =>
          await runRecordingTranscriptValidation({
            meetingId: stopSnapshot.meetingId,
            recordingDurationSeconds: meetingTiming.durationSeconds,
            micAudioPath: primaryAudioPath,
            mixAudioPath: mixedAudioPath,
            systemAudioPath,
            provisionalSegments: newTranscription,
            activityWindows,
            canonicalMode: foregroundValidationPlan.canonicalMode,
            checkpointEvidenceVerified:
              foregroundValidationPlan.checkpointEvidenceVerified,
            transcribe: async (audioPath, options) =>
              await window.ipcRenderer.invoke(
                'WHISPER_TRANSCRIBE',
                audioPath,
                buildTranscriptionOptions({
                  diarize: false,
                  meetingId: stopSnapshot.meetingId,
                  canonicalSource:
                    options.canonicalSource === 'mix' ? 'mix' : 'mic',
                }),
              ),
            probeDuration: async (audioPath) =>
              await window.ipcRenderer.invoke(
                'AUDIO_PROBE_DURATION',
                audioPath,
              ),
          }),
      );
      newTranscription.splice(
        0,
        newTranscription.length,
        ...(integrityValidation.segments as TranscriptionSegment[]),
      );

      if (integrityValidation.status === 'needs_attention') {
        const stopToValidatedLatency = markStopToValidatedLatencyUnavailable(
          stopToValidatedLatencyRef.current,
          'needs_attention',
        );
        const recoverableMeeting = {
          id: stopSnapshot.meetingId,
          title: userTitle || 'Meeting',
          meeting_type: 'Recording',
          started_at: meetingTiming.startedAtIso,
          ended_at: meetingTiming.endedAtIso,
          duration_seconds: meetingTiming.durationSeconds,
          audio_path: primaryAudioPath || null,
          system_audio_path: systemAudioPath || null,
          mixed_audio_path: mixedAudioPath || null,
          transcript_status: 'needs_attention',
          transcript_validated_at: null,
          transcript_json: JSON.stringify(
            buildTranscriptJsonPayload(newTranscription, {
              pipelineMode,
              canonicalSource: mixedAudioPath ? 'mix' : 'mic',
              postHydrationBleedPass: false,
              transcription: {
                backend: String(resolvedTranscriptionSettings.backend),
                preset: String(resolvedTranscriptionSettings.preset),
                model: String(resolvedChunkModel),
                device: String(resolvedTranscriptionSettings.device),
                computeType: String(resolvedChunkComputeType),
                diarization: false,
                elapsedMs: 0,
                vocabularyHintPolicyVersion:
                  transcriptionVocabularyRef.current.provenance.policyVersion,
                vocabularyHintCount:
                  transcriptionVocabularyRef.current.provenance.hintCount,
              },
              speakerAttribution,
              liveTranscriptResponsiveness:
                frozenLiveTranscriptResponsivenessRef.current ?? undefined,
              stopToValidatedLatency,
              lifecycleStatus: 'needs_attention',
              integrity: {
                ...integrityValidation.evidence,
                reasons: integrityValidation.reasons,
              },
            }),
          ),
          user_notes: userNotes,
          enhanced_notes: null,
          analysis_json: null,
          value_signals_json: null,
          participants,
          capture_journal_generation:
            captureJournalStateRef.current?.generation ?? null,
          folder_id: null,
          is_favorite: false,
          end_reason: endReason || 'manual',
          finalization_status: 'finalized',
          finalization_error_category: null,
        };
        await sealedActivityHandoff.persistMeeting(
          recoverableMeeting,
          {
            schemaVersion: 2,
            state: 'needs_attention',
            causes: integrityValidation.reasons.map((code) => ({ code })),
            evidenceProvenance: {
              kind: 'sealed_capture_activity_v2',
              digestSha256: sealedActivityEvidence.digestSha256,
            },
            activityEvidence: sealedActivityEvidence,
            evidence: integrityValidation.evidence,
          },
          async (meeting) =>
            await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
        );
        onSessionComplete?.(recoverableMeeting.id);
        return;
      }

      if (onTranscript && newTranscription.length > 0) {
        const fullText = newTranscription.map((s) => s.text).join(' ');
        onTranscript(fullText);
      }
      if (newTranscription.length === 0) {
        console.warn('[Pluto] No transcription segments from either source');
      }

      const downstreamRunId = crypto.randomUUID();
      const checkpointValidationRunId = crypto.randomUUID();
      const attributionPersistenceRecord = buildInitialValidatedMeetingPayload({
        meeting: {
          id: stopSnapshot.meetingId,
          title: userTitle || 'Meeting',
          meeting_type: 'Recording',
          started_at: meetingTiming.startedAtIso,
          ended_at: meetingTiming.endedAtIso,
          duration_seconds: meetingTiming.durationSeconds,
          audio_path: primaryAudioPath,
          system_audio_path: systemAudioPath,
          mixed_audio_path: mixedAudioPath,
          transcript_status: 'validated',
          transcript_validated_at: new Date().toISOString(),
          user_notes: userNotes,
          folder_id: null,
          is_favorite: false,
          end_reason: endReason || 'manual',
          downstream_processing_json: JSON.stringify({
            schemaVersion: 1,
            state: 'processing',
            transcriptValidatedAt: '',
            runId: downstreamRunId,
            stage: 'analysis',
          }),
          capture_journal_generation:
            captureJournalStateRef.current?.generation ?? null,
        },
        segments: newTranscription,
        transcriptMetadata: {
          pipelineMode,
          sessionFallbackUsed: sessionFallbackDecision.shouldRun,
          sessionFallbackReasons: sessionFallbackDecision.reasons,
          canonicalSource: sessionCanonicalSource,
          postHydrationBleedPass,
          postHydrationBleedDroppedMe,
          transcription: {
            backend: String(resolvedTranscriptionSettings.backend),
            preset: String(resolvedTranscriptionSettings.preset),
            model: String(resolvedChunkModel),
            device: String(resolvedTranscriptionSettings.device),
            computeType: String(resolvedChunkComputeType),
            diarization: false,
            elapsedMs: 0,
            vocabularyHintPolicyVersion:
              transcriptionVocabularyRef.current.provenance.policyVersion,
            vocabularyHintCount:
              transcriptionVocabularyRef.current.provenance.hintCount,
          },
          sessionFallbackTranscription: sessionTranscriptionMeta
            ? {
                backend: String(sessionTranscriptionMeta.backend),
                preset: String(sessionTranscriptionMeta.preset),
                model: String(sessionTranscriptionMeta.model),
                device: String(sessionTranscriptionMeta.device),
                computeType: String(sessionTranscriptionMeta.computeType),
                canonicalSource: sessionCanonicalSource,
                diarization: diarizationEnabled,
                elapsedMs: sessionTranscriptionMeta.elapsedMs || 0,
                providerLabel: sessionTranscriptionMeta.providerLabel,
                warnings: sessionTranscriptionMeta.warnings,
                vocabularyHintPolicyVersion:
                  sessionTranscriptionMeta.vocabularyHintPolicyVersion,
                vocabularyHintCount:
                  sessionTranscriptionMeta.vocabularyHintCount,
              }
            : undefined,
          speakerAttribution,
          liveTranscriptResponsiveness:
            frozenLiveTranscriptResponsivenessRef.current ?? undefined,
          lifecycleStatus: 'validated',
          integrity: {
            ...integrityValidation.evidence,
            reasons: integrityValidation.reasons,
          },
        },
        participants,
      });
      const transcriptValidatedAt = String(
        attributionPersistenceRecord.transcript_validated_at,
      );
      attributionPersistenceRecord.downstream_processing_json = JSON.stringify({
        schemaVersion: 1,
        state: 'processing',
        transcriptValidatedAt,
        runId: downstreamRunId,
        stage: 'analysis',
      });
      const attributionIntegrity = {
        schemaVersion: 2,
        state: 'validated',
        causes: [],
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: sealedActivityEvidence.digestSha256,
        },
        activityEvidence: sealedActivityEvidence,
        evidence: integrityValidation.evidence,
        validationProof: {
          gateVersion: 'canonical_integrity_v1',
          validatedAt: transcriptValidatedAt,
        },
      };
      const attributionIntegrityJson = JSON.stringify(attributionIntegrity);

      // 3. Generate Analysis V3 (canonical markdown + hidden signals)
      const fullTranscript = newTranscription
        .map((s) => `${s.speaker}: ${s.text}`)
        .join('\n');
      void fullTranscript;
      let enhancedNotes = '';
      let valueSignals = emptyValueSignals();
      let analysisDocument: AnalysisDocument | AnalysisDocumentV3 =
        emptyAnalysisDocument();

      let stopToValidatedLatency: StopToValidatedLatencySummary | null = null;
      let transcriptWithLatency = '';
      const { patchOutcome: metricPatchOutcome, downstream: rawArtifacts } =
        await persistTranscriptThenRunLatencyPatchAndDownstream({
          persistTranscript: async () => {
            if (
              checkpointEvidenceVerified &&
              attributionPersistenceRecord.capture_journal_generation
            ) {
              const checkpointValidationStartedAt = Date.now();
              const validatingIntegrity = beginRetryLease(
                attributionIntegrity,
                {
                  runId: checkpointValidationRunId,
                  startedAt: new Date(
                    checkpointValidationStartedAt,
                  ).toISOString(),
                  deadlineAt: new Date(
                    buildRetryDeadline(
                      checkpointValidationStartedAt,
                      meetingTiming.durationSeconds,
                    ),
                  ).toISOString(),
                  stage: 'saving',
                },
              );
              const inserted = await sealedActivityHandoff.persistMeeting(
                {
                  ...attributionPersistenceRecord,
                  transcript_status: 'validating',
                  transcript_validated_at: null,
                  transcript_json: withTranscriptLifecycleStatus(
                    attributionPersistenceRecord.transcript_json,
                    'validating',
                  ),
                  downstream_processing_json: null,
                },
                validatingIntegrity,
                async (meeting) =>
                  await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
              );
              if (inserted === false) return false;
              const outcome = await window.ipcRenderer.invoke(
                'FINALIZE_CHECKPOINT_TRANSCRIPT',
                {
                  meetingId: attributionPersistenceRecord.id,
                  journalGeneration:
                    attributionPersistenceRecord.capture_journal_generation,
                  expectedTranscriptStatus: 'validating',
                  expectedValidationRunId: checkpointValidationRunId,
                  canonicalTranscriptJson:
                    attributionPersistenceRecord.transcript_json,
                  transcriptIntegrityJson: attributionIntegrityJson,
                  transcriptValidatedAt:
                    attributionPersistenceRecord.transcript_validated_at,
                  downstreamRunId,
                },
              );
              return (
                outcome === 'committed_and_claimed' ||
                outcome === 'already_committed'
              );
            }
            return await sealedActivityHandoff.persistMeeting(
              attributionPersistenceRecord,
              attributionIntegrity,
              async (meeting) =>
                await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
            );
          },
          patchLatency: async () => {
            stopToValidatedLatency =
              stopToValidatedLatencyRef.current.completeValidatedSave(
                performance.now(),
              ).summary as StopToValidatedLatencySummary;
            transcriptWithLatency = JSON.stringify({
              ...(JSON.parse(
                attributionPersistenceRecord.transcript_json,
              ) as Record<string, unknown>),
              stopToValidatedLatency,
            });
            return await window.ipcRenderer.invoke(
              'PATCH_STOP_TO_VALIDATED_LATENCY',
              {
                meetingId: attributionPersistenceRecord.id,
                expectedTranscriptJson:
                  attributionPersistenceRecord.transcript_json,
                expectedTranscriptIntegrityJson: attributionIntegrityJson,
                expectedTranscriptValidatedAt:
                  attributionPersistenceRecord.transcript_validated_at,
                replacementTranscriptJson: transcriptWithLatency,
              },
            );
          },
          runDownstream: (async () =>
            null) as () => Promise<AnalysisArtifacts | null>,
        });
      if (!stopToValidatedLatency) {
        throw new Error('Validated latency summary was not finalized');
      }

      // The durable post-meeting coordinator owns every intelligence stage.
      // Recording finalization ends after canonical transcript persistence so
      // navigation, restart, and manual retry all use the same worker.
      onSessionComplete?.(attributionPersistenceRecord.id);
      return;

      // biome-ignore lint/correctness/noUnreachable: retained temporarily while the single-worker migration removes the legacy inline intelligence block
      if (rawArtifacts) {
        analysisDocument = normalizeAnalysisDocument(rawArtifacts?.analysis);
        valueSignals = normalizeValueSignals(rawArtifacts?.signals);
        enhancedNotes = analysisDocumentToMarkdown(analysisDocument);

        console.log(
          '[Pluto] V3 analysis generated:',
          `formatPass=${analysisDocument.quality.format_pass},`,
          `retryCount=${analysisDocument.quality.retry_count},`,
          `fallback=${analysisDocument.quality.fallback_used},`,
          `continuity=${valueSignals.continuity.length},`,
          `accountability=${valueSignals.accountability_risks.length},`,
          `decisionImpact=${valueSignals.decision_impacts.length}`,
        );
      } else {
        analysisDocument = emptyAnalysisDocument();
        enhancedNotes = analysisDocumentToMarkdown(analysisDocument);
        valueSignals = emptyValueSignals();
      }

      // Relabel transcript segments with actual speaker names
      const labeledTranscription = newTranscription;

      // 4. Save to DB

      // Generate intelligent title
      let title = userTitle || 'Meeting';
      if (!userTitle) {
        try {
          const fullTranscript = labeledTranscription
            .map((s) => `${s.speaker}: ${s.text}`)
            .join('\n');
          title = await window.ipcRenderer.invoke('GENERATE_TITLE', {
            transcript: fullTranscript,
          });
          console.log(`[Pluto] Generated title: ${title}`);
        } catch (titleErr) {
          console.error(
            '[Pluto] Title generation failed, using fallback:',
            titleErr,
          );
          title = extractTitle(labeledTranscription);
        }
      }

      const chunkTranscriptMeta = {
        backend: String(resolvedTranscriptionSettings.backend),
        preset: String(resolvedTranscriptionSettings.preset),
        model: String(resolvedChunkModel),
        device: String(resolvedTranscriptionSettings.device),
        computeType: String(resolvedChunkComputeType),
        diarization: false,
        elapsedMs: 0,
        vocabularyHintPolicyVersion:
          transcriptionVocabularyRef.current.provenance.policyVersion,
        vocabularyHintCount:
          transcriptionVocabularyRef.current.provenance.hintCount,
      };
      const sessionFallbackTranscriptMeta = sessionTranscriptionMeta
        ? {
            backend: String(sessionTranscriptionMeta.backend),
            preset: String(sessionTranscriptionMeta.preset),
            model: String(sessionTranscriptionMeta.model),
            device: String(sessionTranscriptionMeta.device),
            computeType: String(sessionTranscriptionMeta.computeType),
            canonicalSource: sessionCanonicalSource,
            diarization: diarizationEnabled,
            elapsedMs: sessionTranscriptionMeta.elapsedMs || 0,
            providerLabel: sessionTranscriptionMeta.providerLabel,
            warnings: sessionTranscriptionMeta.warnings,
            vocabularyHintPolicyVersion:
              sessionTranscriptionMeta.vocabularyHintPolicyVersion,
            vocabularyHintCount: sessionTranscriptionMeta.vocabularyHintCount,
          }
        : undefined;
      const transcriptMeta = {
        backend: String(chunkTranscriptMeta.backend),
        preset: String(chunkTranscriptMeta.preset),
        model: String(chunkTranscriptMeta.model),
        device: String(chunkTranscriptMeta.device),
        computeType: String(chunkTranscriptMeta.computeType),
        diarization: chunkTranscriptMeta.diarization,
        elapsedMs: chunkTranscriptMeta.elapsedMs,
        vocabularyHintPolicyVersion:
          chunkTranscriptMeta.vocabularyHintPolicyVersion,
        vocabularyHintCount: chunkTranscriptMeta.vocabularyHintCount,
      };

      const currentMeetingId = currentMeetingIdRef.current;
      if (!currentMeetingId) {
        throw new Error('No active meeting ID while finalizing recording');
      }
      const analysisGenerationMetadata = (
        analysisDocument as AnalysisDocumentV3
      ).generation_metadata;
      const meetingData = {
        id: currentMeetingId,
        title: title,
        meeting_type: 'Recording',
        started_at: meetingTiming.startedAtIso,
        ended_at: meetingTiming.endedAtIso,
        duration_seconds: meetingTiming.durationSeconds,
        audio_path: primaryAudioPath,
        system_audio_path: systemAudioPath,
        mixed_audio_path: mixedAudioPath,
        transcript_status: integrityValidation.status,
        transcript_validated_at:
          integrityValidation.status === 'validated'
            ? new Date().toISOString()
            : null,
        transcript_json: JSON.stringify(
          buildTranscriptJsonPayload(labeledTranscription, {
            pipelineMode,
            sessionFallbackUsed: sessionFallbackDecision.shouldRun,
            sessionFallbackReasons: sessionFallbackDecision.reasons,
            canonicalSource: sessionCanonicalSource,
            postHydrationBleedPass,
            postHydrationBleedDroppedMe,
            transcription: transcriptMeta,
            sessionFallbackTranscription: sessionFallbackTranscriptMeta,
            speakerAttribution,
            liveTranscriptResponsiveness:
              frozenLiveTranscriptResponsivenessRef.current ?? undefined,
            stopToValidatedLatency,
            lifecycleStatus: integrityValidation.status,
            integrity: {
              ...integrityValidation.evidence,
              reasons: integrityValidation.reasons,
            },
          }),
        ),
        user_notes: userNotes,
        enhanced_notes: enhancedNotes,
        analysis_json: JSON.stringify(analysisDocument),
        analysis_schema_version: analysisDocument.analysis_schema_version,
        analysis_format_pass: analysisDocument.quality.format_pass,
        analysis_retry_count: analysisDocument.quality.retry_count,
        analysis_fallback_used: analysisDocument.quality.fallback_used,
        analysis_provider: analysisGenerationMetadata?.provider ?? null,
        analysis_model: analysisGenerationMetadata?.model ?? null,
        analysis_generation_path:
          analysisGenerationMetadata?.generation_path ?? null,
        analysis_prompt_version:
          analysisGenerationMetadata?.prompt_version ?? null,
        analysis_generated_at: analysisGenerationMetadata?.generated_at ?? null,
        analysis_error_categories_json: analysisGenerationMetadata
          ? JSON.stringify(analysisGenerationMetadata.error_categories)
          : null,
        value_signals_json: JSON.stringify(valueSignals),
        participants: participants,
        folder_id: null,
        is_favorite: false,
        end_reason: endReason || 'manual',
        finalization_status: 'finalized',
        finalization_error_category: null,
        downstream_processing_json: JSON.stringify(
          rawArtifacts
            ? {
                schemaVersion: 1,
                state: 'complete',
                transcriptValidatedAt,
              }
            : {
                schemaVersion: 1,
                state: 'failed',
                transcriptValidatedAt,
                stage: 'analysis',
                failure: 'generation_failed',
              },
        ),
      };

      const derivedPersistence = await persistDerivedAfterLatencyPatch<unknown>(
        {
          patchOutcome: metricPatchOutcome,
          persistDerived: async () =>
            await window.ipcRenderer.invoke(
              'SAVE_DERIVED_MEETING_FIELDS_IF_TRANSCRIPT_CURRENT',
              {
                meetingId: meetingData.id,
                expectedTranscriptJson: transcriptWithLatency,
                expectedTranscriptIntegrityJson: attributionIntegrityJson,
                expectedTranscriptValidatedAt:
                  attributionPersistenceRecord.transcript_validated_at,
                expectedTitle: attributionPersistenceRecord.title,
                title: meetingData.title,
                enhancedNotes: meetingData.enhanced_notes,
                analysisJson: meetingData.analysis_json,
                analysisSchemaVersion: meetingData.analysis_schema_version,
                analysisFormatPass: meetingData.analysis_format_pass,
                analysisRetryCount: meetingData.analysis_retry_count,
                analysisFallbackUsed: meetingData.analysis_fallback_used,
                analysisProvider: meetingData.analysis_provider,
                analysisModel: meetingData.analysis_model,
                analysisGenerationPath: meetingData.analysis_generation_path,
                analysisPromptVersion: meetingData.analysis_prompt_version,
                analysisGeneratedAt: meetingData.analysis_generated_at,
                analysisErrorCategoriesJson:
                  meetingData.analysis_error_categories_json,
                valueSignalsJson: meetingData.value_signals_json,
                downstreamProcessingJson:
                  meetingData.downstream_processing_json,
              },
            ),
        },
      );
      if (derivedPersistence.outcome === 'suppressed') {
        console.warn(
          `[Pluto] Latency reconciliation ${String(metricPatchOutcome)}; suppressing derived persistence`,
        );
        onSessionComplete?.(meetingData.id);
        return;
      }
      if (derivedPersistence.outcome === 'failed') {
        console.warn(
          '[Pluto] Derived persistence failed; preserving current transcript generation',
        );
        onSessionComplete?.(meetingData.id);
        return;
      }
      if (derivedPersistence.result !== 'updated') {
        console.warn(
          `[Pluto] Derived persistence ${String(derivedPersistence.result)}; preserving current transcript generation`,
        );
        onSessionComplete?.(meetingData.id);
        return;
      }
      console.log(
        '[Pluto] Session saved to DB with transcript segments:',
        labeledTranscription.length,
        'summary length:',
        enhancedNotes.length,
      );

      const cleanupPaths = resolveFinalizationCleanupPaths({
        primaryAudioPath,
        systemAudioPath,
        rebuiltSystemAudioPath,
        mixedAudioPath,
        validationStatus: integrityValidation.status,
      });
      if (cleanupPaths.length > 0) {
        try {
          await window.ipcRenderer.invoke('AUDIO_DELETE_FILES', cleanupPaths);
        } catch (cleanupErr) {
          console.warn(
            '[Pluto] Failed to clean superseded recording artifacts:',
            cleanupErr,
          );
        }
      }

      // 5. Extract & Process Entities for Knowledge Graph (Sprint 2)
      void (async () => {
        const runExtraction = async () => {
          try {
            console.log('[Pluto] Extracting entities for Knowledge Graph...');
            window.dispatchEvent(
              new CustomEvent('MEETING_ENTITIES_PROCESSING', {
                detail: { meetingId: meetingData.id, processing: true },
              }),
            );
            const fullTranscriptText = labeledTranscription
              .map((s) => `${s.speaker}: ${s.text}`)
              .join('\n');
            const entityResult = await window.ipcRenderer.invoke(
              'EXTRACT_AND_PROCESS_ENTITIES',
              {
                transcript: fullTranscriptText,
                meetingId: String(meetingData.id),
                summary: enhancedNotes,
                valueSignals,
              },
            );
            console.log(
              `[Pluto] Entity extraction complete: ${entityResult.created} created, ${entityResult.linked} linked`,
            );
            window.dispatchEvent(
              new CustomEvent('MEETING_ENTITIES_UPDATED', {
                detail: { meetingId: meetingData.id },
              }),
            );
          } catch (entityErr) {
            console.error(
              '[Pluto] Knowledge Graph processing failed:',
              entityErr,
            );
            // Non-blocking error
          } finally {
            window.dispatchEvent(
              new CustomEvent('MEETING_ENTITIES_PROCESSING', {
                detail: { meetingId: meetingData.id, processing: false },
              }),
            );
          }
        };

        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(
            () => {
              void runExtraction();
            },
            { timeout: 2000 },
          );
        } else {
          setTimeout(() => {
            void runExtraction();
          }, 300);
        }
      })();

      if (onSessionComplete) {
        onSessionComplete(meetingData.id);
      }
    } catch (e) {
      console.error('[Pluto] Processing failed:', e);
      if (
        currentMeetingIdRef.current &&
        (primaryAudioPath || systemAudioPath || mixedAudioPath)
      ) {
        try {
          const meetingTiming = buildMeetingTiming(stopSnapshot);
          const stopToValidatedLatency = markStopToValidatedLatencyUnavailable(
            stopToValidatedLatencyRef.current,
            'validated_save_failed',
          );
          await window.ipcRenderer.invoke('SAVE_MEETING', {
            id: currentMeetingIdRef.current,
            title: userTitle || 'Meeting',
            meeting_type: 'Recording',
            started_at: meetingTiming.startedAtIso,
            ended_at: meetingTiming.endedAtIso,
            duration_seconds: meetingTiming.durationSeconds,
            audio_path: primaryAudioPath || null,
            system_audio_path:
              rebuiltSystemAudioPath || systemAudioPath || null,
            mixed_audio_path: mixedAudioPath || null,
            transcript_status: 'needs_attention',
            transcript_integrity_json: JSON.stringify({
              schemaVersion: 2,
              state: 'needs_attention',
              causes: [
                {
                  code: 'processing_stage_failed',
                  stage: 'canonical_save',
                },
              ],
              evidenceProvenance: sealedActivityEvidence
                ? {
                    kind: 'sealed_capture_activity_v2',
                    digestSha256: sealedActivityEvidence.digestSha256,
                  }
                : { kind: 'missing' },
              ...(sealedActivityEvidence
                ? {
                    activityEvidence: sealedActivityEvidence,
                  }
                : {}),
            }),
            transcript_validated_at: null,
            transcript_json: JSON.stringify(
              buildTranscriptJsonPayload([], {
                canonicalSource: mixedAudioPath ? 'mix' : 'mic',
                postHydrationBleedPass: false,
                stopToValidatedLatency,
                lifecycleStatus: 'needs_attention',
              }),
            ),
            user_notes: userNotes,
            enhanced_notes: null,
            analysis_json: null,
            value_signals_json: null,
            participants,
            folder_id: null,
            is_favorite: false,
            end_reason: endReason || 'processing_error',
            finalization_status: 'finalized',
            finalization_error_category: null,
          });
          onSessionComplete?.(currentMeetingIdRef.current);
        } catch {
          console.error('[Pluto] Failed to save recoverable recording state');
        }
      }
      alert(`Failed to process recording: ${(e as Error).message}`);
      isRecordingRef.current = false;
      setIsRecording(false);
    } finally {
      stopInFlightRef.current = false;
      stopToValidatedLatencyRef.current =
        createStopToValidatedLatencyAccumulator();
      startTimeRef.current = 0;
      recordingEndedAtRef.current = 0;
      isProcessingRef.current = false;
      setIsProcessing(false);
      currentMeetingIdRef.current = null;
    }
  };

  useEffect(() => {
    return attachCaptureUnloadGuard(window, {
      isRecording: () => isRecordingRef.current,
      isProcessing: () => isProcessingRef.current,
    });
  }, []);

  // Set up event listeners for external control (e.g., "End Meeting" button)
  useEffect(() => {
    const handleStopRecording = () => {
      console.log(
        '[Pluto] STOP_RECORDING event received, isRecording:',
        isRecordingRef.current,
      );
      if (isRecordingRef.current && !isProcessingRef.current) {
        stopSession();
      }
    };
    const handleStartRecording = () => {
      console.log('[Pluto] START_RECORDING event received');
      if (!isRecordingRef.current && !isProcessingRef.current) {
        startSession();
      }
    };
    window.addEventListener('STOP_RECORDING', handleStopRecording);
    window.addEventListener('START_RECORDING', handleStartRecording);

    const handleMeetingDeleted = (_event: unknown, deletedId: string) => {
      if (deletedId === currentMeetingIdRef.current) {
        console.warn(
          `[Pluto] Active meeting ${deletedId} was deleted. Resetting state.`,
        );
        // Note: we don't call stopSession because that would try to save.
        // We just reset local state. The main process handles task cancellation.
        currentMeetingIdRef.current = null;
        liveTranscriptResponsivenessRef.current.abortStart();
        frozenLiveTranscriptResponsivenessRef.current = null;
        stopInFlightRef.current = false;
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        isProcessingRef.current = false;
        setIsRecording(false);
        setIsProcessing(false);
        // Kill active recorders
        if (
          micRecorderRef.current &&
          micRecorderRef.current.state !== 'inactive'
        ) {
          micRecorderRef.current.stop();
        }
        cancelSystemAudioHealthTimeoutRef.current?.();
        cancelSystemAudioHealthTimeoutRef.current = null;
        window.ipcRenderer.invoke('NATIVE_AUDIO_STOP').catch(() => {});
      }
    };
    window.ipcRenderer.on('MEETING_DELETED', handleMeetingDeleted);

    return () => {
      cancelSystemAudioHealthTimeoutRef.current?.();
      cancelSystemAudioHealthTimeoutRef.current = null;
      window.removeEventListener('STOP_RECORDING', handleStopRecording);
      window.removeEventListener('START_RECORDING', handleStartRecording);
      window.ipcRenderer.off('MEETING_DELETED', handleMeetingDeleted);
    };
  });

  // Expose stopSession and startSession to parent via refs
  useEffect(() => {
    if (onStopSessionRef) {
      onStopSessionRef.current = stopSession;
    }
    if (onStartSessionRef) {
      onStartSessionRef.current = startSession;
    }
  });

  return null;
};
