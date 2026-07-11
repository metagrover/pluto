export type CaptureHealth = 'healthy' | 'warning' | 'unavailable';

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
  segments: LiveTranscriptSegment[];
  interimText: string;
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
  return {
    status: input.isProcessing
      ? ('processing' as const)
      : ('recording' as const),
    elapsedLabel: formatElapsed(
      input.startedAtMs ? input.nowMs - input.startedAtMs : 0,
    ),
    microphone: input.microphone,
    systemAudio: input.systemAudio,
    needsAttention: microphoneWarning || systemAudioWarning,
    statusMessage: microphoneWarning
      ? 'Microphone needs attention'
      : systemAudioWarning
        ? 'System audio needs attention'
        : input.isProcessing
          ? 'Finalizing notes. Keep Pluto open.'
          : 'Capture is healthy',
    transcript: input.segments.filter((segment) => segment.text.trim()),
    interimText: input.interimText.trim(),
  };
};
