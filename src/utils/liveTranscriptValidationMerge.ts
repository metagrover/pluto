export type LiveValidationSource = 'mic' | 'system';

export type ValidationMergeSegment = {
  id?: string;
  speaker: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

const roundedMillis = (seconds: number) => Math.round(seconds * 1_000);

export const createStableLiveSegmentId = (
  source: LiveValidationSource,
  sequence: number,
  startTime: number,
  endTime: number,
): string =>
  `live-${source}-${sequence}-${roundedMillis(startTime)}-${roundedMillis(endTime)}`;

const overlapRatio = (
  left: ValidationMergeSegment,
  right: ValidationMergeSegment,
): number => {
  const overlap = Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );
  const shorter = Math.min(
    left.endTime - left.startTime,
    right.endTime - right.startTime,
  );
  return shorter > 0 ? overlap / shorter : 0;
};

export const mergeValidatedTranscriptChunk = ({
  preview,
  validated,
  source,
  sequence,
  chunkStartSec,
  chunkEndSec,
}: {
  preview: Array<ValidationMergeSegment & { id: string }>;
  validated: ValidationMergeSegment[];
  source: LiveValidationSource;
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
}): Array<ValidationMergeSegment & { id: string }> | null => {
  const expectedSpeaker = source === 'mic' ? 'Me' : 'Them';
  if (preview.length === 0 || validated.length === 0) return null;
  const ordered = [...validated].sort((a, b) => a.startTime - b.startTime);
  if (
    ordered.some(
      (segment) =>
        segment.speaker !== expectedSpeaker ||
        !segment.text.trim() ||
        !Number.isFinite(segment.startTime) ||
        !Number.isFinite(segment.endTime) ||
        segment.startTime < chunkStartSec ||
        segment.endTime > chunkEndSec + 0.25 ||
        segment.endTime <= segment.startTime,
    )
  ) {
    return null;
  }

  let previewCursor = 0;
  let matched = 0;
  const merged = ordered.map((segment) => {
    let matchIndex = -1;
    for (let index = previewCursor; index < preview.length; index += 1) {
      if (overlapRatio(preview[index], segment) >= 0.5) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex >= 0) {
      previewCursor = matchIndex + 1;
      matched += 1;
    }
    return {
      ...segment,
      text: segment.text.trim(),
      id:
        matchIndex >= 0
          ? preview[matchIndex].id
          : createStableLiveSegmentId(
              source,
              sequence,
              segment.startTime,
              segment.endTime,
            ),
    };
  });
  return matched / Math.max(preview.length, validated.length) >= 0.5
    ? merged
    : null;
};
