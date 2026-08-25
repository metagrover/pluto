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
  // Find the sentence boundaries around the match
  const before = text.substring(0, matchIndex);
  const after = text.substring(matchIndex);

  // Look backwards for sentence start
  const sentenceStartMatch = before.match(/(?:^|[.!?\n])\s*([^.!?\n]*)$/);
  const sentenceStart = sentenceStartMatch
    ? sentenceStartMatch[1]
    : before.slice(-100);

  // Look forwards for sentence end
  const sentenceEndMatch = after.match(/^[^.!?\n]*[.!?\n]?/);
  const sentenceEnd = sentenceEndMatch
    ? sentenceEndMatch[0]
    : after.slice(0, 100);

  return (sentenceStart + sentenceEnd).replace(/\[Source\s+\d+\]/gi, '').trim();
};

/**
 * Get the first meaningful evidence span from a retrieval result's MID.
 */
const getFirstEvidenceSpan = (source: RetrievalResult): string | undefined => {
  if (source.mid?.evidence_spans && source.mid.evidence_spans.length > 0) {
    return source.mid.evidence_spans[0].quote;
  }
  // Fallback: extract first useful segment from evidence text
  const evidenceLines = source.evidence_text
    .split('\n')
    .filter((l) => l.trim().length > 20 && !l.startsWith('['));
  return evidenceLines[0]?.trim().substring(0, 200);
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
  const seenSources = new Set<number>();

  // Primary: match [Source N] references
  const sourceRefRegex = /\[Source\s+(\d+)\]/gi;
  for (const match of answer.matchAll(sourceRefRegex)) {
    const sourceIdx = Number.parseInt(match[1], 10) - 1; // 0-indexed
    if (
      sourceIdx >= 0 &&
      sourceIdx < sources.length &&
      !seenSources.has(sourceIdx)
    ) {
      seenSources.add(sourceIdx);
      const source = sources[sourceIdx];
      const claim = extractSurroundingSentence(answer, match.index ?? 0);

      citations.push({
        claim,
        meeting_id: source.meeting_id,
        meeting_title:
          source.meeting_title || source.mid?.title || 'Unknown Meeting',
        evidence_span: getFirstEvidenceSpan(source),
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
export const auditCitations = (citations: CitationChain[]): CitationChain[] => {
  return citations.map((citation) => {
    let evidence_valid = true;

    // 1. Verify meeting and MID exist
    const mid = getMeetingMid(citation.meeting_id);
    if (!mid) {
      evidence_valid = false;
    } else {
      // 2. Verify entity_id resolves if provided and not empty
      if (citation.entity_id && citation.entity_id.trim() !== '') {
        const entity = getEntity(citation.entity_id);
        if (!entity) {
          evidence_valid = false;
        }
      }

      // 3. Verify evidence span exists in MID spans if provided and not empty
      if (
        evidence_valid &&
        citation.evidence_span &&
        citation.evidence_span.trim() !== ''
      ) {
        const needle = citation.evidence_span.toLowerCase().trim();
        const spanFound = mid.evidence_spans?.some((span) => {
          const haystack = span.quote.toLowerCase();
          return haystack.includes(needle) || needle.includes(haystack);
        });

        if (!spanFound) {
          evidence_valid = false;
        }
      }
    }

    return {
      ...citation,
      evidence_valid,
      trust_status: deriveCitationTrustStatus({
        evidenceValid: evidence_valid,
      }),
    };
  });
};
