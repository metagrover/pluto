import {
  type CaptureActivityEvidence,
  verifyCaptureActivityEvidence,
} from './transcriptActivityEvidence.ts';
import type { ResolvedTranscriptionSettings } from './transcriptionSettings.ts';

export type RecordingStopSnapshot = {
  meetingId: string;
  recordingStartedAtMs: number;
  recordingEndedAtMs: number;
};

export const canDeleteMeeting = (finalizationStatus?: string) =>
  finalizationStatus !== 'recovery_required';

export const getTerminalRecordingFailureMessage = () =>
  "Recording saved, but Pluto couldn't finish the transcript.";

export type SpeakerAttributionRetryPlan = {
  shouldRetry: boolean;
  reason:
    | 'diarization-disabled'
    | 'mapping-confident'
    | 'retry-already-used'
    | 'no-stronger-policy'
    | 'retry-with-stronger-policy';
  strongerOptions: null;
};

export const getStrongerSpeakerAttributionPolicy = (
  _settings: ResolvedTranscriptionSettings,
): null => {
  return null;
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
  settings: ResolvedTranscriptionSettings;
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

export type CaptureJournalFinalizationFailure =
  | 'capture_journal_write_failed'
  | 'capture_journal_seal_failed';

export const buildRecoverableSealFailureMeeting = ({
  snapshot,
  title,
  userNotes,
  endReason,
  failureReason,
}: {
  snapshot: RecordingStopSnapshot;
  title?: string;
  userNotes?: string;
  endReason?: string;
  failureReason: CaptureJournalFinalizationFailure;
}) => {
  const timing = buildMeetingTiming(snapshot);
  const failureCategory =
    failureReason === 'capture_journal_write_failed'
      ? failureReason
      : 'journal_seal_failed';
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
      schemaVersion: 2,
      state: 'needs_attention',
      causes:
        failureReason === 'capture_journal_write_failed'
          ? [{ code: 'capture_journal_write_failed' }]
          : [
              {
                code: 'processing_stage_failed',
                stage: 'capture_seal',
              },
            ],
      evidenceProvenance: { kind: 'missing' },
    }),
    transcript_validated_at: null,
    transcript_json: JSON.stringify([]),
    user_notes: userNotes || '',
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    finalization_status: 'recovery_required' as const,
    finalization_error_category: failureCategory,
    folder_id: null,
    is_favorite: false,
    end_reason: endReason || failureCategory,
  };
};

export type JournalSealResult =
  | { status: 'sealed'; activityEvidence: CaptureActivityEvidence }
  | {
      status: 'recovery_required';
      reason: CaptureJournalFinalizationFailure;
    };

export const planForegroundTranscriptValidation = ({
  checkpointEvidenceVerified,
}: {
  checkpointEvidenceVerified: boolean;
}) => ({
  canonicalMode: 'checkpointed' as const,
  checkpointEvidenceVerified,
});

export const createSealedCaptureActivityHandoff = (
  activityEvidence: CaptureActivityEvidence,
) => ({
  activityWindows: activityEvidence.windows,
  integrity: {
    activityEvidenceSource: 'capture_activity_v2' as const,
    activityEvidence,
  },
  runValidation: async <Result>(
    validate: (windows: CaptureActivityEvidence['windows']) => Promise<Result>,
  ) => await validate(activityEvidence.windows),
  persistMeeting: async <Meeting extends Record<string, unknown>, Result>(
    meeting: Meeting,
    integrity: Record<string, unknown>,
    persist: (
      meeting: Meeting & { transcript_integrity_json: string },
    ) => Promise<Result>,
  ) =>
    await persist({
      ...meeting,
      transcript_integrity_json: JSON.stringify({
        ...integrity,
        ...(integrity.schemaVersion === 2
          ? {
              evidenceProvenance: {
                kind: 'sealed_capture_activity_v2',
                digestSha256: activityEvidence.digestSha256,
              },
            }
          : { activityEvidenceSource: 'capture_activity_v2' }),
        activityEvidence,
      }),
    }),
});

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
