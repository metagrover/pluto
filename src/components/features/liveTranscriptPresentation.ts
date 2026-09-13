import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSegment['speaker'];
  source?: LiveTranscriptSegment['source'];
  timestampMs: number;
  segments: LiveTranscriptSegment[];
  paragraphs: LiveTranscriptParagraph[];
};

export type LiveTranscriptParagraph = {
  id: string;
  parts: Array<{
    id: string;
    text: string;
    confirmed: boolean;
  }>;
};

const MAX_TURN_CHARACTERS = 360;
const MAX_TURN_DURATION_MS = 45_000;
const MAX_PARAGRAPH_CHARACTERS = 280;
const MIN_SENTENCE_BREAK_CHARACTERS = 120;

const splitReadableText = (text: string): string[] => {
  const chunks: string[] = [];
  let remaining = text.trim().replace(/\s+/g, ' ');
  while (remaining.length > MAX_PARAGRAPH_CHARACTERS) {
    const window = remaining.slice(0, MAX_PARAGRAPH_CHARACTERS + 1);
    const sentenceMatches = [...window.matchAll(/[.!?…]["')\]]?\s+/gu)];
    const sentenceBreak = sentenceMatches
      .map((match) => (match.index ?? 0) + match[0].trimEnd().length)
      .filter((index) => index >= MIN_SENTENCE_BREAK_CHARACTERS)
      .at(-1);
    const wordBreak = window.lastIndexOf(' ', MAX_PARAGRAPH_CHARACTERS);
    const splitAt = sentenceBreak ?? wordBreak;
    if (splitAt <= 0) break;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

const buildParagraphs = (
  segments: LiveTranscriptSegment[],
): LiveTranscriptParagraph[] => {
  const paragraphs: LiveTranscriptParagraph[] = [];
  for (const segment of segments) {
    splitReadableText(segment.text).forEach((text, chunkIndex) => {
      const id = `${segment.id}:part:${chunkIndex}`;
      const current = paragraphs.at(-1);
      const currentLength =
        current?.parts.reduce(
          (total, part, index) => total + part.text.length + (index ? 1 : 0),
          0,
        ) ?? 0;
      const part = { id, text, confirmed: segment.confirmed };
      if (
        current &&
        currentLength + text.length + 1 <= MAX_PARAGRAPH_CHARACTERS
      ) {
        current.parts.push(part);
      } else {
        paragraphs.push({ id, parts: [part] });
      }
    });
  }
  return paragraphs;
};

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

  const visible = segments
    .filter((raw) => raw.presentation?.visibility !== 'suppressed_echo')
    .map((raw) =>
      raw.presentation?.visibility === 'echo_span_removed'
        ? {
            ...raw,
            text: raw.presentation.text,
            timestampMs: raw.presentation.timestampMs ?? raw.timestampMs,
            endTimestampMs:
              raw.presentation.endTimestampMs ?? raw.endTimestampMs,
          }
        : raw,
    );
  // Ordinary EOU ordering keeps tentative text at the live edge. Reorder only
  // when retained speech moved within a raw row after removing its echo prefix.
  if (
    segments.some(
      (raw) =>
        raw.presentation?.visibility === 'echo_span_removed' &&
        raw.presentation.timestampMs !== undefined &&
        raw.presentation.timestampMs !== raw.timestampMs,
    )
  ) {
    visible.sort((left, right) => left.timestampMs - right.timestampMs);
  }

  for (const segment of visible) {
    const projectedSpeaker =
      segment.source === 'mic'
        ? 'Me'
        : segment.source === 'system'
          ? 'Them'
          : segment.speaker;
    const current = turns.at(-1);
    const canContinueTurn =
      current?.speaker === projectedSpeaker &&
      current?.source === segment.source &&
      segment.timestampMs - current.timestampMs <= MAX_TURN_DURATION_MS &&
      turnCharacterCount(current) + segment.text.length + 1 <=
        MAX_TURN_CHARACTERS;
    if (canContinueTurn && current) {
      current.segments.push(segment);
      continue;
    }

    turns.push({
      id: segment.id,
      speaker: projectedSpeaker,
      source: segment.source,
      timestampMs: segment.timestampMs,
      segments: [segment],
      paragraphs: [],
    });
  }

  return turns.map((turn) => ({
    ...turn,
    paragraphs: buildParagraphs(turn.segments),
  }));
};
