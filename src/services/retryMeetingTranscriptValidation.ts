import type { Meeting } from '../types.ts';
import { parseLiveTranscriptResponsivenessSummary } from '../utils/liveTranscriptResponsiveness.ts';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../utils/speakerAttribution.ts';
import { parseStopToValidatedLatencySummary } from '../utils/stopToValidatedLatency.ts';
import {
  type TranscriptActivityEvidenceFallbackSource,
  buildStoredTranscriptActivityEvidence,
  parseCaptureActivityEvidence,
  parseStoredTranscriptActivityEvidence,
} from '../utils/transcriptActivityEvidence.ts';
import type { TranscriptIntegrityReason } from '../utils/transcriptIntegrity.ts';
import {
  buildTranscriptJsonPayload,
  withTranscriptLifecycleStatus,
} from '../utils/transcriptSchema.ts';
import { runRecordingTranscriptValidation } from './recordingTranscriptValidation.ts';
import { reprocessAttributedMeeting } from './safeAttributionReprocessing.ts';
import {
  beginRetryLease,
  buildRetryDeadline,
  finishRetryLease,
  parseIntegrityRecord,
  readRetryLease,
} from './transcriptValidationRetryLease.ts';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export const shouldAutoProcessMeetingAnalysis = (
  meeting: Partial<Meeting> | null | undefined,
) => {
  if (
    !meeting ||
    (meeting.transcript_status !== 'needs_attention' &&
      meeting.transcript_status !== 'validated') ||
    meeting.finalization_status === 'recovery_required' ||
    Boolean(meeting.analysis_json || meeting.enhanced_notes) ||
    !meeting.transcript_json ||
    !(
      meeting.audio_path ||
      meeting.system_audio_path ||
      meeting.mixed_audio_path
    )
  ) {
    return false;
  }
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      causes?: Array<{ code?: unknown }>;
    };
    return !integrity.causes?.some(
      (cause) => cause.code === 'capture_gap_detected',
    );
  } catch {
    return false;
  }
};

const parseSegments = (value?: string): AttributionSegment[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const segments = Array.isArray(parsed)
      ? parsed
      : (parsed as { segments?: unknown[] })?.segments;
    if (!Array.isArray(segments)) return [];
    return segments.filter(
      (segment): segment is AttributionSegment =>
        Boolean(segment) &&
        typeof segment === 'object' &&
        typeof (segment as AttributionSegment).text === 'string',
    );
  } catch {
    return [];
  }
};

const readRunId = (meeting: Meeting): string | null => {
  try {
    const parsed = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      validation_run_id?: unknown;
    };
    return (
      readRetryLease(parsed)?.runId ??
      (typeof parsed.validation_run_id === 'string'
        ? parsed.validation_run_id
        : null)
    );
  } catch {
    return null;
  }
};

const readLiveTranscriptResponsiveness = (transcriptJson?: string | null) => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as Record<
      string,
      unknown
    >;
    return parseLiveTranscriptResponsivenessSummary(
      parsed.liveTranscriptResponsiveness,
    );
  } catch {
    return null;
  }
};

const readStopToValidatedLatency = (transcriptJson?: string | null) => {
  try {
    const parsed = JSON.parse(transcriptJson || '{}') as Record<
      string,
      unknown
    >;
    return parseStopToValidatedLatencySummary(parsed.stopToValidatedLatency);
  } catch {
    return null;
  }
};

const hadUnaccountedSpeech = (
  meeting: Meeting,
  reason: 'local_speech_unaccounted' | 'remote_speech_unaccounted',
  activityKey: 'micActivitySeconds' | 'systemActivitySeconds',
): boolean => {
  try {
    const parsed = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      reasons?: unknown;
      micActivitySeconds?: unknown;
      systemActivitySeconds?: unknown;
    };
    return (
      Array.isArray(parsed.reasons) &&
      parsed.reasons.includes(reason) &&
      typeof parsed[activityKey] === 'number' &&
      parsed[activityKey] >= 3
    );
  } catch {
    return false;
  }
};

type RetryActivityEvidenceSource =
  | TranscriptActivityEvidenceFallbackSource
  | 'capture_activity_v2'
  | 'capture_activity_unsupported';

