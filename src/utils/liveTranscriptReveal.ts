const nextWord = (text: string) => text.match(/^\s*\S+\s*/)?.[0] ?? text;

export const advanceTranscriptRevealText = (
  sourceText: string,
  revealedText: string,
) => {
  if (!sourceText.startsWith(revealedText)) return sourceText;
  if (revealedText === sourceText) return sourceText;
  return revealedText + nextWord(sourceText.slice(revealedText.length));
};

export const getPendingTranscriptWordCount = (
  sourceText: string,
  revealedText: string,
) => {
  if (!sourceText.startsWith(revealedText)) return 0;
  return sourceText.slice(revealedText.length).match(/\S+/g)?.length ?? 0;
};

export const getLiveTranscriptRevealDelay = (pendingWords: number) => {
  if (pendingWords <= 0) return null;
  if (pendingWords > 18) return 35;
  if (pendingWords > 8) return 55;
  return 85;
};
