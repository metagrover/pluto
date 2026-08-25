import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSegment['speaker'];
  timestampMs: number;
  segments: LiveTranscriptSegment[];
};

const MAX_TURN_CHARACTERS = 360;
const MAX_TURN_DURATION_MS = 45_000;

const turnCharacterCount = (turn: LiveTranscriptTurn): number =>
  turn.segments.reduce(
    (total, segment, index) =>
      total + segment.text.length + (index === 0 ? 0 : 1),
    0,
  );

export const buildLiveTranscriptTurns = (
  segments: LiveTranscriptSegment[],
): LiveTranscriptTurn[] => {
  const turns: LiveTranscriptTurn[] = [];

  for (const segment of segments) {
    const current = turns.at(-1);
    const canContinueTurn =
      current?.speaker === segment.speaker &&
      segment.timestampMs - current.timestampMs <= MAX_TURN_DURATION_MS &&
      turnCharacterCount(current) + segment.text.length + 1 <=
        MAX_TURN_CHARACTERS;
    if (canContinueTurn && current) {
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
