import { asksForExplicitAttribution } from './askPlutoConversation';
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

const EXPLICIT_ATTRIBUTION_ANSWER =
  /\b(?:[\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?\s+(?:said|asked|requested|assigned|decided|told|stated)|(?:said|asked|requested|assigned|decided|told|stated)\s+by\s+[\p{Lu}][\p{L}'-]+)\b/u;
const UNKNOWN_ATTRIBUTION_ANSWER =
  /\b(?:can(?:not|'t)\s+(?:confirm|determine|tell|verify)|does\s+not\s+(?:say|specify|identify|attribute)|is\s+not\s+(?:specified|identified|attributed)|no\s+(?:speaker|assigner|requester)\s+(?:is\s+)?(?:named|identified))\b/i;
const IMPLIED_UNATTRIBUTED_ASSIGNMENT =
  /\b(?:assign(?:ed)?\s+(?:you|to\s+you)|you\s+(?:were|are)\s+(?:tasked|asked|assigned|told)|your\s+(?:task|assignment))\b/i;
const PRIMARY_ATTRIBUTION_QUESTION = /^\s*(?:who|which\s+person)\b/i;
const UNKNOWN_ATTRIBUTION_RESPONSE =
  'I can’t confirm who said it from the synthesized context returned for this question. The note records the requirement, but it does not identify the speaker or assigner.';

export const ensureAskPlutoAttributionAnswer = (
  query: string,
  answer: string,
): string => {
  if (
    !asksForExplicitAttribution(query) ||
    EXPLICIT_ATTRIBUTION_ANSWER.test(answer)
  ) {
    return answer;
  }

  if (PRIMARY_ATTRIBUTION_QUESTION.test(query)) {
    return UNKNOWN_ATTRIBUTION_RESPONSE;
  }

  const cleanedAnswer = answer
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !IMPLIED_UNATTRIBUTED_ASSIGNMENT.test(sentence))
    .join(' ')
    .trim();

  if (
    cleanedAnswer.length > 0 &&
    UNKNOWN_ATTRIBUTION_ANSWER.test(cleanedAnswer)
  ) {
    return cleanedAnswer;
  }

  return cleanedAnswer.length > 0
    ? `${cleanedAnswer}\n\n${UNKNOWN_ATTRIBUTION_RESPONSE}`
    : UNKNOWN_ATTRIBUTION_RESPONSE;
};
