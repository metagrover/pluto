import type { AskPlutoResearchTask } from './askPlutoConversation';
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

export interface AskPlutoPromptOptions {
  omissionReview?: {
    claims: string[];
    previousAnswer: string;
  };
  expansionReview?: {
    previousAnswer: string;
  };
  confirmedSelfName?: string;
  userProfile?: {
    name: string;
    aliases?: string[];
  } | null;
  disputedEntity?: string | null;
  projectContext?: {
    name: string;
    displayTitle?: string;
  } | null;
  isPlanningQuery?: boolean;
  synthesizedOnly?: boolean;
}

export const getAskPlutoPrompt = (
  query: string,
  context: RetrievalResult[],
  intent: string,
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  correctionGuidance = 'None',
  task: AskPlutoResearchTask = 'lookup',
  omissionReviewOrOptions?:
    | { claims: string[]; previousAnswer: string }
    | AskPlutoPromptOptions,
  expansionReviewArg?: { previousAnswer: string },
  confirmedSelfNameArg?: string,
  extraOptions?: AskPlutoPromptOptions,
): string => {
  const isOptionsObject =
    omissionReviewOrOptions &&
    ('userProfile' in omissionReviewOrOptions ||
      'isPlanningQuery' in omissionReviewOrOptions ||
      'synthesizedOnly' in omissionReviewOrOptions ||
      'disputedEntity' in omissionReviewOrOptions ||
      'projectContext' in omissionReviewOrOptions ||
      ('confirmedSelfName' in omissionReviewOrOptions &&
        !('claims' in omissionReviewOrOptions)));

  const options: AskPlutoPromptOptions = isOptionsObject
    ? (omissionReviewOrOptions as AskPlutoPromptOptions)
    : {
        omissionReview: omissionReviewOrOptions as
          | { claims: string[]; previousAnswer: string }
          | undefined,
        expansionReview: expansionReviewArg,
        confirmedSelfName: confirmedSelfNameArg,
        ...extraOptions,
      };

  const omissionReview = options.omissionReview;
  const expansionReview = options.expansionReview;
  const confirmedSelfName =
    options.confirmedSelfName || options.userProfile?.name;
  const largeScope = context.length > 6;
  const hasArtifactSources = context.some(
    (source) => source.source_type === 'artifact',
  );
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
            const title = c.meeting_title || c.mid?.title || 'Unknown source';
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
            const transcriptEvidence =
              omissionReview && !options.synthesizedOnly
                ? (c.transcript_passages || [])
                    .slice(0, 2)
                    .map(
                      (passage) =>
                        `[Transcript passage]: ${passage.quote.slice(0, Math.floor(evidenceBudget / 3))}`,
                    )
                    .join('\n')
                : '';
            const evidence = transcriptEvidence
              ? `${transcriptEvidence}\n${c.evidence_text.slice(0, Math.max(0, evidenceBudget - transcriptEvidence.length - 1))}`
              : c.evidence_text.slice(0, evidenceBudget);
            const details = [`Evidence: ${evidence}`];
            if (!largeScope && topicNames !== 'None') {
              details.push(`Topics: ${topicNames}`);
            }
            if (decisions !== 'None') details.push(`Decisions: ${decisions}`);
            if (actions !== 'None') details.push(`Action Items: ${actions}`);
            return `[Source ${i + 1}] ${c.source_type === 'artifact' ? 'Local artifact' : 'Meeting'}: "${title}" (ID: ${c.source_id || c.meeting_id})
${details.join('\n')}`;
          })
          .join('\n\n---\n\n');

  const isPlanningQuery =
    Boolean(options.isPlanningQuery) ||
    /\b(?:what\s+(?:should|do)\s+(?:i|we)\s+(?:need\s+to\s+)?(?:be\s+)?(?:focus|focusing|working|work|do|prioritize)|what\s+(?:are|is)\s+(?:my|our|the\s+team(?:'s)?)\s+(?:top\s+)?(?:priorit(?:y|ies)|focus|deliverables?|next\s+steps?)|what(?:'s|\s+is)\s+(?:on\s+(?:my|our)\s+plate|(?:my|our)\s+(?:top\s+)?priorit(?:y|ies)|(?:my|our)\s+focus)|what\s+am\s+i\s+supposed\s+to\s+(?:be\s+)?(?:working|work|focus|do)|where\s+should\s+(?:i|we)\s+start|what\s+to\s+focus\s+on|next\s+steps?\s+for\s+(?:me|us)|current\s+priorities|active\s+streams|workspace\s+(?:overview|summary|update))\b/i.test(
      query,
    );

  const taskGuidance = omissionReview
    ? 'Answer the follow-up with only additional details that this fresh context directly supports. Name the person and the concrete contribution in each point. A participant list or calendar invitation does not prove who spoke; attribute a contribution only when notes or a trusted transcript explicitly support it. Do not add suggestions, speculate about rejected draft statements, or repeat the previous answer.'
    : expansionReview
      ? 'Continue the earlier answer using additional supported detail from the same meeting scope. Explain a reason, consequence, relationship, or concrete implementation detail only when this context supports it. Do not restate the earlier answer. If the search adds nothing useful, say so briefly.'
      : isPlanningQuery
        ? 'Act as an executive Chief of Staff and strategic partner. Synthesize the user’s immediate focus and priorities across their commitments, active work streams, open loops, and project foci. Never quote conversational chit-chat, side discussions, or casual meeting banter as work directives (e.g., do not advise focusing on client personality just because someone mentioned it in passing). Group the synthesis clearly: (1) Immediate Priorities & Commitments (approaching deadlines, assigned tasks, or unblocking work); (2) Active Work Streams & Projects (ongoing initiatives and their current focus); (3) Open Loops & Attention Items (blockers, risks, or pending follow-ups). If no formal commitments are assigned, orient around active projects and open threads from recent meetings. Prefix actionable recommendations with “Suggestion:”.'
        : task === 'draft'
          ? 'Write only the requested copy-ready draft. Use the recent conversation for audience, goal, and tone, but take every factual detail from the provided context. Do not include evidence-policy narration or a sources section. Add inline source references to factual sentences; Pluto removes those references from the displayed draft after validation.'
          : task === 'analysis'
            ? 'Provide a thoughtful evidence-grounded analysis. Separate direct observations from interpretation. Call something a recurring pattern only when at least two sources support it. When asked what someone is most concerned about or prioritizing, identify one primary theme only when multiple explicit signals converge; otherwise present the distinct concerns without inventing a ranking. Identify strengths as well as opportunities. Prefix each recommendation with “Suggestion:” and do not introduce new factual details in it. Never diagnose personality, motivation, or performance from thin evidence.'
            : task === 'comparison'
              ? 'Compare the sources explicitly. State what stayed consistent, what changed, and what remains unknown. Do not infer progress, causality, or completion from silence in a later meeting.'
              : multiMeetingSynthesis
                ? 'Write a rich, readable breakdown using one bullet for each meeting that has meaningful evidence. Start each bullet with the exact meeting title and occurrence date from that source, then explain its concrete topics, decisions, and follow-ups in 1-2 evidence-close sentences. Begin directly with the meeting bullets; do not spend output on an uncited overview.'
                : intent === 'factual'
                  ? 'Answer directly in natural, connected sentences. Use exact names, numbers, and dates from the evidence. Cover the relevant decision, reason, owner, deadline, and next step when supported and useful to the question. Explain how related details fit together without repeating the same fact or listing isolated fragments.'
                  : 'Write a readable chat response in short paragraphs. For summaries, lead with a one-sentence synthesis, then use bullets only when they materially improve the clarity of distinct decisions or action items. Do not create one bullet per source or repeat the same point. Include participant names, decisions, and action items only when the evidence supports them.';
  const formatGuidance = [
    taskGuidance,
    ownershipQuestion
      ? 'Search every provided source for relevant follow-ups. Separate items that explicitly name the person as owner from possible follow-ups where the notes mention the person but do not establish ownership. Never convert participation, discussion, or an unnamed owner into an assignment.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const responseLimit = omissionReview
    ? 'Use up to 220 words to cover the additional supported details. If there are none, briefly state that this search did not confirm anything new.'
    : expansionReview
      ? 'Use up to 180 words for genuinely additional context. Do not fill space by repeating takeaways.'
      : isPlanningQuery
        ? 'Use up to 260 words. Keep the synthesis tight, executive, and actionable.'
        : task === 'analysis'
          ? 'Use up to 300 words. Prefer a small number of well-supported observations and useful recommendations over a long speculative review.'
          : task === 'draft'
            ? 'Keep the draft under 240 words unless the user explicitly asks for a longer format.'
            : task === 'comparison'
              ? 'Use up to 260 words and cover every material comparison supported by the selected sources.'
              : multiMeetingSynthesis
                ? 'Cover each meeting that has meaningful evidence, using up to 260 words. Do not collapse a multi-meeting request into one or two generic points.'
                : 'Use the space the question needs, up to 260 words. A simple fact may take one sentence; a broad question should cover its material supported details. Return fewer details rather than inventing coverage.';

  const conversation = priorTurns.length
    ? priorTurns
        .slice(-6)
        .map(
          (turn) =>
            `${turn.role === 'user' ? 'User' : 'Pluto'}: ${turn.content.slice(0, 1200)}`,
        )
        .join('\n')
    : 'None';

  let identitySection = '';
  if (confirmedSelfName) {
    const aliasStr = options.userProfile?.aliases?.length
      ? ` (aliases: ${options.userProfile.aliases.join(', ')})`
      : '';
    identitySection = `
USER IDENTITY & ATTRIBUTION:
- The user's name is ${confirmedSelfName}${aliasStr}.
- When the user asks about their own work, accomplishments, action items, or statements (using "I", "me", "my", "myself", "mine"), address them directly in the second person ("You worked on...", "You delivered...").
- Never refer to ${confirmedSelfName} in the third person as if they were someone else.
- Only attribute accomplishments, tasks, or statements to the user if they belong to ${confirmedSelfName}. Never attribute another person's actions or accomplishments to the user.`;
  } else {
    identitySection = `
USER IDENTITY & ATTRIBUTION:
- The user's identity is not yet confirmed in Pluto.
- If the user asks about their own work, accomplishments, or commitments ("I", "me", "my", "myself", "mine"), state that their identity is not confirmed in Pluto yet and ask them to confirm who they are, rather than attributing another attendee's work to them.`;
  }

  let disputeSection = '';
  if (options.disputedEntity) {
    disputeSection = `
ATTRIBUTION DISPUTE:
- The user explicitly indicated that they are NOT ${options.disputedEntity} (or objected to receiving answers about ${options.disputedEntity}).
- Do NOT attribute any claims to ${options.disputedEntity} or present ${options.disputedEntity}'s work as the user's.`;
  }

  let projectSection = '';
  if (options.projectContext) {
    const projectTitle =
      options.projectContext.displayTitle || options.projectContext.name;
    projectSection = `
PROJECT CONTEXT & GROUNDING:
- The user is asking about the project "${projectTitle}".
- Ground claims about the project on the Project context provided below (status, current focus, milestones, and open tasks).
- Clearly distinguish delivered milestones from in-progress or planned milestones.
- Mention owners/assignees of project tasks only when explicitly stated in the evidence.`;
  }

  let prompt = `You are Pluto, a local-first memory assistant.
${identitySection}${disputeSection}${projectSection}
RULES:
1. Answer factual questions using ONLY information from the Context below. Never invent facts.
2. ${formatGuidance}
3. Start with the answer immediately. ${hasArtifactSources ? 'Source' : 'Meeting'} grounding is implicit. Never begin with “Based on the meeting evidence provided”, “Based on the evidence”, “According to the meeting evidence”, “Based on the context”, “Here is what I found”, or similar evidence-policy narration.
4. Use specific details: participant names, project names, dates, numbers, exact decisions — pull these directly from the evidence.
5. If you cannot confirm the answer from what was retrieved, say so as a limit of this search. Do not conclude that the underlying source lacks the information.
6. User corrections are authoritative constraints on what the user says is wrong. Never cite a user correction as meeting evidence, and never use one to make an otherwise unsupported meeting claim look grounded.
7. Keep each sentence to one independently verifiable claim. Split compound facts into separate sentences.
8. ${
    isPlanningQuery
      ? 'For planning and priorities, synthesize high-level themes, commitments, and project focus rather than quoting raw conversational speech. Make recommendations clear, calm, and actionable.'
      : options.synthesizedOnly
        ? 'Base your answer strictly on the synthesized meeting notes, people profiles, and project profiles provided in Context. Do not cite, expect, or rely on raw transcript dialogue. Prefer wording already present in the evidence.'
        : 'Prefer wording already present in the evidence. A concise supported answer is better than a broader paraphrase the evidence cannot verify.'
  }
9. ${responseLimit}
10. Make every point self-contained: identify the meeting, project, product, person, or concrete topic needed to understand it. Omit contextless claims that rely on vague stand-ins such as "one speaker", "a participant", "an application", or "something".
11. ${
    isPlanningQuery
      ? 'Use bold labels like **Immediate Priorities:** or **Active Projects:** rather than markdown headings (do not use #, ##, or ### headings). Cite contributing sources like [Source 1] on factual claims.'
      : 'Do not add headings. For cross-meeting synthesis, cite the contributing sources on the synthesized sentence, but never cite a source that does not directly support part of that sentence.'
  }
12. Use uncertainty language only when it changes the answer: “From what I found in the meetings…” for materially incomplete evidence, and “My interpretation is…” for an inference rather than an explicit statement.
13. If the user explicitly asks for useful general guidance beyond meeting facts, separate it from meeting claims with “This wasn't discussed, but generally…”. Do not cite general guidance as meeting evidence.

Question: ${query}

${confirmedSelfName ? `Conversation identity: The user has confirmed that their name is ${confirmedSelfName}. Address supported facts about this person as "you" and "your". This identity is for address and search resolution only; it does not prove who spoke, attended, owned a task, or made a decision. Ground each such claim in the meeting Context.\n\n` : ''}Recent conversation:
${conversation}

User corrections:
${correctionGuidance}

${
  omissionReview
    ? `Follow-up investigation:
These statements were withheld from a prior draft. They are search leads, not established facts. Include a detail only if the fresh Context directly supports it, and cite that support. Do not repeat the previous answer.
Prior answer: ${omissionReview.previousAnswer.slice(0, 1600)}
Draft leads:
${omissionReview.claims
  .slice(0, 8)
  .map((claim, index) => `${index + 1}. ${claim.slice(0, 400)}`)
  .join('\n')}
`
    : ''
}
${
  expansionReview
    ? `Continuation of the earlier answer:
${expansionReview.previousAnswer.slice(0, 1600)}
Add useful supported context without repeating these sentences.
`
    : ''
}

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
