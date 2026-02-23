import { Loader2, Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  computeRms,
  createWavBlob,
  decodeFloat32PcmChunk,
} from '../utils/audio';
import {
  applyTurnTakingHeuristics,
  assignSpeakersToCanonicalSegments,
  decideNextSpeaker,
  dropShortCrossSpeakerEchoes,
  reassignShortBoundarySegments,
  resolveCrossChannelDuplicates,
  shouldApplyFullSessionMeRecovery,
  shouldDropBySpeakerActivity,
  stripLikelyMeBleedSegments,
} from '../utils/speakerAttribution';

interface AudioManagerProps {
  onTranscript: (text: string) => void;
  onSessionComplete: (meetingId?: string | number) => void;
  onRecordingChange?: (isRecording: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onSpeakingChange?: (speaker: 'Me' | 'Them' | null) => void;
  userNotes?: string;
  userTitle?: string;
  participants?: string[];
  systemAudioStatus?: string;

  onStopSessionRef?: React.MutableRefObject<(() => void) | null>;
  onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
  onAnalyserReadyRef?: React.MutableRefObject<
    ((analyser: AnalyserNode) => void) | null
  >;
}

interface TranscriptionSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  speaker: string;
}

type MicChunkFormat = 'webm' | 'ogg' | 'wav';

interface PendingMicChunk {
  blob: Blob;
  format: MicChunkFormat;
  chunkStartSec: number;
  chunkEndSec: number;
}

interface SpeakerActivityWindow {
  startTime: number;
  endTime: number;
  speaker: 'Me' | 'Them';
}

type NativeAudioChunk =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | {
      buffer: ArrayBuffer;
      byteOffset?: number;
      byteLength: number;
      type?: string;
      data?: number[];
    }
  | null
  | undefined;

type NativeAudioListener = (_event: unknown, chunk: NativeAudioChunk) => void;

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
  markdown: string;
  analysis: AnalysisDocument;
  signals: InternalSignalDocument;
}

const emptyValueSignals = (): InternalSignalDocument => ({
  analysis_schema_version: 2,
  continuity: [],
  accountability_risks: [],
  decision_impacts: [],
  extra_tags: [],
});

const emptyAnalysisDocument = (): AnalysisDocument => ({
  analysis_schema_version: 2,
  summary: [],
  key_points: [],
  action_items: [],
  decisions: [],
  quality: {
    format_pass: false,
    retry_count: 1,
    fallback_used: true,
    issues: ['Missing analysis document'],
  },
});

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

