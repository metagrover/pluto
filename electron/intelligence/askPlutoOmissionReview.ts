import { randomUUID } from 'node:crypto';
import type { ResolvedAskPlutoScope } from '../../src/types/askPlutoQuery';
import type { RetrievalResult } from './intelligenceTypes';

export interface AskPlutoOmissionReview {
  ownerId: number;
  originalQuery: string;
  visibleAnswer: string;
  claims: string[];
  scope: ResolvedAskPlutoScope;
  searchMeetingIds?: string[];
  createdAt: number;
}

const MAX_REVIEWS = 40;
const REVIEW_TTL_MS = 2 * 60 * 60_000;
const reviews = new Map<string, AskPlutoOmissionReview>();

const pruneReviews = (now: number): void => {
  for (const [ref, review] of reviews) {
    if (now - review.createdAt > REVIEW_TTL_MS) reviews.delete(ref);
  }
  while (reviews.size >= MAX_REVIEWS) {
    const oldest = reviews.keys().next().value;
    if (!oldest) break;
    reviews.delete(oldest);
  }
};

export const rememberAskPlutoOmissions = (
  input: Omit<AskPlutoOmissionReview, 'createdAt'>,
  now = Date.now(),
): string | undefined => {
  const claims = [...new Set(input.claims.map((claim) => claim.trim()))]
    .filter(Boolean)
    .slice(0, 12);
  if (!claims.length) return undefined;
  pruneReviews(now);
  const ref = randomUUID();
  reviews.set(ref, { ...input, claims, createdAt: now });
  return ref;
};

export const getAskPlutoOmissionReview = (
  ref: string | undefined,
  ownerId: number,
  now = Date.now(),
): AskPlutoOmissionReview | undefined => {
  if (!ref) return undefined;
  const review = reviews.get(ref);
  if (!review || review.ownerId !== ownerId) return undefined;
  if (now - review.createdAt > REVIEW_TTL_MS) {
    reviews.delete(ref);
    return undefined;
  }
  return review;
};

export const clearAskPlutoOmissions = (ownerId: number): void => {
  for (const [ref, review] of reviews) {
    if (review.ownerId === ownerId) reviews.delete(ref);
  }
};

/** Keep distinct passages from the same meeting when different leads find them. */
export const selectAskPlutoOmissionContext = (
  leadResults: RetrievalResult[][],
  generalResults: RetrievalResult[],
  limit = 8,
): RetrievalResult[] => {
  const ordered: RetrievalResult[] = [];
  const maxLeadDepth = Math.max(
    0,
    ...leadResults.map((results) => results.length),
  );
  for (let index = 0; index < maxLeadDepth; index += 1) {
    for (const results of leadResults) {
      const result = results[index];
      if (result) ordered.push(result);
    }
  }
  ordered.push(...generalResults);

  const seenEvidence = new Set<string>();
  return ordered
    .filter((result) => {
      const key = `${result.source_type || 'meeting'}:${result.source_id || result.meeting_id}:${result.evidence_text}`;
      if (seenEvidence.has(key)) return false;
      seenEvidence.add(key);
      return true;
    })
    .slice(0, limit);
};

export const uniqueAskPlutoEvidenceMeetings = (
  context: RetrievalResult[],
): RetrievalResult[] => [
  ...new Map(
    context
      .filter((result) => result.source_type !== 'artifact')
      .map((result) => [result.meeting_id, result]),
  ).values(),
];

export const describeUnverifiedAskPlutoOmissions = (
  claimCount: number | undefined,
): string => {
  if (!claimCount) {
    return "I searched the earlier question again, but couldn't verify any additional details in this search.";
  }
  return `I rechecked the ${claimCount} ${claimCount === 1 ? 'detail' : 'details'} left out of my earlier draft, but couldn't verify any as additional facts in this search.`;
};

export const selectAdditionalSupportedClaims = <
  Citation extends { claim: string },
>(
  citations: Citation[],
  earlierAnswer: string,
): { citations: Citation[]; claims: string[] } => {
  const normalize = (value: string) =>
    value
      .replace(/\[Source\s+\d+\]/gi, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .toLocaleLowerCase();
  const normalizedEarlierAnswer = normalize(earlierAnswer);
  const newCitations = citations.filter((citation) => {
    const claim = normalize(citation.claim);
    return Boolean(claim) && !normalizedEarlierAnswer.includes(claim);
  });
  return {
    citations: newCitations,
    claims: [...new Set(newCitations.map((citation) => citation.claim.trim()))],
  };
};
