export type RecordingStopSnapshot = {
  meetingId: string;
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
};

type BeginRecordingFinalizationArgs = {
  meetingId: string | null;
  stopInFlight: boolean;
  recordingStartedAtMs: number;
  nowMs: number;
};

export const beginRecordingFinalization = ({
  meetingId,
  stopInFlight,
  recordingStartedAtMs,
  nowMs,
}: BeginRecordingFinalizationArgs): RecordingStopSnapshot | null => {
  if (!meetingId || stopInFlight) return null;

  const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : Date.now();
  const safeStart =
    Number.isFinite(recordingStartedAtMs) && recordingStartedAtMs > 0
      ? Math.floor(recordingStartedAtMs)
      : safeNow;

  return {
    meetingId,
    recordingStartedAtMs: safeStart,
    recordingEndedAtMs: Math.max(safeStart, safeNow),
  };
};

export const buildMeetingTiming = ({
  recordingStartedAtMs,
  recordingEndedAtMs,
}: Pick<
  RecordingStopSnapshot,
  'recordingStartedAtMs' | 'recordingEndedAtMs'
>) => {
  const safeStart = Math.max(0, Math.floor(recordingStartedAtMs));
  const safeEnd = Math.max(safeStart, Math.floor(recordingEndedAtMs));

  return {
    startedAtIso: new Date(safeStart).toISOString(),
    endedAtIso: new Date(safeEnd).toISOString(),
    durationSeconds: Math.floor((safeEnd - safeStart) / 1000),
  };
};

type ResolveFinalizationCleanupPathsArgs = {
  primaryAudioPath: string;
  systemAudioPath: string;
  rebuiltSystemAudioPath: string;
  mixedAudioPath: string;
  validationStatus: 'validated' | 'needs_attention';
};

export const collectDisposableRecordingArtifactPaths = (
  _paths: Omit<ResolveFinalizationCleanupPathsArgs, 'validationStatus'>,
): string[] => [];

export const resolveFinalizationCleanupPaths = ({
  primaryAudioPath,
  systemAudioPath,
  rebuiltSystemAudioPath,
  mixedAudioPath,
  validationStatus,
}: ResolveFinalizationCleanupPathsArgs): string[] => {
  if (validationStatus === 'needs_attention') return [];

  const retained = new Set(
    [
      primaryAudioPath,
      rebuiltSystemAudioPath || systemAudioPath,
      mixedAudioPath,
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );

  const cleanup = new Set<string>();
  if (
    systemAudioPath &&
    rebuiltSystemAudioPath &&
    systemAudioPath !== rebuiltSystemAudioPath &&
    !retained.has(systemAudioPath)
  ) {
    cleanup.add(systemAudioPath);
  }

  return [...cleanup];
};
