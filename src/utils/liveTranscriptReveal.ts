type TranscriptRevealSegment = {
  id: string;
  text: string;
};

type TranscriptRevealEntry = {
  sourceText: string;
  revealedText: string;
};

export type LiveTranscriptRevealState = {
  order: string[];
  entries: Record<string, TranscriptRevealEntry>;
};

export const createLiveTranscriptRevealState = (
  segments: TranscriptRevealSegment[],
): LiveTranscriptRevealState => ({
  order: segments.map((segment) => segment.id),
  entries: Object.fromEntries(
    segments.map((segment) => [
      segment.id,
      { sourceText: segment.text, revealedText: segment.text },
    ]),
  ),
});

export const reconcileLiveTranscriptReveal = (
  state: LiveTranscriptRevealState,
  segments: TranscriptRevealSegment[],
  options: { revealImmediately?: boolean } = {},
): LiveTranscriptRevealState => ({
  order: segments.map((segment) => segment.id),
  entries: Object.fromEntries(
    segments.map((segment) => {
      const previous = state.entries[segment.id];
      const revealedText = options.revealImmediately
        ? segment.text
        : previous && segment.text.startsWith(previous.revealedText)
          ? previous.revealedText
          : previous
            ? segment.text
            : '';
      return [segment.id, { sourceText: segment.text, revealedText }];
    }),
  ),
});

const nextWord = (text: string) => text.match(/^\s*\S+\s*/)?.[0] ?? text;

export const advanceLiveTranscriptReveal = (
  state: LiveTranscriptRevealState,
): LiveTranscriptRevealState => {
  const pendingId = state.order.find((id) => {
    const entry = state.entries[id];
    return entry && entry.revealedText !== entry.sourceText;
  });
  if (!pendingId) return state;

  const entry = state.entries[pendingId];
  const remainder = entry.sourceText.slice(entry.revealedText.length);
  return {
    ...state,
    entries: {
      ...state.entries,
      [pendingId]: {
        ...entry,
        revealedText: entry.revealedText + nextWord(remainder),
      },
    },
  };
};

export const getRevealedTranscriptText = (
  state: LiveTranscriptRevealState,
  id: string,
) => state.entries[id]?.revealedText ?? '';

export const getPendingLiveTranscriptWordCount = (
  state: LiveTranscriptRevealState,
) =>
  state.order.reduce((count, id) => {
    const entry = state.entries[id];
    if (!entry) return count;
    const remainder = entry.sourceText.slice(entry.revealedText.length);
    return count + (remainder.match(/\S+/g)?.length ?? 0);
  }, 0);

export const getActiveLiveTranscriptRevealId = (
  state: LiveTranscriptRevealState,
) =>
  state.order.find((id) => {
    const entry = state.entries[id];
    return entry && entry.revealedText !== entry.sourceText;
  }) ?? null;

export const getLiveTranscriptRevealDelay = (pendingWords: number) => {
  if (pendingWords <= 0) return null;
  if (pendingWords > 18) return 35;
  if (pendingWords > 8) return 55;
  return 85;
};