const readStoredActivityWindows = async (
  meeting: Meeting,
  provisionalSegments: AttributionSegment[],
): Promise<{
  windows: SpeakerActivityWindow[];
  source: RetryActivityEvidenceSource;
  failureReason: TranscriptIntegrityReason | null;
  evidence?: unknown;
}> => {
  try {
    const parsed = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      activityEvidence?: unknown;
      activityEvidenceSource?: unknown;
      evidenceProvenance?: { kind?: unknown };
    };

    if (
      parsed.activityEvidenceSource === 'capture_activity_v2' ||
      parsed.evidenceProvenance?.kind === 'sealed_capture_activity_v2'
    ) {
      if (parsed.activityEvidence === undefined) {
        return {
          windows: [],
          source: 'capture_activity_missing',
          failureReason: 'capture_activity_missing',
        };
      }
      const verified = await parseCaptureActivityEvidence(
        parsed.activityEvidence,
      );
      if (!verified.ok) {
        const unsupported = verified.reason === 'unsupported';
        return {
          windows: [],
          source: unsupported
            ? 'capture_activity_unsupported'
            : 'capture_activity_corrupt',
          failureReason: unsupported
            ? 'capture_activity_unsupported'
            : 'capture_activity_corrupt',
        };
      }
      return {
        windows: verified.evidence.windows,
        source: 'capture_activity_v2',
        failureReason: null,
        evidence: verified.evidence,
      };
    }

    const priorSource =
      parsed.activityEvidenceSource === 'capture_activity_v1'
        ? 'capture_activity_v1'
        : parsed.activityEvidenceSource === 'legacy_provisional_segments'
          ? 'legacy_provisional_segments'
          : null;

    if (parsed.activityEvidenceSource !== undefined && priorSource === null) {
      const unsupported = typeof parsed.activityEvidenceSource === 'string';
      return {
        windows: [],
        source: unsupported
          ? 'capture_activity_unsupported'
          : 'capture_activity_corrupt',
        failureReason: unsupported
          ? 'capture_activity_unsupported'
          : 'capture_activity_corrupt',
      };
    }

    if (priorSource !== 'legacy_provisional_segments') {
      const stored = parseStoredTranscriptActivityEvidence(
        parsed.activityEvidence,
      );
      if (stored) {
        return {
          windows: stored.windows,
          source: stored.source,
          failureReason: null,
        };
      }
    }

    if (parsed.activityEvidence !== undefined) {
      return {
        windows: [],
        source: 'capture_activity_corrupt',
        failureReason: 'deterministic_retry_evidence_corrupt',
      };
    }

    if (priorSource === 'capture_activity_v1') {
      return {
        windows: [],
        source: 'capture_activity_missing',
        failureReason: 'deterministic_retry_evidence_missing',
      };
    }
  } catch {
    return {
      windows: [],
      source: 'capture_activity_corrupt',
      failureReason: 'deterministic_retry_evidence_corrupt',
    };
  }

  return {
    windows: provisionalSegments.map((segment) => ({
      startTime: segment.startTime,
      endTime: segment.endTime,
      speaker: segment.speaker === 'Them' ? 'Them' : 'Me',
    })),
    source: 'legacy_provisional_segments',
    failureReason: null,
  };
};

