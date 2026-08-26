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
  'about',
  'be',
  'by',
  'during',
  'did',
  'do',
  'does',
  'for',
  'from',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'who',
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

const negationSignatures = (text: string): string[][] =>
  text
    .toLowerCase()
    .replace(/\b(?:didn't|doesn't|isn't|wasn't|won't|can't)\b/g, ' not ')
    .split(/[.;!?]/)
    .flatMap((clause) => {
      const tokens = clause.match(/[\p{L}\p{N}'-]+/gu) || [];
      const negationIndex = tokens.findIndex((token) =>
        /^(?:no|not|never|neither|nor|without)$/.test(token),
      );
      if (negationIndex < 0) return [];
      const before = contentTokens(tokens.slice(0, negationIndex).join(' '));
      const after = contentTokens(tokens.slice(negationIndex + 1).join(' '));
      const signature = [...before.slice(-1), ...after.slice(0, 3)];
      return signature.length > 0 ? [signature] : [];
    });

const negationConflicts = (claim: string, evidence: string): boolean => {
  const claimSignatures = negationSignatures(claim);
  const evidenceSignatures = negationSignatures(evidence);
  if (claimSignatures.length === 0 && evidenceSignatures.length === 0) {
    return false;
  }
  const supportsSignature = (text: string, signature: string[]): boolean => {
    const tokens = new Set(contentTokens(text));
    return (
      signature.length > 0 &&
      signature.filter((token) => tokens.has(token)).length /
        signature.length >=
        0.75
    );
  };
  if (claimSignatures.length === 0) {
    return evidenceSignatures.some((signature) =>
      supportsSignature(claim, signature),
    );
  }
  if (evidenceSignatures.length === 0) {
    return claimSignatures.some((signature) =>
      supportsSignature(evidence, signature),
    );
  }
  return !claimSignatures.some((claimSignature) =>
    evidenceSignatures.some((evidenceSignature) => {
      const evidenceTokens = new Set(evidenceSignature);
      return (
        claimSignature.filter((token) => evidenceTokens.has(token)).length /
          Math.max(claimSignature.length, evidenceSignature.length) >=
        0.75
      );
    }),
  );
};

const NON_ENTITY_CAPITALIZED_WORDS = new Set([
  'A',
  'An',
  'Another',
  'At',
  'Compared',
  'During',
  'Earlier',
  'For',
  'From',
  'In',
  'It',
  'Later',
  'Multiple',
  'No',
  'On',
  'One',
  'Several',
  'They',
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
  if (negationConflicts(claim, evidence)) return false;

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
const getSourceEvidenceCandidates = (source: RetrievalResult): string[] => {
  const evidenceUnits = source.evidence_text.split('\n').flatMap((line) => {
    const cleanLine = line.replace(/^\[[^\]]+\]:?\s*/, '').trim();
    if (!cleanLine) return [];
    const sentences = cleanLine
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 20);
    return sentences.length > 1 ? sentences : [cleanLine];
  });
  const adjacentEvidence = evidenceUnits.flatMap((_, index) =>
    [2, 3]
      .map((windowSize) => evidenceUnits.slice(index, index + windowSize))
      .filter((window) => window.length > 1)
      .map((window) => window.join('\n'))
      .filter((window) => window.length <= 320),
  );
  return [
    ...(source.mid?.evidence_spans?.map((span) => span.quote) || []),
    ...(source.mid?.decisions?.map((decision) => decision.description) || []),
    ...(source.mid?.action_items?.map((item) => item.description) || []),
    ...evidenceUnits,
    ...adjacentEvidence,
  ].filter((candidate, index, candidates) => {
    const normalized = candidate.trim().toLocaleLowerCase();
    return (
      normalized.length > 0 &&
      candidates.findIndex(
        (value) => value.trim().toLocaleLowerCase() === normalized,
      ) === index
    );
  });
};

const getBestEvidenceSpan = (
  source: RetrievalResult,
  claim: string,
): string | undefined => {
  const candidates = getSourceEvidenceCandidates(source);
  return candidates
    .map((evidence, index) => ({
      evidence,
      index,
      score: evidenceSupportScore(claim, evidence),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    )[0]
    ?.evidence.slice(0, 320);
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
          (source ? getSourceEvidenceCandidates(source) : []).some(
            (candidate) => {
              const haystack = candidate.toLowerCase();
              return haystack.includes(needle) || needle.includes(haystack);
            },
          ) ||
          mid?.evidence_spans?.some((span) => {
            const haystack = span.quote.toLowerCase();
            return haystack.includes(needle) || needle.includes(haystack);
          });

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
    const directSupport = [
      citation.evidence_span || '',
      source?.meeting_title || source?.mid?.title || '',
    ]
      .filter(Boolean)
      .join('\n');
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
          .flatMap((item) => {
            const itemSource = sources.find(
              (candidate) => candidate.meeting_id === item.citation.meeting_id,
            );
            return [
              item.citation.evidence_span || '',
              itemSource?.meeting_title || itemSource?.mid?.title || '',
            ];
          })
          .filter(Boolean)
          .join('\n'),
      );
    const evidence_valid =
      structurallyValid &&
      (claimIsSupportedByEvidence(citation.claim, directSupport) ||
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

const CONTEXTLESS_CLAIM_PATTERN =
  /\b(?:one|a|another|the)\s+(?:speaker|participant|attendee)\b|\b(?:an?|the)\s+(?:application|app|project|product|tool)\b/i;

const isContextfulClaim = (claim: string): boolean =>
  !CONTEXTLESS_CLAIM_PATTERN.test(
    claim.replace(/\[Source\s+\d+\]/gi, '').trim(),
  );

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
      isContextfulClaim(cleanSentence) &&
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

export const buildSafeAnswerPresentation = (
  answer: string,
  citations: CitationChain[],
): {
  answer: string;
  citations: CitationChain[];
  outcome: 'answered' | 'partial' | 'no_evidence';
  trustStatus: 'grounded' | 'inferred' | undefined;
  unsupportedClaimCount: number;
} => {
  const cleanAnswer = answer
    .replace(/\[Source\s+\d+\]/gi, '')
    .replace(/<?\-?cite[^>]*>[\s\S]*?<\/cite>/gi, '')
    .trim();
  if (/^I couldn't find information/i.test(cleanAnswer)) {
    return {
      answer: cleanAnswer,
      citations: [],
      outcome: 'no_evidence',
      trustStatus: undefined,
      unsupportedClaimCount: 0,
    };
  }

  const grounding = auditAnswerGrounding(answer, citations);
  if (grounding.unsupportedClaimCount === 0) {
    return {
      answer: cleanAnswer,
      citations,
      outcome: 'answered',
      trustStatus:
        grounding.trustStatus === 'inferred' ? 'inferred' : 'grounded',
      unsupportedClaimCount: 0,
    };
  }

  const grouped = new Map<string, CitationChain[]>();
  for (const citation of citations) {
    const key = citation.claim.trim().toLowerCase();
    const group = grouped.get(key) || [];
    group.push(citation);
    grouped.set(key, group);
  }
  const supportedGroups = [...grouped.values()].filter((group) => {
    const meetings = new Set(group.map((citation) => citation.meeting_id));
    return (
      isContextfulClaim(group[0].claim) &&
      group.every((citation) => citation.evidence_valid) &&
      (!COMPARATIVE_CLAIM_PATTERN.test(group[0].claim) || meetings.size >= 2)
    );
  });
  const supportedCitations = supportedGroups.flat();
  if (supportedCitations.length === 0) {
    return {
      answer:
        "I found meeting material, but it doesn't contain enough specific, supported context to answer that clearly.",
      citations: [],
      outcome: 'no_evidence',
      trustStatus: undefined,
      unsupportedClaimCount: grounding.unsupportedClaimCount,
    };
  }

  const supportedClaims = supportedGroups.map((group) => group[0].claim.trim());
  const supportedClaimSeparator = supportedClaims.every((claim) =>
    /^[-*]\s/.test(claim),
  )
    ? '\n'
    : '\n\n';
  const inferred = supportedGroups.some(
    (group) =>
      new Set(group.map((citation) => citation.meeting_id)).size >= 2 ||
      group.some((citation) => citation.trust_status === 'inferred'),
  );
  return {
    answer: supportedClaims.join(supportedClaimSeparator),
    citations: supportedCitations,
    outcome: 'partial',
    trustStatus: inferred ? 'inferred' : 'grounded',
    unsupportedClaimCount: grounding.unsupportedClaimCount,
  };
};

type SafeAnswerPresentation = ReturnType<typeof buildSafeAnswerPresentation>;

/**
 * Buffers provider tokens at the trust boundary and releases only claims that
 * already have a complete, audited source reference. The final presentation
 * remains authoritative, but it can no longer retract an unsupported raw draft
 * that the renderer was allowed to present as an answer.
 */
export const createValidatedAnswerStream = (
  sources: RetrievalResult[],
  onDelta: (delta: string) => void,
): {
  push: (delta: string) => void;
  finalize: (answer: string) => SafeAnswerPresentation;
  readonly streamedAnswer: string;
} => {
  let rawAnswer = '';
  let streamedAnswer = '';
  let auditedReferenceCount = 0;

  const emitSupportedExtension = (
    presentation: SafeAnswerPresentation,
  ): void => {
    if (
      presentation.outcome === 'no_evidence' ||
      !presentation.answer.startsWith(streamedAnswer) ||
      presentation.answer.length === streamedAnswer.length
    ) {
      return;
    }
    const delta = presentation.answer.slice(streamedAnswer.length);
    streamedAnswer = presentation.answer;
    onDelta(delta);
  };

  const auditCurrentAnswer = (): SafeAnswerPresentation => {
    const citations = auditCitations(
      buildCitationChain(rawAnswer, sources),
      sources,
    );
    return buildSafeAnswerPresentation(rawAnswer, citations);
  };

  const push = (delta: string): void => {
    if (!delta) return;
    rawAnswer += delta;
    const references = [...rawAnswer.matchAll(/\[Source\s+\d+\]/gi)];
    if (references.length <= auditedReferenceCount) return;

    auditedReferenceCount = references.length;
    emitSupportedExtension(auditCurrentAnswer());
  };

  return {
    push,
    finalize: (answer: string) => {
      rawAnswer = answer;
      return auditCurrentAnswer();
    },
    get streamedAnswer() {
      return streamedAnswer;
    },
  };
};
