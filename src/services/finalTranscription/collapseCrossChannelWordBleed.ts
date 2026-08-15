import type { AttributionSegment } from '../../utils/speakerAttribution.ts';

type WordLocation = {
  segmentIndex: number;
  wordIndex: number;
  token: string;
  at: number;
};

const normalizeToken = (word: string) =>
  word
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();

const flattenWords = (segments: AttributionSegment[]): WordLocation[] =>
  segments.flatMap((segment, segmentIndex) =>
    (segment.words || []).flatMap((word, wordIndex) => {
      const token = normalizeToken(word.word);
      return token
        ? [
            {
              segmentIndex,
              wordIndex,
              token,
              at: (word.start + word.end) / 2,
            },
          ]
        : [];
    }),
  );

const renderWords = (
  words: NonNullable<AttributionSegment['words']>,
): string => {
  let text = '';
  for (const word of words) {
    if (!text) text = word.word;
    else if (/^[,.;:!?…%)\]}]/.test(word.word)) text += word.word;
    else text += ` ${word.word}`;
  }
  return text;
};

export const collapseCrossChannelWordBleed = (input: {
  micSegments: AttributionSegment[];
  systemSegments: AttributionSegment[];
  minimumSequenceWords?: number;
  timingToleranceSeconds?: number;
}) => {
  const minimumSequenceWords = input.minimumSequenceWords ?? 3;
  const timingToleranceSeconds = input.timingToleranceSeconds ?? 0.75;
  const micWords = flattenWords(input.micSegments);
  const systemWords = flattenWords(input.systemSegments);
  const systemStartsByToken = new Map<string, number[]>();
  systemWords.forEach((word, index) => {
    const starts = systemStartsByToken.get(word.token) || [];
    starts.push(index);
    systemStartsByToken.set(word.token, starts);
  });
  const droppedMicWords = new Set<string>();
  let collapsedSequenceCount = 0;

  for (let micStart = 0; micStart < micWords.length; micStart += 1) {
    for (const systemStart of systemStartsByToken.get(
      micWords[micStart].token,
    ) || []) {
      if (
        Math.abs(micWords[micStart].at - systemWords[systemStart].at) >
        timingToleranceSeconds
      ) {
        continue;
      }
      let length = 0;
      while (
        micStart + length < micWords.length &&
        systemStart + length < systemWords.length &&
        micWords[micStart + length].token ===
          systemWords[systemStart + length].token &&
        Math.abs(
          micWords[micStart + length].at - systemWords[systemStart + length].at,
        ) <= timingToleranceSeconds
      ) {
        length += 1;
      }
      if (length < minimumSequenceWords) continue;
      let added = false;
      for (let offset = 0; offset < length; offset += 1) {
        const word = micWords[micStart + offset];
        const key = `${word.segmentIndex}:${word.wordIndex}`;
        if (!droppedMicWords.has(key)) added = true;
        droppedMicWords.add(key);
      }
      if (added) collapsedSequenceCount += 1;
      micStart += length - 1;
      break;
    }
  }

  const micSegments = input.micSegments.flatMap((segment, segmentIndex) => {
    if (!segment.words?.length) return [segment];
    const words = segment.words.filter(
      (_word, wordIndex) =>
        !droppedMicWords.has(`${segmentIndex}:${wordIndex}`),
    );
    if (words.length === 0) return [];
    if (words.length === segment.words.length) return [segment];
    return [
      {
        ...segment,
        startTime: words[0].start,
        endTime: words.at(-1)?.end ?? words[0].end,
        text: renderWords(words),
        words,
      },
    ];
  });

  return {
    micSegments,
    systemSegments: input.systemSegments,
    droppedMicWordCount: droppedMicWords.size,
    collapsedSequenceCount,
  };
};
