import type { RetrievalResult } from './intelligenceTypes';

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
  intent: string,
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  correctionGuidance = 'None',
): string => {
  const largeScope = context.length > 6;
  const multiMeetingSynthesis =
    context.length > 1 &&
    /\b(?:summari[sz]e|recap|overview|breakdown|analy[sz]e)\b[\s\S]{0,60}\b(?:meetings|calls)\b/i.test(
      query,
    );
  const ownershipQuestion =
    /\b(?:assigned to|action items?|what (?:else )?does .+ own|who owns)\b/i.test(
      query,
    );
  const evidenceBudget =
    context.length === 1
      ? 2600
      : largeScope
        ? Math.max(240, Math.floor(6400 / context.length))
        : multiMeetingSynthesis
          ? 3000
          : 1800;
  const structuredFieldBudget = largeScope ? 80 : 600;
  const contextStr =
    context.length === 0
      ? 'None'
      : context
          .map((c, i) => {
            const title = c.meeting_title || c.mid?.title || 'Unknown Meeting';
            const topicNames =
              c.mid?.topics
                ?.map((t) => t.name)
                .join(', ')
                .slice(0, largeScope ? 100 : 400) || 'None';
            const decisions =
              c.mid?.decisions
                ?.map((d) => d.description)
                .join('; ')
                .slice(0, structuredFieldBudget) || 'None';
            const actions =
              c.mid?.action_items
                ?.map((a) => a.description)
                .join('; ')
                .slice(0, structuredFieldBudget) || 'None';
            const evidence = c.evidence_text.slice(0, evidenceBudget);
            const details = [`Evidence: ${evidence}`];
            if (!largeScope && topicNames !== 'None') {
              details.push(`Topics: ${topicNames}`);
            }
            if (decisions !== 'None') details.push(`Decisions: ${decisions}`);
            if (actions !== 'None') details.push(`Action Items: ${actions}`);
            return `[Source ${i + 1}] Meeting: "${title}" (ID: ${c.meeting_id})
${details.join('\n')}`;
          })
          .join('\n\n---\n\n');

  const formatGuidance = multiMeetingSynthesis
    ? 'Write a rich, readable breakdown using one bullet for each meeting that has meaningful evidence. Start each bullet with the exact meeting title and occurrence date from that source, then explain its concrete topics, decisions, and follow-ups in 1-2 evidence-close sentences. Begin directly with the meeting bullets; do not spend output on an uncited overview.'
    : ownershipQuestion
      ? 'Search every provided source for relevant follow-ups. Separate items that explicitly name the person as owner from possible follow-ups where the notes mention the person but do not establish ownership. Never convert participation, discussion, or an unnamed owner into an assignment.'
      : intent === 'factual'
        ? 'Answer directly and specifically. Use exact names, numbers, and dates from the evidence. Include the decision, owner, deadline, or next step when it directly helps answer the question.'
        : 'Write a readable chat response in short paragraphs. For summaries, lead with a one-sentence synthesis, then use bullets only when they materially improve the clarity of distinct decisions or action items. Do not create one bullet per source or repeat the same point. Include participant names, decisions, and action items only when the evidence supports them.';
  const responseLimit = multiMeetingSynthesis
    ? 'Cover each meeting that has meaningful evidence, using up to 260 words. Do not collapse a multi-meeting request into one or two generic points.'
    : 'Use up to 4 supported points and stay under 160 words. Return fewer rather than inventing coverage.';

  const conversation = priorTurns.length
    ? priorTurns
        .slice(-6)
        .map(
          (turn) =>
            `${turn.role === 'user' ? 'User' : 'Pluto'}: ${turn.content.slice(0, 1200)}`,
        )
        .join('\n')
    : 'None';

  let prompt = `You are Pluto, an AI meeting intelligence assistant.

RULES:
1. Answer meeting-fact questions using ONLY information from the Context below. Never invent facts.
2. ${formatGuidance}
3. Start with the answer immediately. No preamble like "Based on the context" or "Here is what I found".
4. Use specific details: participant names, project names, dates, numbers, exact decisions — pull these directly from the evidence.
5. If the Context does not contain the answer, say: "I couldn't find information about that in your meetings."
6. User corrections are authoritative constraints on what the user says is wrong. Never cite a user correction as meeting evidence, and never use one to make an otherwise unsupported meeting claim look grounded.
7. Keep each sentence to one independently verifiable claim. Split compound facts into separate sentences.
8. Prefer wording already present in the evidence. A concise supported answer is better than a broader paraphrase the evidence cannot verify.
9. ${responseLimit}
10. Make every point self-contained: identify the meeting, project, product, person, or concrete topic needed to understand it. Omit contextless claims that rely on vague stand-ins such as "one speaker", "a participant", "an application", or "something".
11. Do not add headings. For cross-meeting synthesis, cite the contributing sources on the synthesized sentence, but never cite a source that does not directly support part of that sentence.

Question: ${query}

Recent conversation:
${conversation}

User corrections:
${correctionGuidance}

Context:
${contextStr}`;

  if (context.length > 0) {
    prompt += `

CITATION RULES:
- For each factual claim, add an inline source reference like [Source 1] or [Source 2] at the end of the sentence.
- Use the source numbers that correspond to the Context sources above.
- Every bullet point or key claim MUST have at least one [Source N] reference.
- Prefer the smallest set of directly supporting sources; do not append every source to a claim.`;
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
