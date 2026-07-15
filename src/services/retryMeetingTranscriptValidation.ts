import type { Meeting } from '../types';
import type {
  AttributionSegment,
  SpeakerActivityWindow,
} from '../utils/speakerAttribution';
import {
  type TranscriptActivityEvidenceFallbackSource,
  buildStoredTranscriptActivityEvidence,
  parseStoredTranscriptActivityEvidence,
} from '../utils/transcriptActivityEvidence';
import type { TranscriptIntegrityReason } from '../utils/transcriptIntegrity';
import { buildTranscriptJsonPayload } from '../utils/transcriptSchema';
import { runRecordingTranscriptValidation } from './recordingTranscriptValidation';

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
    return typeof parsed.validation_run_id === 'string'
      ? parsed.validation_run_id
      : null;
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

const readStoredActivityWindows = (
  meeting: Meeting,
  provisionalSegments: AttributionSegment[],
): {
  windows: SpeakerActivityWindow[];
  source: TranscriptActivityEvidenceFallbackSource;
  failureReason: TranscriptIntegrityReason | null;
} => {
  try {
    const parsed = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      activityEvidence?: unknown;
      activityEvidenceSource?: unknown;
    };
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

    const priorSource =
      parsed.activityEvidenceSource === 'capture_activity_v1'
        ? 'capture_activity_v1'
        : parsed.activityEvidenceSource === 'legacy_provisional_segments'
          ? 'legacy_provisional_segments'
          : null;

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
): Promise<{ status: 'validated' | 'needs_attention' | 'superseded' }> => {
  const meeting = (await invoke('GET_MEETING', meetingId)) as Meeting | null;
  if (!meeting) throw new Error('Meeting not found');
  if (meeting.transcript_status === 'validated' && meeting.analysis_json) {
    return { status: 'validated' };
  }

  const runId = crypto.randomUUID();
  const sourcePaths = {
    mic: meeting.audio_path || '',
    system: meeting.system_audio_path || '',
    mix: meeting.mixed_audio_path || '',
  };
  const provisionalSegments = parseSegments(meeting.transcript_json);
  const activityEvidence = readStoredActivityWindows(
    meeting,
    provisionalSegments,
  );
  await invoke('SAVE_MEETING', {
    ...meeting,
    transcript_status: 'validating',
    transcript_integrity_json: JSON.stringify({ validation_run_id: runId }),
  });

  const validation = await runRecordingTranscriptValidation({
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
  });
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
      : {}),
    validation_run_id: runId,
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
    await invoke('SAVE_MEETING', {
      ...meeting,
      transcript_status: 'needs_attention',
      transcript_integrity_json: JSON.stringify(integrity),
      transcript_validated_at: null,
      enhanced_notes: null,
      analysis_json: null,
      value_signals_json: null,
    });
    return { status: 'needs_attention' };
  }

  const current = (await invoke('GET_MEETING', meetingId)) as Meeting;
  if (readRunId(current) !== runId) return { status: 'superseded' };

  const transcript = validation.segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join('\n');
  const title =
    meeting.title === 'Meeting'
      ? ((await invoke('GENERATE_TITLE', { transcript })) as string)
      : meeting.title;
  const artifacts = (await invoke('GENERATE_ANALYSIS_V2', {
    transcript,
    userNotes: meeting.user_notes || '',
  })) as { markdown?: string; analysis?: unknown; signals?: unknown };
  const latest = (await invoke('GET_MEETING', meetingId)) as Meeting;
  if (readRunId(latest) !== runId) return { status: 'superseded' };

  await invoke('SAVE_MEETING', {
    ...meeting,
    title,
    transcript_status: 'validated',
    transcript_validated_at: new Date().toISOString(),
    transcript_integrity_json: JSON.stringify(integrity),
    transcript_json: JSON.stringify(
      buildTranscriptJsonPayload(validation.segments, {
        pipelineMode: 'canonical_session_v2',
        canonicalSource: 'mix',
        postHydrationBleedPass: false,
        lifecycleStatus: 'validated',
        integrity: { ...validation.evidence, reasons: validation.reasons },
      }),
    ),
    enhanced_notes: artifacts.markdown || '',
    analysis_json: JSON.stringify(artifacts.analysis ?? null),
    value_signals_json: JSON.stringify(artifacts.signals ?? null),
  });
  await invoke('EXTRACT_AND_PROCESS_ENTITIES', {
    transcript,
    meetingId: String(meeting.id),
    summary: artifacts.markdown || '',
    valueSignals: artifacts.signals ?? null,
  });
  return { status: 'validated' };
};
