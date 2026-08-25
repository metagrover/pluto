import { deriveCitationTrustStatus } from '../../src/utils/trustStatus';
import { getEntity, getMeetingMid } from '../db';
import type { CitationChain, RetrievalResult } from './intelligenceTypes';

/**
 * Extract the sentence surrounding a given character index in a text.
 */
const extractSurroundingSentence = (
  text: string,
  matchIndex: number,
): string => {
  const before = text
    .slice(0, matchIndex)
    .replace(/(?:\s*\[Source\s+\d+\])+\s*$/gi, '')
    .trimEnd();
  const citationFollowsSentence = /[.!?]$/.test(before);
  const claimEnd = citationFollowsSentence ? before.length : matchIndex;
  const boundarySearchEnd = citationFollowsSentence ? claimEnd - 1 : claimEnd;
  const start = Math.max(
    before.lastIndexOf('.', boundarySearchEnd - 1),
    before.lastIndexOf('!', boundarySearchEnd - 1),
    before.lastIndexOf('?', boundarySearchEnd - 1),
    before.lastIndexOf('\n', boundarySearchEnd - 1),
  );
  const afterCitation = text
    .slice(matchIndex)
    .replace(/^\[Source\s+\d+\]/i, '');
  const nextBoundary = afterCitation.search(/[.!?\n]/);
  const claimTail = citationFollowsSentence
    ? ''
    : nextBoundary >= 0
      ? afterCitation.slice(0, nextBoundary + 1)
      : afterCitation;

  return `${before.slice(start + 1, claimEnd)}${claimTail}`
    .replace(/\[Source\s+\d+\]/gi, '')
    .trim();
};

const CLAIM_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
]);

const stemToken = (token: string): string => {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
};

const contentTokens = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => !CLAIM_STOPWORDS.has(token))
    .map(stemToken);

const hasNegation = (text: string): boolean =>
  /\b(no|not|never|neither|nor|without|didn't|doesn't|isn't|wasn't|won't|can't)\b/i.test(
    text,
  );

const NON_ENTITY_CAPITALIZED_WORDS = new Set([
  'A',
  'An',
  'Compared',
  'Earlier',
  'It',
  'Later',
  'That',
  'The',
  'There',
  'This',
]);

