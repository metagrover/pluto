import type { Meeting } from '../types.ts';
import { readDownstreamProcessingLease } from './downstreamProcessingLease.ts';
import { shouldAutoProcessMeetingAnalysis } from './retryMeetingTranscriptValidation.ts';

const PROCESSING_WAKE_GRACE_MS = 50;

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
  const delays = meetings.flatMap((meeting) => {
    const lease = readDownstreamProcessingLease(
      meeting.downstream_processing_json,
    );
    const deadline = lease ? Date.parse(lease.deadlineAt) : Number.NaN;
    if (!Number.isFinite(deadline)) return [];
    if (deadline > now) {
      return [deadline - now + PROCESSING_WAKE_GRACE_MS];
    }
    return attemptedFingerprints.has(meetingProcessingFingerprint(meeting))
      ? []
      : [PROCESSING_WAKE_GRACE_MS];
  });
  return delays.length > 0 ? Math.min(...delays) : null;
};
