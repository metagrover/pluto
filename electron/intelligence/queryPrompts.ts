import type { AskPlutoConversationContext } from '../../src/types/askPlutoQuery';
import type { AskPlutoResearchTask } from './askPlutoConversation';
import type { ConversationTurnMode } from './conversationController';
import type { RetrievalResult } from './intelligenceTypes';
import { excerptQueryEvidence } from './queryEvidenceExcerpt';

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
    asOf?: string;
    latestNoteAt?: string;
  } | null;
  activeConversationContext?: AskPlutoConversationContext | null;
  conversationMode?: ConversationTurnMode;
  isPlanningQuery?: boolean;
}

export const anchorRelativeSourceDates = (evidence: string): string => {
  const recordedAt = evidence.match(
    /\[(?:Occurred|Meeting date)\]:\s*(\d{4}-\d{2}-\d{2})/i,
  )?.[1];
  if (!recordedAt || recordedAt >= new Date().toISOString().slice(0, 10)) {
    return evidence;
  }
  return evidence
    .replace(/\btoday\b/gi, `on the meeting date (${recordedAt})`)
    .replace(/\btomorrow\b/gi, `the day after the meeting (${recordedAt})`)
    .replace(/\bcurrently\b/gi, `at the time of the meeting (${recordedAt})`)
    .replace(
      /\bnext\s+(Monday|Tuesday|Wednesday|Thursday|Friday)\b/gi,
      (_, weekday: string) =>
        `the ${weekday} after the meeting (${recordedAt})`,
    );
};

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
      'omissionReview' in omissionReviewOrOptions ||
      'expansionReview' in omissionReviewOrOptions ||
      'isPlanningQuery' in omissionReviewOrOptions ||
      'disputedEntity' in omissionReviewOrOptions ||
      'projectContext' in omissionReviewOrOptions ||
      'activeConversationContext' in omissionReviewOrOptions ||
      'conversationMode' in omissionReviewOrOptions ||
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
  const requiresInlineCitations = Boolean(omissionReview);
  const confirmedSelfName =
    options.confirmedSelfName || options.userProfile?.name;
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
  const attributionQuestion =
    /\bwho\s+(?:said|asked|requested|assigned|decided|told|stated)\b/i.test(
      query,
    );
  const conciseDraft =
    task === 'draft' &&
    /\b(?:brief|briefer|concise|short|shorter|tighter)\b/i.test(query);
  const shorteningDraft =
    task === 'draft' &&
    /\b(?:shorter|briefer|tighter|shorten|condense)\b/i.test(query);
  const priorDraftWords = [...priorTurns]
    .reverse()
    .find((turn) => turn.role === 'assistant')
    ?.content.trim()
    .split(/\s+/).length;
  const conciseDraftWords =
    shorteningDraft && priorDraftWords
      ? Math.min(80, Math.max(20, Math.floor(priorDraftWords * 0.7)))
      : 80;
  const personExpectationQuestion =
    /\bwhat\s+do\s+you\s+think\s+(?:will|would)\s+satisfy\b|\b(?:their|his|her|[\p{L}'-]+(?:'s|’s))\s+expectations?\b/iu.test(
      query,
    );
  const personWorkQuestion =
    /\bwhat(?:'s|\s+is)\s+.+?\s+(?:working\s+on|focused\s+on|doing)\b|\bwhat\s+does\s+.+?\s+(?:work\s+on|focus\s+on|do)\b/i.test(
      query,
    );
  const isPlanningQuery =
    Boolean(options.isPlanningQuery) ||
    /\b(?:what\s+(?:should|do)\s+(?:i|we)\s+(?:need\s+to\s+)?(?:be\s+)?(?:focus|focusing|working|work|do|prioritize)|what\s+(?:are|is)\s+(?:my|our|the\s+team(?:'s)?)\s+(?:top\s+)?(?:priorit(?:y|ies)|focus|deliverables?|next\s+steps?)|what(?:'s|\s+is)\s+(?:on\s+(?:my|our)\s+plate|(?:my|our)\s+(?:top\s+)?priorit(?:y|ies)|(?:my|our)\s+focus)|what\s+am\s+i\s+supposed\s+to\s+(?:be\s+)?(?:working|work|focus|do)|where\s+should\s+(?:i|we)\s+start|what\s+to\s+focus\s+on|next\s+steps?\s+for\s+(?:me|us)|current\s+priorities|active\s+streams|workspace\s+(?:overview|summary|update))\b/i.test(
      query,
    );

  const expandedEvidence =
    Boolean(options.projectContext) ||
    context.some((source) => source.evidence_kind === 'note') ||
    (isPlanningQuery && task !== 'draft');
  const evidenceBudget = expandedEvidence
    ? Math.min(6000, Math.floor(24_000 / Math.max(1, context.length)))
    : context.length === 1
      ? 2000
      : personExpectationQuestion
        ? Math.max(600, Math.floor(4000 / context.length))
        : largeScope
          ? Math.max(200, Math.floor(5200 / context.length))
          : multiMeetingSynthesis
            ? 1800
            : context.length >= 3
              ? Math.floor(4200 / context.length)
              : 1200;
  // Give short notes their full text before dividing the remaining allowance.
  const evidenceBudgets = context.map(() => evidenceBudget);
  if (expandedEvidence) {
    let remaining = 24_000;
    const shortestFirst = context
      .map((source, index) => ({
        index,
        length: source.evidence_text.length,
      }))
      .sort((a, b) => a.length - b.length);
    shortestFirst.forEach(({ index, length }, rank) => {
      const allocation = Math.min(
        length,
        6000,
        Math.floor(remaining / (context.length - rank)),
      );
      evidenceBudgets[index] = allocation;
      remaining -= allocation;
    });
  }
  const structuredFieldBudget = largeScope
    ? 60
    : personExpectationQuestion
      ? 180
      : 320;
  const contextStr =
    context.length === 0
      ? 'None'
      : context
          .map((c, i) => {
            const title = c.meeting_title || c.mid?.title || 'Unknown source';
            const projectScopedSection = Boolean(
              options.projectContext && c.evidence_kind === 'section',
            );
            const topicNames =
              (projectScopedSection ? undefined : c.mid?.topics)
                ?.map((t) => t.name)
                .join(', ')
                .slice(0, largeScope ? 80 : 200) || 'None';
            const decisions =
              (projectScopedSection ? undefined : c.mid?.decisions)
                ?.map((d) => d.description)
                .join('; ')
                .slice(0, structuredFieldBudget) || 'None';
            const actions =
              (projectScopedSection ? undefined : c.mid?.action_items)
                ?.map((a) => a.description)
                .join('; ')
                .slice(0, structuredFieldBudget) || 'None';
            const sourceBudget = evidenceBudgets[i];
            const sourceEvidence = expandedEvidence
              ? excerptQueryEvidence(c.evidence_text, query, sourceBudget)
              : c.evidence_text.slice(0, sourceBudget);
            const evidence = anchorRelativeSourceDates(sourceEvidence);
            const details = [`Evidence: ${evidence}`];
            if (!largeScope && topicNames !== 'None') {
              details.push(`Topics: ${topicNames}`);
            }
            if (decisions !== 'None') details.push(`Decisions: ${decisions}`);
            if (actions !== 'None') details.push(`Action Items: ${actions}`);
            const sourceLabel =
              c.source_type === 'artifact'
                ? options.projectContext && i === 0
                  ? 'Project profile'
                  : 'Local artifact'
                : 'Meeting';
            const contextLabel = requiresInlineCitations
              ? `Source ${i + 1}`
              : `Context ${i + 1}`;
            return `[${contextLabel}] ${sourceLabel}: "${title}" (ID: ${c.source_id || c.meeting_id})
${details.join('\n')}`;
          })
          .join('\n\n---\n\n');

  const taskGuidance = omissionReview
    ? 'Answer the follow-up with only additional details that this fresh context directly supports. Name the person and the concrete contribution in each point. A participant list or calendar invitation does not prove who spoke; attribute a contribution only when the synthesized notes explicitly support it. Do not add suggestions, speculate about rejected draft statements, or repeat the previous answer.'
    : task === 'draft'
      ? 'Write only the requested copy-ready draft. Return exactly one draft unless the user explicitly asks for alternatives. Do not add a preface, commentary, options, or headings. Use the recent conversation for audience, goal, and tone, but take every factual detail from the provided context. Carry the specific relevant decisions or questions into the draft; do not replace them with a generic request for alignment. Do not present inferred urgency, shifted priorities, or dated plans as current facts; ask the recipient for an update instead. Do not include evidence-policy narration, context labels, or a sources section.'
      : expansionReview && isPlanningQuery && task === 'analysis'
        ? 'Answer the user’s current question about the earlier priority briefing instead of generating another workspace summary. Use the prior answer to preserve the active priorities and the synthesized Context to reason about them. Give candid, constructive feedback in a warm human voice when the user asks for judgment or coaching. Separate observations from recommendations, explain why each recommendation matters, and do not invent performance claims or personal traits.'
        : expansionReview
          ? 'Continue the earlier answer using additional supported detail from the same meeting scope. Explain a reason, consequence, relationship, or concrete implementation detail only when this context supports it. Do not restate the earlier answer. If the search adds nothing useful, say so briefly.'
          : options.projectContext && task === 'analysis'
            ? 'Answer the exact project question first, then add enough related detail to be useful. For a detailed request, connect the current state, concrete work, constraints, and next move only where the synthesized project context supports them. Use at most two descriptive labels if they help; do not fill a fixed template or substitute unrelated strategy for a missing technical detail. State plainly when the requested facet is not recorded. Distinguish the last recorded state from a current update, and write like a thoughtful collaborator, not a database export.'
            : personExpectationQuestion && task === 'analysis'
              ? 'Answer as a bounded interpretation, not as a statement of the person’s recorded expectations. Begin with “My interpretation is…”. Use only synthesized context that explicitly names the person in the question; omit otherwise relevant work that does not name them. Explain which explicit requests, feedback, approvals, or data points support the interpretation. If the context does not record enough person-specific evidence, say so instead of filling the gap with adjacent project facts.'
              : attributionQuestion
                ? 'Answer the attribution question directly. Name a speaker, requester, or assigner only when the same synthesized context passage explicitly attributes the statement or assignment to that person. An action item addressed to “you” does not identify who created or assigned it. If no explicit attribution is present, say that the synthesized note records the requirement but does not identify who said or assigned it.'
                : isPlanningQuery
                  ? 'Answer the user’s planning question naturally. Recommend what to focus on first and explain why, using the freshest relevant notes, explicit ownership, deadlines, and dependencies. Ignore incidental chatter. Distinguish recorded status from your inferred recommendation; an old open item does not prove it remains unfinished. If current ownership or completion is unknown, say so. Use headings or bullets only when they help the answer.'
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
    options.conversationMode === 'challenge'
      ? 'Re-evaluate the prior answer against the current synthesized Context. Say what was overstated, give the latest dated supported picture, and identify any remaining uncertainty. Do not merely agree or restate the earlier answer. Do not claim that newer notes do not exist just because this bounded search did not retrieve them.'
      : '',
    ownershipQuestion
      ? 'Search every provided source for relevant follow-ups. Separate items that explicitly name the person as owner from possible follow-ups where the notes mention the person but do not establish ownership. Never convert participation, discussion, or an unnamed owner into an assignment.'
      : '',
    personWorkQuestion
      ? 'For a question about a named person’s work, describe only tasks the synthesized notes explicitly assign to that person or say they are doing. Work concerning their clients, work done for their review, and work done by a colleague are not their tasks. If the available notes show only involvement or dependencies, say that their current work is not confirmed and describe the involvement separately.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const responseLimit = omissionReview
    ? 'Use up to 220 words to cover the additional supported details. If there are none, briefly state that this search did not confirm anything new.'
    : task === 'draft'
      ? conciseDraft
        ? `Keep the entire draft under ${conciseDraftWords} words. Preserve its concrete questions and requested uncertainty. Use a greeting and one compact paragraph. Omit a sign-off for a chat message unless the user requests one; include one only when the requested format clearly needs it, such as an email. Do not use labels, sections, or bullets.`
        : 'Keep the draft under 140 words unless the user explicitly asks for a longer format. Prefer a single connected message over sections or bullets.'
      : expansionReview && isPlanningQuery && task === 'analysis'
        ? 'Use up to 260 words. Prefer two or three specific observations and practical next moves over a broad inventory of projects.'
        : expansionReview
          ? 'Use up to 180 words for genuinely additional context. Do not fill space by repeating takeaways.'
          : options.projectContext && task === 'analysis'
            ? 'Use up to 360 words when the evidence supports that depth. Prefer a coherent project picture over one bullet per fact.'
            : isPlanningQuery
              ? 'Use up to 260 words. Give specific priorities and reasoning rather than an inventory of every project.'
              : task === 'analysis'
                ? 'Use up to 300 words. Prefer a small number of well-supported observations and useful recommendations over a long speculative review.'
                : task === 'comparison'
                  ? 'Use up to 260 words and cover every material comparison supported by the selected sources.'
                  : multiMeetingSynthesis
                    ? 'Cover each meeting that has meaningful evidence, using up to 260 words. Do not collapse a multi-meeting request into one or two generic points.'
                    : 'Use the space the question needs, up to 260 words. A simple fact may take one sentence; a broad question should cover its material supported details. Return fewer details rather than inventing coverage.';

  const conversationTurns = expansionReview
    ? priorTurns.filter((turn) => turn.role === 'user').slice(-2)
    : priorTurns.slice(-4);
  const conversation = conversationTurns.length
    ? conversationTurns
        .map(
          (turn) =>
            `${turn.role === 'user' ? 'User' : 'Pluto'}: ${turn.content.slice(0, turn.role === 'user' ? 700 : 2000)}`,
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
    const asOf = options.projectContext.asOf;
    const latestNoteAt = options.projectContext.latestNoteAt;
    const isAgingProfile = Boolean(
      asOf && Date.parse(asOf) < Date.now() - 7 * 24 * 60 * 60 * 1000,
    );
    projectSection = `
PROJECT CONTEXT & GROUNDING:
- Context includes the project "${projectTitle}". This is a retrieval hint, not a restriction on the user's question.
- Answer all requested parts using the supplied notes. Keep facts attributed to their own projects; do not transfer status or commitments between workstreams.
- Clearly distinguish delivered milestones from in-progress or planned milestones.
- A past target date does not prove a release slipped, is blocked, or remains incomplete. A recorded issue does not prove it caused a delay. Describe only the status explicitly recorded, and mark current completion or causality unknown when no newer update confirms it.
- Mention owners/assignees of project tasks only when explicitly stated in the evidence.${
      isAgingProfile
        ? `\n- The project profile was last synthesized ${asOf}. Unless a newer project-specific note updates it, describe its status as the last recorded state on that date; do not claim it is current today.`
        : ''
    }${
      latestNoteAt &&
      latestNoteAt.slice(0, 10) < new Date().toISOString().slice(0, 10)
        ? `\n- The newest matched project note occurred ${latestNoteAt.slice(0, 10)}, before today. Words like “today” and “next” in that note refer to its meeting date. Do not turn its past follow-ups into actions due today; describe them as last recorded, and say when current ownership or completion is unknown.`
        : ''
    }`;
  }

  let activeConversationSection = '';
  if (options.activeConversationContext) {
    const activeTopic = options.activeConversationContext.topic;
    const topicLabel =
      activeTopic?.label || activeTopic?.kind || 'the prior answer';
    activeConversationSection = `
ACTIVE CONVERSATION CONTEXT:
- The previous exchange was grounded in ${topicLabel}.
- Interpret the user's new message in light of the recent conversation and this active context. If it continues, critiques, redirects, or asks to deepen the prior answer, respond to that conversational intent using the active sources in Context.
- Keep the answer on the person, project, or concrete item the user named. Do not introduce adjacent workstreams merely because they appear in another retrieved note or in the earlier answer.
- Treat the earlier answer as conversational orientation, not as evidence. Re-check every carried-forward factual detail against the current Context.
- If the user clearly changed topics, answer the new topic and ignore unrelated active-context sources.
- Do not require the user to use a special phrase such as "tell me more" or "go deeper" to continue the discussion.`;
  }

  const personProfile = context.find((source) =>
    source.meeting_id.startsWith('person:'),
  );
  const personProfileAsOf = personProfile?.evidence_text.match(
    /\[Profile as of\]:\s*([^\n]+)/,
  )?.[1];
  const personProfileName = personProfile?.evidence_text.match(
    /\[Person profile\]:\s*([^\n]+)/,
  )?.[1];
  const agedPersonProfile = Boolean(
    personProfileAsOf &&
      Date.parse(personProfileAsOf) < Date.now() - 3 * 24 * 60 * 60 * 1000,
  );
  const personRecencySection = agedPersonProfile
    ? task === 'draft'
      ? `\nPERSON PROFILE RECENCY:\n- This person's profile was last synthesized ${personProfileAsOf}. Use recorded details only as background for the requested draft; do not state old work as current or include an as-of preface in the message.\n`
      : `\nPERSON PROFILE RECENCY:\n- This person's profile was last synthesized ${personProfileAsOf}. Describe its work as the last recorded picture, not confirmed current work. Do not call this work "current," "recent," or "active" unless a newer source confirms it. For coaching advice, make suggestions conditional on that work still being active; do not invent recent performance or new responsibilities.\n`
    : '';
  const otherPersonSection =
    task !== 'draft' &&
    personProfileName &&
    personProfileName.toLocaleLowerCase() !==
      confirmedSelfName?.toLocaleLowerCase()
      ? `\nPERSON SUBJECT:\n- This question is about ${personProfileName}, not the user. Describe ${personProfileName}'s work in the third person. Do not turn ${personProfileName}'s actions into "you" or "your". If the user appears as a collaborator, keep the two people's roles distinct.\n`
      : '';
  const personQuestionFraming =
    agedPersonProfile && task !== 'draft'
      ? `\nAnswer framing: Begin with the profile's as-of date. Describe the person's work as last recorded on that date, not as current work. If offering advice, say what to check before acting on it.`
      : '';

  let prompt = `You are Pluto, a local-first memory assistant. Current UTC date: ${new Date().toISOString().slice(0, 10)}.
${identitySection}${disputeSection}${projectSection}${activeConversationSection}${personRecencySection}${otherPersonSection}
RULES:
1. Answer factual questions using ONLY the synthesized meeting notes, people profiles, and project profiles in Context. Never invent facts or use raw transcript dialogue. You may synthesize and rephrase this healthy context naturally.
2. ${formatGuidance}
3. Start with the answer immediately. ${requiresInlineCitations ? 'Add the inline source references required for validation; Pluto removes them before display.' : 'Provenance is attached by Pluto, so do not mention retrieval, grounding, sources, or context labels in the answer.'} Never begin with “Based on the meeting evidence provided” or similar evidence-policy narration.
4. Use specific names, dates, numbers, decisions, owners, and next steps only where Context supports them. Address each distinct part of the user's question; if one part is unsupported, say which part remains unclear instead of substituting adjacent project history. For an ambiguous term, name your interpretation instead of silently conflating workstreams. If you cannot confirm the answer from what was retrieved, say so as a limit of this search. Do not conclude that the underlying source lacks the information.
5. Write like a thoughtful colleague: lead with the useful judgment, connect related details, and avoid a search-result or compliance-report voice. Make every point self-contained; avoid vague stand-ins such as "an application" or "a participant".
6. ${responseLimit}
7. ${
    requiresInlineCitations
      ? 'Do not add headings. Cite every factual sentence with the smallest set of directly supporting [Source N] references.'
      : options.projectContext
        ? 'If structure helps, use at most two short bold labels that describe the project content; do not use markdown headings (#, ##, ###) or source/context markers.'
        : isPlanningQuery
          ? 'Use short paragraphs, with bullets or brief bold labels only if they make the priorities easier to follow. Do not fill a fixed template or include source/context markers.'
          : 'Do not add headings unless the user asks for a detailed breakdown. Do not include source or context markers in the answer.'
  }
8. Preserve source boundaries: do not transfer a fact between people, projects, or initiatives merely because both appear in Context or conversation. Attribute speech, decisions, requests, expectations, and ownership only when the same synthesized passage explicitly names the person. Participation or second-person wording does not prove ownership. For inferred expectations, say “My interpretation is…” rather than “they expect”.
9. Treat source dates as the age of the information, not proof that an old status is still current. Relative deadlines such as “next Tuesday” are relative to the source's occurrence date, not today; if that target is already past, call it an earlier target or omit it. For priorities and recommendations, separate Pluto's judgment from recorded facts and prefer fresher matching updates.
10. User corrections constrain what the user says is wrong. Never cite a user correction as meeting evidence. When the user asks for advice, distinguish your judgment from recorded facts in natural language; do not imply the source discussed your recommendation.

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
    ? task === 'draft'
      ? `Relevant earlier answer for the draft's factual focus:
${expansionReview.previousAnswer.slice(0, 1200)}
Use it only to identify the one item the user means by "it" or "that"; it is not evidence. Draft about that item alone, without combining adjacent workstreams. Take factual details only from Context. If Context does not support the item's current status, ask the recipient for an update instead of asserting one. Do not continue the earlier answer's structure or offer alternatives.
`
      : `Continuation of the earlier answer:
${expansionReview.previousAnswer.slice(0, 1200)}
Add useful supported context without repeating these sentences.
`
    : ''
}

Context:
${contextStr}`;

  if (context.length > 0 && requiresInlineCitations) {
    prompt += `

CITATION RULES:
- For each factual claim, add an inline source reference like [Source 1] or [Source 2] at the end of the sentence.
- Use the source numbers that correspond to the Context sources above.
- Every bullet point or key claim MUST have at least one [Source N] reference.
- Prefer the smallest set of directly supporting sources; do not append every source to a claim.`;
  }

  prompt += `\n\nUser Query: ${query}${personQuestionFraming}`;
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
