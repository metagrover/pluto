import type {
  AskPlutoConversationTurn,
  ResolvedAskPlutoScope,
} from '../../src/types/askPlutoQuery';

const REFERENTIAL_PATTERN =
  /\b(it|that|those|them|these|here|previous|earlier|you said|you suggested|your answer|that answer|those meetings|analyze them|try again|why|what did you find|which meetings|which sources|go deeper)\b/i;

const DIAGNOSTIC_PATTERN =
  /\b(what went wrong|why (?:couldn't|could not|didn't|did not) you|that didn't answer|that did not answer|why no results|why did that fail|what did you find|which meetings|which sources)\b/i;
const EXPANSION_FOLLOW_UP_PATTERN =
  /^(?:there (?:should|must) be more|is that all|anything else|what else|show me more|more|go deeper)[?.!]*$/i;
const ASSIGNEE_QUERY_PATTERN =
  /\b(?:what(?:'s| is)|show me (?:what(?:'s| is))?)\s+assigned to\s+(.+?)(?:\?|$)|\bwhat\s+does\s+(.+?)\s+own(?:\?|$)|\bwhat\s+(?:are|were)\s+(.+?)(?:'s|’s)\s+action items?(?:\?|$)/i;

export const queryReferencesPriorConversation = (query: string): boolean =>
  REFERENTIAL_PATTERN.test(query);

export const isDiagnosticConversationFollowUp = (query: string): boolean =>
  DIAGNOSTIC_PATTERN.test(query);

export const latestAssistantTurn = (
  turns: AskPlutoConversationTurn[],
): AskPlutoConversationTurn | undefined =>
  [...turns].reverse().find((turn) => turn.role === 'assistant');

export const resolveConversationQuery = (
  query: string,
  turns: AskPlutoConversationTurn[],
): string => {
  if (!EXPANSION_FOLLOW_UP_PATTERN.test(query.trim())) return query;
  const priorAssignee = [...turns]
    .reverse()
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content.match(ASSIGNEE_QUERY_PATTERN))
    .find(Boolean);
  const assignee = priorAssignee
    ?.slice(1)
    .find((candidate): candidate is string => Boolean(candidate?.trim()))
    ?.trim()
    .replace(/[?.!,;:]+$/, '');
  if (assignee) {
    return `What else is assigned to ${assignee}? Search all meeting notes and distinguish explicit assignments from possible follow-ups.`;
  }
  if (/^go deeper[?.!]*$/i.test(query.trim())) {
    const priorQuestion = [...turns]
      .reverse()
      .find((turn) => turn.role === 'user')?.content;
    return priorQuestion
      ? `Go deeper into this earlier question using relevant transcript passages: ${priorQuestion}`
      : query;
  }
  return query;
};

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
  const trace = turn.retrievalTrace;
  const scopeLabel = turn.resolvedScope?.temporalRange?.label;
  const traceMeetings = trace
    ? [
        ...new Set(
          [
            ...(trace.meetings || []).map((meeting) => meeting.meetingTitle),
            ...trace.sections.map((section) => section.meetingTitle),
            ...trace.transcriptPassages.map((passage) => passage.meetingTitle),
          ].filter(Boolean),
        ),
      ]
    : [];
  if (
    trace &&
    (traceMeetings.length > 0 ||
      trace.sections.length > 0 ||
      trace.transcriptPassages.length > 0 ||
      trace.commitmentCount > 0)
  ) {
    const headings = [
      ...new Set(trace.sections.map((section) => section.heading)),
    ];
    return [
      `The previous request searched ${trace.searchedMeetingCount} ${trace.searchedMeetingCount === 1 ? 'meeting' : 'meetings'}.`,
      traceMeetings.length
        ? `Matched meetings: ${traceMeetings.slice(0, 6).join(', ')}.`
        : '',
      headings.length
        ? `Matched sections: ${headings.slice(0, 8).join(', ')}.`
        : '',
      trace.commitmentCount > 0
        ? `It found ${trace.commitmentCount} confirmed ${trace.commitmentCount === 1 ? 'commitment' : 'commitments'}.`
        : '',
      trace.transcriptPassages.length
        ? `It used ${trace.transcriptPassages.length} transcript ${trace.transcriptPassages.length === 1 ? 'passage' : 'passages'}.`
        : 'It did not need transcript passages.',
    ]
      .filter(Boolean)
      .join(' ');
  }
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
