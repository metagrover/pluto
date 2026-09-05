import type { TranscriptSegment } from '../../types';
import { getAnonymousSpeakerDisplayLabel } from '../../utils/speakerReview';

export type MeetingTranscriptTurn<T extends TranscriptSegment> = {
  id: string;
  speaker: TranscriptSegment['speaker'];
  startSeconds: number;
  segments: T[];
};

const MAX_TURN_CHARACTERS = 420;
const MAX_TURN_DURATION_SECONDS = 45;

const startSeconds = (segment: TranscriptSegment): number => {
  const value = segment.startTime ?? segment.start ?? 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const applyMeetingSpeakerDisplayNames = <T extends TranscriptSegment>(
  segments: T[],
  displayNames: Readonly<Record<string, string>>,
): T[] =>
  segments.map((segment) => {
    const speaker = String(segment.speaker ?? '');
    const displayName = displayNames[speaker]?.trim();
    const projectedSpeaker =
      displayName || getAnonymousSpeakerDisplayLabel(speaker);
    return projectedSpeaker !== speaker
      ? ({ ...segment, speaker: projectedSpeaker } as T)
      : segment;
  });

const turnCharacterCount = <T extends TranscriptSegment>(
  turn: MeetingTranscriptTurn<T>,
): number =>
  turn.segments.reduce(
    (total, segment, index) =>
      total + segment.text.length + (index === 0 ? 0 : 1),
    0,
  );

export const buildMeetingTranscriptTurns = <T extends TranscriptSegment>(
  segments: T[],
): MeetingTranscriptTurn<T>[] => {
  const turns: MeetingTranscriptTurn<T>[] = [];

  for (const segment of segments) {
    const current = turns.at(-1);
    const segmentStart = startSeconds(segment);
    const canContinue =
      current &&
      String(current.speaker ?? '') === String(segment.speaker ?? '') &&
      segmentStart - current.startSeconds <= MAX_TURN_DURATION_SECONDS &&
      turnCharacterCount(current) + segment.text.length + 1 <=
        MAX_TURN_CHARACTERS;

    if (canContinue) {
      current.segments.push(segment);
      continue;
    }

    turns.push({
      id: `${String(segment.speaker ?? 'unknown')}-${segmentStart}-${turns.length}`,
      speaker: segment.speaker,
      startSeconds: segmentStart,
      segments: [segment],
    });
  }

  return turns;
};
