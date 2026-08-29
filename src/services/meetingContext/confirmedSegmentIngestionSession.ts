import type { LiveTranscriptSegment } from '../../components/features/recordingWorkspaceModel';
import type {
  MeetingContextIngestionRequest,
  MeetingContextIngestionSegment,
} from '../../types/meetingContext';

const MAX_SEGMENTS = 24;
const MAX_TEXT_CHARACTERS = 12_000;

export type ConfirmedSegmentIngestionSession = {
  accept(segments: LiveTranscriptSegment[]): void;
  close(): void;
};

const normalize = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const eligibleSegment = (
  segment: LiveTranscriptSegment,
): MeetingContextIngestionSegment | null => {
  const id = segment.id.trim();
  const text = normalize(segment.text);
  if (
    !segment.confirmed ||
    !id ||
    !text ||
    text.length > MAX_TEXT_CHARACTERS ||
    !Number.isFinite(segment.timestampMs) ||
    segment.timestampMs < 0
  ) {
    return null;
  }
  return {
    id,
    speaker: segment.speaker,
    text,
    timestampMs: segment.timestampMs,
    confirmed: true,
  };
};

export const createConfirmedSegmentIngestionSession = (options: {
  meetingId: string;
  submit(request: MeetingContextIngestionRequest): Promise<unknown>;
  onError(error: unknown): void;
}): ConfirmedSegmentIngestionSession => {
  let closed = false;
  const pendingOrSubmittedIds = new Set<string>();

  return {
    accept(segments) {
      if (closed) return;
      const batch: MeetingContextIngestionSegment[] = [];
      let textCharacters = 0;
      for (const segment of segments) {
        if (batch.length >= MAX_SEGMENTS) break;
        const eligible = eligibleSegment(segment);
        if (
          !eligible ||
          pendingOrSubmittedIds.has(eligible.id) ||
          textCharacters + eligible.text.length > MAX_TEXT_CHARACTERS
        ) {
          continue;
        }
        batch.push(eligible);
        textCharacters += eligible.text.length;
      }
      if (batch.length === 0) return;

      batch.forEach((segment) => pendingOrSubmittedIds.add(segment.id));
      let submission: Promise<unknown>;
      try {
        submission = options.submit({
          meetingId: options.meetingId,
          segments: batch,
        });
      } catch (error) {
        batch.forEach((segment) => pendingOrSubmittedIds.delete(segment.id));
        options.onError(error);
        return;
      }
      void submission.catch((error) => {
        if (!closed) {
          batch.forEach((segment) => pendingOrSubmittedIds.delete(segment.id));
        }
        options.onError(error);
      });
    },
    close() {
      closed = true;
      pendingOrSubmittedIds.clear();
    },
  };
};
