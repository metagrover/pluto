import type { CitationChain } from './intelligenceTypes';

const claimKey = (text: string): string =>
  text
    .replace(/\[Source\s+\d+\]/gi, '')
    .replace(/^[-*]\s*/, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const splitSentences = (line: string): string[] =>
  line
    .replace(/\s+([.!?])/g, '$1')
    .split(/(?<=[.!?])\s+(?=[\p{L}\p{N}*])/u)
    .filter(Boolean);

export const removeRepeatedAskPlutoClaims = (
  answer: string,
  citations: CitationChain[],
  previousAnswer = '',
): { answer: string; citations: CitationChain[] } => {
  const seen = new Set(
    previousAnswer
      .split('\n')
      .flatMap(splitSentences)
      .map(claimKey)
      .filter(Boolean),
  );
  const removed = new Set<string>();
  const retained = new Set<string>();
  const cleaned = answer
    .split('\n')
    .map((line) =>
      splitSentences(line)
        .filter((sentence) => {
          const key = claimKey(sentence);
          if (!key || seen.has(key)) {
            if (key) removed.add(key);
            return false;
          }
          seen.add(key);
          retained.add(key);
          return true;
        })
        .join(' '),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const cited = new Set<string>();
  return {
    answer: cleaned,
    citations: citations.filter((citation) => {
      const key = claimKey(citation.claim);
      const citationKey = `${citation.meeting_id}:${key}`;
      if ((removed.has(key) && !retained.has(key)) || cited.has(citationKey))
        return false;
      cited.add(citationKey);
      return true;
    }),
  };
};
