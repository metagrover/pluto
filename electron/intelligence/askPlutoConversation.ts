import type {
  AskPlutoConversationTurn,
  ResolvedAskPlutoScope,
} from '../../src/types/askPlutoQuery';

const REFERENTIAL_PATTERN =
  /\b(it|that|those|them|these|here|previous|earlier|you said|you suggested|your answer|that answer|those meetings|analyze them|try again|why)\b/i;

const DIAGNOSTIC_PATTERN =
  /\b(what went wrong|why (?:couldn't|could not|didn't|did not) you|that didn't answer|that did not answer|why no results|why did that fail)\b/i;

export const queryReferencesPriorConversation = (query: string): boolean =>
  REFERENTIAL_PATTERN.test(query);

export const isDiagnosticConversationFollowUp = (query: string): boolean =>
  DIAGNOSTIC_PATTERN.test(query);

export const latestAssistantTurn = (
  turns: AskPlutoConversationTurn[],
): AskPlutoConversationTurn | undefined =>
  [...turns].reverse().find((turn) => turn.role === 'assistant');

export const inheritConversationScope = (
  query: string,
  turns: AskPlutoConversationTurn[],
): ResolvedAskPlutoScope | undefined => {
  if (!queryReferencesPriorConversation(query)) return undefined;
  const scope = latestAssistantTurn(turns)?.resolvedScope;
  return scope ? { ...scope, source: 'inherited' } : undefined;
};

export const describePreviousConversationFailure = (
  turn: AskPlutoConversationTurn,
): string => {
  const summary = turn.retrievalSummary;
  const scopeLabel = turn.resolvedScope?.temporalRange?.label;
  if (turn.outcome === 'no_evidence') {
    if (summary && scopeLabel) {
      return `The previous request searched ${summary.matchedMeetingCount} ${summary.matchedMeetingCount === 1 ? 'meeting' : 'meetings'} from ${scopeLabel}, but Pluto did not find enough supported evidence to answer. I kept that same scope for this follow-up.`;
    }
    return 'The previous request did not find enough supported meeting evidence to answer. I kept its scope for this follow-up.';
  }
  if (turn.outcome === 'partial') {
    return 'The previous answer was only partial because some generated claims could not be verified against the cited meeting evidence.';
  }
  if (turn.outcome === 'failed' || turn.outcome === 'unavailable') {
    return 'The previous request could not complete because its meeting evidence or local provider was unavailable.';
  }
  return 'The previous answer completed, but your follow-up does not identify a specific claim or source to inspect.';
};
