export type CaptureHealth = 'healthy' | 'warning' | 'unavailable';
export type LiveTranscriptIntegrity = 'healthy' | 'lagging';

export type LiveTranscriptSegment = {
  id: string;
  speaker: 'Me' | 'Them' | 'Unknown';
  text: string;
  timestampMs: number;
  confirmed: boolean;
};

export type RecordingWorkspaceInput = {
  startedAtMs: number | null;
  nowMs: number;
  isProcessing: boolean;
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
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

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const buildRecordingWorkspaceModel = (
  input: RecordingWorkspaceInput,
) => {
  const microphoneWarning = input.microphone !== 'healthy';
  const systemAudioWarning = input.systemAudio !== 'healthy';
  const transcriptWarning = input.liveTranscriptIntegrity === 'lagging';
  return {
    status: input.isProcessing
      ? ('processing' as const)
      : ('recording' as const),
    elapsedLabel: formatElapsed(
      input.startedAtMs ? input.nowMs - input.startedAtMs : 0,
    ),
    microphone: input.microphone,
    systemAudio: input.systemAudio,
    needsAttention:
      microphoneWarning || systemAudioWarning || transcriptWarning,
    statusMessage: microphoneWarning
      ? 'Microphone needs attention'
      : systemAudioWarning
        ? 'System audio needs attention'
        : transcriptWarning
          ? 'Your audio is recording, but live transcription is falling behind'
          : input.isProcessing
            ? 'Finalizing notes. Keep Pluto open.'
            : 'Capture is healthy',
    transcript: input.segments.filter((segment) => segment.text.trim()),
    interimText: input.interimText.trim(),
  };
};
