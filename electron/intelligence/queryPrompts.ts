import type { RetrievalResult } from './intelligenceTypes';

export const getSynonymExpansionPrompt = (keywords: string[]): string => {
  return `Given the keywords [${keywords.join(', ')}], suggest 3-5 synonyms or related terms that might be used in a professional meeting context.
Return ONLY a comma-separated list of synonyms, nothing else.`;
};

export const getAskPlutoPrompt = (
  query: string,
  context: RetrievalResult[],
  citationConstraints: string,
): string => {
  const contextStr = context
    .map((c, i) => {
      return `[Source ${i + 1}] Meeting ID: ${c.meeting_id} | Title: ${
        c.mid?.title || 'Unknown'
      }\nEvidence (Relevance): ${c.evidence_text}\nRelevant Extracted Topics: ${
        c.mid?.topics?.map((t) => t.name).join(', ') || 'None'
      }\nRelevant Extracted Decisions: ${
        c.mid?.decisions?.map((d) => d.description).join(', ') || 'None'
      }\nRelevant Action Items: ${
        c.mid?.action_items?.map((a) => a.description).join(', ') || 'None'
      }`;
    })
    .join('\n\n---\n\n');

  return `You are Pluto, an AI meeting intelligence assistant. Answer the user's question based strictly on the provided meeting context.

Question: ${query}

Context:
${contextStr}

Constraints:
${citationConstraints}
Your response must include citations using the <cite> tag format:
<cite meeting="meeting_id" entity="entity_id" quote="exact_quote_from_evidence">The claim you are making.</cite>

Make sure every factual claim is wrapped in a <cite> tag referencing the appropriate meeting_id and quote. 
If an entity ID is applicable, include it. The "quote" should be as exact as possible based on the Evidence context provided.`;
};

export const getSynthesisPrompt = (sources: RetrievalResult[]): string => {
  const contextStr = sources
    .map((c, i) => {
      return `[Source ${i + 1}] Meeting ID: ${c.meeting_id} | Title: ${
        c.mid?.title || 'Unknown'
      }`;
    })
    .join('\n');

  return `Synthesize the following meeting context into a coherent narrative. Identify the common themes, action items, and cross-cutting decisions.
  
Available context:
${contextStr}`;
};
