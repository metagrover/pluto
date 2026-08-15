import { useEffect, useRef, useState } from 'react';
import {
  markStopToValidatedLatencyUnavailable,
  startStopToValidatedLatencyAfterAcceptedStop,
} from '../services/diarizationFirstFinalization';
import { runFinalTranscription } from '../services/finalTranscription/runFinalTranscription';
import { retryMeetingTranscriptValidation } from '../services/retryMeetingTranscriptValidation';
import {
  computeRms,
  createWavBlob,
  decodeFloat32PcmChunk,
  isCaptureChunkPairReady,
  resolvePcmTimelineSampleRate,
  trimPcmLeadingOverflow,
} from '../utils/audio';
import {
  BackgroundTranscriptValidationQueue,
  type CaptureComputePolicy,
} from '../utils/backgroundTranscriptValidation';
import { startBoundedSampler } from '../utils/boundedSampler';
import { createCaptureActivitySession } from '../utils/captureActivitySession';
import { createCaptureJournalMutationCoordinator } from '../utils/captureJournalMutationCoordinator';
import {
  attachCaptureUnloadGuard,
  isCaptureSessionAlreadyActiveError,
} from '../utils/captureSessionGuard';
import {
  type LiveTranscriptResponsivenessSummary,
  createLiveTranscriptResponsivenessRuntime,
} from '../utils/liveTranscriptResponsiveness';
import {
  createStableLiveSegmentId,
  mergeValidatedTranscriptChunk,
} from '../utils/liveTranscriptValidationMerge';
import { LiveTranscriptionQueue } from '../utils/liveTranscriptionQueue';
import { isGrantedStatus } from '../utils/permissions';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildRecoverableSealFailureMeeting,
  createSealedCaptureActivityHandoff,
  sealCaptureJournalBeforeFinalization,
} from '../utils/recordingFinalization';
import {
  type SpeakerActivityWindow,
  type WordTimestamp,
  decideNextSpeaker,
  shouldDropBySpeakerActivity,
} from '../utils/speakerAttribution';
import { createStopToValidatedLatencyAccumulator } from '../utils/stopToValidatedLatency';
import {
  type TimedAudioChunk,
  shouldUseSystemAudioReconstructionFallback,
} from '../utils/systemAudioReconstruction';
import type { CaptureActivityEvidence } from '../utils/transcriptActivityEvidence';
import { canonicalizeTranscriptCheckpointConfig } from '../utils/transcriptCheckpointConfig';
import { evaluateLiveTranscriptCoverage } from '../utils/transcriptIntegrity';
import {
  type StoredTranscriptSpeakerAttribution,
  type TranscriptPipelineMode,
  buildTranscriptJsonPayload,
  buildTranscriptSpeakerAttribution,
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
  validationState?: 'preview' | 'validated';
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

type JournalAcceptanceState = {
  acceptedChecksumSha256: string;
};

type ChunkAcceptanceDraft = {
  activityEvidenceDigestSha256: string;
  sidecar: {
    schemaVersion: 1;
    meetingId: string;
    sequence: number;
    arbitrationVersion: 'chunk_arbitration_v1';
    activityInputs: unknown;
    segments: Array<{
      source: 'mic' | 'system';
      start: number;
      end: number;
      text: string;
      words?: WordTimestamp[];
    }>;
  };
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
    resolvedTranscriptionSettings.backend === 'mlx_preview' ? 5 : 30;
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
        ? (overrides.canonicalSource as 'mic' | 'mix')
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
  // Refs - Dual Recording for source-based speaker labeling
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micMimeTypeRef = useRef<string | null>(null);

  const micChunksRef = useRef<Blob[]>([]);
  const systemChunksRef = useRef<Blob[]>([]);

  const micChunkIndexRef = useRef(0);
  const systemChunkIndexRef = useRef(0);

  const systemPcmChunksRef = useRef<Float32Array[]>([]);
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
  const backgroundValidationQueueRef = useRef(
    new BackgroundTranscriptValidationQueue({
      waitForLiveIdle: async (timeoutMs) =>
        await processingQueueRef.current.waitForIdle(timeoutMs),
      getPolicy: async () =>
        (await window.ipcRenderer.invoke(
          'GET_CAPTURE_COMPUTE_POLICY',
        )) as CaptureComputePolicy,
      onError: () => {
        console.warn('[Pluto] Background transcript validation failed');
      },
    }),
  );
  const liveTranscriptionGenerationRef = useRef(0);
  const transcriptionVocabularyRef = useRef<TranscriptionVocabularySelection>({
    initialPrompt: null,
    terms: [],
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
  const captureJournalAcceptanceFramesRef = useRef(
    new Map<number, JournalAcceptanceState>(),
  );
  const chunkAcceptanceDraftsRef = useRef(
    new Map<number, ChunkAcceptanceDraft>(),
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
      schemaVersion: 1 as const,
      meetingId,
      sequence,
      arbitrationVersion: 'chunk_arbitration_v1' as const,
      activityInputs,
      segments: [
        ...micSegments.map((segment) => ({
          source: 'mic' as const,
          start: segment.startTime + chunkStartSec,
          end: segment.endTime + chunkStartSec,
          text: segment.text,
          words: segment.words,
        })),
        ...systemSegments.map((segment) => ({
          source: 'system' as const,
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
      )) as {
        manifest: JournalManifestState;
        frame: JournalAcceptanceState;
      };
      captureJournalStateRef.current = saved.manifest;
      captureJournalAcceptanceFramesRef.current.set(sequence, saved.frame);
      chunkAcceptanceDraftsRef.current.set(sequence, {
        activityEvidenceDigestSha256,
        sidecar,
      });
      return saved;
    });
  };

  const validateTranscriptChunkInBackground = async ({
    meetingId,
    generation,
    source,
    sequence,
    audioPath,
    previewSegments,
    signal,
  }: {
    meetingId: string;
    generation: number;
    source: 'mic' | 'system';
    sequence: number;
    audioPath: string;
    previewSegments: TranscriptionSegment[];
    signal: AbortSignal;
  }) => {
    if (
      signal.aborted ||
      generation !== liveTranscriptionGenerationRef.current ||
      currentMeetingIdRef.current !== meetingId ||
      !isRecordingRef.current
    ) {
      return;
    }
    const tuple = journalTupleKey(source, sequence);
    const receipt = captureJournalReceiptsRef.current.get(tuple);
    const priorCheckpoint = captureJournalCheckpointsRef.current.get(tuple);
    const priorFrame = captureJournalAcceptanceFramesRef.current.get(sequence);
    const acceptanceDraft = chunkAcceptanceDraftsRef.current.get(sequence);
    if (!receipt || !priorCheckpoint || !priorFrame || !acceptanceDraft) return;

    const validationModel = 'medium' as const;
    const result = await window.ipcRenderer.invoke(
      'TRANSCRIPTION_TRANSCRIBE_PREVIEW',
      audioPath,
      buildTranscriptionOptions({
        diarize: false,
        meetingId,
        model: validationModel,
        wordTimestamps: true,
      }),
    );
    if (
      signal.aborted ||
      generation !== liveTranscriptionGenerationRef.current ||
      currentMeetingIdRef.current !== meetingId ||
      !isRecordingRef.current
    ) {
      return;
    }
    const speaker = source === 'mic' ? 'Me' : 'Them';
    const rawSegments = Array.isArray(result?.segments) ? result.segments : [];
    const validatedSegments: TranscriptionSegment[] = rawSegments
      .filter((segment: { text?: unknown }) =>
        isValidSegment(String(segment.text ?? '')),
      )
      .map(
        (segment: {
          start: number;
          end: number;
          text: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }) => ({
          id: createStableLiveSegmentId(
            source,
            sequence,
            segment.start + receipt.chunkStartSec,
            segment.end + receipt.chunkStartSec,
          ),
          startTime: segment.start + receipt.chunkStartSec,
          endTime: segment.end + receipt.chunkStartSec,
          text: segment.text.trim(),
          speaker,
          validationState: 'validated' as const,
          words: segment.words?.map((word) => ({
            word: word.word,
            start: word.start + receipt.chunkStartSec,
            end: word.end + receipt.chunkStartSec,
          })),
        }),
      );
    const merged = mergeValidatedTranscriptChunk({
      preview: previewSegments,
      validated: validatedSegments,
      source,
      sequence,
      chunkStartSec: receipt.chunkStartSec,
      chunkEndSec: receipt.chunkEndSec,
    });
    if (!merged) return;

    const config = {
      ...buildTranscriptCheckpointConfig(),
      model: validationModel,
    };
    const configKey = await sha256Hex(
      canonicalizeTranscriptCheckpointConfig(config),
    );
    const sidecar = {
      schemaVersion: 1 as const,
      meetingId,
      source,
      sequence,
      chunkChecksumSha256: receipt.checksumSha256,
      chunkStartSec: receipt.chunkStartSec,
      chunkEndSec: receipt.chunkEndSec,
      transcriptionConfig: config,
      backendResult: {
        detectedLanguage:
          typeof result?.language === 'string'
            ? result.language.toLowerCase()
            : null,
        providerLabel:
          typeof result?.meta?.providerLabel === 'string'
            ? result.meta.providerLabel
            : 'local',
      },
      segments: merged.map((segment) => ({
        start: segment.startTime - receipt.chunkStartSec,
        end: segment.endTime - receipt.chunkStartSec,
        text: segment.text,
        ...(segment.words
          ? {
              words: segment.words.map((word) => ({
                word: word.word,
                start: word.start - receipt.chunkStartSec,
                end: word.end - receipt.chunkStartSec,
              })),
            }
          : {}),
      })),
    };
    const acceptanceSegments = acceptanceDraft.sidecar.segments.filter(
      (segment) => segment.source !== source,
    );
    acceptanceSegments.push(
      ...sidecar.segments.map((segment) => ({
        source,
        start: segment.start + receipt.chunkStartSec,
        end: segment.end + receipt.chunkStartSec,
        text: segment.text,
        ...(segment.words
          ? {
              words: segment.words.map((word) => ({
                word: word.word,
                start: word.start + receipt.chunkStartSec,
                end: word.end + receipt.chunkStartSec,
              })),
            }
          : {}),
      })),
    );

    const saved = await captureJournalMutationCoordinatorRef.current.run(
      async () => {
        const current = await refreshCaptureJournalState(meetingId);
        if (!current || signal.aborted) return null;
        return (await window.ipcRenderer.invoke(
          'AUDIO_CAPTURE_JOURNAL_CHECKPOINT_PROMOTE',
          {
            receipt,
            expectedManifestRevision: current.revision,
            expectedPriorTranscriptChecksumSha256:
              priorCheckpoint.transcriptChecksumSha256,
            transcriptionConfigKey: configKey,
            sidecar,
            expectedPriorAcceptedChecksumSha256:
              priorFrame.acceptedChecksumSha256,
            acceptance: {
              sequence,
              micCheckpointChecksumSha256:
                source === 'mic'
                  ? priorCheckpoint.transcriptChecksumSha256
                  : (captureJournalCheckpointsRef.current.get(
                      journalTupleKey('mic', sequence),
                    )?.transcriptChecksumSha256 ?? null),
              systemCheckpointChecksumSha256:
                source === 'system'
                  ? priorCheckpoint.transcriptChecksumSha256
                  : (captureJournalCheckpointsRef.current.get(
                      journalTupleKey('system', sequence),
                    )?.transcriptChecksumSha256 ?? null),
              activityEvidenceDigestSha256:
                acceptanceDraft.activityEvidenceDigestSha256,
              sidecar: {
                ...acceptanceDraft.sidecar,
                segments: acceptanceSegments.sort(
                  (left, right) => left.start - right.start,
                ),
              },
            },
          },
        )) as {
          manifest: JournalManifestState;
          checkpoint: JournalCheckpointState;
          frame: JournalAcceptanceState;
        };
      },
    );
    if (
      !saved ||
      signal.aborted ||
      generation !== liveTranscriptionGenerationRef.current ||
      currentMeetingIdRef.current !== meetingId ||
      !isRecordingRef.current
    ) {
      return;
    }
    captureJournalStateRef.current = saved.manifest;
    captureJournalCheckpointsRef.current.set(tuple, saved.checkpoint);
    captureJournalAcceptanceFramesRef.current.set(sequence, saved.frame);
    const previewIds = new Set(previewSegments.map((segment) => segment.id));
    processedMicSegmentsRef.current = [
      ...processedMicSegmentsRef.current.filter(
        (segment) => !previewIds.has(segment.id),
      ),
      ...merged.map((segment) => ({
        ...segment,
        validationState: 'validated' as const,
      })),
    ];
    onLiveTranscript?.(
      [...processedMicSegmentsRef.current]
        .sort((left, right) => left.startTime - right.startTime)
        .map((segment) => ({
          id: segment.id,
          speaker:
            segment.speaker === 'Me' || segment.speaker === 'Them'
              ? segment.speaker
              : 'Unknown',
          text: segment.text,
          timestampMs: segment.startTime * 1_000,
          confirmed: segment.validationState === 'validated',
        })),
    );
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
        terms: [],
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
      backgroundValidationQueueRef.current.close();
      backgroundValidationQueueRef.current =
        new BackgroundTranscriptValidationQueue({
          waitForLiveIdle: async (timeoutMs) =>
            await processingQueueRef.current.waitForIdle(timeoutMs),
          getPolicy: async () =>
            (await window.ipcRenderer.invoke(
              'GET_CAPTURE_COMPUTE_POLICY',
            )) as CaptureComputePolicy,
          onError: () => {
            console.warn('[Pluto] Background transcript validation failed');
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
        captureJournalAcceptanceFramesRef.current.clear();
        chunkAcceptanceDraftsRef.current.clear();
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
        const terms = Array.isArray(vocabulary?.terms)
          ? vocabulary.terms
              .filter((term): term is string => typeof term === 'string')
              .slice(0, 12)
          : [];
        transcriptionVocabularyRef.current = {
          initialPrompt,
          terms,
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
          (window as unknown as Record<string, unknown>).__plutoMicProcessor =
            processor;
          (window as unknown as Record<string, unknown>).__plutoMicSource =
            micSource;
          console.log(
            `[Pluto] Mic PCM chunk capture active at ${audioContext.sampleRate}Hz`,
          );
        } catch (pcmErr) {
          const keepalive = window as unknown as Record<string, unknown>;
          keepalive.__plutoMicProcessor = undefined;
          keepalive.__plutoMicSource = undefined;
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
    backgroundValidationQueueRef.current.close();

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
    const keepalive = window as unknown as Record<string, unknown>;
    keepalive.__plutoMicProcessor = undefined;
    keepalive.__plutoMicSource = undefined;
    micPcmChunksRef.current = [];
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }
  };

  // --- Helpers ---

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
    if (!micPending) return;
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
      backgroundValidationEligible?: boolean;
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
              'TRANSCRIPTION_TRANSCRIBE_PREVIEW',
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
                    id: createStableLiveSegmentId(
                      'mic',
                      opts.chunkIndex,
                      s.start,
                      s.end,
                    ),
                    startTime: s.start,
                    endTime: s.end,
                    text: s.text.trim(),
                    speaker: label,
                    validationState: 'preview' as const,
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
                backgroundValidationEligible: false,
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
            id: createStableLiveSegmentId(
              label === 'Me' ? 'mic' : 'system',
              opts.chunkIndex,
              s.start + timeOffsetSec,
              s.end + timeOffsetSec,
            ),
            startTime: s.start + timeOffsetSec,
            endTime: s.end + timeOffsetSec,
            text: s.text.trim(),
            speaker: label,
            validationState: 'preview' as const,
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
                'TRANSCRIPTION_TRANSCRIBE_PREVIEW',
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
        'TRANSCRIPTION_TRANSCRIBE_PREVIEW',
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
          '[Pluto] Disabling per-chunk Me transcription for this meeting; final validation will replace the preview',
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
        confirmed: segment.validationState === 'validated',
      }));
    liveTranscriptResponsivenessRef.current.publishAcceptedSegments(
      acceptedSegments,
      () => {
        onInterimTranscript?.('');
        onLiveTranscript?.(liveTranscript);
      },
    );
    if (checkpointMeetingId) {
      const candidates =
        opts.chunkIndex % 2 === 0
          ? [
              {
                source: 'mic' as const,
                audioPath: micResult.audioPath,
                segments: filteredMicSegments,
                eligible: micResult.backgroundValidationEligible !== false,
              },
              {
                source: 'system' as const,
                audioPath: systemResult.audioPath,
                segments: filteredSystemSegments,
                eligible: systemResult.backgroundValidationEligible !== false,
              },
            ]
          : [
              {
                source: 'system' as const,
                audioPath: systemResult.audioPath,
                segments: filteredSystemSegments,
                eligible: systemResult.backgroundValidationEligible !== false,
              },
              {
                source: 'mic' as const,
                audioPath: micResult.audioPath,
                segments: filteredMicSegments,
                eligible: micResult.backgroundValidationEligible !== false,
              },
            ];
      const candidate = candidates.find(
        (item) => item.eligible && item.audioPath && item.segments.length > 0,
      );
      if (candidate?.audioPath) {
        const previewSegments = candidate.segments.map((segment) => ({
          ...segment,
          startTime: segment.startTime + chunkStartSec,
          endTime: segment.endTime + chunkStartSec,
        }));
        backgroundValidationQueueRef.current.enqueue(
          `${candidate.source}:${opts.chunkIndex}`,
          async (signal) =>
            await validateTranscriptChunkInBackground({
              meetingId: checkpointMeetingId,
              generation: opts.generation,
              source: candidate.source,
              sequence: opts.chunkIndex,
              audioPath: candidate.audioPath as string,
              previewSegments,
              signal,
            }),
        );
      }
    }
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
    const finalTranscriptionRunId = crypto.randomUUID();
    let provisionalMeetingPersisted = false;

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

      // The capture journal owns disk-backed system chunks. Do not retain or
      // concatenate a second session-length PCM copy in the renderer.
      const finalizedSystemDurationSec = 0;
      if (systemPcmChunksRef.current.length > 0) {
        systemPcmChunksRef.current = [];
      }

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
      const newTranscription = mergeConsecutiveSpeakerSegments(
        [...processedMicSegmentsRef.current].sort(
          (left, right) => left.startTime - right.startTime,
        ),
      );
      const pipelineMode: TranscriptPipelineMode = 'canonical_session_v2';
      const speakerAttribution: StoredTranscriptSpeakerAttribution =
        buildTranscriptSpeakerAttribution({
          diarizationEnabled: false,
          diarizationAttempted: false,
          fallbackReason: 'diarization_disabled',
        });

      const meetingTiming = buildMeetingTiming(stopSnapshot);
      if (!stopSnapshot || !sealedActivityEvidence) {
        throw new Error('final_transcription_evidence_unavailable');
      }
      const finalStopSnapshot = stopSnapshot;
      const finalSealedActivityEvidence = sealedActivityEvidence;
      const captureGeneration =
        captureJournalStateRef.current?.generation ?? '';
      const provisionalTranscriptJson = JSON.stringify(
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
          lifecycleStatus: 'provisional',
        }),
      );
      const provisionalMeeting = {
        id: finalStopSnapshot.meetingId,
        title: userTitle || 'Meeting',
        meeting_type: 'Recording',
        started_at: meetingTiming.startedAtIso,
        ended_at: meetingTiming.endedAtIso,
        duration_seconds: meetingTiming.durationSeconds,
        audio_path: primaryAudioPath || null,
        system_audio_path: systemAudioPath || null,
        mixed_audio_path: mixedAudioPath || null,
        transcript_status: 'provisional',
        transcript_validated_at: null,
        transcript_json: provisionalTranscriptJson,
        user_notes: userNotes,
        enhanced_notes: null,
        analysis_json: null,
        value_signals_json: null,
        participants,
        capture_journal_generation: captureGeneration || null,
        folder_id: null,
        is_favorite: false,
        end_reason: endReason || 'manual',
        finalization_status: 'finalized',
        finalization_error_category: null,
      };
      const provisionalIntegrity = {
        schemaVersion: 2,
        state: 'provisional',
        causes: [],
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: finalSealedActivityEvidence.digestSha256,
        },
        activityEvidence: finalSealedActivityEvidence,
      };
      const insertedProvisional = await sealedActivityHandoff.persistMeeting(
        provisionalMeeting,
        provisionalIntegrity,
        async (meeting) =>
          await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
      );
      if (insertedProvisional === false) {
        onSessionComplete?.(finalStopSnapshot.meetingId);
        return;
      }
      provisionalMeetingPersisted = true;

      let committedFinalSegments: TranscriptionSegment[] = [];
      const finalOutcome = await sealedActivityHandoff.runValidation(
        async (activityWindows) =>
          await runFinalTranscription(
            {
              meetingId: finalStopSnapshot.meetingId,
              runId: finalTranscriptionRunId,
              captureEvidence: {
                sealed: Boolean(captureGeneration),
                generation: captureGeneration,
              },
              recordingDurationSeconds: meetingTiming.durationSeconds,
              micAudioPath: primaryAudioPath,
              systemAudioPath,
              provisionalSegments: newTranscription,
              activityWindows,
              language: resolvedTranscriptionSettings.language || 'en',
              vocabulary: transcriptionVocabularyRef.current.terms,
              vocabularyPolicyVersion:
                transcriptionVocabularyRef.current.provenance.policyVersion,
            },
            {
              claimLease: async (lease) =>
                (await window.ipcRenderer.invoke(
                  'CLAIM_FINAL_TRANSCRIPTION',
                  finalStopSnapshot.meetingId,
                  lease,
                )) === true,
              updateLease: async (lease) =>
                await window.ipcRenderer.invoke(
                  'UPDATE_FINAL_TRANSCRIPTION_STAGE',
                  finalStopSnapshot.meetingId,
                  lease.runId,
                  lease.stage,
                ),
              transcribe: async (request) =>
                await window.ipcRenderer.invoke(
                  'TRANSCRIPTION_TRANSCRIBE_FINAL',
                  request,
                ),
              probeDuration: async (audioPath) =>
                await window.ipcRenderer.invoke(
                  'AUDIO_PROBE_DURATION',
                  audioPath,
                ),
              commitCanonical: async (commit) => {
                committedFinalSegments =
                  commit.segments as TranscriptionSegment[];
                const transcriptValidatedAt = new Date().toISOString();
                const canonicalTranscriptJson = JSON.stringify(
                  buildTranscriptJsonPayload(committedFinalSegments, {
                    pipelineMode,
                    canonicalSource: 'recovered_channels',
                    postHydrationBleedPass: false,
                    transcription: {
                      backend: 'parakeet_coreml',
                      preset: 'accuracy_first',
                      model: commit.metadata.model,
                      device: 'coreml',
                      computeType: 'float16',
                      canonicalSource: 'recovered_channels',
                      diarization: false,
                      elapsedMs: 0,
                      providerLabel: 'FluidAudio-0.15.5',
                      vocabularyHintPolicyVersion:
                        commit.metadata.vocabularyPolicyVersion,
                      vocabularyHintCount: commit.metadata.vocabularyCount,
                    },
                    speakerAttribution,
                    liveTranscriptResponsiveness:
                      frozenLiveTranscriptResponsivenessRef.current ??
                      undefined,
                    lifecycleStatus: 'validated',
                    integrity: {
                      ...commit.integrity,
                      reasons: [],
                    },
                  }),
                );
                const transcriptIntegrityJson = JSON.stringify({
                  schemaVersion: 2,
                  state: 'validated',
                  causes: [],
                  evidenceProvenance: {
                    kind: 'sealed_capture_activity_v2',
                    digestSha256: finalSealedActivityEvidence.digestSha256,
                  },
                  activityEvidence: finalSealedActivityEvidence,
                  evidence: commit.integrity,
                  validationProof: {
                    gateVersion: 'canonical_integrity_v1',
                    validatedAt: transcriptValidatedAt,
                  },
                });
                const outcome = await window.ipcRenderer.invoke(
                  'COMMIT_FINAL_TRANSCRIPTION',
                  {
                    meetingId: finalStopSnapshot.meetingId,
                    runId: finalTranscriptionRunId,
                    captureGeneration,
                    canonicalTranscriptJson,
                    transcriptIntegrityJson,
                    transcriptValidatedAt,
                  },
                );
                return outcome && outcome.committed === true
                  ? {
                      committed: true,
                      transcript: JSON.parse(outcome.transcriptJson),
                    }
                  : { committed: false };
              },
              markNeedsAttention: async ({ failure, lease }) => {
                if (lease) {
                  await window.ipcRenderer.invoke(
                    'FAIL_FINAL_TRANSCRIPTION',
                    finalStopSnapshot.meetingId,
                    lease.runId,
                    failure,
                  );
                }
              },
              startAnalysis: async ({ transcript }) => {
                if (
                  transcript &&
                  typeof transcript === 'object' &&
                  Array.isArray(
                    (transcript as { segments?: unknown[] }).segments,
                  )
                ) {
                  const fullText = committedFinalSegments
                    .map((segment) => segment.text)
                    .join(' ');
                  if (fullText) onTranscript?.(fullText);
                }
                await retryMeetingTranscriptValidation(
                  finalStopSnapshot.meetingId,
                  (channel, ...args) =>
                    window.ipcRenderer.invoke(channel, ...args),
                );
                onSessionComplete?.(finalStopSnapshot.meetingId);
              },
            },
          ),
      );
      if (finalOutcome.status !== 'validated') {
        onSessionComplete?.(finalStopSnapshot.meetingId);
      }
      if (finalOutcome.status) return;
    } catch (e) {
      console.error('[Pluto] Processing failed:', e);
      if (provisionalMeetingPersisted) {
        await window.ipcRenderer
          .invoke(
            'FAIL_FINAL_TRANSCRIPTION',
            stopSnapshot.meetingId,
            finalTranscriptionRunId,
            'runtime_unavailable',
          )
          .catch(() => null);
        onSessionComplete?.(stopSnapshot.meetingId);
      } else if (
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
