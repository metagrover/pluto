const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take'
]);

export interface WordCorrectionCandidate {
  original: string;
  corrected: string;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function extractLearnedWordCandidate(
  originalText: string,
  editedText: string
): WordCorrectionCandidate | null {
  if (!originalText || !editedText || originalText === editedText) {
    return null;
  }

  const origWords = originalText.match(/\b\w+\b/g) || [];
  const editWords = editedText.match(/\b\w+\b/g) || [];

  for (const e of editWords) {
    const eLower = e.toLowerCase();
    if (e.length >= 3 && !COMMON_WORDS.has(eLower)) {
      const isJargon = e[0] === e[0].toUpperCase() || /[A-Z]/.test(e);
      if (isJargon && !origWords.includes(e)) {
        const match = origWords.find(
          (o) => o.toLowerCase() === eLower || (Math.abs(o.length - e.length) <= 3 && levenshteinDistance(o.toLowerCase(), eLower) <= 2)
        );
        if (match && match !== e) {
          return { original: match, corrected: e };
        }
      }
    }
  }

  return null;
}
