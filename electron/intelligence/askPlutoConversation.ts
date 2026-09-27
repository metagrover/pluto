import type {
  AskPlutoConversationTurn,
  ResolvedAskPlutoScope,
} from '../../src/types/askPlutoQuery';

const REFERENTIAL_PATTERN =
  /\b(it|that|those|them|these|here|previous|earlier|you said|you mentioned|you suggested|your answer|that answer|those meetings|analyze them|try again|why|what did you find|which meetings|which sources|tell me more|explain|elaborate|go deeper|can you expand|what do you mean)\b/i;

const DIAGNOSTIC_PATTERN =
  /\b(what went wrong|why (?:couldn't|could not|didn't|did not) you|that didn't answer|that did not answer|why no results|why did that fail|what did you find|which meetings|which sources)\b/i;
export const EXPANSION_FOLLOW_UP_PATTERN =
  /^(?:there (?:should|must) be more|is that all|anything else|what else|show me more|tell me more|more|explain|elaborate|go deeper|can you expand|what do you mean)[?.!]*$/i;
export const TOPIC_EXPANSION_PATTERN =
  /^(?:there (?:should|must) be more|is that all|anything else|what else|show me more|tell me more|more|explain|elaborate|go deeper|can you expand|what do you mean)\b/i;
const OMITTED_DETAIL_FOLLOW_UP_PATTERN =
  /\b(?:left out|omitted|excluded|held back|could(?:n't| not) verify|unverified)\b[\s\S]{0,80}\b(?:details?|statements?|claims?|parts?|items?)\b|\b(?:details?|statements?|claims?|parts?|items?)\b[\s\S]{0,80}\b(?:left out|omitted|excluded|held back|could(?:n't| not) verify|unverified)\b/i;
const CONTINUATION_PATTERN =
  /^(?:and|but|also|so|then|what about|how about)\b/i;
const ELLIPTICAL_FOLLOW_UP_PATTERN =
  /^(?:what(?:'s| is) (?:the )?(?:status|deadline|due date|next step)|when is (?:it|that) due|who owns (?:it|that)|any (?:blockers?|risks?|updates?)|draft (?:a|the) follow-up(?: email| message)?|turn (?:that|this) into (?:an? )?(?:email|message|note))\b/i;
const ASSIGNEE_QUERY_PATTERN =
  /\b(?:what(?:'s| is)|show me (?:what(?:'s| is))?)\s+assigned to\s+(.+?)(?:\?|$)|\bwhat\s+does\s+(.+?)\s+own(?:\?|$)|\bwhat\s+(?:are|were)\s+(.+?)(?:'s|’s)\s+action items?(?:\?|$)/i;
export const ATTRIBUTION_DISPUTE_PATTERN =
  /\b(?:why (?:are you|did you) (?:giving|give|talk(?:ing)? about) (?:me )?(?:answers?|details?|info)?\s*(?:for|about)?\s*([A-Z][a-z]+|[\p{L}\p{N}'-]+)|i(?:'m| am) not\s+([A-Z][a-z]+|[\p{L}\p{N}'-]+)|that(?:'s| is) not me)\b/iu;

export const detectAttributionDispute = (
  query: string,
): { disputedEntity?: string; cleanedQuery?: string } | null => {
  const match = query.match(ATTRIBUTION_DISPUTE_PATTERN);
  if (!match) return null;
  const candidate = (match[1] || match[2] || '')
    .trim()
    .replace(/[?.!,;:]+$/, '');
  const disputedEntity =
    candidate &&
    !/^(?:answers?|details?|notes?|info|this|that|me|you|someone|anyone|them)$/i.test(
      candidate,
    )
      ? candidate
      : undefined;
  const cleanedQuery = query
    .replace(ATTRIBUTION_DISPUTE_PATTERN, '')
    .replace(/^[?.!,;:\s]+/, '')
    .trim();
  return {
    disputedEntity,
    cleanedQuery: cleanedQuery || undefined,
  };
};

const CONVERSATION_SUBJECT_STOPWORDS = new Set([
  'about',
  'action',
  'answer',
  'answers',
  'assigned',
  'concern',
  'concerned',
  'does',
  'draft',
  'email',
  'follow-up',
  'from',
  'have',
  'item',
  'items',
  'meeting',
  'meetings',
  'more',
  'most',
  'next',
  'project',
  'status',
  'that',
  'this',
  'what',
  'with',
  'work',
  'working',
]);

export const extractConversationSubjects = (
  query: string,
  disputedEntity?: string,
): string[] => {
  const disputedLower = disputedEntity?.toLowerCase();
  return [
    ...new Set(
      (query.toLocaleLowerCase().match(/[\p{L}\p{N}'-]+/gu) || []).filter(
        (token) =>
          token.length >= 3 &&
          !CONVERSATION_SUBJECT_STOPWORDS.has(token) &&
          token !== disputedLower,
      ),
    ),
  ];
};

const QUERY_CONVERSATIONAL_STOPWORDS = new Set([
  'about',
  'above',
  'also',
  'and',
  'anything',
  'are',
  'can',
  'could',
  'deeper',
  'detail',
  'details',
  'did',
  'do',
  'does',
  'elaborate',
  'especially',
  'expand',
  'explain',
  'find',
  'from',
  'get',
  'give',
  'go',
  'have',
  'has',
  'how',
  'into',
  'just',
  'know',
  'like',
  'me',
  'more',
  'much',
  'need',
  'on',
  'one',
  'ones',
  'only',
  'out',
  'part',
  'particular',
  'particularly',
  'please',
  'see',
  'show',
  'so',
  'tell',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

export interface ReferencedPriorContext {
  matchedText: string;
  matchedTerms: string[];
}

export const extractReferencedPriorContext = (
  query: string,
  previousContent: string,
): ReferencedPriorContext | null => {
  if (!previousContent?.trim()) return null;
  const queryTokens = (
    query.toLocaleLowerCase().match(/[\p{L}\p{N}'-]+/gu) || []
  ).filter(
    (token) => token.length >= 3 && !QUERY_CONVERSATIONAL_STOPWORDS.has(token),
  );
  if (queryTokens.length === 0) return null;

  const candidates = previousContent
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) =>
      line
        .replace(/\[Source\s+\d+\]/gi, '')
        .replace(/^[-*•\d.)\s]+/, '')
        .replace(/^\*\*[^*]+\*\*[:\s]*/, '')
        .trim(),
    )
    .filter((line) => line.length >= 15);

  let bestCandidate: string | null = null;
  let maxMatches = 0;

  for (const candidate of candidates) {
    const candidateLower = candidate.toLocaleLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
      if (candidateLower.includes(token)) {
        matches += 1;
      }
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || maxMatches === 0) return null;

  const matchedTerms = [
    ...new Set(
      (
        bestCandidate.match(
          /\b[\p{Lu}][\p{L}\p{N}'-]+\b|[\p{L}\p{N}'-]{4,}/gu,
        ) || []
      ).filter(
        (t) => !QUERY_CONVERSATIONAL_STOPWORDS.has(t.toLocaleLowerCase()),
      ),
    ),
  ].slice(0, 8);

  return {
    matchedText: bestCandidate,
    matchedTerms,
  };
};

export type AskPlutoConversationRelation =
  | 'new_topic'
  | 'follow_up'
  | 'expansion'
  | 'omission_follow_up';

export type AskPlutoResearchTask =
  | 'lookup'
  | 'analysis'
  | 'comparison'
  | 'draft';

export interface AskPlutoConversationResolution {
  relation: AskPlutoConversationRelation;
  task: AskPlutoResearchTask;
  retrievalQuery: string;
  answerQuery: string;
  priorQuestion?: string;
}

const resolveResearchTask = (query: string): AskPlutoResearchTask => {
  if (
    /\b(?:draft|write|rewrite|compose)\b[\s\S]{0,60}\b(?:email|message|note|follow-up|follow up)\b|\b(?:email|message)\s+draft\b/i.test(
      query,
    )
  ) {
    return 'draft';
  }
  if (
    /\b(?:compare|comparison|changed?|difference|trend|over time|versus|vs\.?|before and after)\b/i.test(
      query,
    )
  ) {
    return 'comparison';
  }
  if (
    /\b(?:analy[sz]e|assess|evaluate|reflect|performance|feedback|strengths?|weaknesses?|patterns?|concern(?:ed|s)?|priorit(?:y|ies|ize|ized)|biggest (?:risk|challenge)|most important|could (?:i|we) have|should (?:i|we)|improve|do better|coach(?:ing)?|focus(?: on)?|what(?:'s| is) on my plate|where should (?:i|we) start|what to focus on|next steps? for (?:me|us))\b/i.test(
      query,
    )
  ) {
    return 'analysis';
  }
  return 'lookup';
};

export const queryReferencesPriorConversation = (query: string): boolean =>
  REFERENTIAL_PATTERN.test(query) || CONTINUATION_PATTERN.test(query.trim());

export const isDiagnosticConversationFollowUp = (query: string): boolean =>
  DIAGNOSTIC_PATTERN.test(query);

export const latestAssistantTurn = (
  turns: AskPlutoConversationTurn[],
): AskPlutoConversationTurn | undefined =>
  [...turns].reverse().find((turn) => turn.role === 'assistant');

export const resolveAskPlutoConversation = (
  query: string,
  turns: AskPlutoConversationTurn[],
): AskPlutoConversationResolution => {
  const trimmedQuery = query.trim();
  const dispute = detectAttributionDispute(trimmedQuery);
  const referencesPriorConversation =
    queryReferencesPriorConversation(trimmedQuery);
  const task = resolveResearchTask(trimmedQuery);
  const latestUserQuestion = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')?.content;
  const previousAssistant = latestAssistantTurn(turns);
  const priorQuestion =
    latestUserQuestion &&
    EXPANSION_FOLLOW_UP_PATTERN.test(latestUserQuestion.trim())
      ? previousAssistant?.conversationAnchor ||
        [...turns]
          .reverse()
          .find(
            (turn) =>
              turn.role === 'user' &&
              !EXPANSION_FOLLOW_UP_PATTERN.test(turn.content.trim()),
          )?.content
      : latestUserQuestion;
  if (
    priorQuestion &&
    previousAssistant?.outcome === 'partial' &&
    previousAssistant.unsupportedClaimCount &&
    OMITTED_DETAIL_FOLLOW_UP_PATTERN.test(trimmedQuery)
  ) {
    return {
      relation: 'omission_follow_up',
      task: 'analysis',
      retrievalQuery: priorQuestion.slice(0, 700),
      answerQuery: `Find additional supported details for this earlier request: ${priorQuestion.slice(0, 700)}. Do not repeat details already in the previous answer.`,
      priorQuestion,
    };
  }
  const priorAssignee = priorQuestion?.match(ASSIGNEE_QUERY_PATTERN);
  const assignee = priorAssignee
    ?.slice(1)
    .find((candidate): candidate is string => Boolean(candidate?.trim()))
    ?.trim()
    .replace(/[?.!,;:]+$/, '');
  const priorSubjects = new Set(
    extractConversationSubjects(priorQuestion || '', dispute?.disputedEntity),
  );
  const continuesPriorSubject = extractConversationSubjects(
    trimmedQuery,
    dispute?.disputedEntity,
  ).some((subject) => priorSubjects.has(subject));
  const contextDependentFollowUp =
    ELLIPTICAL_FOLLOW_UP_PATTERN.test(trimmedQuery) ||
    (task === 'draft' &&
      /\b(?:follow-up|follow up|that|this|them|those|above)\b/i.test(
        trimmedQuery,
      ));
  const referencedPriorContext =
    task !== 'draft' && previousAssistant?.content
      ? extractReferencedPriorContext(trimmedQuery, previousAssistant.content)
      : null;

  if (dispute?.cleanedQuery) {
    return {
      relation: 'follow_up',
      task,
      retrievalQuery: dispute.cleanedQuery,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (
    !priorQuestion ||
    (!EXPANSION_FOLLOW_UP_PATTERN.test(trimmedQuery) &&
      !TOPIC_EXPANSION_PATTERN.test(trimmedQuery) &&
      !referencesPriorConversation &&
      !continuesPriorSubject &&
      !referencedPriorContext &&
      !contextDependentFollowUp)
  ) {
    return {
      relation: 'new_topic',
      task,
      retrievalQuery: trimmedQuery,
      answerQuery: trimmedQuery,
    };
  }
  if (assignee && EXPANSION_FOLLOW_UP_PATTERN.test(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      retrievalQuery: `What else is assigned to ${assignee}? Search all meeting notes and distinguish explicit assignments from possible follow-ups.`,
      answerQuery: `Tell me more about what is assigned to ${assignee}. Add supported context about why it matters, current status, constraints, and related decisions instead of repeating the same list.`,
      priorQuestion,
    };
  }
  if (EXPANSION_FOLLOW_UP_PATTERN.test(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      retrievalQuery: priorQuestion.slice(0, 700),
      answerQuery: `Add supported context for this earlier question: ${priorQuestion.slice(0, 700)}. Explain useful relationships, reasons, or outcomes when the meeting supports them. Avoid repeating the earlier answer.`,
      priorQuestion,
    };
  }
  if (referencedPriorContext && TOPIC_EXPANSION_PATTERN.test(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      retrievalQuery: `${trimmedQuery}\n${referencedPriorContext.matchedText}`,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (continuesPriorSubject) {
    return {
      relation: 'follow_up',
      task,
      retrievalQuery: trimmedQuery,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (referencedPriorContext) {
    return {
      relation: 'follow_up',
      task: task === 'lookup' ? resolveResearchTask(trimmedQuery) : task,
      retrievalQuery: `${trimmedQuery}\n${referencedPriorContext.matchedText}`,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  const retrievalQuery = `${priorQuestion.slice(0, 700)}\n${trimmedQuery}`;
  return {
    relation:
      EXPANSION_FOLLOW_UP_PATTERN.test(trimmedQuery) ||
      TOPIC_EXPANSION_PATTERN.test(trimmedQuery)
        ? 'expansion'
        : 'follow_up',
    task: task === 'lookup' ? resolveResearchTask(retrievalQuery) : task,
    retrievalQuery,
    answerQuery: trimmedQuery,
    priorQuestion,
  };
};

export const resolveConversationQuery = (
  query: string,
  turns: AskPlutoConversationTurn[],
): string => resolveAskPlutoConversation(query, turns).retrievalQuery;

export const inheritConversationScope = (
  query: string,
  turns: AskPlutoConversationTurn[],
  relation?: AskPlutoConversationRelation,
): ResolvedAskPlutoScope | undefined => {
  if (
    relation === 'new_topic' ||
    (!relation && !queryReferencesPriorConversation(query))
  ) {
    return undefined;
  }
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
      return `The previous request searched ${summary.matchedMeetingCount} ${summary.matchedMeetingCount === 1 ? 'meeting' : 'meetings'} from ${scopeLabel}, but Pluto could not verify an answer in that search. I kept that same scope for this follow-up.`;
    }
    return 'Pluto could not verify an answer in the previous search. I kept its scope for this follow-up.';
  }
  if (turn.outcome === 'partial') {
    return 'The previous answer was only partial because some generated claims could not be verified against the cited meeting evidence.';
  }
  if (turn.outcome === 'failed' || turn.outcome === 'unavailable') {
    return 'The previous request could not complete because its meeting evidence or local provider was unavailable.';
  }
  return 'The previous answer completed, but your follow-up does not identify a specific claim or source to inspect.';
};
