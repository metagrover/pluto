import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSegment['speaker'];
  timestampMs: number;
  segments: LiveTranscriptSegment[];
};

export const buildLiveTranscriptTurns = (
  segments: LiveTranscriptSegment[],
): LiveTranscriptTurn[] => {
  const turns: LiveTranscriptTurn[] = [];

  for (const segment of segments) {
    const current = turns.at(-1);
    if (current?.speaker === segment.speaker) {
      current.segments.push(segment);
      continue;
    }

    turns.push({
      id: segment.id,
      speaker: segment.speaker,
      timestampMs: segment.timestampMs,
      segments: [segment],
    });
  }

  return turns;
};
