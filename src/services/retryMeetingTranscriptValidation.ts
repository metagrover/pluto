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
import { assertValidTranscriptTrustCandidate } from '../utils/transcriptTrustState.ts';
import {
  buildPartialCaptureGapProcessingLease,
  selectDownstreamResumeStage,
} from './downstreamProcessingLease.ts';
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

const logRejectedTrustCandidate = (input: {
  meetingId: string;
  runId: string;
  transition: string;
  error: unknown;
  fallback: 'not_started' | 'mark_needs_attention';
}) =>
  console.error('[Pluto] Transcript trust candidate rejected', {
    meetingId: input.meetingId,
    validationRunId: input.runId,
    transition: input.transition,
    reason: input.error instanceof Error ? input.error.message : 'unknown',
    fallback: input.fallback,
  });

const requestMeetingNotesPublication = async (
  meetingId: string | number,
  invoke: Invoke,
): Promise<void> => {
  await invoke('GENERATE_MEETING_NOTES', {
    meetingId,
    requestId: crypto.randomUUID(),
    template: 'auto',
    reason: 'automatic',
  });
};

const MAX_AUTOMATIC_ANALYSIS_ATTEMPTS = 2;

const readDownstreamAttempt = (value: string | null | undefined): number => {
  try {
    const attempt = (JSON.parse(value || '{}') as { attempt?: unknown })
      .attempt;
    return typeof attempt === 'number' && Number.isSafeInteger(attempt)
      ? Math.max(0, attempt)
      : 0;
  } catch {
    return 0;
  }
};

const GENERIC_MEETING_TITLES = new Set([
  '',
  'meeting',
  'new meeting',
  'meeting (mic only)',
  'recovered recording',
  'untitled meeting',
]);

export const meetingTitleNeedsGeneration = (
  title: string | null | undefined,
): boolean => GENERIC_MEETING_TITLES.has((title || '').trim().toLowerCase());

export const meetingTitleFromAnalysis = (analysis: unknown): string | null => {
  if (!analysis || typeof analysis !== 'object') return null;
  const topics = (analysis as { topics?: unknown }).topics;
  if (!Array.isArray(topics)) return null;
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') continue;
    const rawTitle = (topic as { title?: unknown }).title;
    if (typeof rawTitle !== 'string') continue;
    const title = rawTitle.trim();
    if (
      title.length > 0 &&
      title.length < 100 &&
      !meetingTitleNeedsGeneration(title)
    ) {
      return title;
    }
  }
  return null;
};

const hasTranscriptText = (value: string | null | undefined): boolean => {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    const segments = Array.isArray(parsed)
      ? parsed
      : (parsed as { segments?: unknown[] })?.segments;
    return (
      Array.isArray(segments) &&
      segments.some(
        (segment) =>
          Boolean(segment) &&
          typeof segment === 'object' &&
          typeof (segment as { text?: unknown }).text === 'string' &&
          Boolean((segment as { text: string }).text.trim()),
      )
    );
  } catch {
    return false;
  }
};

