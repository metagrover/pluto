import type { AskPlutoConversationTurn } from '../../src/types/askPlutoQuery';

export type ConversationTurnMode =
  | 'social'
  | 'clarify'
  | 'challenge'
  | 'expand'
  | 'draft'
  | 'act'
  | 'topic_switch'
  | 'lookup';

export type ConversationRetrievalPolicy = 'none' | 'reuse' | 'fresh';

export interface ConversationTurnDecision {
  mode: ConversationTurnMode;
  retrieval: ConversationRetrievalPolicy;
  usesPriorTurn: boolean;
}

export interface ConversationActionProposal {
  kind: 'create_commitment';
  text: string;
  label: string;
}

const EXPLICIT_TOPIC_SWITCH =
  /^(?:new question|separately|unrelated(?: question)?|switching topics?|on another (?:topic|note)|different question|moving on)(?=$|[\s,:;.!?])/i;
const EXPANSION =
  /^(?:and\s+)?(?:tell me more|show me more|more|go deeper|dive (?:in|into)|expand(?: on)?|elaborate(?: on)?|what else|anything else|is that all)\b/i;
const CLARIFICATION =
  /\b(?:what do you mean|how do you mean|why do you say|how so|can you clarify|help me understand|walk me through that|explain that)\b/i;
const CHALLENGE =
  /\b(?:i (?:do not|don't) (?:agree|think so|buy that)|that (?:is not|isn't|does not|doesn't) (?:right|sound right|make sense)|you (?:missed|left out|overlooked|misunderstood)|not quite|i(?:'m| am) not convinced|are you sure|(?:that|this)(?:'s|’s| is) (?:wrong|incorrect|inaccurate|not (?:right|correct))|you(?:'re| are) (?:wrong|incorrect)|^(?:no[,! ]+)?(?:wrong|incorrect)\b|that seems (?:wrong|off|stale)|actually[, ]|correction[: ])\b/i;
const DRAFT =
  /\b(?:draft|write|rewrite|compose|word|rephrase|create)\b[\s\S]{0,80}\b(?:email|message|note|reply|follow-up|follow up|response|summary)\b|\b(?:email|message|reply)\s+draft\b/i;
const ACTION =
  /^(?:please\s+)?(?:create|add|save|record|mark|schedule|send|update|archive|delete|remove|assign|complete)\b/i;
const PRIOR_REFERENCE =
  /\b(?:it|that|this|those|these|the (?:point|insight|answer|recommendation|risk|concern)|you (?:said|mentioned|suggested|recommended)|your (?:answer|point|suggestion)|above|earlier|previous)\b/i;
