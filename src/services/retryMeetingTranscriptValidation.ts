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
import { buildTranscriptJsonPayload } from '../utils/transcriptSchema.ts';
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
    };

    if (parsed.activityEvidenceSource === 'capture_activity_v2') {
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
  const claimed = await invoke(
    'SAVE_MEETING',
    {
      ...meeting,
      transcript_status: 'validating',
      transcript_integrity_json: JSON.stringify(
        beginRetryLease(
          parseIntegrityRecord(meeting.transcript_integrity_json),
          lease,
        ),
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
  try {
    validation = await runBeforeDeadline(
      runRecordingTranscriptValidation({
        meetingId: String(meeting.id),
        recordingDurationSeconds: meeting.duration_seconds || 0,
        micAudioPath: sourcePaths.mic,
        systemAudioPath: sourcePaths.system,
        mixAudioPath: sourcePaths.mix,
        provisionalSegments,
        activityWindows: activityEvidence.windows,
        transcribe: async (audioPath, options) =>
          (await invoke('WHISPER_TRANSCRIBE', audioPath, options)) as {
            segments?: Array<{ start: number; end: number; text: string }>;
            meta?: Record<string, unknown>;
          },
        probeDuration: async (audioPath) =>
          (await invoke('AUDIO_PROBE_DURATION', audioPath)) as number | null,
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
  await invoke(
    'UPDATE_TRANSCRIPT_VALIDATION_RETRY_STAGE',
    meetingId,
    runId,
    'reviewing_evidence',
  ).catch(() => null);
  const integrity = {
    ...validation.evidence,
    reasons:
      activityEvidence.failureReason == null
        ? [...validation.reasons]
        : [...new Set([activityEvidence.failureReason, ...validation.reasons])],
    attempts: validation.attempts,
    activityEvidenceSource: activityEvidence.source,
    ...(activityEvidence.source === 'capture_activity_v1'
      ? {
          activityEvidence: buildStoredTranscriptActivityEvidence(
            activityEvidence.windows,
          ),
        }
      : activityEvidence.source === 'capture_activity_v2'
        ? { activityEvidence: activityEvidence.evidence }
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
      !integrity.reasons.includes('local_speech_unaccounted')
    ) {
      integrity.reasons.push('local_speech_unaccounted');
    }
    if (
      priorRemoteSpeechStillMissing &&
      !integrity.reasons.includes('remote_speech_unaccounted')
    ) {
      integrity.reasons.push('remote_speech_unaccounted');
    }
    const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
    if (readRunId(latest) !== runId) return { status: 'superseded' };
    const saved = await invoke(
      'SAVE_MEETING',
      {
        ...latest,
        transcript_status: 'needs_attention',
        transcript_integrity_json: JSON.stringify(finishRetryLease(integrity)),
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
  const canonicalReplacement = {
    ...current,
    transcript_status: 'validated',
    transcript_validated_at: new Date().toISOString(),
    transcript_integrity_json: JSON.stringify({
      ...integrity,
      retry: { ...lease, stage: 'saving' as const },
    }),
    transcript_json: JSON.stringify(
      buildTranscriptJsonPayload(validation.segments, {
        pipelineMode: 'canonical_session_v2',
        canonicalSource: 'mix',
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
    if (readRunId(latest) !== runId) return { status: 'superseded' };
    const saved = await invoke(
      'SAVE_MEETING',
      {
        ...latest,
        title: latest.title === current.title ? generatedTitle : latest.title,
        transcript_integrity_json: JSON.stringify(finishRetryLease(integrity)),
        enhanced_notes: artifacts.markdown || '',
        analysis_json: JSON.stringify(artifacts.analysis ?? null),
        value_signals_json: JSON.stringify(artifacts.signals ?? null),
      },
      {
        expectedValidationRunId: runId,
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
    if (readRunId(latest) === runId) {
      await invoke(
        'SAVE_MEETING',
        {
          ...latest,
          transcript_integrity_json: JSON.stringify(
            finishRetryLease(
              parseIntegrityRecord(latest.transcript_integrity_json),
            ),
          ),
        },
        {
          expectedValidationRunId: runId,
          transcriptOwnedFieldsOnly: true,
        },
      );
    }
  }
  return { status: 'validated' };
};
