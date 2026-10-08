import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../../electron/calendar/types';
import type { RendererCaptureCounters } from '../../electron/captureDiagnostics';
import {
  SILENCE_AUTO_STOP_TIMEOUT_MS,
  type SilenceAutoStopDuration,
  type SilenceWatchdog,
  createSilenceWatchdog,
  resolveSilenceAutoStopDuration,
} from '../autoStop/silenceWatchdog';
import type {
  CaptureLifecycleSnapshot,
  CaptureStartResult,
} from '../services/captureLifecycle';
import {
  markStopToValidatedLatencyUnavailable,
  startStopToValidatedLatencyAfterAcceptedStop,
} from '../services/diarizationFirstFinalization';
import { registerFinalTranscriptionVocabulary } from '../services/finalTranscription/finalTranscriptionVocabularyRegistry';
import { shouldOfferIncrementalMeetingNotes } from '../services/incrementalMeetingNotesOffer';
import { createDurableEouSession } from '../services/liveTranscription/durableEouSession';
import type { LiveConversationSnapshot } from '../services/liveTranscription/liveConversationProjection';
import {
  type LiveConversationProjector,
  createLiveConversationRollout,
} from '../services/liveTranscription/liveConversationRollout';
import {
  reconcileLiveTranscriptReading,
  reconcileLiveTranscriptSegments,
} from '../services/liveTranscription/liveTranscriptReconciliation';
import {
  type ConfirmedSegmentIngestionSession,
  createConfirmedSegmentIngestionSession,
} from '../services/meetingContext/confirmedSegmentIngestionSession';
import {
  computeRms,
  createWavBlob,
  decodeFloat32PcmChunk,
  trimPcmLeadingOverflow,
} from '../utils/audio';
import {
  type AudioResampler,
  createAudioResampler,
} from '../utils/audioResampler';
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
import { waitForMediaRecorderStop } from '../utils/mediaRecorderLifecycle';
import { createNativeAudioRecovery } from '../utils/nativeAudioRecovery';
import { createPcmLivenessMonitor } from '../utils/pcmLiveness';
import { isGrantedStatus } from '../utils/permissions';
import {
  beginRecordingFinalization,
  buildMeetingTiming,
  buildRecoverableSealFailureMeeting,
  createSealedCaptureActivityHandoff,
  getTerminalRecordingFailureMessage,
  sealCaptureJournalBeforeFinalization,
} from '../utils/recordingFinalization';
import {
  type SpeakerActivityWindow,
  type WordTimestamp,
  decideNextSpeaker,
} from '../utils/speakerAttribution';
import { createStopToValidatedLatencyAccumulator } from '../utils/stopToValidatedLatency';
import type { CaptureActivityEvidence } from '../utils/transcriptActivityEvidence';
import { toStoredLiveTranscriptCandidate } from '../utils/transcriptReadingProjection';
import {
  type StoredTranscriptSpeakerAttribution,
  type TranscriptPipelineMode,
  buildTranscriptJsonPayload,
  buildTranscriptSpeakerAttribution,
} from '../utils/transcriptSchema';
import { TRANSCRIPTION_TUNING } from '../utils/transcriptionConfig';
import {
  type TranscriptionSettings,
  resolveTranscriptionSettings,
} from '../utils/transcriptionSettings';
import {
  KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
  type TranscriptionVocabularySelection,
  buildTranscriptionParticipantHints,
} from '../utils/transcriptionVocabulary';
import {
  type CaptureHealth,
  type CaptureHealthState,
  type LiveTranscriptIntegrity,
  type LiveTranscriptSegment,
  type RecordingFinalizationPreview,
  resolveSystemCaptureHealth,
  withCaptureDurabilityWarning,
} from './features/recordingWorkspaceModel';

