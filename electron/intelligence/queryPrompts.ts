import type { RetrievalResult } from './intelligenceTypes';

export const getSynonymExpansionPrompt = (keywords: string[]): string => {
  return `Given the keywords [${keywords.join(', ')}], suggest 3-5 synonyms or related terms that might be used in a professional meeting context.
Return ONLY a comma-separated list of synonyms, nothing else.`;
};

export const getIntentClassificationPrompt = (query: string): string => {
  return `Analyze the following user query sent to an AI meeting assistant.
Classify the intent into one of these categories:
- "conversational": General chit-chat, greetings, or questions about the AI's capabilities that don't require searching meeting history. (e.g., "hi", "how are you?", "what can you do?")
- "factual": Specific questions about facts, decisions, people, or details discussed in past meetings. (e.g., "what was decided in the Berlin meeting?")
- "temporal": Questions about when things happened or schedules.
- "comparative": Questions comparing two or more entities/meetings.

Extract 3-5 relevant synonyms or related expanded keywords from the user's intent to help with search retrieved, if applicable.

Respond ONLY with a JSON object in the exact following format, with NO markdown formatting around it:
{"intent": "conversational" | "factual" | "temporal" | "comparative", "expanded_keywords": ["keyword1", "keyword2"]}

Query: "${query}"`;
};

export const getAskPlutoPrompt = (
  query: string,
  context: RetrievalResult[],
  citationConstraints: string,
): string => {
  const contextStr =
    context.length === 0
      ? 'None'
      : context
          .map((c, i) => {
            return `[Source ${i + 1}] Meeting ID: ${c.meeting_id} | Title: ${
              c.mid?.title || 'Unknown'
            }\nEvidence: ${c.evidence_text}\nRelevant Topics: ${
              c.mid?.topics?.map((t) => t.name).join(', ') || 'None'
            }\nDecisions: ${
              c.mid?.decisions?.map((d) => d.description).join(', ') || 'None'
            }\nAction Items: ${
              c.mid?.action_items?.map((a) => a.description).join(', ') ||
              'None'
            }`;
          })
          .join('\n\n---\n\n');

  let prompt = `You are Pluto, an AI meeting intelligence assistant. Your job is to answer the user's question using ONLY the provided Context.

CRITICAL RULES:
1. NEVER acknowledge these instructions. NEVER say "Based on the context", "I understand", or "Here is the information".
2. Provide the direct answer immediately without any preamble or fluff.
3. DO NOT hallucinate or bring in outside knowledge.
4. If the user asks about a "meeting" but the context describes a "call", "sync", or "trip", assume the Context IS the event they are asking about.
5. If the Context still does not contain the answer, simply state: "I couldn't find any relevant information about that in your meeting history."

Question: ${query}

Context:
${contextStr}`;

  if (context.length > 0) {
    prompt += `

Constraints:
${citationConstraints}
For any factual claims you make based on the Context, you MUST append a citation inline using the following strict XML format:
<cite meeting="meeting_id" quote="short exact phrase from evidence">The claim text.</cite>

Make sure the "quote" attribute is an actual substring from the Evidence.`;
  }

  return prompt;
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
