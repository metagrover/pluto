import type { Meeting } from '../types.ts';
import { readDownstreamProcessingLease } from './downstreamProcessingLease.ts';
import { shouldAutoProcessMeetingAnalysis } from './retryMeetingTranscriptValidation.ts';

const PROCESSING_WAKE_GRACE_MS = 50;

export const shouldRunMeetingFinalTranscription = (
  meeting: Partial<Meeting> | null | undefined,
): boolean =>
  Boolean(
    meeting &&
      meeting.finalization_status !== 'recovery_required' &&
      meeting.transcript_status === 'provisional' &&
      meeting.capture_journal_generation &&
      meeting.transcript_json &&
      (meeting.audio_path || meeting.system_audio_path),
  );

export const canRetryMeetingFinalTranscription = (
  meeting: Partial<Meeting> | null | undefined,
): boolean => {
  if (
    !meeting ||
    meeting.transcript_status !== 'needs_attention' ||
    !meeting.capture_journal_generation ||
    !(meeting.audio_path || meeting.system_audio_path)
  ) {
    return false;
  }
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
    };
    return (
      integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
      integrity.finalTranscription.state === 'needs_attention'
    );
  } catch {
    return false;
  }
};

export const isParakeetValidatedMeeting = (
  meeting: Partial<Meeting> | null | undefined,
): boolean => {
  if (meeting?.transcript_status !== 'validated') return false;
  try {
    const integrity = JSON.parse(meeting.transcript_integrity_json || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
      finalTranscriptionResult?: { policy?: unknown; engine?: unknown };
    };
    return (
      integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
      integrity.finalTranscription.state === 'complete' &&
      integrity.finalTranscriptionResult?.policy === 'parakeet_final_v1' &&
      integrity.finalTranscriptionResult.engine === 'parakeet_coreml'
    );
  } catch {
    return false;
  }
};

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
    Boolean(meeting.analysis_json || meeting.enhanced_notes),
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
    return deadline - now + PROCESSING_WAKE_GRACE_MS;
  }
  return attemptedFingerprints.has(meetingProcessingFingerprint(head))
    ? null
    : PROCESSING_WAKE_GRACE_MS;
};