const namedTerms = (text: string): string[] =>
  (text.match(/\b[\p{Lu}][\p{L}\p{N}'-]+\b/gu) || []).filter(
    (term) => !NON_ENTITY_CAPITALIZED_WORDS.has(term),
  );

const evidenceSupportScore = (claim: string, evidence: string): number => {
  const claimTokens = [...new Set(contentTokens(claim))];
  if (claimTokens.length === 0) return 0;
  const evidenceTokenSet = new Set(contentTokens(evidence));
  const matched = claimTokens.filter((token) => evidenceTokenSet.has(token));
  return matched.length / claimTokens.length;
};

export const claimIsSupportedByEvidence = (
  claim: string,
  evidence: string | undefined,
): boolean => {
  if (!evidence?.trim()) return false;
  if (hasNegation(claim) !== hasNegation(evidence)) return false;
  if (
    hasNegation(claim) &&
    contentTokens(claim).join(' ') !== contentTokens(evidence).join(' ')
  ) {
    return false;
  }

  const claimNumbers = claim.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (claimNumbers.some((value) => !evidence.includes(value))) return false;

  const normalizedEvidence = evidence.toLocaleLowerCase();
  if (
    namedTerms(claim).some(
      (term) => !normalizedEvidence.includes(term.toLocaleLowerCase()),
    )
  ) {
    return false;
  }

  const normalizedClaim = contentTokens(claim);
  const minimumCoverage = normalizedClaim.length <= 3 ? 1 : 0.6;
  return evidenceSupportScore(claim, evidence) >= minimumCoverage;
};

/**
 * Get the first meaningful evidence span from a retrieval result's MID.
 */
const getBestEvidenceSpan = (
  source: RetrievalResult,
  claim: string,
): string | undefined => {
  const candidates = [
    ...(source.mid?.evidence_spans?.map((span) => span.quote) || []),
    ...source.evidence_text
      .split('\n')
      .map((line) => line.replace(/^\[[^\]]+\]:?\s*/, '').trim())
      .filter((line) => line.length > 20),
  ];
  return candidates
    .map((evidence, index) => ({
      evidence,
      index,
      score: evidenceSupportScore(claim, evidence),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    )[0]
    ?.evidence.slice(0, 240);
};

/**
 * Builds a citation chain from the LLM's synthesized answer.
 * Primary format: [Source N] bracket references.
 * Fallback: legacy XML <cite> tags (including malformed ones).
 */
export const buildCitationChain = (
  answer: string,
  sources: RetrievalResult[],
): CitationChain[] => {
  const citations: CitationChain[] = [];
  const seenClaimSources = new Set<string>();

  // Primary: match [Source N] references
  const sourceRefRegex = /\[Source\s+(\d+)\]/gi;
  for (const match of answer.matchAll(sourceRefRegex)) {
    const sourceIdx = Number.parseInt(match[1], 10) - 1; // 0-indexed
    if (sourceIdx >= 0 && sourceIdx < sources.length) {
      const source = sources[sourceIdx];
      const claim = extractSurroundingSentence(answer, match.index ?? 0);
      const claimSourceKey = `${sourceIdx}:${claim.toLowerCase()}`;
      if (seenClaimSources.has(claimSourceKey)) continue;
      seenClaimSources.add(claimSourceKey);

      citations.push({
        claim,
        meeting_id: source.meeting_id,
        meeting_title:
          source.meeting_title || source.mid?.title || 'Unknown Meeting',
        evidence_span: getBestEvidenceSpan(source, claim),
        evidence_valid: false, // set by auditCitations
        trust_status: 'needs_review',
      });
    }
  }

  // Fallback: legacy <cite> tag support (handle malformed tags like -cite, < cite)
  if (citations.length === 0) {
    const legacyCiteRegex =
      /<?\-?cite\s+meeting="([^"]+)"(?:\s+entity="([^"]*)")?(?:\s+quote="([^"]*)")?>([\s\S]*?)<\/cite>/gi;
    for (const legacyMatch of answer.matchAll(legacyCiteRegex)) {
      const meeting_id = legacyMatch[1];
      const entity_id = legacyMatch[2];
      const evidence_span = legacyMatch[3];
      const claim = legacyMatch[4].trim();

      const source = sources.find((s) => s.meeting_id === meeting_id);
      const meetingTitle =
        source?.meeting_title || source?.mid?.title || 'Unknown Meeting';

      citations.push({
        claim,
        meeting_id,
        meeting_title: meetingTitle,
        entity_id: entity_id || undefined,
        evidence_span: evidence_span || undefined,
        evidence_valid: false,
        trust_status: 'needs_review',
      });
    }
  }

  return citations;
};

/**
 * Structural citation audit. Verifies that cited meeting_ids exist in the DB,
 * entity_ids resolve, and evidence quotes are present in the MID's evidence_spans.
 * Requires NO second LLM call.
 */
export const auditCitations = (
  citations: CitationChain[],
  sources: RetrievalResult[] = [],
): CitationChain[] => {
  const structural = citations.map((citation) => {
    let structurallyValid = true;
    const source = sources.find(
      (candidate) => candidate.meeting_id === citation.meeting_id,
    );

    // 1. Verify meeting and MID exist
    const mid = source?.mid || getMeetingMid(citation.meeting_id);
    if (!source && !mid) {
      structurallyValid = false;
    } else {
      // 2. Verify entity_id resolves if provided and not empty
      if (citation.entity_id && citation.entity_id.trim() !== '') {
        const entity = getEntity(citation.entity_id);
        if (!entity) {
          structurallyValid = false;
        }
      }

      // 3. Verify evidence span exists in MID spans if provided and not empty
      if (
        structurallyValid &&
        citation.evidence_span &&
        citation.evidence_span.trim() !== ''
      ) {
        const needle = citation.evidence_span.toLowerCase().trim();
        const spanFound =
          mid?.evidence_spans?.some((span) => {
            const haystack = span.quote.toLowerCase();
            return haystack.includes(needle) || needle.includes(haystack);
          }) || source?.evidence_text.toLowerCase().includes(needle);

        if (!spanFound) {
          structurallyValid = false;
        }
      }
    }

    return { citation, structurallyValid };
  });

  const claimGroups = new Map<string, typeof structural>();
  for (const item of structural) {
    const key = item.citation.claim.trim().toLowerCase();
    const group = claimGroups.get(key) || [];
    group.push(item);
    claimGroups.set(key, group);
  }

  return structural.map(({ citation, structurallyValid }) => {
    const source = sources.find(
      (candidate) => candidate.meeting_id === citation.meeting_id,
    );
    const provisionalSource =
      source !== undefined &&
      /^\[(?:Current recording|Live transcript|Interim transcript)[^\]]*(?:provisional|unconfirmed)/im.test(
        source.evidence_text,
      );
    const group = claimGroups.get(citation.claim.trim().toLowerCase()) || [];
    const combinedSupport =
      group.length > 1 &&
      group.every((item) => item.structurallyValid) &&
      claimIsSupportedByEvidence(
        citation.claim,
        group
          .map((item) => item.citation.evidence_span || '')
          .filter(Boolean)
          .join('\n'),
      );
    const evidence_valid =
      structurallyValid &&
      (claimIsSupportedByEvidence(citation.claim, citation.evidence_span) ||
        combinedSupport);

    return {
      ...citation,
      evidence_valid,
      trust_status:
        evidence_valid && (combinedSupport || provisionalSource)
          ? ('inferred' as const)
          : deriveCitationTrustStatus({ evidenceValid: evidence_valid }),
    };
  });
};

const COMPARATIVE_CLAIM_PATTERN =
  /\b(compare|compared|difference|different|changed?|moved|more|less|earlier|later|whereas|while|unlike|versus|vs)\b/i;

const isMaterialClaim = (sentence: string): boolean => {
  const withoutCitations = sentence.replace(/\[Source\s+\d+\]/gi, '').trim();
  if (!withoutCitations) return false;
  if (/^I couldn't find information/i.test(withoutCitations)) return false;
  return contentTokens(withoutCitations).length >= 2;
};

export const auditAnswerGrounding = (
  answer: string,
  citations: CitationChain[],
): {
  trustStatus: 'grounded' | 'inferred' | 'needs_review';
  unsupportedClaimCount: number;
} => {
  const sentences = answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(isMaterialClaim);
  let unsupportedClaimCount = 0;
  let inferred = false;

  for (const sentence of sentences) {
    const cleanSentence = sentence
      .replace(/\[Source\s+\d+\]/gi, '')
      .trim()
      .replace(/[.!?]+$/, '');
    const matching = citations.filter((citation) => {
      const cleanClaim = citation.claim.trim().replace(/[.!?]+$/, '');
      return cleanClaim === cleanSentence;
    });
    const citedMeetings = new Set(
      matching.map((citation) => citation.meeting_id),
    );
    const comparisonNeedsTwoSources =
      COMPARATIVE_CLAIM_PATTERN.test(cleanSentence);
    const supported =
      matching.length > 0 &&
      matching.every((citation) => citation.evidence_valid) &&
      (!comparisonNeedsTwoSources || citedMeetings.size >= 2);
    if (!supported) {
      unsupportedClaimCount += 1;
    } else if (
      citedMeetings.size >= 2 ||
      matching.some((citation) => citation.trust_status === 'inferred')
    ) {
      inferred = true;
    }
  }

  return {
    trustStatus:
      unsupportedClaimCount > 0
        ? 'needs_review'
        : inferred
          ? 'inferred'
          : 'grounded',
    unsupportedClaimCount,
  };
};
