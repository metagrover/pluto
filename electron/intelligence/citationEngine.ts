import { getEntity, getMeetingMid } from '../db';
import type { CitationChain, RetrievalResult } from './intelligenceTypes';

/**
 * Builds a citation chain from the LLM's synthesized answer.
 * We parse out XML-like citation tags and validate them.
 */
export const buildCitationChain = (
  answer: string,
  sources: RetrievalResult[],
): CitationChain[] => {
  const citations: CitationChain[] = [];
  
  // Format we expect from the LLM:
  // <cite meeting="meeting_id" entity="entity_id" quote="exact_quote">claim text</cite>
  const citeRegex = /<cite\s+meeting="([^"]+)"(?:\s+entity="([^"]*)")?(?:\s+quote="([^"]*)")?>([\s\S]*?)<\/cite>/g;
  
  let match;
  while ((match = citeRegex.exec(answer)) !== null) {
    const meeting_id = match[1];
    const entity_id = match[2];
    const evidence_span = match[3];
    const claim = match[4].trim();
    
    // Find the title matching this ID from our sources to populate it
    const source = sources.find((s) => s.meeting_id === meeting_id);
    const meetingTitle = source?.mid?.title || 'Unknown Meeting';

    citations.push({
      claim,
      meeting_id,
      meeting_title: meetingTitle,
      entity_id: entity_id || undefined,
      evidence_span: evidence_span || undefined,
      evidence_valid: false, // will run structural audit later
    });
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
      if (evidence_valid && citation.evidence_span && citation.evidence_span.trim() !== '') {
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
    };
  });
};
