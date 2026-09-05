import type { Meeting } from '../types.ts';
import {
  hasVerifiedSpeakerAttribution,
  readStoredSpeakerAttribution,
} from '../utils/speakerAttributionTrust.ts';
import { readDownstreamProcessingLease } from './downstreamProcessingLease.ts';
import { shouldAutoProcessMeetingAnalysis } from './retryMeetingTranscriptValidation.ts';

const PROCESSING_WAKE_GRACE_MS = 50;
const PROCESSING_POLL_INTERVAL_MS = 2_000;

export const shouldRunMeetingFinalTranscription = (
  meeting: Partial<Meeting> | null | undefined,
): boolean => {
  const hasDetailedAudioFields = Boolean(
    meeting &&
      ('audio_path' in meeting ||
        'system_audio_path' in meeting ||
        'mixed_audio_path' in meeting),
  );
  const hasRequiredAudio = hasDetailedAudioFields
    ? Boolean(
        meeting?.audio_path &&
          meeting.system_audio_path &&
          meeting.mixed_audio_path,
      )
    : Boolean(meeting?.has_audio);
  return Boolean(
    meeting &&
      meeting.finalization_status !== 'recovery_required' &&
      meeting.transcript_status === 'provisional' &&
      meeting.capture_journal_generation &&
      (meeting.transcript_json || meeting.has_transcript) &&
      hasRequiredAudio,
  );
};

export const canRetryMeetingFinalTranscription = (
  meeting: Partial<Meeting> | null | undefined,
): boolean => {
  if (
    !meeting ||
    !['needs_attention', 'validated'].includes(
      String(meeting.transcript_status),
    ) ||
    !meeting.capture_journal_generation ||
    !(
      (meeting.audio_path &&
        meeting.system_audio_path &&
        meeting.mixed_audio_path &&
        meeting.transcript_json) ||
      (meeting.has_audio && meeting.has_transcript)
    )
  ) {
    return false;
  }
  if (canImproveHistoricalSpeakerLabels(meeting)) return true;
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
    };
    return Boolean(
      (meeting.final_transcription_policy === 'parakeet_final_v1' &&
        meeting.final_transcription_state === 'needs_attention') ||
        (integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
          integrity.finalTranscription.state === 'needs_attention'),
    );
  } catch {
    return false;
  }
};

export function canImproveHistoricalSpeakerLabels(
  meeting: Partial<Meeting> | null | undefined,
): boolean {
  if (
    !meeting ||
    meeting.transcript_status !== 'validated' ||
    !meeting.capture_journal_generation ||
    !(
      (meeting.audio_path &&
        meeting.system_audio_path &&
        meeting.mixed_audio_path &&
        meeting.transcript_json) ||
      (meeting.has_audio && meeting.has_transcript)
    )
  ) {
    return false;
  }
  let completedParakeetFinal =
    meeting.final_transcription_policy === 'parakeet_final_v1' &&
    meeting.final_transcription_state === 'complete';
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
    };
    completedParakeetFinal ||= Boolean(
      integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
        integrity.finalTranscription.state === 'complete',
    );
  } catch {
    completedParakeetFinal = false;
  }
  if (!completedParakeetFinal) return false;
  if (meeting.transcript_json) {
    const attribution = readStoredSpeakerAttribution(meeting.transcript_json);
    return (
      attribution?.source === 'recovered_channel_acoustic_v1' ||
      !hasVerifiedSpeakerAttribution(meeting.transcript_json)
    );
  }
  return meeting.speaker_attribution_verified === false;
}

export const isParakeetValidatedMeeting = (
  meeting: Partial<Meeting> | null | undefined,
): boolean => {
  if (
    meeting?.transcript_status !== 'validated' ||
    !hasVerifiedSpeakerAttribution(meeting.transcript_json)
  )
    return false;
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
      finalTranscriptionResult?: { policy?: unknown; engine?: unknown };
    };
    return Boolean(
      (meeting.final_transcription_policy === 'parakeet_final_v1' &&
        meeting.final_transcription_state === 'complete' &&
        meeting.final_transcription_engine === 'parakeet_coreml') ||
        (integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
          integrity.finalTranscription.state === 'complete' &&
          integrity.finalTranscriptionResult?.policy === 'parakeet_final_v1' &&
          integrity.finalTranscriptionResult.engine === 'parakeet_coreml'),
    );
  } catch {
    return false;
  }
};

