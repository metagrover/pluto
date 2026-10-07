import type { MeetingAskPlutoTurn } from '../../src/types/askPluto';
import { parseLiveMeetingCommand } from '../../src/utils/liveMeetingCommands';
import {
  type ConversationRetrievalPolicy,
  type ConversationTurnMode,
  decideConversationTurn,
} from './conversationController';

export type MeetingAskPlutoConversationRelation =
  | 'new_topic'
  | 'follow_up'
  | 'ambiguous'
  | 'social';

export interface MeetingAskPlutoConversationResolution {
  relation: MeetingAskPlutoConversationRelation;
  turnMode: ConversationTurnMode;
  retrievalPolicy: ConversationRetrievalPolicy;
  retrievalQuery: string;
  routingQuery: string;
  priorQuestion?: string;
  priorEvidenceHintCount: number;
}

const EXPLICIT_TOPIC_SWITCH_PATTERN =
  /^(?:new question|separately|unrelated(?: question)?|switching topics?|on another (?:topic|note)|different question)\b/i;
const SELF_CONTAINED_TOPIC_PATTERN =
  /^(?:(?:what|how) about|tell me more about) (?!that\b|this\b|it\b|those\b|these\b|the (?:first|second|third|fourth|last|former|latter)\b)/i;
const REFERENTIAL_FOLLOW_UP_PATTERN =
  /\b(?:it|that|this|those|these|she|he|they|her|him|the (?:participant|speaker|other person|client|prospect|candidate|lead)|the (?:first|second|third|fourth|last|former|latter) (?:point|item|one)|your (?:answer|point|concern|recommendation|suggestion)|you (?:said|mentioned|suggested|recommended)|the (?:concern|risk|recommendation|suggestion|reason) you (?:raised|mentioned|gave))\b/i;

const CONTINUATION_PATTERN =
  /^(?:and|but|also|so|then|what about|how about|tell me more|go deeper|can you expand|what do you mean)\b/i;
const SHORT_FOLLOW_UP_PATTERN =
  /^(?:why|how so|is that all|anything else|what else|more|explain(?: more)?|elaborate)[?.!]*$/i;
const IMPLIED_PRIOR_ANSWER_PATTERN =
  /\b(?:instead|else|again|further|more deeply)\b/i;
const GENERIC_SINGULAR_REFERENCE_PATTERN = /\b(?:it|that|this)\b/i;
const SPECIFIC_REFERENCE_PATTERN =
  /\b(?:first|second|third|fourth|last|former|latter)\b/i;

const normalize = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/g, ' ').trim();

const bounded = (value: string, limit: number): string => {
  const normalized = normalize(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const latestCompletedExchange = (turns: MeetingAskPlutoTurn[]) => {
  let assistantIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'assistant' && turn.content.trim()) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;
  if (
    turns
      .slice(assistantIndex + 1)
      .some((turn) => turn.role === 'user' && turn.content.trim())
  ) {
    return null;
  }
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (turns[index].role === 'user' && turns[index].content.trim()) {
      return {
        user: turns[index],
        assistant: turns[assistantIndex],
      };
    }
  }
  return null;
};

const hasMultipleStructuredTopics = (answer: string): boolean =>
  answer.split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line))
    .length > 1;

const isFollowUp = (query: string): boolean => {
  const withoutMeetingScopeReferences = query.replace(
    /\bthis\s+(?:meeting|call|conversation|discussion|exchange)\b/gi,
    '',
  );
  return (
    REFERENTIAL_FOLLOW_UP_PATTERN.test(withoutMeetingScopeReferences) ||
    CONTINUATION_PATTERN.test(query) ||
    SHORT_FOLLOW_UP_PATTERN.test(query) ||
    IMPLIED_PRIOR_ANSWER_PATTERN.test(query)
  );
};

export const resolveMeetingAskPlutoConversation = ({
  query,
  turns,
}: {
  query: string;
  turns: MeetingAskPlutoTurn[];
}): MeetingAskPlutoConversationResolution => {
  const shortcut = parseLiveMeetingCommand(query);
  if (shortcut.kind === 'command') {
    return {
      relation: 'new_topic',
      turnMode: 'lookup',
      retrievalPolicy: 'fresh',
      retrievalQuery: shortcut.question,
      routingQuery: query.trim(),
      priorEvidenceHintCount: 0,
    };
  }
  const normalizedQuery = normalize(query);
  const exchange = latestCompletedExchange(turns);
  const decision = decideConversationTurn({
    query: normalizedQuery,
    hasPriorAssistant: Boolean(exchange),
  });
  if (exchange && decision.mode === 'social') {
    return {
      relation: 'social',
      turnMode: decision.mode,
      retrievalPolicy: decision.retrieval,
      retrievalQuery: bounded(exchange.user.content, 700),
      routingQuery: normalizedQuery,
      priorQuestion: bounded(exchange.user.content, 500),
      priorEvidenceHintCount: 0,
    };
  }
  if (
    !exchange ||
    EXPLICIT_TOPIC_SWITCH_PATTERN.test(normalizedQuery) ||
    SELF_CONTAINED_TOPIC_PATTERN.test(normalizedQuery) ||
    (!isFollowUp(normalizedQuery) && decision.mode !== 'challenge')
  ) {
    return {
      relation: 'new_topic',
      turnMode: decision.mode,
      retrievalPolicy: decision.retrieval,
      retrievalQuery: normalizedQuery,
      routingQuery: normalizedQuery,
      priorEvidenceHintCount: 0,
    };
  }

  const priorResolution = resolveMeetingAskPlutoConversation({
    query: exchange.user.content,
    turns: turns.slice(0, turns.indexOf(exchange.user)),
  });
  const priorQuestion = bounded(
    priorResolution.priorQuestion || exchange.user.content,
    500,
  );
  // A challenged answer and its citations must not anchor the next search.
  const evidenceHints = (
    decision.mode === 'challenge'
      ? []
      : (exchange.assistant.evidenceHints ?? [])
  )
    .map((hint) => bounded(hint, 500))
    .filter(Boolean)
    .slice(0, 4);
  const relation: MeetingAskPlutoConversationRelation =
    decision.mode !== 'challenge' &&
    GENERIC_SINGULAR_REFERENCE_PATTERN.test(normalizedQuery) &&
    !SPECIFIC_REFERENCE_PATTERN.test(normalizedQuery) &&
    hasMultipleStructuredTopics(exchange.assistant.content)
      ? 'ambiguous'
      : 'follow_up';

  return {
    relation,
    turnMode: decision.mode,
    retrievalPolicy: decision.retrieval,
    retrievalQuery:
      decision.mode === 'challenge'
        ? priorQuestion
        : [priorQuestion, bounded(normalizedQuery, 700), ...evidenceHints].join(
            '\n',
          ),
    routingQuery: `${priorQuestion}\n${bounded(normalizedQuery, 700)}`,
    priorQuestion,
    priorEvidenceHintCount: evidenceHints.length,
  };
};
