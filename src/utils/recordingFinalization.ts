import {
  type CaptureActivityEvidence,
  verifyCaptureActivityEvidence,
} from './transcriptActivityEvidence.ts';
import {
  type ResolvedBackendOptions,
  resolveBackendOptions,
} from './transcriptionBackendConfig.ts';
import type { TranscriptionSettings } from './transcriptionSettings.ts';

export type RecordingStopSnapshot = {
  meetingId: string;
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
};

export const canDeleteMeeting = (finalizationStatus?: string) =>
  finalizationStatus !== 'recovery_required';

export type SpeakerAttributionRetryPlan = {
  shouldRetry: boolean;
  reason:
    | 'diarization-disabled'
    | 'mapping-confident'
    | 'retry-already-used'
    | 'no-stronger-policy'
    | 'retry-with-stronger-policy';
  strongerOptions: ResolvedBackendOptions | null;
};

const STRONGEST_ATTRIBUTION_POLICY = resolveBackendOptions({
  backend: 'whisperx_tuned',
  preset: 'accuracy_first',
});

export const getStrongerSpeakerAttributionPolicy = (
  settings: Required<TranscriptionSettings>,
): ResolvedBackendOptions | null => {
  const current = resolveBackendOptions(settings);

  if (
    current.backend === STRONGEST_ATTRIBUTION_POLICY.backend &&
    current.preset === STRONGEST_ATTRIBUTION_POLICY.preset &&
    current.model === STRONGEST_ATTRIBUTION_POLICY.model &&
    current.device === STRONGEST_ATTRIBUTION_POLICY.device &&
    current.computeType === STRONGEST_ATTRIBUTION_POLICY.computeType
  ) {
    return null;
  }

  return STRONGEST_ATTRIBUTION_POLICY;
};

export const buildSpeakerAttributionRetryPlan = ({
  diarizationEnabled,
  mappingConfident,
  retryAlreadyUsed,
  providerHasStrongerPolicy = true,
  settings,
}: {
  diarizationEnabled: boolean;
  mappingConfident: boolean;
  retryAlreadyUsed: boolean;
  providerHasStrongerPolicy?: boolean;
  settings: Required<TranscriptionSettings>;
}): SpeakerAttributionRetryPlan => {
  if (!diarizationEnabled) {
    return {
      shouldRetry: false,
      reason: 'diarization-disabled',
      strongerOptions: null,
    };
  }

  if (mappingConfident) {
    return {
      shouldRetry: false,
      reason: 'mapping-confident',
      strongerOptions: null,
    };
  }

  if (retryAlreadyUsed) {
    return {
      shouldRetry: false,
      reason: 'retry-already-used',
      strongerOptions: null,
    };
  }

  if (!providerHasStrongerPolicy) {
    return {
      shouldRetry: false,
      reason: 'no-stronger-policy',
      strongerOptions: null,
    };
  }

  const strongerOptions = getStrongerSpeakerAttributionPolicy(settings);
  if (!strongerOptions) {
    return {
      shouldRetry: false,
      reason: 'no-stronger-policy',
      strongerOptions: null,
    };
  }

  return {
    shouldRetry: true,
    reason: 'retry-with-stronger-policy',
    strongerOptions,
  };
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

export const buildRecoverableSealFailureMeeting = ({
  snapshot,
  title,
  userNotes,
  endReason,
}: {
  snapshot: RecordingStopSnapshot;
  title?: string;
  userNotes?: string;
  endReason?: string;
}) => {
  const timing = buildMeetingTiming(snapshot);
  return {
    id: snapshot.meetingId,
    title: title?.trim() || 'Meeting',
    meeting_type: 'Recording',
    started_at: timing.startedAtIso,
    ended_at: timing.endedAtIso,
    duration_seconds: timing.durationSeconds,
    audio_path: null,
    system_audio_path: null,
    mixed_audio_path: null,
    transcript_status: 'needs_attention' as const,
    transcript_integrity_json: JSON.stringify({
      reasons: ['journal_seal_failed'],
    }),
    transcript_validated_at: null,
    transcript_json: JSON.stringify([]),
    user_notes: userNotes || '',
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    finalization_status: 'recovery_required' as const,
    finalization_error_category: 'journal_seal_failed' as const,
    folder_id: null,
    is_favorite: false,
    end_reason: endReason || 'journal_seal_failed',
  };
};

export type JournalSealResult =
  | { status: 'sealed'; activityEvidence: CaptureActivityEvidence }
  | {
      status: 'recovery_required';
      reason: 'capture_journal_write_failed' | 'capture_journal_seal_failed';
    };

export const sealCaptureJournalBeforeFinalization = async ({
  drainAppends,
  hasWriteFailure,
  seal,
}: {
  drainAppends: () => Promise<void>;
  hasWriteFailure: () => boolean;
  seal: () => Promise<{ activityEvidence?: CaptureActivityEvidence }>;
}): Promise<JournalSealResult> => {
  try {
    await drainAppends();
  } catch {
    return {
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    };
  }

  if (hasWriteFailure()) {
    return {
      status: 'recovery_required',
      reason: 'capture_journal_write_failed',
    };
  }

  try {
    const sealed = await seal();
    const activityEvidence = await verifyCaptureActivityEvidence(
      sealed.activityEvidence,
    );
    return { status: 'sealed', activityEvidence };
  } catch {
    return {
      status: 'recovery_required',
      reason: 'capture_journal_seal_failed',
    };
  }
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
