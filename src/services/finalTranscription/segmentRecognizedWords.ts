import type {
  TranscriptionSegment,
  TranscriptionWord,
} from '../transcription/contracts';

const SILENCE_BOUNDARY_SECONDS = 0.8;
const MAX_SEGMENT_SECONDS = 15;
const MAX_SEGMENT_WORDS = 40;
const TIMING_EPSILON = 1e-6;

const sentenceEnds = (text: string): boolean => /[.!?…]["')\]]*$/.test(text);

const renderWords = (words: TranscriptionWord[]): string => {
  let text = '';
  for (const recognized of words) {
    const token = recognized.word;
    if (text.length === 0) {
      text = token;
    } else if (/^[,.;:!?…%)\]}]/.test(token)) {
      text += token;
    } else {
      text += ` ${token}`;
    }
  }
  return text;
};

const validateWords = (words: TranscriptionWord[], duration: number): void => {
  let previousEnd = 0;
  for (const recognized of words) {
    if (
      recognized.word.trim().length === 0 ||
      !Number.isFinite(recognized.start) ||
      !Number.isFinite(recognized.end) ||
      recognized.start < 0 ||
      recognized.end < recognized.start ||
      recognized.end - duration > TIMING_EPSILON ||
      recognized.start + TIMING_EPSILON < previousEnd ||
      (recognized.confidence !== undefined &&
        (!Number.isFinite(recognized.confidence) ||
          recognized.confidence < 0 ||
          recognized.confidence > 1))
    ) {
      throw new Error('transcription_word_timing_invalid');
    }
    previousEnd = recognized.end;
  }
};

export const segmentRecognizedWords = (
  words: TranscriptionWord[],
  duration: number,
): TranscriptionSegment[] => {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error('transcription_duration_invalid');
  }
  validateWords(words, duration);
  if (words.length === 0) return [];

  const groups: TranscriptionWord[][] = [];
  let current: TranscriptionWord[] = [];
  for (const recognized of words) {
    const previous = current.at(-1);
    const startsNewSegment =
      current.length > 0 &&
      (current.length >= MAX_SEGMENT_WORDS ||
        (previous !== undefined && sentenceEnds(previous.word)) ||
        (previous !== undefined &&
          recognized.start - previous.end >=
            SILENCE_BOUNDARY_SECONDS - TIMING_EPSILON) ||
        recognized.end - current[0].start >
          MAX_SEGMENT_SECONDS + TIMING_EPSILON);
    if (startsNewSegment) {
      groups.push(current);
      current = [];
    }
    current.push(recognized);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group) => ({
    start: group[0].start,
    end: group[group.length - 1].end,
    text: renderWords(group),
    words: group,
  }));
};