export const shouldAutoProcessMeetingAnalysis = (
  meeting: Partial<Meeting> | null | undefined,
) => {
  let downstreamState: unknown = null;
  let downstreamStage: unknown = null;
  let downstreamAttempt = 0;
  let pendingParakeetFinal = false;
  try {
    const downstream = JSON.parse(
      meeting?.downstream_processing_json || '{}',
    ) as { state?: unknown; stage?: unknown; attempt?: unknown };
    downstreamState = downstream.state;
    downstreamStage = downstream.stage;
    downstreamAttempt =
      typeof downstream.attempt === 'number' &&
      Number.isSafeInteger(downstream.attempt)
        ? downstream.attempt
        : 0;
  } catch {
    downstreamState = null;
  }
  try {
    const integrity = JSON.parse(
      meeting?.transcript_integrity_json || '{}',
    ) as {
      finalTranscription?: { policy?: unknown; state?: unknown };
    };
    pendingParakeetFinal =
      integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
      integrity.finalTranscription.state === 'needs_attention';
  } catch {
    pendingParakeetFinal = false;
  }
  const genericTitleRepairNeeded =
    typeof meeting?.title === 'string' &&
    meetingTitleNeedsGeneration(meeting?.title) &&
    hasTranscriptText(meeting?.transcript_json);
  if (
    !meeting ||
    pendingParakeetFinal ||
    (downstreamState === 'failed' &&
      downstreamStage === 'analysis' &&
      downstreamAttempt >= MAX_AUTOMATIC_ANALYSIS_ATTEMPTS) ||
    (meeting.transcript_status !== 'needs_attention' &&
      meeting.transcript_status !== 'validated') ||
    meeting.finalization_status === 'recovery_required' ||
    (Boolean(meeting.analysis_json || meeting.enhanced_notes) &&
      downstreamState !== 'processing' &&
      downstreamState !== 'failed' &&
      !meetingTitleNeedsGeneration(meeting.title)) ||
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
    const hasCaptureGap = integrity.causes?.some(
      (cause) => cause.code === 'capture_gap_detected',
    );
    const partialCaptureGapEligible =
      hasTranscriptText(meeting.transcript_json) &&
      typeof meeting.capture_journal_generation === 'string' &&
      meeting.capture_journal_generation.length > 0;
    return (
      !hasCaptureGap || genericTitleRepairNeeded || partialCaptureGapEligible
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
  options: {
    now?: () => number;
    validationTimeoutMs?: number;
  } = {},
): Promise<{ status: 'validated' | 'needs_attention' | 'superseded' }> => {
  const meeting = (await invoke('GET_MEETING', meetingId)) as Meeting | null;
  if (!meeting) throw new Error('Meeting not found');
  let hasCaptureGap = false;
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      causes?: Array<{ code?: unknown }>;
    };
    hasCaptureGap = Boolean(
      integrity.causes?.some((cause) => cause.code === 'capture_gap_detected'),
    );
  } catch {
    hasCaptureGap = false;
  }
  const canProcessPartialCaptureGap =
    meeting.transcript_status === 'needs_attention' &&
    hasCaptureGap &&
    hasTranscriptText(meeting.transcript_json) &&
    typeof meeting.capture_journal_generation === 'string' &&
    meeting.capture_journal_generation.length > 0;
  if (
    meeting.transcript_status === 'validated' ||
    canProcessPartialCaptureGap
  ) {
    let downstreamState: unknown = null;
    try {
      downstreamState = JSON.parse(
        meeting.downstream_processing_json || '{}',
      ).state;
    } catch {
      downstreamState = null;
    }
    if (
      downstreamState === 'complete' &&
      meeting.analysis_json &&
      !meetingTitleNeedsGeneration(meeting.title)
    ) {
      return {
        status: canProcessPartialCaptureGap ? 'needs_attention' : 'validated',
      };
    }

    if (canProcessPartialCaptureGap) {
      const lease = await buildPartialCaptureGapProcessingLease({
        runId: crypto.randomUUID(),
        transcriptJson: meeting.transcript_json || '',
        transcriptIntegrityJson: meeting.transcript_integrity_json || '',
        captureJournalGeneration: meeting.capture_journal_generation || '',
        now: options.now?.(),
        stage: selectDownstreamResumeStage(meeting),
        attempt: readDownstreamAttempt(meeting.downstream_processing_json) + 1,
      });
      const claimed = await invoke(
        'CLAIM_DOWNSTREAM_PROCESSING',
        meeting.id,
        lease,
      );
      if (claimed !== true) return { status: 'superseded' };
    }

    try {
      await requestMeetingNotesPublication(meeting.id, invoke);
    } catch (error) {
      console.error('[Pluto] Retry notes publication request failed', error);
    }
    return {
      status: canProcessPartialCaptureGap ? 'needs_attention' : 'validated',
    };
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
  const canonicalMode = 'recovered_channels' as const;
  const claimCandidate = {
    ...meeting,
    transcript_status: 'validating' as const,
    transcript_json: withTranscriptLifecycleStatus(
      meeting.transcript_json,
      'validating',
    ),
    transcript_integrity_json: JSON.stringify(
      beginRetryLease(priorIntegrity, lease),
    ),
  };
  try {
    assertValidTranscriptTrustCandidate(claimCandidate, 'claim_validation');
  } catch (error) {
    logRejectedTrustCandidate({
      meetingId: String(meetingId),
      runId,
      transition: 'claim_validation',
      error,
      fallback: 'not_started',
    });
    throw error;
  }
  const claimed = await invoke('SAVE_MEETING', claimCandidate, {
    claimValidationLease: lease,
  });
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
    await invoke('TRANSCRIPTION_CANCEL_FINAL', meetingId).catch(() => null);
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
      transcriptionScheduling: 'sequential_channels',
      checkpointEvidenceVerified:
        mode === 'checkpointed' && checkpointEvidenceVerified,
      transcribe: async (audioPath, options) =>
        (await invoke('TRANSCRIPTION_TRANSCRIBE_FINAL', {
          meetingId: String(meeting.id),
          role: 'final_validation',
          source: options.canonicalSource,
          audioPath,
          language: 'en',
          vocabulary: [],
        })) as {
          segments?: Array<{ start: number; end: number; text: string }>;
          meta?: Record<string, unknown>;
          vad?: {
            status?: 'speech' | 'no_speech' | 'failed';
            speechSeconds?: number;
          };
        },
      probeDuration: async (audioPath) =>
        (await invoke('AUDIO_PROBE_DURATION', audioPath)) as number | null,
    });
  try {
    validation = await runBeforeDeadline(validateTranscript(canonicalMode));
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
    ) &&
    validation.sourceSegmentCounts.mic === 0 &&
    validation.sourceOutcomes.mic !== 'no_speech';
  const priorRemoteSpeechStillMissing =
    hadUnaccountedSpeech(
      meeting,
      'remote_speech_unaccounted',
      'systemActivitySeconds',
    ) &&
    validation.sourceSegmentCounts.system === 0 &&
    validation.sourceOutcomes.system !== 'no_speech';
  if (
    validation.segments.length === 0 ||
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
    const needsAttentionCandidate = {
      ...latest,
      transcript_status: 'needs_attention' as const,
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
    };
    try {
      assertValidTranscriptTrustCandidate(
        needsAttentionCandidate,
        'needs_attention',
      );
    } catch (error) {
      logRejectedTrustCandidate({
        meetingId: String(meetingId),
        runId,
        transition: 'needs_attention',
        error,
        fallback: 'mark_needs_attention',
      });
      return await failCurrentRetry('retry_failed');
    }
    const saved = await invoke('SAVE_MEETING', needsAttentionCandidate, {
      expectedValidationRunId: runId,
      transcriptOwnedFieldsOnly: true,
    });
    if (saved === false) return { status: 'superseded' };
    return { status: 'needs_attention' };
  }

  const current = (await invoke('GET_MEETING', meetingId)) as Meeting;
  if (readRunId(current) !== runId) return { status: 'superseded' };

  const validatedAt = new Date().toISOString();
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
    transcript_status: 'validated' as const,
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
  };
  try {
    assertValidTranscriptTrustCandidate(canonicalReplacement, 'validated');
  } catch (error) {
    logRejectedTrustCandidate({
      meetingId: String(meetingId),
      runId,
      transition: 'validated',
      error,
      fallback: 'mark_needs_attention',
    });
    return await failCurrentRetry('retry_failed');
  }
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
        saveReplacement: async (candidate) =>
          invoke('SAVE_MEETING', candidate, {
            expectedValidationRunId: runId,
            transcriptOwnedFieldsOnly: true,
          }),
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
    await requestMeetingNotesPublication(meetingId, invoke);
  } catch (error) {
    console.error(
      '[Pluto] Post-validation notes publication request failed',
      error,
    );
  }
  return { status: 'validated' };
};
