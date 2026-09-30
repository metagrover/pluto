export type MeetingAskPlutoRecallKind =
  | 'catch_up'
  | 'fact'
  | 'decision'
  | 'action';

export type MeetingAskPlutoAssistanceRoute =
  | {
      mode: 'recall';
      recallKind: MeetingAskPlutoRecallKind;
    }
  | { mode: 'coaching' }
  | { mode: 'clarification' }
  | { mode: 'explanation' }
  | { mode: 'advice' }
  | { mode: 'draft' }
  | { mode: 'general' };

const ACTION_PATTERN =
  /\b(action items?|next steps?|follow[- ]?ups?|who (?:owns|is responsible for)|owners?|assignees?|deadlines?|due date|what (?:do|does) (?:i|we|they|he|she) need to do)\b/i;
const DECISION_PATTERN =
  /\b(decisions?|decide|decided|agreed?|agreement|settled? on|approved?|chose|chosen)\b/i;
const CATCH_UP_PATTERN =
  /\b(what did i miss|catch me up|what (?:are|were) (?:they|we|you) (?:talking|speaking|discussing) about|what(?:'s| is) (?:happening|going on)|recap (?:the )?(?:latest|conversation|meeting|discussion|last few minutes|so far)|summari[sz]e (?:(?:the|this) )?(?:conversation|meeting|discussion|latest|so far))\b/i;
const SUMMARY_PATTERN =
  /\b(?:summari[sz]e|summary|recap|give me (?:a )?brief|key takeaways)\b/i;
const EXPLANATION_PATTERN =
  /^(?:(?:can|could|would|will) you )?(?:please )?(?:why\b|explain\b|elaborate\b|compare\b|tell me more\b|go deeper\b|can you expand\b|what do you mean\b|what led\b|how did we (?:reach|arrive)\b|how so\b|how (?:does|did|would|will) .+ work\b|what (?:does|did) .+ mean\b)/i;
const ADVICE_PATTERN =
  /\b(?:what (?:should|could|can) (?:i|we) (?:do|say|ask|clarify|check|resolve|address|prioriti[sz]e|focus on)|recommend(?:ation|ations)?|suggest(?:ion|ions)?|advice)\b/i;
const FACT_PATTERN =
  /\b(what did .+ (?:say|mention|ask|mean)|did (?:we|they|you|he|she|[a-z][a-z'-]+) (?:discuss|mention|say|talk about|cover|ask)|remind me (?:what|who|when|where|how)|who (?:will|is going to) (?:write|build|prepare|send|review)|who (?:said|mentioned|asked|created|built|wrote|authored|prepared|designed|made|put together)|what was (?:said|mentioned|discussed|asked))\b/i;
const DIRECT_FACT_PATTERN =
  /\b(?:what(?:'s| is| was) (?:the )?(?:name|time|date|place|location)\b|who (?:is|was|were) (?:the )?(?:person|participant|speaker)\b|when (?:is|was|are|were|does|did|will)\b|where (?:is|was|are|were|does|did|will)\b)/i;
const DRAFT_PATTERN =
  /^\s*(?:(?:can|could|would|will) you\s+|help me\s+)?(?:please\s+)?(?:draft|write|create|compose|generate)\b/i;
const COACHING_PATTERN =
  /\b(?:what (?:can|could|should) (?:i|the speaker|they) do better|how (?:am i|is|are|was|were) .{0,48}\bdoing|coach(?:ing)?|communication feedback|improve (?:my|their) communication)\b/i;
const CLARIFICATION_PATTERN =
  /\b(?:did [\p{L}\p{N} .'-]{1,80} understand|not understand|confused?|confusion|unclear|misunderstood?|needed? clarification|what (?:was|is) confusing)\b/iu;

export const routeMeetingAskPlutoAssistance = (
  query: string,
): MeetingAskPlutoAssistanceRoute => {
  const normalized = query.normalize('NFKC').replace(/\s+/g, ' ').trim();

  if (DRAFT_PATTERN.test(normalized)) {
    return { mode: 'draft' };
  }
  if (COACHING_PATTERN.test(normalized)) {
    return { mode: 'coaching' };
  }
  if (CLARIFICATION_PATTERN.test(normalized)) {
    return { mode: 'clarification' };
  }
  if (EXPLANATION_PATTERN.test(normalized)) {
    return { mode: 'explanation' };
  }
  if (ADVICE_PATTERN.test(normalized)) {
    return { mode: 'advice' };
  }
  if (SUMMARY_PATTERN.test(normalized)) {
    return { mode: 'recall', recallKind: 'catch_up' };
  }
  if (ACTION_PATTERN.test(normalized)) {
    return { mode: 'recall', recallKind: 'action' };
  }
  if (DECISION_PATTERN.test(normalized)) {
    return { mode: 'recall', recallKind: 'decision' };
  }
  if (CATCH_UP_PATTERN.test(normalized)) {
    return { mode: 'recall', recallKind: 'catch_up' };
  }
  if (FACT_PATTERN.test(normalized) || DIRECT_FACT_PATTERN.test(normalized)) {
    return { mode: 'recall', recallKind: 'fact' };
  }

  return { mode: 'general' };
};