const normalizeAnalysisDocument = (value: unknown): AnalysisDocument => {
  if (!value || typeof value !== 'object') {
    return emptyAnalysisDocument();
  }
  const record = value as Record<string, unknown>;
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

const analysisDocumentToMarkdown = (doc: AnalysisDocument): string => {
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

export const AudioManager = ({
  onTranscript,
  onSessionComplete,
  onRecordingChange,
  onProcessingChange,
  userNotes = '',
  userTitle = '',
  participants = [],
  onStopSessionRef,
  onStartSessionRef,
  onAnalyserReadyRef,
  onSpeakingChange,
  systemAudioStatus = 'unknown',
}: AudioManagerProps) => {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

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
  const nativeAudioListenerRef = useRef<NativeAudioListener | null>(null);
  const systemAudioChunkSeenRef = useRef(false);

  const speakingLoopRef = useRef<number | null>(null);
  const lastSpeakerRef = useRef<'Me' | 'Them' | null>(null);
  const lastSpeakerTsRef = useRef<number>(0);
  const speakerTimelineRef = useRef<SpeakerActivityWindow[]>([]);
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
  const processingQueueRef = useRef(Promise.resolve());
  const processedMicSegmentsRef = useRef<TranscriptionSegment[]>([]);
  const zeroMicChunkStreakRef = useRef(0);
  const micChunkConversionFailuresRef = useRef(0);
  const disableMicChunkTranscriptionRef = useRef(false);
  const micWebmInitSegmentRef = useRef<ArrayBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const visStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const isRecordingRef = useRef(false);
  const isProcessingRef = useRef(false);

  // Keep state refs in sync
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  // --- Native Capture Logic ---
  // Functions defined below, event listeners set up after

  const startSession = async () => {
    try {
      startTimeRef.current = Date.now();
      setIsRecording(true);

      console.log('[Pluto] Starting session (Robust Mic First)...');

      // 0. Preflight Permissions (Mic only)
      const micStatus = await window.ipcRenderer.invoke(
        'CHECK_MICROPHONE_PERMISSION',
      );
      if (micStatus !== 'granted') {
        window.dispatchEvent(
          new CustomEvent('SHOW_PERMISSION_OVERLAY', {
            detail: { micStatus },
          }),
        );
        setIsRecording(false);
        return;
      }

      // 1. System Audio Verification (Block start if unavailable)
      if (systemAudioStatus !== 'granted') {
        window.dispatchEvent(
          new CustomEvent('SHOW_PERMISSION_OVERLAY', {
            detail: { micStatus: 'granted', systemAudioStatus: 'needs-audio' },
          }),
        );
        setIsRecording(false);
        return;
      }

      // 2. Acquire Microphone Stream (Critical Path)
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
        alert('Failed to access microphone. Please check permissions.');
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

      // 3. Setup Audio Context & Visualizer (Immediate Feedback)
      const audioContext = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') await audioContext.resume();

      const visAnalyser = audioContext.createAnalyser();
      visAnalyser.fftSize = 256;
      setAnalyser(visAnalyser);

      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(visAnalyser);
        micPcmSampleRateRef.current = audioContext.sampleRate;
        micPcmChunksRef.current = [];
        try {
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          const sink = audioContext.createGain();
          sink.gain.value = 0;
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

      if (onAnalyserReadyRef?.current) onAnalyserReadyRef.current(visAnalyser);
      startSpeakingMonitor(audioContext, micStream);

      // 4. System Audio: Native AudioCap
      console.log('[Pluto] Starting Native AudioCap...');
      try {
        await window.ipcRenderer.invoke('NATIVE_AUDIO_START');
        hasSystemRecorderRef.current = true;
        systemAudioChunkSeenRef.current = false;

        // Setup Listener
        const handler: NativeAudioListener = (_event, chunk) => {
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
            } else if (
              chunk?.buffer instanceof ArrayBuffer &&
              typeof chunk.byteLength === 'number'
            ) {
              chunkBytes = new Uint8Array(
                chunk.buffer,
                chunk.byteOffset ?? 0,
                chunk.byteLength,
              );
            } else if (chunk?.type === 'Buffer' && Array.isArray(chunk.data)) {
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
                rawSampleRateEstimate <= 192000
              ) {
                systemPcmSampleRateRef.current = snapSampleRate(
                  rawSampleRateEstimate,
                );
              }
              if (index < 3) {
                console.log(
                  `[Pluto] System chunk #${index} sampleRate estimate: raw=${rawSampleRateEstimate.toFixed(0)}Hz, ` +
                    `using=${systemPcmSampleRateRef.current}Hz, samples=${totalLen}, duration=${chunkDurationSec.toFixed(2)}s`,
                );
              }
              systemBlob = createWavBlob(
                merged,
                systemPcmSampleRateRef.current,
                1,
              );
              // Clear for next chunk
              systemPcmChunksRef.current = [];
            }

            // Manually handle chunks
            handleChunkBlob(
              'mic',
              index,
              finalMicBlob,
              micChunkFormat,
              chunkStartSec,
              chunkEndSec,
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
            } else {
              // If no system audio, effectively "silence" - handleChunkBlob logic
              // expects to wait if hasSystemRecorderRef is true.
              // But for native capture, we might have pure silence if no output.
              // Send empty blob or nothing?
              // If we send nothing, 'handleChunkBlob' might hang waiting for it.
              // Let's create an empty 1-second silence WAV to keep pipeline flowing?
              // Or simpler: handleChunkBlob checks "micBlob && (systemBlob || !hasSystemRecorderRef)".
              // If hasSystemRecorderRef is true, we MUST provide a systemBlob.
              // So create dummy silence.
              const silence = new Float32Array(
                systemPcmSampleRateRef.current * 1,
              ); // 1 sec silence
              systemBlob = createWavBlob(
                silence,
                systemPcmSampleRateRef.current,
                1,
              );
              handleChunkBlob(
                'system',
                index,
                systemBlob,
                'wav',
                chunkStartSec,
                chunkEndSec,
              );
            }
          }
        };

        micRecorder.start(CHUNK_SECONDS * 1000);
        console.log('[Pluto] Microphone recording started.');
      }

      // 6. No restart loop needed
    } catch (e) {
      console.error('[Pluto] Failed to start session', e);
      setIsRecording(false);
    }
  };

  // Effect cleared - logic handled in standard recorder flow now
  useEffect(() => {
    // Intentionally empty - we removed IPC listener
  }, []);

  const getMeetingElapsedSeconds = (): number => {
    if (!startTimeRef.current) return 0;
    return Math.max(0, (Date.now() - startTimeRef.current) / 1000);
  };

  const flushActiveSpeakerWindow = (endTime: number) => {
    const active = activeSpeakerWindowRef.current;
    if (!active) return;
    if (endTime <= active.startTime) {
      activeSpeakerWindowRef.current = null;
      return;
    }
    speakerTimelineRef.current.push({
      startTime: active.startTime,
      endTime,
      speaker: active.speaker,
    });
    activeSpeakerWindowRef.current = null;
  };

  const recordSpeakerActivity = (
    nextSpeaker: 'Me' | 'Them' | null,
    nowTime: number,
  ) => {
    const active = activeSpeakerWindowRef.current;
    if (!active) {
      if (nextSpeaker) {
        activeSpeakerWindowRef.current = {
          speaker: nextSpeaker,
          startTime: nowTime,
        };
      }
      return;
    }

    if (nextSpeaker === active.speaker) {
      return;
    }

    flushActiveSpeakerWindow(nowTime);
    if (nextSpeaker) {
      activeSpeakerWindowRef.current = {
        speaker: nextSpeaker,
        startTime: nowTime,
      };
    }
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
      speakingLoopRef.current = requestAnimationFrame(tick);
    };
    speakingLoopRef.current = requestAnimationFrame(tick);
  };

  const stopAllTracks = () => {
    if (speakingLoopRef.current) {
      cancelAnimationFrame(speakingLoopRef.current);
      speakingLoopRef.current = null;
    }
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
      for (const t of micStreamRef.current.getTracks()) {
        t.stop();
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

  const RMS_WINDOW_SECONDS = 0.5;
  const SPEAKING_RMS_THRESHOLD = 0.012;
  const SPEAKING_RATIO = 1.25;
  const SPEAKING_MIN_INTERVAL_MS = 200;
  const SYSTEM_TRANSCRIBE_MIN_RMS = 0.002;
  // Shorter chunks improve turn-level recovery when one participant dominates long spans.
  const CHUNK_SECONDS = 8;
  const ENABLE_CHUNK_ARBITRATION = true;
  const COMMON_SAMPLE_RATES = [
    16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000,
  ];

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

  const snapSampleRate = (estimate: number): number => {
    if (!Number.isFinite(estimate) || estimate <= 0)
      return systemPcmSampleRateRef.current;
    let best = COMMON_SAMPLE_RATES[0];
    let bestDelta = Math.abs(estimate - best);
    for (const candidate of COMMON_SAMPLE_RATES) {
      const delta = Math.abs(estimate - candidate);
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }
    return best;
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
    const audioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!audioContextCtor) {
      throw new Error('AudioContext is not available');
    }
    const audioCtx = new audioContextCtor();
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

  const aggregateTranscriptQuality = (
    segments: TranscriptionSegment[],
  ): number => {
    if (segments.length === 0) return 0;
    let weightedScore = 0;
    let totalWeight = 0;
    for (const segment of segments) {
      const words = Math.max(
        1,
        normalizeTranscriptText(segment.text).split(' ').filter(Boolean).length,
      );
      const score = transcriptQualityScore(segment.text);
      weightedScore += score * words;
      totalWeight += words;
    }
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  };

  const shouldPreferSessionLexicalSource = (
    sessionSegments: TranscriptionSegment[],
    channelSegments: TranscriptionSegment[],
  ): boolean => {
    if (sessionSegments.length === 0) return false;
    if (channelSegments.length === 0) return true;

    const sessionQuality = aggregateTranscriptQuality(sessionSegments);
    const channelQuality = aggregateTranscriptQuality(channelSegments);
    const sessionWords = sessionSegments.reduce(
      (sum, segment) =>
        sum +
        normalizeTranscriptText(segment.text).split(' ').filter(Boolean).length,
      0,
    );

    if (sessionWords < 6) return false;
    // Prefer session text by default; fall back to channel text only when session
    // lexical quality is substantially worse.
    return sessionQuality + 0.45 >= channelQuality;
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
      if (micWords < 5) continue;

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

      if (bestSystemIndex < 0 || bestOverlapRatio < 0.45) continue;
      const system = systemSegments[bestSystemIndex];
      const systemWords = normalizeTranscriptText(system.text)
        .split(' ')
        .filter(Boolean).length;
      if (systemWords < 5) continue;

      const micQuality = transcriptQualityScore(mic.text);
      const systemQuality = transcriptQualityScore(system.text);
      const qualityDelta = micQuality - systemQuality;
      const systemLooksInformative = systemWords >= 6 && systemQuality >= 0.45;

      if (qualityDelta >= 0.28) {
        const strongMicEdge =
          qualityDelta >= 0.45 && micWords >= systemWords + 4;
        const shortSystemFragment = systemWords <= 3;
        if (!systemLooksInformative || strongMicEdge || shortSystemFragment) {
          removeSystem.add(bestSystemIndex);
          droppedSystem++;
        }
      } else if (qualityDelta <= -0.28) {
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
    const overlap = overlapSeconds(mic, system);
    if (overlap <= 0) return false;
    const micDur = Math.max(0.01, mic.endTime - mic.startTime);
    const sysDur = Math.max(0.01, system.endTime - system.startTime);
    const overlapRatio = overlap / Math.min(micDur, sysDur);
    if (isBleedDuplicate(mic, system)) return true;
    if (overlapRatio >= 0.62 || overlap >= 1.2) return true;
    if (overlapRatio < 0.45) return false;

    const tokenSim = tokenSimilarity(mic.text, system.text);
    const prefixSim = tokenPrefixSimilarity(mic.text, system.text);
    return tokenSim >= 0.28 || prefixSim >= 0.45;
  };

  const selectDominantSpeakerForPair = (
    mic: TranscriptionSegment,
    system: TranscriptionSegment,
    micRmsData: RmsData | null,
    systemRmsData: RmsData | null,
    chunkStartSec: number,
    preferredSpeaker: 'Me' | 'Them' | null,
  ): 'Me' | 'Them' => {
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
        meCoverage >= Math.max(0.8, themCoverage * 2.8) &&
        micWords >= sysWords + 4;
      return strongMeDominance ? 'Me' : 'Them';
    }

    if (meCoverage >= 0.2 && meCoverage >= themCoverage * 1.25) meScore += 2;
    if (themCoverage >= 0.2 && themCoverage >= meCoverage * 1.25)
      themScore += 2;

    const micRms = getSegmentWindowRms(micRmsData, mic.startTime, mic.endTime);
    const sysRms = getSegmentWindowRms(
      systemRmsData,
      system.startTime,
      system.endTime,
    );
    if (micRms !== null && sysRms !== null) {
      if (micRms >= sysRms * 1.2) meScore += 2;
      else if (sysRms >= micRms * 1.2) themScore += 2;
    }

    if (micWords >= sysWords + 3) meScore += 1;
    else if (sysWords >= micWords + 3) themScore += 1;
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
      if (overlapRatio < 0.2) {
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
        systemEnergy >= micEnergy * 1.15;
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
      if (overlapRatio < 0.2) {
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
        micEnergy >= systemEnergy * 1.15;
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
    const minCoverageSeconds = 0.35;

    if (meCoverage >= minCoverageSeconds && meCoverage >= themCoverage * 1.2)
      return 'Me';
    if (themCoverage >= minCoverageSeconds && themCoverage >= meCoverage * 1.2)
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

  const normalizeEnglishArtifacts = (text: string): string => {
    let next = text.trim();
    // Collapse duplicated leading token: "Let's let's" -> "Let's"
    next = next.replace(/^(\b[^\s]+\b)\s+\1\b/i, '$1');
    next = next.replace(/\blet['’]?s\s+let['’]?s\b/gi, "Let's");
    next = next.replace(/\bthat it\b/gi, "That's it");
    next = next.replace(
      /\bi['’]?m not again speaking\b/gi,
      "I'm now again speaking",
    );
    next = next.replace(/\ba more like\b/gi, 'more like');
    next = next.replace(
      /\bmore like ([A-Za-z0-9]+) and ([A-Za-z0-9]+)\b/g,
      'more like $1, $2',
    );
    return next;
  };

  const applyCanonicalLexicalHints = (
    canonicalSegments: TranscriptionSegment[],
    channelEvidenceSegments: TranscriptionSegment[],
  ): TranscriptionSegment[] => {
    return canonicalSegments.map((segment) => {
      let text = normalizeEnglishArtifacts(segment.text);
      const sameSpeakerEvidence = channelEvidenceSegments.filter(
        (candidate) =>
          candidate.speaker === segment.speaker &&
          (overlapSeconds(candidate, segment) > 0 ||
            Math.abs(candidate.startTime - segment.startTime) <= 1.6),
      );
      const oppositeSpeakerEvidence = channelEvidenceSegments.filter(
        (candidate) =>
          candidate.speaker !== segment.speaker &&
          candidate.speaker !== 'Unknown' &&
          candidate.endTime <= segment.startTime + 0.4 &&
          candidate.endTime >= segment.startTime - 2.2,
      );

      if (
        /my audio is getting appropriately captured/i.test(text) &&
        sameSpeakerEvidence.some((candidate) =>
          /or you are getting appropriately captured/i.test(candidate.text),
        )
      ) {
        text = text.replace(
          /my audio is getting appropriately captured/i,
          'my audio or your audio is getting appropriately captured',
        );
      }

      if (
        /\bmodel like\b/i.test(text) &&
        sameSpeakerEvidence.some((candidate) =>
          /\bmore like\b/i.test(candidate.text),
        )
      ) {
        text = text.replace(/\bmodel like\b/i, 'more like');
      }

      if (
        /^maybe\b/i.test(text) &&
        oppositeSpeakerEvidence.some((candidate) =>
          /\bthat it\b|\bthat\'s it\b/i.test(candidate.text),
        )
      ) {
        text = `That's it. ${text}`;
      }

      if (
        /\bnot sure\b/i.test(text) &&
        sameSpeakerEvidence.some((candidate) =>
          /\bnot sure how much i should share there\b/i.test(candidate.text),
        )
      ) {
        text = text.replace(
          /\b(i['’]?\s?m\s+)?not sure[^.?!]*there\b[.?!]?/i,
          'Not sure how much I should share there.',
        );
      }

      return {
        ...segment,
        text: normalizeEnglishArtifacts(text),
      };
    });
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
      const isDuplicate = recentForSpeaker.some((prev) => {
        const gap = segment.startTime - prev.endTime;
        if (gap > 2.5) return false;
        const prevNorm = normalizeTranscriptText(prev.text);
        if (!segNorm || !prevNorm) return false;
        if (segNorm === prevNorm) return true;
        return false;
      });

      if (isDuplicate) {
        dropped++;
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
    if (speakingLoopRef.current) {
      cancelAnimationFrame(speakingLoopRef.current);
      speakingLoopRef.current = null;
    }
    flushActiveSpeakerWindow(getMeetingElapsedSeconds());
    micAnalyserRef.current = null;
    lastSpeakerRef.current = null;
    lastSpeakerTsRef.current = 0;
    onSpeakingChange?.(null);
  };

  const enqueueBackgroundJob = (job: () => Promise<void>) => {
    processingQueueRef.current = processingQueueRef.current
      .then(job)
      .catch((e) => {
        console.error('[Pluto] Background transcription job failed:', e);
      });
  };

  const handleChunkBlob = (
    type: 'mic' | 'system',
    chunkIndex: number,
    chunkBlob: Blob,
    micFormat: MicChunkFormat = 'webm',
    chunkStartSec?: number,
    chunkEndSec?: number,
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

    if (micBlob && (systemBlob || !hasSystemRecorderRef.current)) {
      pendingMicChunksRef.current.delete(chunkIndex);
      if (systemBlob) pendingSystemChunksRef.current.delete(chunkIndex);

      enqueueBackgroundJob(() =>
        transcribeChunkPair({
          micBlob,
          micFormat: micFormatForChunk,
          systemBlob,
          chunkIndex,
          chunkStartSec: micPending.chunkStartSec,
          chunkEndSec: micPending.chunkEndSec,
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
  }) => {
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
    ) => {
      if (label === 'Me' && disableMicChunkTranscriptionRef.current) {
        return {
          segments: [],
          rms: null as RmsData | null,
          conversionFailed: false,
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
          return { segments: [], rms, conversionFailed: false };
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
              {
                diarize: false,
                language: 'en',
              },
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

      const result = await window.ipcRenderer.invoke(
        'WHISPER_TRANSCRIBE',
        wavPath,
        {
          diarize: false,
          language: 'en',
        },
      );
      // ... (rest of mapping logic same as before)
      const segments = result?.segments
        ? result.segments
            .filter((s: { text: string }) => isValidSegment(s.text))
            .map((s: { start: number; end: number; text: string }) => ({
              id: crypto.randomUUID(),
              startTime: s.start + chunkStartSec,
              endTime: s.end + chunkStartSec,
              text: s.text.trim(),
              speaker: label,
            }))
        : [];
      return { segments, rms, conversionFailed: false };
    };

    const [micResult, systemResult] = await Promise.all([
      processStream('Me', opts.micBlob, opts.micFormat),
      processStream('Them', opts.systemBlob, 'wav'),
    ]);
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

  const stopSession = async () => {
    console.log('[Pluto] Stopping session...');
    setIsProcessing(true);

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
      if (systemPcmChunksRef.current.length > 0) {
        // Merge remaining
        let totalLen = 0;
        for (const c of systemPcmChunksRef.current) totalLen += c.length;
        const merged = new Float32Array(totalLen);
        let offset = 0;
        for (const c of systemPcmChunksRef.current) {
          merged.set(c, offset);
          offset += c.length;
        }
        systemBlob = createWavBlob(merged, systemPcmSampleRateRef.current, 1);
        systemPcmChunksRef.current = [];
        console.log(`[Pluto] Finalized System Audio: ${systemBlob.size} bytes`);
      }

      // Stop all tracks
      stopAllTracks();

      // Reset refs
      micRecorderRef.current = null;
      micMimeTypeRef.current = null;
      micChunksRef.current = [];
      hasMicRecorderRef.current = false;
      hasSystemRecorderRef.current = false;

      // Cleanup visualization
      stopSpeakingMonitor();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (visStreamRef.current) {
        for (const t of visStreamRef.current.getTracks()) {
          t.stop();
        }
        visStreamRef.current = null;
      }
      setAnalyser(null);
      setIsRecording(false);

      // Process final chunks
      for (const [
        chunkIndex,
        micPending,
      ] of pendingMicChunksRef.current.entries()) {
        const sysB = pendingSystemChunksRef.current.get(chunkIndex);
        enqueueBackgroundJob(() =>
          transcribeChunkPair({
            micBlob: micPending.blob,
            micFormat: micPending.format,
            systemBlob: sysB,
            chunkIndex,
            chunkStartSec: micPending.chunkStartSec,
            chunkEndSec: micPending.chunkEndSec,
          }),
        );
      }
      pendingMicChunksRef.current.clear();
      pendingSystemChunksRef.current.clear();
      zeroMicChunkStreakRef.current = 0;

      // Wait for queue
      await processingQueueRef.current;

      // Store a single full audio file for playback
      let primaryAudioPath = '';
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
      // Notify completion
      // ... (rest of logic)

      // Wait for background chunk processing to finish
      await processingQueueRef.current;
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
      const chunkMeSegments = collectedSegments.filter(
        (segment) => segment.speaker === 'Me',
      );
      const chunkThemSegments = collectedSegments.filter(
        (segment) => segment.speaker === 'Them',
      );
      const hasChunkMeSegments = chunkMeSegments.length > 0;

      if (primaryAudioPath) {
        try {
          const fullMicResult = await window.ipcRenderer.invoke(
            'WHISPER_TRANSCRIBE',
            primaryAudioPath,
            {
              diarize: false,
              language: 'en',
            },
          );
          const recoveredMeSegments: TranscriptionSegment[] =
            fullMicResult?.segments
              ? fullMicResult.segments
                  .filter((s: { text: string }) => isValidSegment(s.text))
                  .map((s: { start: number; end: number; text: string }) => ({
                    id: crypto.randomUUID(),
                    startTime: s.start,
                    endTime: s.end,
                    text: s.text.trim(),
                    speaker: 'Me',
                  }))
              : [];
          fullSessionCanonicalSegments = fullMicResult?.segments
            ? fullMicResult.segments
                .filter((s: { text: string }) => isValidSegment(s.text))
                .map((s: { start: number; end: number; text: string }) => ({
                  id: crypto.randomUUID(),
                  startTime: s.start,
                  endTime: s.end,
                  text: s.text.trim(),
                  speaker: 'Me',
                }))
            : [];
          fullSessionValidationTexts = fullMicResult?.segments
            ? fullMicResult.segments
                .map((s: { text: string }) => (s.text || '').trim())
                .filter((text: string) => text.length > 0)
            : [];
          fullSessionRecoveredMeSegments = recoveredMeSegments;

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
              '[Pluto] Full session mic transcription returned no recoverable Me segments',
            );
          }
        } catch (recoveryErr) {
          console.error(
            '[Pluto] Failed to recover Me transcript from full session audio:',
            recoveryErr,
          );
        }
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
      const crossChannelSegments =
        crossChannelResolved.segments as TranscriptionSegment[];
      if (crossChannelResolved.stats.resolvedPairs > 0) {
        console.log(
          `[Pluto] Cross-channel duplicate resolver: candidates=${crossChannelResolved.stats.candidatePairs}, ` +
            `resolved=${crossChannelResolved.stats.resolvedPairs}, ` +
            `droppedMe=${crossChannelResolved.stats.droppedMe}, droppedThem=${crossChannelResolved.stats.droppedThem}`,
        );
      }
      const dedupedThemSegments = filterDuplicateSpeakerSegments(
        crossChannelSegments,
        'Them',
      );
      const dedupedSegments = filterDuplicateSpeakerSegments(
        dedupedThemSegments,
        'Me',
      );
      const echoTrimmedSegments = trimAdjacentCrossSpeakerEcho(dedupedSegments);
      const shortEchoPruned = dropShortCrossSpeakerEchoes({
        segments: echoTrimmedSegments as TranscriptionSegment[],
      });
      if (shortEchoPruned.dropped > 0) {
        console.log(
          `[Pluto] Dropped ${shortEchoPruned.dropped} short cross-speaker echo segments`,
        );
      }
      let finalizedSegments =
        shortEchoPruned.segments as TranscriptionSegment[];
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
        const meBleedStripped = stripLikelyMeBleedSegments(finalizedSegments);
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
      const noisyAttributionEvidence =
        passThroughCheck.probable ||
        crossChannelResolved.stats.resolvedPairs > 0 ||
        shortEchoPruned.dropped > 0;
      const preferSessionLexicalByQuality = shouldPreferSessionLexicalSource(
        fullSessionCanonicalSegments,
        finalizedSegments,
      );
      const preferSessionLexical =
        noisyAttributionEvidence || preferSessionLexicalByQuality;
      if (
        fullSessionCanonicalSegments.length > 0 &&
        finalizedSegments.length > 0 &&
        preferSessionLexical
      ) {
        const channelEvidenceForHints = finalizedSegments.map((segment) => ({
          ...segment,
        }));
        const canonicalForAttribution = splitCanonicalSegmentsForAttribution(
          fullSessionCanonicalSegments,
        );
        const canonicalAttribution = assignSpeakersToCanonicalSegments({
          canonicalSegments: canonicalForAttribution,
          attributedSegments: finalizedSegments,
          activityWindows: speakerTimelineRef.current,
        });
        const turnAdjusted = applyTurnTakingHeuristics(
          canonicalAttribution.segments as TranscriptionSegment[],
        );
        const boundaryAdjusted = reassignShortBoundarySegments({
          segments: turnAdjusted as TranscriptionSegment[],
        });
        const lexicalAdjusted = applyCanonicalLexicalHints(
          boundaryAdjusted as TranscriptionSegment[],
          channelEvidenceForHints,
        );
        if (lexicalAdjusted.length > 0) {
          finalizedSegments = lexicalAdjusted as TranscriptionSegment[];
          console.log(
            `[Pluto] Session-canonical hydration: segments=${lexicalAdjusted.length}, ` +
              `byOverlap=${canonicalAttribution.stats.byOverlap}, ` +
              `byActivity=${canonicalAttribution.stats.byActivity}, ` +
              `fallback=${canonicalAttribution.stats.byFallback}`,
          );
        }
      } else if (fullSessionCanonicalSegments.length > 0) {
        console.log(
          `[Pluto] Skipping session-canonical hydration: ${
            finalizedSegments.length === 0
              ? 'missing channel attribution context'
              : 'session lexical confidence lower than channel transcript'
          }`,
        );
      }

      // Merge consecutive segments from the same speaker
      const newTranscription: TranscriptionSegment[] = [];
      const MERGE_SAME_SPEAKER_GAP_SECONDS = 1;
      for (const segment of finalizedSegments) {
        const lastSegment = newTranscription[newTranscription.length - 1];
        const gapSeconds = lastSegment
          ? segment.startTime - lastSegment.endTime
          : Number.POSITIVE_INFINITY;

        if (
          lastSegment &&
          lastSegment.speaker === segment.speaker &&
          gapSeconds <= MERGE_SAME_SPEAKER_GAP_SECONDS
        ) {
          lastSegment.text = mergeSegmentText(
            lastSegment.text,
            segment.text,
            segment.speaker,
          );
          lastSegment.endTime = segment.endTime;
        } else {
          newTranscription.push({ ...segment });
        }
      }
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

        newTranscription.length = 0;
        for (const segment of rescueFinalizedSegments) {
          const lastSegment = newTranscription[newTranscription.length - 1];
          const gapSeconds = lastSegment
            ? segment.startTime - lastSegment.endTime
            : Number.POSITIVE_INFINITY;
          if (
            lastSegment &&
            lastSegment.speaker === segment.speaker &&
            gapSeconds <= MERGE_SAME_SPEAKER_GAP_SECONDS
          ) {
            lastSegment.text = mergeSegmentText(
              lastSegment.text,
              segment.text,
              segment.speaker,
            );
            lastSegment.endTime = segment.endTime;
          } else {
            newTranscription.push({ ...segment });
          }
        }

        mergedSpeakerCounts.me = 0;
        mergedSpeakerCounts.them = 0;
        for (const segment of newTranscription) {
          if (segment.speaker === 'Me') mergedSpeakerCounts.me++;
          if (segment.speaker === 'Them') mergedSpeakerCounts.them++;
        }
      } else if (
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
        `[Pluto] Merged: ${finalizedSegments.length} channel-first segments → ${newTranscription.length} merged segments`,
      );

      if (onTranscript && newTranscription.length > 0) {
        const fullText = newTranscription.map((s) => s.text).join(' ');
        onTranscript(fullText);
      }
      if (newTranscription.length === 0) {
        console.warn('[Pluto] No transcription segments from either source');
      }

      // 3. Generate Analysis V2 (canonical markdown + hidden signals)
      const fullTranscript = newTranscription
        .map((s) => `${s.speaker}: ${s.text}`)
        .join('\n');
      let enhancedNotes = '';
      let valueSignals = emptyValueSignals();
      let analysisDocument = emptyAnalysisDocument();

      try {
        const rawArtifacts = (await window.ipcRenderer.invoke(
          'GENERATE_ANALYSIS_V2',
          {
            transcript: fullTranscript,
            userNotes: userNotes,
          },
        )) as AnalysisArtifacts;

        analysisDocument = normalizeAnalysisDocument(rawArtifacts?.analysis);
        valueSignals = normalizeValueSignals(rawArtifacts?.signals);
        enhancedNotes =
          typeof rawArtifacts?.markdown === 'string'
            ? rawArtifacts.markdown
            : analysisDocumentToMarkdown(analysisDocument);

        if (!enhancedNotes.trim()) {
          enhancedNotes = analysisDocumentToMarkdown(analysisDocument);
        }

        console.log(
          '[Pluto] V2 analysis generated:',
          `formatPass=${analysisDocument.quality.format_pass},`,
          `retryCount=${analysisDocument.quality.retry_count},`,
          `fallback=${analysisDocument.quality.fallback_used},`,
          `continuity=${valueSignals.continuity.length},`,
          `accountability=${valueSignals.accountability_risks.length},`,
          `decisionImpact=${valueSignals.decision_impacts.length}`,
        );
      } catch (analysisErr) {
        console.error('[Pluto] V2 analysis generation failed:', analysisErr);
        analysisDocument = emptyAnalysisDocument();
        enhancedNotes = analysisDocumentToMarkdown(analysisDocument);
        valueSignals = emptyValueSignals();
      }

      // Relabel transcript segments with actual speaker names
      const labeledTranscription = newTranscription;

      // 4. Save to DB
      const duration = (Date.now() - (startTimeRef.current || 0)) / 1000;
      const startTime = new Date(
        startTimeRef.current || Date.now(),
      ).toISOString();
      const endTime = new Date().toISOString();

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

      const meetingData = {
        id: crypto.randomUUID(),
        title: title,
        meeting_type: 'Recording',
        started_at: startTime,
        ended_at: endTime,
        duration_seconds: Math.floor(duration),
        audio_path: primaryAudioPath,
        transcript_json: JSON.stringify(labeledTranscription),
        user_notes: userNotes,
        enhanced_notes: enhancedNotes,
        analysis_json: JSON.stringify(analysisDocument),
        analysis_schema_version: analysisDocument.analysis_schema_version,
        analysis_format_pass: analysisDocument.quality.format_pass,
        analysis_retry_count: analysisDocument.quality.retry_count,
        analysis_fallback_used: analysisDocument.quality.fallback_used,
        value_signals_json: JSON.stringify(valueSignals),
        participants: participants,
        folder_id: null,
        is_favorite: false,
      };

      await window.ipcRenderer.invoke('SAVE_MEETING', meetingData);
      console.log(
        '[Pluto] Session saved to DB with transcript segments:',
        labeledTranscription.length,
        'summary length:',
        enhancedNotes.length,
      );

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
      alert(`Failed to process recording: ${(e as Error).message}`);
      setIsRecording(false);
    } finally {
      setIsProcessing(false);
    }
  };

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
    return () => {
      window.removeEventListener('STOP_RECORDING', handleStopRecording);
      window.removeEventListener('START_RECORDING', handleStartRecording);
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

  const toggleSession = () => {
    if (isRecording) {
      stopSession();
    } else if (!isProcessing) {
      startSession();
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Waveform Visualizer + Recording Button */}
      <WaveformVisualizer
        analyser={analyser}
        isRecording={isRecording}
        isProcessing={isProcessing}
        onToggle={toggleSession}
      />

      {/* Local-First Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pro-border/40 shadow-sm">
          <div className="flex -space-x-1">
            <div className="w-1.5 h-1.5 rounded-full bg-pro-accent" />
            <div className="w-1.5 h-1.5 rounded-full bg-pro-accent/30 animate-pulse" />
          </div>
          <span className="text-[9px] font-bold text-pro-text-muted/60 uppercase tracking-widest">
            Local Session
          </span>
        </div>
      </div>
    </div>
  );
};

const WaveformVisualizer = ({
  analyser,
  isRecording,
  isProcessing,
  onToggle,
}: {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isProcessing: boolean;
  onToggle: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Timer logic
  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Visualize waveform
  useEffect(() => {
    if (!analyser || !canvasRef.current || !isRecording) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 48;
      const barWidth = 2;
      const gap = 3;
      const cornerRadius = 1;

      const totalWidth = barCount * (barWidth + gap);
      const startX = (canvas.width - totalWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * (dataArray.length / 2));
        const value = dataArray[dataIndex];
        const percent = value / 255;
        const barHeight = Math.max(2, percent * canvas.height * 0.8);

        const x = startX + i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;

        ctx.fillStyle = '#C6AA79'; // Pro Accent Gold

        // Draw rounded rect
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, cornerRadius);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, isRecording]);

  return (
    <div className="relative w-full group">
      {/* Premium Glass Card */}
      <div
        className={`
        relative w-full h-[280px] rounded-[2.5rem] overflow-hidden transition-all duration-700 ease-out
        border border-white/50 bg-gradient-to-b from-white/80 via-white/40 to-white/30 backdrop-blur-2xl
        shadow-[0_20px_40px_-12px_rgba(0,0,0,0.05)]
        ${isRecording ? 'shadow-[0_25px_50px_-12px_rgba(99,102,241,0.15)] ring-1 ring-pro-accent/20' : 'hover:shadow-[0_30px_60px_-12px_rgba(0,0,0,0.08)] hover:scale-[1.01]'}
      `}
      >
        {/* Subtle internal gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-white/40 pointer-events-none" />

        {/* Status Indicator (Top Center) */}
        <div className="absolute top-8 left-0 right-0 flex justify-center pointer-events-none">
          {isRecording ? (
            <div className="flex flex-col items-center gap-1 animate-in fade-in zoom-in duration-500">
              <span className="text-[10px] font-bold text-pro-accent uppercase tracking-[0.2em]">
                {formatTime(elapsed)}
              </span>
              <div className="flex items-center gap-1.5 opacity-60">
                <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[9px] font-bold text-pro-text-main">
                  REC
                </span>
              </div>
            </div>
          ) : (
            <span className="text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em]">
              Ready to Capture
            </span>
          )}
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 translate-y-2">
          {/* Visualization Area */}
          <div className="h-12 w-full flex items-center justify-center gap-1.5">
            {isRecording ? (
              <div className="relative w-full max-w-[200px] h-full opacity-80 mix-blend-multiply">
                <canvas
                  ref={canvasRef}
                  className="w-full h-full"
                  width={400}
                  height={56}
                />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 h-full opacity-20 group-hover:opacity-40 transition-opacity duration-500">
                {/* Static Equalizer (reacts to hover only) */}
                {['eq-1', 'eq-2', 'eq-3', 'eq-4', 'eq-5'].map((barKey) => (
                  <div
                    key={barKey}
                    className="w-1 rounded-full bg-pro-text-main transition-all duration-500 ease-out h-1 group-hover:h-2"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={onToggle}
            disabled={isProcessing}
            className={`
                  relative group/btn flex items-center justify-center gap-3 px-8 py-4 rounded-full font-black text-[11px] uppercase tracking-[0.2em] transition-all duration-300
                  ${
                    isProcessing
                      ? 'bg-pro-bg text-pro-text-muted cursor-not-allowed border border-pro-border'
                      : isRecording
                        ? 'bg-white text-pro-text-main shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 border border-transparent ring-2 ring-red-50/50'
                        : 'bg-pro-text-main text-white shadow-[0_10px_20px_-5px_rgba(0,0,0,0.2)] hover:shadow-[0_15px_30px_-5px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm'
                  }
                `}
          >
            {isProcessing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Processing</span>
              </>
            ) : isRecording ? (
              <>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                <span>Finish</span>
              </>
            ) : (
              <>
                <Mic
                  size={16}
                  className="text-white/80 group-hover/btn:scale-110 transition-transform"
                />
                <span>Start Session</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
