import type { Meeting } from '../types.ts';
import { shouldAutoProcessMeetingAnalysis } from './retryMeetingTranscriptValidation.ts';

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
): Partial<Meeting> | null =>
  meetings.find(
    (meeting) =>
      shouldAutoProcessMeetingAnalysis(meeting) &&
      !attemptedFingerprints.has(meetingProcessingFingerprint(meeting)),
  ) ?? null;

export const rememberMeetingProcessingOutcome = (
  attemptedFingerprints: Set<string>,
  meeting: Partial<Meeting> | null | undefined,
): void => {
  if (meeting) {
    attemptedFingerprints.add(meetingProcessingFingerprint(meeting));
  }
};
