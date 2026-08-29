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
  | { mode: 'general' };

const ACTION_PATTERN =
  /\b(action items?|next steps?|follow[- ]?ups?|who (?:owns|is responsible for)|owners?|assignees?|deadlines?|due date|what (?:do|does) (?:i|we|they|he|she) need to do)\b/i;
const DECISION_PATTERN =
  /\b(decisions?|decide|decided|agreed?|agreement|settled? on|approved?|chose|chosen)\b/i;
const CATCH_UP_PATTERN =
  /\b(what did i miss|catch me up|what (?:are|were) (?:they|we|you) (?:talking|speaking|discussing) about|what(?:'s| is) (?:happening|going on)|recap (?:the )?(?:latest|conversation|meeting|discussion|last few minutes|so far)|summari[sz]e (?:the )?(?:conversation|meeting|discussion|latest|so far))\b/i;
const FACT_PATTERN =
  /\b(what did .+ (?:say|mention|ask|mean)|did (?:we|they|you|he|she|[a-z][a-z'-]+) (?:discuss|mention|say|talk about|cover|ask)|remind me (?:what|who|when|where|how)|who (?:said|mentioned|asked)|what was (?:said|mentioned|discussed|asked))\b/i;
const DIRECT_FACT_PATTERN =
  /\b(?:what(?:'s| is| was) (?:the )?(?:name|time|date|place|location)\b|who (?:is|was|were) (?:the )?(?:person|participant|speaker)\b|when (?:is|was|are|were|does|did|will)\b|where (?:is|was|are|were|does|did|will)\b)/i;
const UNSUPPORTED_CREATION_PATTERN =
  /^\s*(?:please\s+)?(?:draft|write|create|compose|generate)\b/i;

export const routeMeetingAskPlutoAssistance = (
  query: string,
): MeetingAskPlutoAssistanceRoute => {
  const normalized = query.normalize('NFKC').replace(/\s+/g, ' ').trim();

  if (UNSUPPORTED_CREATION_PATTERN.test(normalized)) {
    return { mode: 'general' };
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