export const canRetryMeetingSpeakerLabels = (
  meeting: Partial<Meeting> | null | undefined,
): boolean =>
  canRetryMeetingFinalTranscription(meeting) ||
  Boolean(
    meeting?.capture_journal_generation &&
      meeting.audio_path &&
      meeting.system_audio_path &&
      meeting.mixed_audio_path &&
      meeting.transcript_json &&
      isParakeetValidatedMeeting(meeting),
  );

export const shouldStartMeetingFinalTranscription = (
  meeting: Partial<Meeting> | null | undefined,
  reason: 'automatic' | 'manual' | 'speaker_labels',
): boolean =>
  reason === 'automatic'
    ? shouldRunMeetingFinalTranscription(meeting)
    : reason === 'speaker_labels'
      ? canRetryMeetingSpeakerLabels(meeting)
      : canRetryMeetingFinalTranscription(meeting);

export const selectNextMeetingForFinalTranscription = (
  meetings: Array<Partial<Meeting>>,
): Partial<Meeting> | null =>
  meetings.find(shouldRunMeetingFinalTranscription) ?? null;

export const meetingProcessingFingerprint = (
  meeting: Partial<Meeting>,
): string =>
  JSON.stringify([
    String(meeting.id),
    meeting.transcript_status ?? null,
    meeting.transcript_validated_at ?? null,
    meeting.transcript_integrity_json ?? null,
    meeting.downstream_processing_json ?? null,
    meeting.analysis_run_json ?? null,
    Boolean(
      meeting.analysis_json || meeting.enhanced_notes || meeting.has_analysis,
    ),
  ]);

export const selectNextMeetingForProcessing = (
  meetings: Array<Partial<Meeting>>,
  attemptedFingerprints: ReadonlySet<string>,
  now = Date.now(),
): Partial<Meeting> | null => {
  const head = meetings.find(shouldAutoProcessMeetingAnalysis) ?? null;
  if (!head) return null;
  const lease = readDownstreamProcessingLease(head.downstream_processing_json);
  const leaseDeadline = lease ? Date.parse(lease.deadlineAt) : Number.NaN;
  if (Number.isFinite(leaseDeadline) && leaseDeadline > now) return null;
  if (attemptedFingerprints.has(meetingProcessingFingerprint(head))) {
    return null;
  }
  return head;
};

export const rememberMeetingProcessingOutcome = (
  attemptedFingerprints: Set<string>,
  meeting: Partial<Meeting> | null | undefined,
): void => {
  if (meeting) {
    attemptedFingerprints.add(meetingProcessingFingerprint(meeting));
  }
};

export const forgetExpiredMeetingProcessingAttempts = (
  meetings: Array<Partial<Meeting>>,
  attemptedFingerprints: Set<string>,
  now = Date.now(),
): void => {
  for (const meeting of meetings) {
    const lease = readDownstreamProcessingLease(
      meeting.downstream_processing_json,
    );
    const deadline = lease ? Date.parse(lease.deadlineAt) : Number.NaN;
    if (Number.isFinite(deadline) && deadline <= now) {
      attemptedFingerprints.delete(meetingProcessingFingerprint(meeting));
    }
  }
};

export const nextMeetingProcessingWakeDelay = (
  meetings: Array<Partial<Meeting>>,
  now = Date.now(),
  attemptedFingerprints: ReadonlySet<string> = new Set(),
): number | null => {
  const head = meetings.find(shouldAutoProcessMeetingAnalysis) ?? null;
  if (!head) return null;
  const lease = readDownstreamProcessingLease(head.downstream_processing_json);
  const deadline = lease ? Date.parse(lease.deadlineAt) : Number.NaN;
  if (!Number.isFinite(deadline)) return null;
  if (deadline > now) {
    return Math.min(
      deadline - now + PROCESSING_WAKE_GRACE_MS,
      PROCESSING_POLL_INTERVAL_MS,
    );
  }
  return attemptedFingerprints.has(meetingProcessingFingerprint(head))
    ? null
    : PROCESSING_WAKE_GRACE_MS;
};