interface AudioManagerProps {
  onSessionComplete: (meetingId?: string | number) => void;
  onSessionUpdated?: (meetingId: string | number) => void;
  onStartingChange?: (isStarting: boolean) => void;
  onRecordingChange?: (isRecording: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onCaptureLifecycleChange?: (snapshot: CaptureLifecycleSnapshot) => void;
  onFinalizationStarted?: (meeting: RecordingFinalizationPreview) => void;
  onSpeakingChange?: (speaker: 'Me' | 'Them' | null) => void;
  onLiveTranscript?: (segments: LiveTranscriptSegment[]) => void;
  onLiveConversation?: (conversation: LiveConversationSnapshot | null) => void;
  onInterimTranscript?: (text: string) => void;
  onCaptureHealthChange?: (health: CaptureHealthState) => void;
  onLiveTranscriptIntegrityChange?: (state: LiveTranscriptIntegrity) => void;
  onRecordingStarted?: (startedAtMs: number, meetingId: string) => void;
  userNotes?: string;
  userTitle?: string;
  participants?: string[];
  transcriptionParticipantHints?: string[];
  systemAudioStatus?: string;
  transcriptionSettings?: TranscriptionSettings;
  silenceAutoStopDuration?: SilenceAutoStopDuration;
  calendarEndTimeMs?: number | null;
  fasterNotesEnabled?: boolean;

  onStopSessionRef?: React.MutableRefObject<
    ((endReason?: string) => void) | null
  >;
  onStartSessionRef?: React.MutableRefObject<
    ((calendarEvent?: CalendarEvent) => Promise<CaptureStartResult>) | null
  >;
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
  schemaVersion: 3 | 4;
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
  onSessionComplete,
  onSessionUpdated,
  onStartingChange,
  onRecordingChange,
  onProcessingChange,
  onCaptureLifecycleChange,
  onFinalizationStarted,
  userNotes = '',
  userTitle = '',
  participants = [],
  transcriptionParticipantHints = [],
  transcriptionSettings,
  onStopSessionRef,
  onStartSessionRef,
  onSpeakingChange,
  onLiveTranscript,
  onLiveConversation,
  onInterimTranscript,
  onCaptureHealthChange,
  onLiveTranscriptIntegrityChange,
  onRecordingStarted,
  systemAudioStatus = 'unknown',
  silenceAutoStopDuration = '0.5',
  calendarEndTimeMs = null,
  fasterNotesEnabled = true,
}: AudioManagerProps) => {
  const fasterNotesEnabledRef = useRef(fasterNotesEnabled);
  fasterNotesEnabledRef.current = fasterNotesEnabled;
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
  const captureLifecycleRef = useRef<CaptureLifecycleSnapshot>({
    state: 'idle',
  });
  const publishCaptureLifecycle = (
    snapshot: CaptureLifecycleSnapshot,
  ): void => {
    captureLifecycleRef.current = snapshot;
    onCaptureLifecycleChange?.(snapshot);
  };

  useEffect(() => {
    onCaptureLifecycleChange?.(captureLifecycleRef.current);
  }, [onCaptureLifecycleChange]);

  const resolvedTranscriptionSettings = resolveTranscriptionSettings(
    transcriptionSettings,
  );
  const CHUNK_SECONDS = 5;
  // Refs - Dual Recording for source-based speaker labeling
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micMimeTypeRef = useRef<string | null>(null);

  const micChunksRef = useRef<Blob[]>([]);
  const systemChunksRef = useRef<Blob[]>([]);

  const micChunkIndexRef = useRef(0);
  const systemChunkIndexRef = useRef(0);

  const systemPcmChunksRef = useRef<Float32Array[]>([]);
  const captureDiagnosticsRef = useRef<RendererCaptureCounters>({
    bytesReceived: 0,
    samplesAccepted: 0,
    samplesPackaged: 0,
    samplesTrimmed: 0,
  });
  const systemPcmCarryoverBytesRef = useRef<Uint8Array>(new Uint8Array(0));
  const systemPcmSampleRateRef = useRef(48000);
  const systemChunkDecodeDropCountRef = useRef(0);
  const micPcmChunksRef = useRef<Float32Array[]>([]);
  const micPcmSampleRateRef = useRef(48000);
  const micPcmSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micPcmSinkRef = useRef<GainNode | null>(null);
  const AUDIO_TARGET_SAMPLE_RATE = 16000;
  const micResamplerRef = useRef<AudioResampler | null>(null);
  const isReconfiguringRef = useRef<boolean>(false);
  const pendingReconfigureRef = useRef<boolean>(false);
  const reconfigureDeviceTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const activeDeviceChangeListenerRef = useRef<(() => void) | null>(null);
  const startMicMediaRecorderRef = useRef<
    | ((
        stream: MediaStream,
        allowBeforeRecording?: boolean,
      ) => Promise<boolean>)
    | null
  >(null);
  const deviceChangeDebounceMs = 200;
  const nativeAudioUnsubscribeRef = useRef<(() => void) | null>(null);
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
  const eouGenerationRef = useRef(0);
  const liveConversationProjectorRef = useRef<LiveConversationProjector | null>(
    null,
  );
  const eouSessionRef = useRef<ReturnType<
    typeof createDurableEouSession
  > | null>(null);
  const meetingContextIngestionRef =
    useRef<ConfirmedSegmentIngestionSession | null>(null);
  const startSessionActionRef = useRef<() => void>(() => undefined);
  const stopSessionActionRef = useRef<(endReason?: string) => void>(
    () => undefined,
  );
  const silenceWatchdogRef = useRef<SilenceWatchdog | null>(null);
  const calendarEndTimeMsRef = useRef<number | null>(null);
  const silenceAutoStopDurationRef = useRef<string | undefined>(
    silenceAutoStopDuration,
  );

  useEffect(() => {
    calendarEndTimeMsRef.current = calendarEndTimeMs ?? null;
  }, [calendarEndTimeMs]);

  useEffect(() => {
    silenceAutoStopDurationRef.current = silenceAutoStopDuration;
  }, [silenceAutoStopDuration]);

  const getSilenceTimeoutMs = (): number | null => {
    return resolveSilenceAutoStopDuration(
      silenceAutoStopDurationRef.current,
    ) === 'disabled'
      ? null
      : SILENCE_AUTO_STOP_TIMEOUT_MS;
  };
  const transcriptionVocabularyRef = useRef<TranscriptionVocabularySelection>({
    initialPrompt: null,
    terms: [],
    provenance: {
      policyVersion: KNOWN_PERSON_VOCABULARY_POLICY_VERSION,
      hintCount: 0,
    },
  });
  const vocabularyRequestGenerationRef = useRef(0);
  const applyTranscriptionVocabulary = (vocabulary: unknown) => {
    const vocab = vocabulary as TranscriptionVocabularySelection;
    const initialPrompt =
      typeof vocab?.initialPrompt === 'string' &&
      vocab.initialPrompt.length <= 240
        ? vocab.initialPrompt
        : null;
    const hintCount = Number.isInteger(vocab?.provenance?.hintCount)
      ? Math.max(0, Math.min(12, vocab.provenance.hintCount))
      : 0;
    const terms = Array.isArray(vocab?.terms)
      ? vocab.terms
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
  };
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
  const incrementalNotesOfferedCharactersRef = useRef(0);
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
  const startInFlightRef = useRef(false);
  const currentMeetingIdRef = useRef<string | null>(null);
  const confirmedHintKey = transcriptionParticipantHints.join('\u0000');
  const participantHintKey = participants.join('\u0000');
  useEffect(() => {
    if (!isRecording || !confirmedHintKey) return;
    const generation = ++vocabularyRequestGenerationRef.current;
    void window.ipcRenderer
      .invoke('GET_TRANSCRIPTION_VOCABULARY', {
        participants: buildTranscriptionParticipantHints(
          participants,
          transcriptionParticipantHints,
        ),
      })
      .then((vocabulary: unknown) => {
        if (generation === vocabularyRequestGenerationRef.current)
          applyTranscriptionVocabulary(vocabulary);
      })
      .catch(() => console.warn('[Pluto] Calendar vocabulary unavailable'));
  }, [isRecording, confirmedHintKey, participantHintKey]);
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

  const refreshCaptureJournalState = async (meetingId: string) => {
    const manifest = (await window.ipcRenderer.invoke(
      'AUDIO_CAPTURE_JOURNAL_READ',
      { meetingId },
    )) as JournalManifestState;
    if (manifest?.schemaVersion !== 3 && manifest?.schemaVersion !== 4) {
      return null;
    }
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
          ...(source === 'mic'
            ? { diagnostics: { ...captureDiagnosticsRef.current } }
            : {}),
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

  const abortUnstartedCapture = async (meetingId: string) => {
    eouSessionRef.current?.cancel();
    eouSessionRef.current = null;
    meetingContextIngestionRef.current?.close();
    meetingContextIngestionRef.current = null;
    cancelSystemAudioHealthTimeoutRef.current?.();
    cancelSystemAudioHealthTimeoutRef.current = null;
    nativeAudioUnsubscribeRef.current?.();
    nativeAudioUnsubscribeRef.current = null;
    try {
      await window.ipcRenderer.invoke('NATIVE_AUDIO_STOP');
    } catch {
      console.warn('[Pluto] Failed to stop unstarted native capture');
    }
    try {
      await window.ipcRenderer.invoke('AUDIO_CAPTURE_JOURNAL_ABORT_START', {
        meetingId,
      });
    } catch (error) {
      console.warn('[Pluto] Failed to release unstarted capture');
    }
  };

  const startSession = async (
    calendarEvent?: CalendarEvent,
  ): Promise<CaptureStartResult> => {
    if (captureLifecycleRef.current.state !== 'idle') {
      console.warn('[Pluto] Ignoring duplicate start request');
      return {
        admitted: false,
        state: captureLifecycleRef.current.state,
        reason: 'capture_not_idle',
      };
    }
    startInFlightRef.current = true;
    publishCaptureLifecycle({ state: 'starting' });
    onStartingChange?.(true);

    try {
      const readiness = (await window.ipcRenderer.invoke(
        'RECORDING_READINESS_PREPARE',
        { verifyPermissions: true },
      )) as { ready: boolean; blockers: string[] };
      if (!readiness.ready) {
        console.warn('[Pluto] Recording readiness failed:', readiness.blockers);
        window.dispatchEvent(
          new CustomEvent('RECORDING_READINESS_FAILED', { detail: readiness }),
        );
        return {
          admitted: false,
          state: 'starting',
          reason: 'recording_not_ready',
        };
      }

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
      eouGenerationRef.current += 1;
      const eouGeneration = eouGenerationRef.current;
      liveConversationProjectorRef.current =
        await createLiveConversationRollout({
          generation: eouGeneration,
          getSetting: (key) => window.ipcRenderer.invoke('GET_SETTING', key),
        });
      onLiveConversation?.(null);
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
            ...(calendarEvent
              ? { calendarOccurrenceKey: calendarEvent.occurrenceKey }
              : {}),
            sourceAvailability: {
              system: isGrantedStatus(systemAudioStatus)
                ? 'available'
                : 'unavailable_at_start',
            },
          },
        )) as JournalManifestState;
        captureJournalStateRef.current =
          manifest?.schemaVersion === 3 || manifest?.schemaVersion === 4
            ? manifest
            : null;
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
          liveConversationProjectorRef.current = null;
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
          return {
            admitted: false,
            state: 'starting',
            reason: 'capture_session_already_active',
          };
        }
        console.warn(
          '[Pluto] Failed to initialize capture journal:',
          journalErr,
        );
        currentMeetingIdRef.current = null;
        liveConversationProjectorRef.current = null;
        liveTranscriptResponsivenessRef.current.abortStart();
        frozenLiveTranscriptResponsivenessRef.current = null;
        captureActivitySessionRef.current = null;
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        stopInFlightRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);
        alert('Recording could not start securely. Please try again.');
        return {
          admitted: false,
          state: 'starting',
          reason: 'capture_journal_start_failed',
        };
      }

      // Start the native tap as soon as the durable journal owns the session.
      // Its PCM proof can overlap vocabulary, EOU, and microphone setup, while
      // the synchronized recording boundary below still waits for the result.
      console.log('[Pluto] Starting Native AudioCap...');
      const systemCaptureGeneration =
        captureJournalStateRef.current?.generation;
      let systemFailureRecorded = false;
      let systemGapRecorded = false;
      const markSystemCaptureUnresponsive = () => {
        if (
          systemFailureRecorded ||
          stopInFlightRef.current ||
          currentMeetingIdRef.current !== meetingId
        )
          return;
        if (isRecordingRef.current) recordSystemCaptureGap();
        systemAudioHealthRef.current = 'warning';
        publishCaptureHealth({
          ...captureHealthRef.current,
          systemAudio: 'warning',
        });
      };
      const markSystemCaptureFailed = () => {
        if (
          stopInFlightRef.current ||
          currentMeetingIdRef.current !== meetingId
        )
          return;
        systemAudioHealthRef.current = 'unavailable';
        publishCaptureHealth({
          ...captureHealthRef.current,
          systemAudio: 'unavailable',
        });
        systemFailureRecorded = true;
        recordSystemCaptureGap();
      };
      const recordSystemCaptureGap = () => {
        if (systemGapRecorded) return;
        systemGapRecorded = true;
        void captureJournalMutationCoordinatorRef.current
          .run(async () => {
            try {
              const manifest = await refreshCaptureJournalState(meetingId);
              if (
                !manifest ||
                manifest.generation !== systemCaptureGeneration
              ) {
                throw new Error('system_capture_failure_generation_mismatch');
              }
              captureJournalStateRef.current = await window.ipcRenderer.invoke(
                'AUDIO_CAPTURE_JOURNAL_SOURCE_FAILED',
                {
                  meetingId,
                  generation: manifest.generation,
                  expectedRevision: manifest.revision,
                  source: 'system',
                },
              );
            } catch (error) {
              captureActivitySessionRef.current?.markDurabilityFailure();
              throw error;
            }
          })
          .catch((error) => {
            warnCaptureDurability();
            console.warn(
              '[Pluto] Failed to persist System capture failure:',
              error,
            );
          });
      };
      systemAudioChunkSeenRef.current = false;
      systemAudioHealthRef.current = 'warning';
      systemPcmCarryoverBytesRef.current = new Uint8Array(0);
      systemChunkDecodeDropCountRef.current = 0;
      captureDiagnosticsRef.current = {
        bytesReceived: 0,
        samplesAccepted: 0,
        samplesPackaged: 0,
        samplesTrimmed: 0,
      };
      const systemRecovery = createNativeAudioRecovery({
        isActive: () =>
          isRecordingRef.current &&
          !stopInFlightRef.current &&
          !systemFailureRecorded &&
          currentMeetingIdRef.current === meetingId &&
          captureJournalStateRef.current?.generation ===
            systemCaptureGeneration,
        stopCapture: () => window.ipcRenderer.invoke('NATIVE_AUDIO_STOP'),
        startCapture: () => {
          systemPcmCarryoverBytesRef.current = new Uint8Array(0);
          return window.ipcRenderer.invoke('NATIVE_AUDIO_START');
        },
        onRecovering: () => {
          // Recovery restores future capture; it cannot restore the lost interval.
          recordSystemCaptureGap();
          systemAudioHealthRef.current = 'reconfiguring';
          publishCaptureHealth({
            ...captureHealthRef.current,
            systemAudio: 'reconfiguring',
          });
        },
        onFailed: markSystemCaptureFailed,
      });
      const systemLiveness = createPcmLivenessMonitor(
        markSystemCaptureUnresponsive,
        3000,
        () => {
          void systemRecovery.recover();
        },
      );
      cancelSystemAudioHealthTimeoutRef.current = systemLiveness.stop;
      const handler = (_: unknown, chunk: NativeAudioChunk) => {
        if (!chunk) return;
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
        captureDiagnosticsRef.current.bytesReceived += chunkBytes.length;
        const decoded = decodeFloat32PcmChunk(
          chunkBytes,
          systemPcmCarryoverBytesRef.current,
        );
        systemPcmCarryoverBytesRef.current = decoded.carryoverBytes;
        if (!systemLiveness.received(decoded.samples)) return;
        captureDiagnosticsRef.current.samplesAccepted += decoded.samples.length;
        if (
          !systemFailureRecorded &&
          systemAudioHealthRef.current !== 'healthy'
        ) {
          systemAudioHealthRef.current = resolveSystemCaptureHealth({
            nativeStarted: true,
            validPcmSeen: true,
          });
          publishCaptureHealth({
            ...captureHealthRef.current,
            systemAudio: systemAudioHealthRef.current,
          });
        }
        systemPcmChunksRef.current.push(decoded.samples);
        const rms = computeRms(decoded.samples);
        systemRmsRef.current = rms;
        systemRmsUpdatedAtRef.current = performance.now();
      };
      const unsubscribeChunks = window.ipcRenderer.on(
        'NATIVE_AUDIO_CHUNK',
        handler,
      );
      const unsubscribeFailures = window.ipcRenderer.on(
        'NATIVE_AUDIO_FAILURE',
        () => {
          if (systemRecovery.isRecovering()) return;
          if (isRecordingRef.current && !stopInFlightRef.current) {
            markSystemCaptureUnresponsive();
            void systemRecovery.recover();
          } else {
            markSystemCaptureFailed();
          }
        },
      );
      nativeAudioUnsubscribeRef.current = () => {
        unsubscribeChunks();
        unsubscribeFailures();
      };
      const nativeAudioStartPromise =
        window.ipcRenderer.invoke('NATIVE_AUDIO_START');
      void nativeAudioStartPromise.catch(() => undefined);

      const vocabularyGeneration = ++vocabularyRequestGenerationRef.current;
      void window.ipcRenderer
        .invoke('GET_TRANSCRIPTION_VOCABULARY', {
          participants: buildTranscriptionParticipantHints(
            participants,
            transcriptionParticipantHints,
          ),
        })
        .then((vocabulary: unknown) => {
          if (vocabularyGeneration !== vocabularyRequestGenerationRef.current)
            return;
          applyTranscriptionVocabulary(vocabulary);
          console.log(
            '[Pluto] Transcription vocabulary ready',
            transcriptionVocabularyRef.current.provenance,
          );
        })
        .catch(() => {
          console.warn('[Pluto] Transcription vocabulary unavailable');
        });

      const meetingContextIngestion = createConfirmedSegmentIngestionSession({
        meetingId,
        submit: async (request) =>
          await window.ipcRenderer.invoke(
            'MEETING_CONTEXT_INGEST_CONFIRMED',
            request,
          ),
        onError: (error) => {
          console.warn(
            `[Pluto] Meeting context ingestion failed for ${meetingId}`,
            error,
          );
        },
      });
      meetingContextIngestionRef.current?.close();
      meetingContextIngestionRef.current = meetingContextIngestion;
      let liveTranscriptionRecovering = false;
      const eouSession = createDurableEouSession({
        meetingId,
        generation: eouGeneration,
        readAudio: (source, fromSeconds) =>
          window.ipcRenderer.invoke('PARAKEET_EOU_READ_AUDIO', {
            meetingId,
            source,
            fromSeconds,
          }),
        onStatus: (status) => {
          if (
            currentMeetingIdRef.current !== meetingId ||
            eouGenerationRef.current !== eouGeneration
          )
            return;
          liveTranscriptionRecovering = status !== 'active';
          onLiveTranscriptIntegrityChange?.(
            liveTranscriptionRecovering ? 'lagging' : 'healthy',
          );
          const projector = liveConversationProjectorRef.current;
          if (projector)
            onLiveConversation?.(projector.recovering(eouGeneration, status));
        },
        transport: {
          invoke: (channel, payload) =>
            window.ipcRenderer.invoke(channel, payload),
          onUpdate: (listener) => {
            const handler = (_event: unknown, payload: unknown) =>
              listener(payload);
            return window.ipcRenderer.on('PARAKEET_EOU_UPDATE', handler);
          },
          onUnavailable: (listener) => {
            const handler = (_event: unknown, payload: unknown) =>
              listener(payload);
            return window.ipcRenderer.on('PARAKEET_EOU_UNAVAILABLE', handler);
          },
        },
        nowSeconds: getMeetingElapsedSeconds,
        onSegments: (segments, echoEvidence, reason) => {
          if (
            currentMeetingIdRef.current !== meetingId ||
            eouGenerationRef.current !== eouGeneration
          )
            return;
          if (segments.length > 0) {
            silenceWatchdogRef.current?.recordSpeechActivity(Date.now());
          }
          const activeWindow = activeSpeakerWindowRef.current;
          const activityWindows = activeWindow
            ? [
                ...speakerTimelineRef.current,
                {
                  ...activeWindow,
                  endTime: getMeetingElapsedSeconds(),
                },
              ]
            : speakerTimelineRef.current;
          let readingSegments = segments;
          try {
            readingSegments = reconcileLiveTranscriptSegments({
              segments,
              activityWindows,
              echoEvidence,
            });
            const projector = liveConversationProjectorRef.current;
            if (projector) {
              const reading = reconcileLiveTranscriptReading({
                segments,
                activityWindows,
                echoEvidence,
              });
              onLiveConversation?.(
                projector.apply({ generation: eouGeneration, reading, reason }),
              );
            }
          } catch (error) {
            console.warn(
              '[Pluto] Live transcript presentation degraded',
              error,
            );
            const projector = liveConversationProjectorRef.current;
            if (projector)
              onLiveConversation?.(projector.degraded(eouGeneration));
          }
          if (reason === 'echo_evidence') {
            onLiveTranscript?.(readingSegments);
            return;
          }
          processedMicSegmentsRef.current = segments.map(
            toStoredLiveTranscriptCandidate,
          );
          liveTranscriptResponsivenessRef.current.publishAcceptedSegments(
            segments,
            () => {
              // Tentative native EOU rows are stable by id and are replaced in
              // place as recognition advances. Publish them in the primary
              // transcript instead of hiding first text in the faint footer.
              onLiveTranscript?.(readingSegments);
              onInterimTranscript?.('');
              meetingContextIngestion.accept(segments);
              const incrementalSegments = mergeConsecutiveSpeakerSegments(
                [...processedMicSegmentsRef.current].sort(
                  (left, right) => left.startTime - right.startTime,
                ),
              );
              const sourceCharacterCount = incrementalSegments.reduce(
                (total, segment) => total + segment.text.length,
                0,
              );
              if (
                fasterNotesEnabledRef.current !== false &&
                !liveTranscriptionRecovering &&
                shouldOfferIncrementalMeetingNotes({
                  sourceCharacterCount,
                  lastOfferedCharacterCount:
                    incrementalNotesOfferedCharactersRef.current,
                })
              ) {
                incrementalNotesOfferedCharactersRef.current =
                  sourceCharacterCount;
                void window.ipcRenderer
                  .invoke('MEETING_NOTES_OFFER_INCREMENTAL', {
                    meetingId,
                    segments: incrementalSegments.map((segment) => ({
                      speaker: segment.speaker,
                      text: segment.text,
                    })),
                    userNotes,
                    liveTranscriptHealthy: true,
                  })
                  .catch(() => undefined);
              }
            },
          );
          onLiveTranscriptIntegrityChange?.('healthy');
        },
        onUnavailable: (code) => {
          if (
            currentMeetingIdRef.current !== meetingId ||
            eouGenerationRef.current !== eouGeneration
          )
            return;
          console.warn(`[Pluto] Live Parakeet EOU unavailable: ${code}`);
          void window.ipcRenderer
            .invoke('MEETING_NOTES_CANCEL_INCREMENTAL', { meetingId })
            .catch(() => undefined);
          onLiveTranscriptIntegrityChange?.('lagging');
          const projector = liveConversationProjectorRef.current;
          if (projector)
            onLiveConversation?.(
              projector.recovering(eouGeneration, 'reconnecting'),
            );
        },
      });
      eouSessionRef.current = eouSession;
      void eouSession.start().catch((err) => {
        console.warn(
          '[Pluto] Live Parakeet EOU start deferred/unavailable:',
          err,
        );
      });

      recordingEndedAtRef.current = 0;
      stopInFlightRef.current = false;
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
        liveConversationProjectorRef.current = null;
        liveTranscriptResponsivenessRef.current.abortStart();
        frozenLiveTranscriptResponsivenessRef.current = null;
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        stopInFlightRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);
        return {
          admitted: false,
          state: 'starting',
          reason: 'microphone_unavailable',
        };
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
        micResamplerRef.current = createAudioResampler({
          inputSampleRate: audioContext.sampleRate,
          outputSampleRate: AUDIO_TARGET_SAMPLE_RATE,
        });
        micPcmSampleRateRef.current = AUDIO_TARGET_SAMPLE_RATE;
        micPcmChunksRef.current = [];
        try {
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          const sink = audioContext.createGain();
          sink.gain.value = 0.00001;
          processor.onaudioprocess = (evt: AudioProcessingEvent) => {
            const input = evt.inputBuffer.getChannelData(0);
            if (!input || input.length === 0) return;
            // Retain for PCM contract compatibility: const copied = new Float32Array(input);
            const resampled = micResamplerRef.current
              ? micResamplerRef.current.process(input)
              : new Float32Array(input);
            if (resampled.length === 0) return;
            const copied = new Float32Array(resampled);
            micPcmChunksRef.current.push(copied);
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
            `[Pluto] Mic PCM chunk capture active at ${audioContext.sampleRate}Hz -> ${AUDIO_TARGET_SAMPLE_RATE}Hz`,
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

      // System Audio: settle the PCM proof before synchronized recording starts.
      try {
        const nativeStarted = await nativeAudioStartPromise;
        hasSystemRecorderRef.current = nativeStarted === true;
        if (!nativeStarted) {
          throw new Error('Native system audio capture did not produce PCM');
        }
        console.log('[Pluto] Native AudioCap started & listening.');
      } catch (sysErr) {
        hasSystemRecorderRef.current = false;
        systemLiveness.stop();
        nativeAudioUnsubscribeRef.current?.();
        nativeAudioUnsubscribeRef.current = null;
        markSystemCaptureFailed();
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
      incrementalNotesOfferedCharactersRef.current = 0;
      micPcmChunksRef.current = [];
      systemPcmCarryoverBytesRef.current = new Uint8Array(0);
      systemPcmSampleRateRef.current = 48000;
      systemChunkDecodeDropCountRef.current = 0;
      systemRmsRef.current = 0;
      systemRmsUpdatedAtRef.current = 0;
      speakerTimelineRef.current = [];
      activeSpeakerWindowRef.current = null;
      zeroMicChunkStreakRef.current = 0;
      micChunkConversionFailuresRef.current = 0;
      disableMicChunkTranscriptionRef.current = false;
      micWebmInitSegmentRef.current = null;

      const startMicMediaRecorder = async (
        stream: MediaStream,
        allowBeforeRecording = false,
      ): Promise<boolean> => {
        const oldRecorder = micRecorderRef.current;
        if (oldRecorder) {
          const stopped = await waitForMediaRecorderStop(oldRecorder, 500);
          if (!stopped) {
            console.warn(
              '[Pluto] Timed out stopping microphone recorder during device reconfiguration',
            );
            return false;
          }
          await captureActivitySessionRef.current?.drain();
        }
        if (
          (!allowBeforeRecording && !isRecordingRef.current) ||
          stopInFlightRef.current
        ) {
          return false;
        }
        const micRecorder = new MediaRecorder(stream, getRecorderOptions());
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
            const chunkDurationSec = Math.max(0.2, chunkEndSec - chunkStartSec);
            // Native AudioCap normalizes output to fixed 48kHz Float32 mono PCM.
            // Keep sample rate fixed at 48000; do not infer from sample count / wall time.
            systemPcmSampleRateRef.current = 48000;
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
              const intervalPcm = trimPcmLeadingOverflow(
                merged,
                48000,
                chunkDurationSec,
              );
              captureDiagnosticsRef.current.samplesPackaged +=
                intervalPcm.length;
              captureDiagnosticsRef.current.samplesTrimmed +=
                merged.length - intervalPcm.length;
              systemBlob = createWavBlob(intervalPcm, 48000, 1);
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
            });
          }
        };

        micRecorder.start(CHUNK_SECONDS * 1000);
        console.log('[Pluto] Microphone recording started.');
        return true;
      };
      startMicMediaRecorderRef.current = startMicMediaRecorder;

      if (micStream) {
        systemPcmCarryoverBytesRef.current = new Uint8Array(0);
        const recorderStarted = await startMicMediaRecorder(micStream, true);
        if (!recorderStarted) {
          throw new Error('microphone_recorder_start_failed');
        }
      }

      // Only expose the recording state once live PCM and durable microphone
      // capture are active. Until this point the UI remains in its explicit
      // starting state, so speech is not invited before it can be recorded.
      if (calendarEvent)
        await window.ipcRenderer.invoke(
          'MEETING_PREP_RECORDING_STARTED',
          meetingId,
        );
      onRecordingStarted?.(startTimeRef.current, meetingId);
      isRecordingRef.current = true;
      setIsRecording(true);
      publishCaptureLifecycle({ state: 'recording', meetingId });

      silenceWatchdogRef.current?.disarm();
      const watchdog = createSilenceWatchdog({
        silenceTimeoutMs: getSilenceTimeoutMs,
        calendarEndTimeMs: () => calendarEndTimeMsRef.current,
        isConferenceSilent: () => {
          const now = performance.now();
          const systemRmsAgeMs =
            systemRmsUpdatedAtRef.current > 0
              ? now - systemRmsUpdatedAtRef.current
              : Number.POSITIVE_INFINITY;
          const currentRms = systemRmsAgeMs <= 1000 ? systemRmsRef.current : 0;
          return currentRms < SPEAKING_RMS_THRESHOLD;
        },
        onTriggerAutoStop: (reason) => {
          console.log('[Pluto] Silence watchdog triggered auto-stop:', reason);
          stopSessionActionRef.current(reason);
        },
      });
      silenceWatchdogRef.current = watchdog;
      watchdog.start();

      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.addEventListener
      ) {
        if (activeDeviceChangeListenerRef.current) {
          navigator.mediaDevices.removeEventListener(
            'devicechange',
            activeDeviceChangeListenerRef.current,
          );
          activeDeviceChangeListenerRef.current = null;
        }
        const listener = () => handleDeviceChangeDebounced();
        activeDeviceChangeListenerRef.current = listener;
        navigator.mediaDevices.addEventListener('devicechange', listener);
      }
      return { admitted: true, meetingId };
    } catch (e) {
      console.error('[Pluto] Failed to start session', e);
      alert(
        'Recording could not start. Check microphone and system audio access in Settings, then try again. If it keeps failing, restart Pluto.',
      );
      silenceWatchdogRef.current?.disarm();
      silenceWatchdogRef.current = null;
      cancelSystemAudioHealthTimeoutRef.current?.();
      cancelSystemAudioHealthTimeoutRef.current = null;
      nativeAudioUnsubscribeRef.current?.();
      nativeAudioUnsubscribeRef.current = null;
      eouSessionRef.current?.cancel();
      eouSessionRef.current = null;
      meetingContextIngestionRef.current?.close();
      meetingContextIngestionRef.current = null;
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
      return {
        admitted: false,
        state: 'starting',
        reason: 'capture_start_failed',
      };
    } finally {
      startInFlightRef.current = false;
      onStartingChange?.(false);
      if (!isRecordingRef.current) {
        publishCaptureLifecycle({ state: 'idle' });
      }
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
      liveTranscriptResponsivenessRef.current.detectSpeech();
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
        micRms >= SPEAKING_RMS_THRESHOLD ||
        systemRms >= SPEAKING_RMS_THRESHOLD ||
        nextSpeaker !== null
      ) {
        silenceWatchdogRef.current?.recordSpeechActivity(Date.now());
      }

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

  const drainInFlightMicPcm = () => {
    if (micResamplerRef.current) {
      const flushed = micResamplerRef.current.flush();
      if (flushed && flushed.length > 0) {
        micPcmChunksRef.current.push(flushed);
      }
    }
  };

  const handleDeviceChangeReconfigure = async () => {
    if (isReconfiguringRef.current) {
      pendingReconfigureRef.current = true;
      return;
    }
    if (!isRecordingRef.current || stopInFlightRef.current) {
      return;
    }

    const reconfigureSessionId = currentMeetingIdRef.current;
    isReconfiguringRef.current = true;
    publishCaptureHealth({
      microphone: 'reconfiguring',
      systemAudio: systemAudioHealthRef.current,
      captureDurability: captureHealthRef.current.captureDurability,
    });

    try {
      drainInFlightMicPcm();

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
      if (micAnalyserRef.current) {
        micAnalyserRef.current.disconnect();
        micAnalyserRef.current = null;
      }
      if (micStreamRef.current) {
        for (const track of micStreamRef.current.getTracks()) {
          track.stop();
        }
        micStreamRef.current = null;
      }

      const newMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const isSessionAborted = () =>
        !isRecordingRef.current ||
        stopInFlightRef.current ||
        currentMeetingIdRef.current !== reconfigureSessionId;

      if (isSessionAborted()) {
        console.log(
          '[Pluto] Capture stopped while awaiting getUserMedia; stopping returned tracks',
        );
        for (const track of newMicStream.getTracks()) {
          track.stop();
        }
        return;
      }

      micStreamRef.current = newMicStream;

      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        )();
        audioContextRef.current = audioContext;
      }
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (isSessionAborted()) {
        console.log(
          '[Pluto] Capture stopped while resuming audioContext; stopping returned tracks',
        );
        for (const track of newMicStream.getTracks()) {
          track.stop();
        }
        return;
      }

      micResamplerRef.current = createAudioResampler({
        inputSampleRate: audioContext.sampleRate,
        outputSampleRate: AUDIO_TARGET_SAMPLE_RATE,
      });
      micPcmSampleRateRef.current = AUDIO_TARGET_SAMPLE_RATE;

      const micSource = audioContext.createMediaStreamSource(newMicStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const sink = audioContext.createGain();
      sink.gain.value = 0.00001;

      processor.onaudioprocess = (evt: AudioProcessingEvent) => {
        const input = evt.inputBuffer.getChannelData(0);
        if (!input || input.length === 0) return;
        // Retain for PCM contract compatibility: const copied = new Float32Array(input);
        const resampled = micResamplerRef.current
          ? micResamplerRef.current.process(input)
          : new Float32Array(input);
        if (resampled.length === 0) return;
        const copied = new Float32Array(resampled);
        micPcmChunksRef.current.push(copied);
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

      startSpeakingMonitor(audioContext, newMicStream);

      // Recreate MediaRecorder with the new stream to preserve the 5-second journal cadence
      if (startMicMediaRecorderRef.current) {
        const recorderStarted =
          await startMicMediaRecorderRef.current(newMicStream);
        if (!recorderStarted && !isSessionAborted()) {
          throw new Error('microphone_recorder_reconnect_failed');
        }
      }

      if (isSessionAborted()) {
        console.log(
          '[Pluto] Capture stopped while starting replacement recorder; stopping tracks and cleaning nodes',
        );
        for (const track of newMicStream.getTracks()) {
          track.stop();
        }
        processor.onaudioprocess = null;
        processor.disconnect();
        micSource.disconnect();
        sink.disconnect();
        return;
      }

      publishCaptureHealth({
        microphone: 'healthy',
        systemAudio: systemAudioHealthRef.current,
        captureDurability: captureHealthRef.current.captureDurability,
      });
      console.log(
        `[Pluto] Mic reconnected successfully at ${audioContext.sampleRate}Hz -> ${AUDIO_TARGET_SAMPLE_RATE}Hz`,
      );
    } catch (reconnectErr) {
      console.warn(
        '[Pluto] Failed to reconnect microphone dynamically:',
        reconnectErr,
      );
      publishCaptureHealth({
        microphone: 'warning',
        systemAudio: systemAudioHealthRef.current,
        captureDurability: captureHealthRef.current.captureDurability,
      });
    } finally {
      isReconfiguringRef.current = false;
      if (pendingReconfigureRef.current) {
        pendingReconfigureRef.current = false;
        void handleDeviceChangeReconfigure();
      }
    }
  };

  const handleDeviceChangeDebounced = () => {
    if (!isRecordingRef.current) return;
    if (reconfigureDeviceTimeoutRef.current) {
      clearTimeout(reconfigureDeviceTimeoutRef.current);
    }
    reconfigureDeviceTimeoutRef.current = setTimeout(() => {
      reconfigureDeviceTimeoutRef.current = null;
      void handleDeviceChangeReconfigure();
    }, deviceChangeDebounceMs);
  };

  const stopAllTracks = () => {
    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.removeEventListener &&
      activeDeviceChangeListenerRef.current
    ) {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        activeDeviceChangeListenerRef.current,
      );
      activeDeviceChangeListenerRef.current = null;
    }
    if (reconfigureDeviceTimeoutRef.current) {
      clearTimeout(reconfigureDeviceTimeoutRef.current);
      reconfigureDeviceTimeoutRef.current = null;
    }
    drainInFlightMicPcm();
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

  const SPEAKING_RMS_THRESHOLD = TRANSCRIPTION_TUNING.speaking.rmsThreshold;
  const SPEAKING_RATIO = TRANSCRIPTION_TUNING.speaking.ratio;
  const SPEAKING_MIN_INTERVAL_MS = TRANSCRIPTION_TUNING.speaking.minIntervalMs;
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

  const mergeConsecutiveSpeakerSegments = (
    segments: TranscriptionSegment[],
  ): TranscriptionSegment[] => {
    const merged: TranscriptionSegment[] = [];
    for (const segment of segments) {
      const prior = merged.at(-1);
      if (prior?.speaker === segment.speaker) {
        prior.text = `${prior.text.trim()} ${segment.text.trim()}`.trim();
        prior.endTime = Math.max(prior.endTime, segment.endTime);
      } else {
        merged.push({ ...segment });
      }
    }
    return merged;
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

  const stopSession = async (endReason?: string) => {
    silenceWatchdogRef.current?.disarm();
    silenceWatchdogRef.current = null;

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
    startStopToValidatedLatencyAfterAcceptedStop({
      acceptedStop: stopSnapshot,
      accumulator: stopToValidatedLatencyRef.current,
      nowMs: performance.now(),
    });

    stopInFlightRef.current = true;
    publishCaptureLifecycle({
      state: 'sealing',
      meetingId: stopSnapshot.meetingId,
    });
    recordingEndedAtRef.current = stopSnapshot.recordingEndedAtMs;
    isProcessingRef.current = true;
    console.log(
      '[Pluto] Stopping session...',
      endReason ? `(reason: ${endReason})` : '',
    );
    setIsProcessing(true);
    onFinalizationStarted?.({
      id: stopSnapshot.meetingId,
      title: userTitle.trim() || 'Meeting',
      startedAt: new Date(stopSnapshot.recordingStartedAtMs).toISOString(),
      endedAt: new Date(stopSnapshot.recordingEndedAtMs).toISOString(),
      durationSeconds: Math.max(
        0,
        Math.round(
          (stopSnapshot.recordingEndedAtMs -
            stopSnapshot.recordingStartedAtMs) /
            1_000,
        ),
      ),
      userNotes,
    });

    const eouSessionAtStop = eouSessionRef.current;
    eouSessionRef.current = null;
    const meetingContextIngestionAtStop = meetingContextIngestionRef.current;
    meetingContextIngestionRef.current = null;

    let primaryAudioPath = '';
    let systemAudioPath = '';
    let mixedAudioPath = '';
    let rebuiltSystemAudioPath = '';
    let sealedActivityEvidence: CaptureActivityEvidence | null = null;
    let provisionalMeetingPersisted = false;
    let captureOwnershipReleased = false;
    const micFormatAtStop = getMicFormat();

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
      nativeAudioUnsubscribeRef.current?.();
      nativeAudioUnsubscribeRef.current = null;

      // The capture journal owns disk-backed system chunks. Do not retain or
      // concatenate a second session-length PCM copy in the renderer.
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
      try {
        await eouSessionAtStop?.finish();
      } catch (err) {
        console.warn('[Pluto] EOU finish failed or timed out:', err);
      } finally {
        meetingContextIngestionAtStop?.close();
      }
      const liveConversationProjectorAtStop =
        liveConversationProjectorRef.current;
      liveConversationProjectorRef.current = null;
      if (liveConversationProjectorAtStop)
        onLiveConversation?.(
          liveConversationProjectorAtStop.finish(eouGenerationRef.current),
        );
      frozenLiveTranscriptResponsivenessRef.current =
        liveTranscriptResponsivenessRef.current.freezeBeforeFinalization();
      eouGenerationRef.current += 1;
      pendingMicChunksRef.current.clear();
      pendingSystemChunksRef.current.clear();
      zeroMicChunkStreakRef.current = 0;

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
        alert(getTerminalRecordingFailureMessage());
        return;
      }
      sealedActivityEvidence = journalSealOutcome.activityEvidence;
      const sealedActivityHandoff = createSealedCaptureActivityHandoff(
        journalSealOutcome.activityEvidence,
      );
      const capturedLiveSegments = [...processedMicSegmentsRef.current].sort(
        (left, right) => left.startTime - right.startTime,
      );
      const capturedSegments =
        mergeConsecutiveSpeakerSegments(capturedLiveSegments);
      const capturedVocabulary = {
        terms: [...transcriptionVocabularyRef.current.terms],
        provenance: { ...transcriptionVocabularyRef.current.provenance },
      };
      const capturedResponsiveness =
        frozenLiveTranscriptResponsivenessRef.current ?? undefined;
      const captureGeneration =
        captureJournalStateRef.current?.generation ?? '';
      const meetingTiming = buildMeetingTiming(stopSnapshot);
      const pipelineMode: TranscriptPipelineMode = 'canonical_session_v2';
      const speakerAttribution: StoredTranscriptSpeakerAttribution =
        buildTranscriptSpeakerAttribution({
          diarizationEnabled: false,
          diarizationAttempted: false,
          fallbackReason: 'diarization_disabled',
        });
      const manualRemoteSpeakerCount = new Set(
        participants.map((participant) => participant.trim()).filter(Boolean),
      ).size;
      const speakerCountHint =
        manualRemoteSpeakerCount > 0
          ? {
              source: 'manual_participants' as const,
              remoteSpeakerCount: manualRemoteSpeakerCount,
            }
          : undefined;
      const buildProvisionalTranscriptJson = (canonicalSource: 'mic' | 'mix') =>
        JSON.stringify(
          buildTranscriptJsonPayload(capturedSegments, {
            liveSegments: capturedLiveSegments,
            pipelineMode,
            canonicalSource,
            postHydrationBleedPass: false,
            transcription: {
              backend: String(resolvedTranscriptionSettings.liveEngine),
              preset: String(resolvedTranscriptionSettings.preset),
              model: 'parakeet-tdt-0.6b-v3',
              device: 'coreml',
              computeType: String(resolvedTranscriptionSettings.computeType),
              diarization: false,
              elapsedMs: 0,
              vocabularyHintPolicyVersion:
                capturedVocabulary.provenance.policyVersion,
              vocabularyHintCount: capturedVocabulary.provenance.hintCount,
              vocabularyTerms: capturedVocabulary.terms,
            },
            speakerAttribution,
            speakerCountHint,
            liveTranscriptResponsiveness: capturedResponsiveness,
            lifecycleStatus: 'provisional',
          }),
        );
      const provisionalMeeting = {
        id: stopSnapshot.meetingId,
        title: userTitle || 'Meeting',
        meeting_type: 'Recording',
        started_at: meetingTiming.startedAtIso,
        ended_at: meetingTiming.endedAtIso,
        duration_seconds: meetingTiming.durationSeconds,
        audio_path: null,
        system_audio_path: null,
        mixed_audio_path: null,
        transcript_status: 'provisional',
        transcript_validated_at: null,
        transcript_json: buildProvisionalTranscriptJson('mic'),
        user_notes: userNotes,
        enhanced_notes: null,
        analysis_json: null,
        value_signals_json: null,
        participants,
        capture_journal_generation: captureGeneration || null,
        folder_id: null,
        is_favorite: false,
        end_reason: endReason || 'manual',
        finalization_status: 'processing',
        finalization_error_category: null,
      };
      const provisionalIntegrity = {
        schemaVersion: 2,
        state: 'provisional',
        causes: [],
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: sealedActivityEvidence.digestSha256,
        },
        activityEvidence: sealedActivityEvidence,
      };
      const insertedProvisional = await sealedActivityHandoff.persistMeeting(
        provisionalMeeting,
        provisionalIntegrity,
        async (meeting) =>
          await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
      );
      if (insertedProvisional === false) {
        onSessionComplete?.(stopSnapshot.meetingId);
        return;
      }
      provisionalMeetingPersisted = true;
      registerFinalTranscriptionVocabulary(
        stopSnapshot.meetingId,
        capturedVocabulary.terms,
      );
      onSessionComplete?.(stopSnapshot.meetingId);

      // The sealed journal and provisional row are the durable handoff. Capture
      // ownership is now free even though audio materialization and downstream
      // processing for this meeting continue in the background.
      if (currentMeetingIdRef.current === stopSnapshot.meetingId) {
        currentMeetingIdRef.current = null;
        liveConversationProjectorRef.current = null;
        onLiveConversation?.(null);
        stopInFlightRef.current = false;
        isProcessingRef.current = false;
        setIsProcessing(false);
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        captureOwnershipReleased = true;
        publishCaptureLifecycle({ state: 'idle' });
      }

      // Materialize both channels against the sealed meeting clock. The
      // browser mic blob is only a fallback because concatenating its chunks
      // can compress startup gaps and shift mic words ahead of System words.
      try {
        const rebuiltMicPath = await window.ipcRenderer.invoke(
          'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE',
          {
            meetingId: stopSnapshot.meetingId,
            source: 'mic',
            outputTag: `${stopSnapshot.meetingId}-session-mic-rebuilt`,
          },
        );
        if (rebuiltMicPath) primaryAudioPath = rebuiltMicPath;
      } catch (e) {
        console.warn('[Pluto] Sealed mic audio materialization failed:', e);
      }
      if (
        !primaryAudioPath &&
        captureJournalStateRef.current?.schemaVersion !== 4 &&
        micBlob &&
        micBlob.size > 0
      ) {
        try {
          const buffer = await micBlob.arrayBuffer();
          const maybePath = await window.ipcRenderer.invoke(
            'AUDIO_SAVE_AND_CONVERT',
            buffer,
            micFormatAtStop,
            `${stopSnapshot.meetingId}-session-mic`,
          );
          if (maybePath) primaryAudioPath = maybePath;
        } catch (e) {
          console.warn('[Pluto] Save failed:', e);
        }
      }
      try {
        const rebuiltSystemPath = await window.ipcRenderer.invoke(
          'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE',
          {
            meetingId: stopSnapshot.meetingId,
            source: 'system',
            outputTag: `${stopSnapshot.meetingId}-session-system-rebuilt`,
          },
        );
        if (rebuiltSystemPath) {
          rebuiltSystemAudioPath = rebuiltSystemPath;
          systemAudioPath = rebuiltSystemPath;
          console.log(
            '[Pluto] Materialized session-system from sealed capture',
          );
        }
      } catch (e) {
        console.warn('[Pluto] Sealed system audio materialization failed:', e);
      }
      if (primaryAudioPath && systemAudioPath) {
        try {
          const maybeMixed = await window.ipcRenderer.invoke('AUDIO_MIX_WAV', {
            inputPaths: [primaryAudioPath, systemAudioPath],
            outputTag: `${stopSnapshot.meetingId}-session-mix`,
            meetingId: stopSnapshot.meetingId,
          });
          if (maybeMixed) mixedAudioPath = maybeMixed;
        } catch (e) {
          console.warn('[Pluto] Mixed audio build failed:', e);
        }
      }
      if (!primaryAudioPath && !systemAudioPath && !mixedAudioPath) {
        throw new Error('sealed_audio_materialization_failed');
      }
      const materializedMeeting = {
        ...provisionalMeeting,
        audio_path: primaryAudioPath || null,
        system_audio_path: systemAudioPath || null,
        mixed_audio_path: mixedAudioPath || null,
        transcript_json: buildProvisionalTranscriptJson(
          mixedAudioPath ? 'mix' : 'mic',
        ),
      };
      await sealedActivityHandoff.persistMeeting(
        materializedMeeting,
        provisionalIntegrity,
        async (meeting) =>
          await window.ipcRenderer.invoke('SAVE_MEETING', meeting),
      );
      onSessionUpdated?.(stopSnapshot.meetingId);
      return;
    } catch (e) {
      console.error('[Pluto] Processing failed:', e);
      eouSessionAtStop?.cancel();
      if (provisionalMeetingPersisted) {
        onSessionUpdated?.(stopSnapshot.meetingId);
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
      if (!captureOwnershipReleased) {
        alert(`Failed to process recording: ${(e as Error).message}`);
        isRecordingRef.current = false;
        setIsRecording(false);
      }
    } finally {
      meetingContextIngestionAtStop?.close();
      if (!captureOwnershipReleased) {
        stopInFlightRef.current = false;
        stopToValidatedLatencyRef.current =
          createStopToValidatedLatencyAccumulator();
        startTimeRef.current = 0;
        recordingEndedAtRef.current = 0;
        isProcessingRef.current = false;
        setIsProcessing(false);
        if (currentMeetingIdRef.current === stopSnapshot.meetingId) {
          currentMeetingIdRef.current = null;
        }
        publishCaptureLifecycle({ state: 'idle' });
      }
    }
  };

  useEffect(() => {
    return attachCaptureUnloadGuard(window, {
      snapshot: () => captureLifecycleRef.current,
    });
  }, []);

  startSessionActionRef.current = startSession;
  stopSessionActionRef.current = stopSession;

  // Set up event listeners for external control (e.g., "End Meeting" button)
  useEffect(() => {
    const handleStopRecording = () => {
      console.log(
        '[Pluto] STOP_RECORDING event received, isRecording:',
        isRecordingRef.current,
      );
      if (isRecordingRef.current && !isProcessingRef.current) {
        stopSessionActionRef.current();
      }
    };
    const handleStartRecording = () => {
      console.log('[Pluto] START_RECORDING event received');
      if (!isRecordingRef.current && !isProcessingRef.current) {
        startSessionActionRef.current();
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
        silenceWatchdogRef.current?.disarm();
        silenceWatchdogRef.current = null;
        currentMeetingIdRef.current = null;
        eouSessionRef.current?.cancel();
        eouSessionRef.current = null;
        meetingContextIngestionRef.current?.close();
        meetingContextIngestionRef.current = null;
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
        nativeAudioUnsubscribeRef.current?.();
        nativeAudioUnsubscribeRef.current = null;
        window.ipcRenderer.invoke('NATIVE_AUDIO_STOP').catch(() => {});
      }
    };
    const unsubscribeMeetingDeleted = window.ipcRenderer.on(
      'MEETING_DELETED',
      handleMeetingDeleted,
    );

    return () => {
      silenceWatchdogRef.current?.disarm();
      silenceWatchdogRef.current = null;
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.removeEventListener &&
        activeDeviceChangeListenerRef.current
      ) {
        navigator.mediaDevices.removeEventListener(
          'devicechange',
          activeDeviceChangeListenerRef.current,
        );
        activeDeviceChangeListenerRef.current = null;
      }
      if (reconfigureDeviceTimeoutRef.current) {
        clearTimeout(reconfigureDeviceTimeoutRef.current);
        reconfigureDeviceTimeoutRef.current = null;
      }
      eouSessionRef.current?.cancel();
      eouSessionRef.current = null;
      liveConversationProjectorRef.current = null;
      meetingContextIngestionRef.current?.close();
      meetingContextIngestionRef.current = null;
      cancelSystemAudioHealthTimeoutRef.current?.();
      cancelSystemAudioHealthTimeoutRef.current = null;
      nativeAudioUnsubscribeRef.current?.();
      nativeAudioUnsubscribeRef.current = null;
      window.removeEventListener('STOP_RECORDING', handleStopRecording);
      window.removeEventListener('START_RECORDING', handleStartRecording);
      unsubscribeMeetingDeleted();
    };
  }, []);

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
