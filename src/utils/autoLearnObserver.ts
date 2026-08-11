const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what'
]);

export interface WordCorrectionCandidate {
  original: string;
  corrected: string;
}

export function extractLearnedWordCandidate(
  originalText: string,
  editedText: string
): WordCorrectionCandidate | null {
  const origWords = originalText.match(/\b\w+\b/g) || [];
  const editWords = editedText.match(/\b\w+\b/g) || [];

  if (origWords.length !== editWords.length) {
    return null;
  }

  for (let i = 0; i < origWords.length; i++) {
    const o = origWords[i];
    const e = editWords[i];
    if (o.toLowerCase() !== e.toLowerCase() || o !== e) {
      if (e.length >= 3 && !COMMON_WORDS.has(e.toLowerCase())) {
        if (e[0] === e[0].toUpperCase()) {
          return { original: o, corrected: e };
        }
      }
    }
  }

  return null;
}
