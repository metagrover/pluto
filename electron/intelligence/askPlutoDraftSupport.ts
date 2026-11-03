// A draft about the previous answer may rely on that answer.
//
// "Draft a note to Adam about it" usually restates the answer just shown,
// which already passed grounding against its sources. Re-auditing the draft
// alone can fail when its sentences no longer quote the source closely, and
// the whole draft was then replaced by "couldn't verify". A draft sentence
// counts as supported when the earlier validated answer covers it; anything
// new still has to be grounded in the retrieved notes.

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'been',
  'before',
  'best',
  'could',
  'dear',
  'from',
  'have',
  'hello',
  'here',
  'just',
  'know',
  'please',
  'quick',
  'regarding',
  'regards',
  'share',
  'should',
  'some',
  'team',
  'thanks',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'update',
  'wanted',
  'were',
  'what',
  'when',
  'which',
  'will',
  'with',
  'would',
  'your',
]);

const contentWords = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\[source\s+\d+\]/gi, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

// Greeting and sign-off lines carry no facts and need no support.
const isFactFree = (claim: string): boolean => contentWords(claim).length < 2;

export const isClaimCoveredBy = (
  claim: string,
  priorAnswer: string,
): boolean => {
  const words = contentWords(claim);
  if (words.length < 2) return true;
  const prior = new Set(contentWords(priorAnswer));
  const covered = words.filter((word) => prior.has(word)).length;
  return covered / words.length >= 0.6;
};

export const draftClaimsCoveredByPriorAnswer = (
  unsupportedClaims: readonly string[],
  priorAnswer: string | undefined,
): boolean =>
  Boolean(priorAnswer?.trim()) &&
  unsupportedClaims.some((claim) => !isFactFree(claim)) &&
  unsupportedClaims.every((claim) =>
    isClaimCoveredBy(claim, priorAnswer ?? ''),
  );

export const cleanDraftText = (draft: string): string =>
  draft
    .replace(/\s*\[Source\s+\d+\]/gi, '')
    .replace(/\s+([.!?,])/g, '$1')
    .trim();