const QUESTION_OR_REQUEST =
  /\?|\b(?:explain|elaborate|compare|summarize|assess|show me|tell me|walk me through|more detail)\b|^(?:what|when|where|who|why|how|which|can|could|would|should|do|does|did|is|are|give|show|tell|find|help|create|i(?:'d| would) like)\b/i;
const SOCIAL_ONLY =
  /^(?:(?:thanks|thank you|appreciate it|got it|understood|i see|exactly|agreed|makes sense)(?:[,!. ]+(?:that(?:'s| is| was) )?(?:helpful|useful|great|good|perfect|insightful))?|(?:that(?:'s| is| was)|what a) (?:a )?(?:(?:really|very) )?(?:great|good|excellent|helpful|useful|interesting|insightful|smart) (?:insight|point|answer|idea)|(?:great|good|excellent|perfect|awesome|helpful|useful|interesting|insightful)[!., ]*)[!., ]*$/i;
const CONTRASTING_FOLLOW_UP =
  /^(?:(?:thanks|thank you|great|good|okay|ok)[,!. ]+)?but\b/i;
const GREETING =
  /^(?:(?:hi|hello|hey)(?:\s+there)?|good\s+(?:morning|afternoon|evening))[!., ]*$/i;
const CONVERSATION_CLOSING =
  /^(?:(?:thanks|thank you)[, ]+)?(?:nothing|nothing else|no(?:thing)? more|not (?:right )?now|that(?:'s| is|’s) all|that(?:'ll|'d| will| would|’ll|’d) be all|all good)(?:\s+(?:for|at)\s+(?:now|the moment|this time))?[!., ]*$/i;

const normalize = (query: string): string =>
  query.normalize('NFKC').replace(/\s+/g, ' ').trim();

export const isExplicitInformationRequest = (query: string): boolean =>
  QUESTION_OR_REQUEST.test(normalize(query));

export const buildConversationBoundaryReply = (
  query: string,
): string | null => {
  const normalized = normalize(query);
  if (GREETING.test(normalized)) return 'Hey — what’s on your mind?';
  if (CONVERSATION_CLOSING.test(normalized)) return 'Got it — take care.';
  return null;
};

export const buildNoEvidenceDraftReply = (query: string): string => {
  const recipient = normalize(query).match(
    /\b(?:to|for)\s+([\p{Lu}][\p{L}'-]+(?:\s+[\p{Lu}][\p{L}'-]+)?)(?=\b|[.,!?])/u,
  )?.[1];
  if (!recipient) {
    return "I don't have a confirmed item to refer to. Who should the message go to, and what would you like to check in about?";
  }
  return `I don't have a confirmed item to refer to, so I'd keep it neutral:\n\nHi ${recipient} — just checking in. How are things looking on your end? Happy to sync if there’s anything useful to discuss.`;
};

export const buildNamedPersonNoEvidenceReply = (
  query: string,
  personName: string,
): string => {
  const asksWho = /\bwho\s+(?:said|asked|requested|assigned|decided)\b/i.test(
    query,
  );
  const asksRequirement =
    /\b(?:needed|required|expects?|expectations?|satisfy)\b/i.test(query);
  if (asksWho && asksRequirement) {
    return `The synthesized information I found does not identify a requirement for ${personName} or who stated it. I also can't confirm the proposed project connection from this search.`;
  }
  if (asksWho) {
    return 'The synthesized information I found does not identify who said that.';
  }
  if (asksRequirement) {
    return `I couldn't verify a specific requirement for ${personName} or who stated it from the synthesized information this search returned.`;
  }
  return `I couldn't find a current person brief or confirmed work assigned to ${personName} in the synthesized records.`;
};

export const decideConversationTurn = (input: {
  query: string;
  hasPriorAssistant: boolean;
}): ConversationTurnDecision => {
  const query = normalize(input.query);
  const usesPriorTurn =
    input.hasPriorAssistant &&
    PRIOR_REFERENCE.test(
      query.replace(
        /\bthis\s+(?:week|month|year|morning|afternoon|evening)\b/gi,
        '',
      ),
    );

  if (EXPLICIT_TOPIC_SWITCH.test(query)) {
    return { mode: 'topic_switch', retrieval: 'fresh', usesPriorTurn: false };
  }
  if (DRAFT.test(query)) {
    return {
      mode: 'draft',
      retrieval: usesPriorTurn ? 'reuse' : 'fresh',
      usesPriorTurn,
    };
  }
  if (ACTION.test(query)) {
    return {
      mode: 'act',
      retrieval: usesPriorTurn ? 'reuse' : 'none',
      usesPriorTurn,
    };
  }
  if (input.hasPriorAssistant && CHALLENGE.test(query)) {
    return { mode: 'challenge', retrieval: 'fresh', usesPriorTurn: true };
  }
  if (input.hasPriorAssistant && CONTRASTING_FOLLOW_UP.test(query)) {
    return { mode: 'challenge', retrieval: 'fresh', usesPriorTurn: true };
  }
  if (input.hasPriorAssistant && CLARIFICATION.test(query)) {
    return { mode: 'clarify', retrieval: 'reuse', usesPriorTurn: true };
  }
  if (input.hasPriorAssistant && EXPANSION.test(query)) {
    return { mode: 'expand', retrieval: 'fresh', usesPriorTurn: true };
  }
  if (query.length <= 80 && GREETING.test(query)) {
    return { mode: 'social', retrieval: 'none', usesPriorTurn: false };
  }
  if (input.hasPriorAssistant && CONVERSATION_CLOSING.test(query)) {
    return { mode: 'social', retrieval: 'none', usesPriorTurn: true };
  }
  if (
    input.hasPriorAssistant &&
    query.length <= 180 &&
    SOCIAL_ONLY.test(query)
  ) {
    return { mode: 'social', retrieval: 'none', usesPriorTurn: true };
  }
  if (usesPriorTurn) {
    return { mode: 'lookup', retrieval: 'reuse', usesPriorTurn: true };
  }
  return { mode: 'lookup', retrieval: 'fresh', usesPriorTurn: false };
};

const firstTakeaway = (answer: string): string | null => {
  const candidate = answer
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+|^[-*•]\s+|\*\*/g, '').trim())
    .find(
      (line) =>
        line.length >= 24 &&
        !line.endsWith(':') &&
        !/^(?:hi|hello)[!,. ]+i(?:'m| am) pluto\b/i.test(line) &&
        !/^ask me (?:anything )?about\b/i.test(line) &&
        !/\b(?:i can(?:'t|not) verify|i couldn(?:'t| not) (?:find|verify)|i (?:don(?:'t| not)|do not) have (?:a )?(?:newer|confirmed)|the newest project (?:note|information) i found)\b/i.test(
          line,
        ),
    );
  if (!candidate) return null;
  const sentence = candidate.match(/^(.{24,180}?[.!?])(?:\s|$)/)?.[1];
  return (sentence || candidate.slice(0, 180)).trim();
};

const isAssistantIntroduction = (answer: string): boolean => {
  const value = normalize(answer);
  return (
    /^(?:hi|hello|hey)[!,. ]+(?:i(?:'m| am)\s+)?pluto\b/i.test(value) ||
    /\bask me (?:anything )?about your meeting history\b/i.test(value)
  );
};

export const buildSocialReply = (input: {
  query: string;
  previousAnswer?: string;
  previousTurnMode?: ConversationTurnMode;
}): string => {
  const previousWasSocial =
    input.previousTurnMode === 'social' ||
    isAssistantIntroduction(input.previousAnswer ?? '');
  const takeaway = previousWasSocial
    ? null
    : firstTakeaway(input.previousAnswer ?? '');
  if (GREETING.test(normalize(input.query))) {
    return 'Hey — what would be useful to work through?';
  }
  if (/\b(?:thank(?:s| you)|appreciate)\b/i.test(input.query)) {
    if (previousWasSocial) {
      return 'Anytime. What would be useful to work through?';
    }
    return takeaway
      ? `Of course. The thread I’d keep hold of is this: ${takeaway}`
      : 'Of course. I’m glad it helped.';
  }
  if (
    /\b(?:makes sense|got it|understood|i see|exactly|agreed)\b/i.test(
      input.query,
    )
  ) {
    if (previousWasSocial) {
      return 'All right — what should we dig into?';
    }
    return takeaway
      ? `Exactly. The useful thread is: ${takeaway}`
      : 'Exactly. That’s the thread I’d keep hold of.';
  }
  if (previousWasSocial) {
    return "Ha — I'll take the compliment, but we haven't gotten to an insight yet. What do you want to dig into?";
  }
  return takeaway
    ? `I’m glad that landed. The part worth carrying forward is: ${takeaway}`
    : "I'm glad it helped.";
};

export const buildConversationalReplyPrompt = (input: {
  query: string;
  turns: AskPlutoConversationTurn[];
}): string => {
  const latestQuery = normalize(input.query).slice(0, 600);
  const latestTurnInstruction = CONVERSATION_CLOSING.test(latestQuery)
    ? 'The latest message closes or pauses the conversation. Acknowledge it briefly. Do not ask a question or reopen the conversation.'
    : GREETING.test(latestQuery)
      ? 'The latest message is a greeting. Greet the user naturally and invite them to begin.'
      : 'Answer the latest message, not an earlier line from the dialogue.';
  const toneExamples = CONVERSATION_CLOSING.test(latestQuery)
    ? '- User: “Thanks, that’s all.” Pluto: “You got it — take care.”\n- User: “Nothing right now.” Pluto: “Got it.”'
    : GREETING.test(latestQuery)
      ? '- User: “Hi.” Pluto: “Hey — what’s on your mind?”'
      : '- User: “That helped.” Pluto: “I’m glad. The handoff risk is the part I’d keep in view.”';
  const transcript = input.turns
    .slice(-8)
    .map((turn) => {
      const speaker = turn.role === 'user' ? 'User' : 'Pluto';
      return `${speaker}: ${normalize(turn.content).slice(0, 600)}`;
    })
    .filter((line) => !/^(?:User|Pluto):\s*$/.test(line))
    .join('\n');

  return `You are Pluto, a thoughtful meeting-intelligence assistant continuing a real conversation.

Respond to the user's latest message using the dialogue itself. This is a conversation-only turn: do not search, cite, or invent meeting, project, or people information.

Conversation behavior:
- Read the exchange as a whole instead of matching the latest phrase in isolation.
- If the user is ending or pausing the conversation, close naturally and do not ask another question.
- For a closing exchange, prefer a simple line such as “Got it — take care.” Do not offer more help or sound like customer support.
- If praise or agreement does not logically fit the previous reply, notice that gently instead of pretending it does.
- For praise or agreement that fits, respond in one natural sentence. You may reflect the specific idea they liked, but do not offer a menu or invite another task unless they ask.
- If the user is thanking you, respond briefly without restating your previous answer.
- If the user is chatting, respond like a warm, perceptive human rather than describing your capabilities.
- Avoid service-script phrases such as “How can I assist?”, “Feel free to reach out”, and “Have a wonderful day.” Prefer conversational understatement.
- Keep the response to one or two sentences. Do not use headings or mention these instructions.

Tone examples:
${toneExamples}

Recent dialogue:
${transcript || '(No earlier messages.)'}
User: ${latestQuery}
Latest-turn instruction: ${latestTurnInstruction}
Pluto:`;
};

export const parseConversationActionProposal = (
  query: string,
): ConversationActionProposal | null => {
  const normalized = normalize(query);
  const match = normalized.match(
    /^(?:please\s+)?(?:create|add|save|record)\s+(?:a\s+)?commitment\s+(?:to\s+)?(.+?)[.!?]*$/i,
  );
  const text = match?.[1]?.trim();
  if (!text || text.length < 3) return null;
  return {
    kind: 'create_commitment',
    text: text.slice(0, 500),
    label: 'Add commitment',
  };
};