export const retryMeetingTranscriptValidation = async (
  meetingId: string | number,
  invoke: Invoke,
  options: { now?: () => number; validationTimeoutMs?: number } = {},
): Promise<{ status: 'validated' | 'needs_attention' | 'superseded' }> => {
  const meeting = (await invoke('GET_MEETING', meetingId)) as Meeting | null;
  if (!meeting) throw new Error('Meeting not found');
  if (meeting.transcript_status === 'validated' && meeting.analysis_json) {
    return { status: 'validated' };
  }

  const runId = crypto.randomUUID();
  const now = options.now?.() ?? Date.now();
  const deadline =
    now +
    (options.validationTimeoutMs ??
      buildRetryDeadline(now, meeting.duration_seconds || 0) - now);
  const lease = {
    runId,
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(deadline).toISOString(),
    stage: 'transcribing' as const,
  };
  const sourcePaths = {
    mic: meeting.audio_path || '',
    system: meeting.system_audio_path || '',
    mix: meeting.mixed_audio_path || '',
  };
  const provisionalSegments = parseSegments(meeting.transcript_json);
  const activityEvidence = await readStoredActivityWindows(
    meeting,
    provisionalSegments,
  );
  const priorIntegrity = parseIntegrityRecord(
    meeting.transcript_integrity_json,
  );
  const usesV2Trust = priorIntegrity.schemaVersion === 2;
  const recovery = usesV2Trust
    ? (priorIntegrity.recovery as
        | {
            source?: unknown;
            gapDetected?: unknown;
            journalSchemaVersion?: unknown;
            checkpointEvidenceVerified?: unknown;
          }
        | undefined)
    : undefined;
  if (recovery?.gapDetected === true) {
    return { status: 'needs_attention' };
  }
  const checkpointEvidenceProvenance = priorIntegrity.evidenceProvenance as
    | { kind?: unknown }
    | undefined;
  type CheckpointVerification = {
    generation?: unknown;
    segmentCount?: unknown;
    sourceCoverageSegments?: unknown;
  };
  let verifiedCheckpointEvidence: CheckpointVerification | null = null;
  const storedCheckpointCandidate =
    recovery?.source === 'capture_journal' &&
    recovery.journalSchemaVersion === 3 &&
    recovery.checkpointEvidenceVerified === true &&
    recovery.gapDetected === false &&
    provisionalSegments.length > 0 &&
    checkpointEvidenceProvenance?.kind === 'sealed_capture_activity_v2' &&
    typeof meeting.capture_journal_generation === 'string';
  if (storedCheckpointCandidate) {
    try {
      verifiedCheckpointEvidence = (await invoke(
        'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT',
        { meetingId: String(meeting.id) },
      )) as CheckpointVerification;
    } catch {
      verifiedCheckpointEvidence = null;
    }
  }
  const checkpointSourceSegments = Array.isArray(
    verifiedCheckpointEvidence?.sourceCoverageSegments,
  )
    ? verifiedCheckpointEvidence.sourceCoverageSegments
        .filter(
          (
            segment,
          ): segment is {
            startTime: number;
            endTime: number;
            speaker: 'Me' | 'Them';
          } =>
            Boolean(segment) &&
            typeof segment === 'object' &&
            Number.isFinite((segment as AttributionSegment).startTime) &&
            Number.isFinite((segment as AttributionSegment).endTime) &&
            (segment as AttributionSegment).endTime >
              (segment as AttributionSegment).startTime &&
            ((segment as AttributionSegment).speaker === 'Me' ||
              (segment as AttributionSegment).speaker === 'Them'),
        )
        .map((segment) => ({ ...segment, text: '' }))
    : [];
  const checkpointEvidenceVerified =
    storedCheckpointCandidate &&
    verifiedCheckpointEvidence?.generation ===
      meeting.capture_journal_generation &&
    verifiedCheckpointEvidence?.segmentCount === provisionalSegments.length &&
    checkpointSourceSegments.length > 0;
  let canonicalMode: 'checkpointed' | 'recovered_channels' | 'full_mix' =
    checkpointEvidenceVerified
      ? ('checkpointed' as const)
      : recovery?.source === 'capture_journal'
        ? ('recovered_channels' as const)
        : ('full_mix' as const);
  const claimed = await invoke(
    'SAVE_MEETING',
    {
      ...meeting,
      transcript_status: 'validating',
      transcript_json: withTranscriptLifecycleStatus(
        meeting.transcript_json,
        'validating',
      ),
      transcript_integrity_json: JSON.stringify(
        beginRetryLease(priorIntegrity, lease),
      ),
    },
    { claimValidationLease: lease },
  );
  if (claimed === false) return { status: 'superseded' };

  const runBeforeDeadline = async <T>(operation: Promise<T>): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('transcript_validation_retry_timeout')),
            Math.max(0, deadline - (options.now?.() ?? Date.now())),
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  const failCurrentRetry = async (
    failure: 'retry_timeout' | 'retry_failed',
  ) => {
    const failed = await invoke(
      'FAIL_TRANSCRIPT_VALIDATION_RETRY',
      meetingId,
      runId,
      failure,
    );
    await invoke('CANCEL_MEETING_TRANSCRIPTION', meetingId).catch(() => null);
    return failed === false
      ? ({ status: 'superseded' } as const)
      : ({ status: 'needs_attention' } as const);
  };
  let validation: Awaited<ReturnType<typeof runRecordingTranscriptValidation>>;
  const validateTranscript = (
    mode: 'checkpointed' | 'recovered_channels' | 'full_mix',
  ) =>
    runRecordingTranscriptValidation({
      meetingId: String(meeting.id),
      recordingDurationSeconds: meeting.duration_seconds || 0,
      micAudioPath: sourcePaths.mic,
      systemAudioPath: sourcePaths.system,
      mixAudioPath: sourcePaths.mix,
      provisionalSegments,
      checkpointSourceSegments:
        mode === 'checkpointed' ? checkpointSourceSegments : [],
      activityWindows: activityEvidence.windows,
      canonicalMode: mode,
      checkpointEvidenceVerified:
        mode === 'checkpointed' && checkpointEvidenceVerified,
      transcribe: async (audioPath, options) =>
        (await invoke('WHISPER_TRANSCRIBE', audioPath, options)) as {
          segments?: Array<{ start: number; end: number; text: string }>;
          meta?: Record<string, unknown>;
        },
      probeDuration: async (audioPath) =>
        (await invoke('AUDIO_PROBE_DURATION', audioPath)) as number | null,
    });
  try {
    validation = await runBeforeDeadline(validateTranscript(canonicalMode));
    if (
      canonicalMode === 'checkpointed' &&
      validation.status === 'needs_attention'
    ) {
      canonicalMode = 'recovered_channels';
      validation = await runBeforeDeadline(validateTranscript(canonicalMode));
    }
  } catch (error) {
    const failure =
      error instanceof Error &&
      error.message === 'transcript_validation_retry_timeout'
        ? 'retry_timeout'
        : 'retry_failed';
    return await failCurrentRetry(failure);
  }
  await invoke(
    'UPDATE_TRANSCRIPT_VALIDATION_RETRY_STAGE',
    meetingId,
    runId,
    'reviewing_evidence',
  ).catch(() => null);
  const reasons =
    activityEvidence.failureReason == null
      ? [...validation.reasons]
      : [...new Set([activityEvidence.failureReason, ...validation.reasons])];
  const storedActivityEvidence =
    activityEvidence.source === 'capture_activity_v1'
      ? buildStoredTranscriptActivityEvidence(activityEvidence.windows)
      : activityEvidence.source === 'capture_activity_v2'
        ? activityEvidence.evidence
        : undefined;
  const evidenceProvenance =
    activityEvidence.source === 'capture_activity_v2'
      ? {
          kind: 'sealed_capture_activity_v2',
          digestSha256: (
            activityEvidence.evidence as { digestSha256?: string } | undefined
          )?.digestSha256,
        }
      : activityEvidence.source === 'capture_activity_v1'
        ? { kind: 'stored_capture_activity_v1' }
        : activityEvidence.source === 'legacy_provisional_segments'
          ? { kind: 'legacy_provisional_segments' }
          : activityEvidence.source === 'capture_activity_missing'
            ? { kind: 'missing' }
            : activityEvidence.source === 'capture_activity_corrupt'
              ? { kind: 'corrupt' }
              : { kind: 'unsupported', sourceVersion: 'unknown' };
  const integrity = usesV2Trust
    ? {
        ...priorIntegrity,
        schemaVersion: 2,
        state: 'validating',
        causes: [],
        evidenceProvenance,
        ...(storedActivityEvidence
          ? { activityEvidence: storedActivityEvidence }
          : {}),
        evidence: validation.evidence,
        retry: { ...lease, stage: 'reviewing_evidence' as const },
      }
    : {
        ...validation.evidence,
        reasons,
        attempts: validation.attempts,
        activityEvidenceSource: activityEvidence.source,
        ...(storedActivityEvidence
          ? { activityEvidence: storedActivityEvidence }
          : {}),
        retry: { ...lease, stage: 'reviewing_evidence' as const },
      };

  const priorLocalSpeechStillMissing =
    hadUnaccountedSpeech(
      meeting,
      'local_speech_unaccounted',
      'micActivitySeconds',
    ) && validation.sourceSegmentCounts.mic === 0;
  const priorRemoteSpeechStillMissing =
    hadUnaccountedSpeech(
      meeting,
      'remote_speech_unaccounted',
      'systemActivitySeconds',
    ) && validation.sourceSegmentCounts.system === 0;
  if (
    validation.status === 'needs_attention' ||
    activityEvidence.failureReason != null ||
    priorLocalSpeechStillMissing ||
    priorRemoteSpeechStillMissing
  ) {
    if (
      priorLocalSpeechStillMissing &&
      !reasons.includes('local_speech_unaccounted')
    ) {
      reasons.push('local_speech_unaccounted');
    }
    if (
      priorRemoteSpeechStillMissing &&
      !reasons.includes('remote_speech_unaccounted')
    ) {
      reasons.push('remote_speech_unaccounted');
    }
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (readRunId(latest) !== runId) return { status: 'superseded' };
    const saved = await invoke(
      'SAVE_MEETING',
      {
        ...latest,
        transcript_status: 'needs_attention',
        transcript_json: withTranscriptLifecycleStatus(
          latest.transcript_json,
          'needs_attention',
        ),
        transcript_integrity_json: JSON.stringify(
          usesV2Trust
            ? {
                ...finishRetryLease(integrity),
                state: 'needs_attention',
                causes: reasons.map((code) => ({ code })),
                validationProof: undefined,
              }
            : finishRetryLease(integrity),
        ),
        transcript_validated_at: null,
        enhanced_notes: null,
        analysis_json: null,
        value_signals_json: null,
      },
      {
        expectedValidationRunId: runId,
        transcriptOwnedFieldsOnly: true,
      },
    );
    if (saved === false) return { status: 'superseded' };
    return { status: 'needs_attention' };
  }

  const current = (await invoke('GET_MEETING', meetingId)) as Meeting;
  if (readRunId(current) !== runId) return { status: 'superseded' };

  const transcript = validation.segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join('\n');
  const validatedAt = new Date().toISOString();
  const downstreamRunId = crypto.randomUUID();
  const validatedIntegrity = usesV2Trust
    ? {
        ...finishRetryLease(integrity),
        state: 'validated',
        causes: [],
        validationProof: {
          gateVersion: 'canonical_integrity_v1',
          validatedAt,
        },
      }
    : {
        ...integrity,
        retry: { ...lease, stage: 'saving' as const },
      };
  const canonicalReplacement = {
    ...current,
    transcript_status: 'validated',
    transcript_validated_at: validatedAt,
    transcript_integrity_json: JSON.stringify(validatedIntegrity),
    transcript_json: JSON.stringify(
      buildTranscriptJsonPayload(validation.segments, {
        pipelineMode: 'canonical_session_v2',
        canonicalSource:
          canonicalMode === 'recovered_channels' ||
          canonicalMode === 'checkpointed'
            ? 'recovered_channels'
            : 'mix',
        postHydrationBleedPass: false,
        liveTranscriptResponsiveness:
          readLiveTranscriptResponsiveness(current.transcript_json) ??
          undefined,
        stopToValidatedLatency:
          readStopToValidatedLatency(current.transcript_json) ?? undefined,
        lifecycleStatus: 'validated',
        integrity: { ...validation.evidence, reasons: validation.reasons },
      }),
    ),
    enhanced_notes: null,
    analysis_json: null,
    value_signals_json: null,
    downstream_processing_json: JSON.stringify({
      schemaVersion: 1,
      state: 'processing',
      transcriptValidatedAt: validatedAt,
      runId: downstreamRunId,
      stage: 'analysis',
    }),
  };
  await invoke(
    'UPDATE_TRANSCRIPT_VALIDATION_RETRY_STAGE',
    meetingId,
    runId,
    'saving',
  ).catch(() => null);
  let reprocessing: Awaited<ReturnType<typeof reprocessAttributedMeeting>>;
  try {
    reprocessing = await runBeforeDeadline(
      reprocessAttributedMeeting({
        previous: current,
        buildReplacement: async () => canonicalReplacement,
        validateReplacement: async (candidate) =>
          candidate.transcript_status === 'validated' &&
          parseSegments(candidate.transcript_json).length > 0,
        saveReplacement: async (candidate) => {
          if (
            canonicalMode === 'checkpointed' &&
            current.capture_journal_generation
          ) {
            const outcome = await invoke('FINALIZE_CHECKPOINT_TRANSCRIPT', {
              meetingId,
              journalGeneration: current.capture_journal_generation,
              expectedTranscriptStatus: 'validating',
              expectedValidationRunId: runId,
              canonicalTranscriptJson: candidate.transcript_json,
              transcriptIntegrityJson: candidate.transcript_integrity_json,
              transcriptValidatedAt: validatedAt,
              downstreamRunId,
            });
            return (
              outcome === 'committed_and_claimed' ||
              outcome === 'already_committed'
            );
          }
          return invoke('SAVE_MEETING', candidate, {
            expectedValidationRunId: runId,
            transcriptOwnedFieldsOnly: true,
          });
        },
      }),
    );
  } catch (error) {
    const failure =
      error instanceof Error &&
      error.message === 'transcript_validation_retry_timeout'
        ? 'retry_timeout'
        : 'retry_failed';
    return await failCurrentRetry(failure);
  }
  if (reprocessing.status === 'save_conflict') {
    return { status: 'superseded' };
  }
  if (reprocessing.status !== 'replaced') {
    return await failCurrentRetry('retry_failed');
  }

  try {
    const generatedTitle =
      current.title === 'Meeting'
        ? ((await invoke('GENERATE_TITLE', { transcript })) as string)
        : current.title;
    const artifacts = (await invoke('GENERATE_ANALYSIS_V2', {
      transcript,
      userNotes: current.user_notes || '',
    })) as { markdown?: string; analysis?: unknown; signals?: unknown };
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (
      usesV2Trust
        ? latest.transcript_validated_at !== validatedAt
        : readRunId(latest) !== runId
    ) {
      return { status: 'superseded' };
    }
    const saved = await invoke(
      'SAVE_MEETING',
      {
        ...latest,
        title: latest.title === current.title ? generatedTitle : latest.title,
        transcript_integrity_json: usesV2Trust
          ? latest.transcript_integrity_json
          : JSON.stringify(finishRetryLease(integrity)),
        enhanced_notes: artifacts.markdown || '',
        analysis_json: JSON.stringify(artifacts.analysis ?? null),
        value_signals_json: JSON.stringify(artifacts.signals ?? null),
        downstream_processing_json: JSON.stringify({
          schemaVersion: 1,
          state: 'complete',
          transcriptValidatedAt: validatedAt,
        }),
      },
      {
        ...(usesV2Trust ? {} : { expectedValidationRunId: runId }),
        transcriptOwnedFieldsOnly: true,
        expectedTitle: current.title,
      },
    );
    if (saved === false) return { status: 'superseded' };
    await invoke('EXTRACT_AND_PROCESS_ENTITIES', {
      transcript,
      meetingId: String(meeting.id),
      summary: artifacts.markdown || '',
      valueSignals: artifacts.signals ?? null,
    });
  } catch (error) {
    console.error('[Pluto] Post-validation intelligence failed', error);
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (
      usesV2Trust
        ? latest.transcript_validated_at === validatedAt
        : readRunId(latest) === runId
    ) {
      await invoke(
        'SAVE_MEETING',
        {
          ...latest,
          transcript_integrity_json: usesV2Trust
            ? latest.transcript_integrity_json
            : JSON.stringify(
                finishRetryLease(
                  parseIntegrityRecord(latest.transcript_integrity_json),
                ),
              ),
          downstream_processing_json: JSON.stringify({
            schemaVersion: 1,
            state: 'failed',
            transcriptValidatedAt: validatedAt,
            stage: 'analysis',
            failure: 'generation_failed',
          }),
        },
        {
          ...(usesV2Trust ? {} : { expectedValidationRunId: runId }),
          transcriptOwnedFieldsOnly: true,
        },
      );
    }
  }
  return { status: 'validated' };
};
