export type CaptureHealth = 'healthy' | 'warning' | 'unavailable';
export type LiveTranscriptIntegrity = 'healthy' | 'lagging';
export type CaptureHealthState = {
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
  captureDurability: CaptureHealth;
};

export type LiveTranscriptSegment = {
  id: string;
  speaker: 'Me' | 'Them' | 'Speaker' | 'Unknown';
  text: string;
  rawText?: string;
  source?: 'mic' | 'system';
  timestampMs: number;
  endTimestampMs?: number;
  confirmed: boolean;
  presentation?: {
    visibility: 'suppressed_echo';
    matchedSegmentId: string;
    confidence: number;
    reason: 'cross_channel_echo';
  };
};

export type RecordingWorkspaceInput = {
  startedAtMs: number | null;
  nowMs: number;
  isStarting: boolean;
  isProcessing: boolean;
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
  captureDurability: CaptureHealth;
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  segments: LiveTranscriptSegment[];
  interimText: string;
};

export const resolveSystemCaptureHealth = ({
  nativeStarted,
  validPcmSeen,
  timedOut = false,
}: {
  nativeStarted: boolean;
  validPcmSeen: boolean;
  timedOut?: boolean;
}): CaptureHealth => {
  if (!nativeStarted || timedOut) return 'unavailable';
  return validPcmSeen ? 'healthy' : 'warning';
};

export const scheduleSystemCaptureTimeout = (
  onTimeout: () => void,
  delayMs: number,
) => {
  const timeout = globalThis.setTimeout(onTimeout, delayMs);
  return () => globalThis.clearTimeout(timeout);
};

export const withCaptureDurabilityWarning = (
  health: CaptureHealthState,
): CaptureHealthState => ({
  ...health,
  captureDurability: 'warning',
});

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const buildRecordingWorkspaceModel = (
  input: RecordingWorkspaceInput,
) => {
  const microphoneWarning = input.microphone !== 'healthy';
  const systemAudioWarning = input.systemAudio !== 'healthy';
  const durabilityWarning = input.captureDurability !== 'healthy';
  const transcriptWarning = input.liveTranscriptIntegrity === 'lagging';
  const visibleTranscript = input.segments.filter(
    (segment) =>
      segment.text.trim() &&
      segment.presentation?.visibility !== 'suppressed_echo',
  );
  const newestTentativeId = visibleTranscript
    .filter((segment) => !segment.confirmed)
    .at(-1)?.id;
  return {
    status: input.isStarting
      ? ('starting' as const)
      : input.isProcessing
        ? ('processing' as const)
        : ('recording' as const),
    elapsedLabel: formatElapsed(
      input.startedAtMs ? input.nowMs - input.startedAtMs : 0,
    ),
    microphone: input.microphone,
    systemAudio: input.systemAudio,
    captureDurability: input.captureDurability,
    needsAttention:
      microphoneWarning ||
      systemAudioWarning ||
      durabilityWarning ||
      transcriptWarning,
    statusMessage: microphoneWarning
      ? 'Microphone needs attention'
      : systemAudioWarning
        ? 'System audio needs attention'
        : durabilityWarning
          ? 'Audio may still be recording, but crash recovery is no longer guaranteed'
          : transcriptWarning
            ? 'Your audio is recording, but live transcription is falling behind'
            : input.isStarting
              ? 'Preparing capture'
              : input.isProcessing
                ? 'Finalizing notes. Keep Pluto open.'
                : 'Capture is healthy',
    transcript: visibleTranscript.filter(
      (segment) => segment.confirmed || segment.id === newestTentativeId,
    ),
    interimText: input.interimText.trim(),
  };
};

export type RecordingFinalizationPreview = {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  userNotes: string;
};
