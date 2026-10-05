import type {
  AskPlutoConversationTurn,
  ResolvedAskPlutoScope,
} from '../../src/types/askPlutoQuery';
import {
  type ConversationRetrievalPolicy,
  type ConversationTurnMode,
  buildSocialReply,
  decideConversationTurn,
} from './conversationController';

const REFERENTIAL_PATTERN =
  /\b(it|that|those|them|these|here|previous|earlier|you said|you mentioned|you suggested|your answer|that answer|those meetings|analyze them|try again|why|what did you find|which meetings|which sources|tell me more|explain|elaborate|go deeper|can you expand|what do you mean)\b/i;

const DIAGNOSTIC_PATTERN =
  /\b(what went wrong|why (?:couldn't|could not|didn't|did not) you|that didn't answer|that did not answer|why no results|why did that fail|what did you find|which meetings|which sources)\b/i;
export const EXPANSION_FOLLOW_UP_PATTERN =
  /^(?:there (?:should|must) be more|is that all|anything else|what else|show me more|tell me more|more|explain|elaborate|go deeper|can you expand|what do you mean)[?.!]*$/i;
export const TOPIC_EXPANSION_PATTERN =
  /^(?:there (?:should|must) be more|is that all|anything else|what else|show me more|tell me more|more|explain|elaborate|go deeper|can you expand|what do you mean)\b/i;
const DEPTH_REQUEST_PATTERN =
  /\b(?:in (?:more )?detail|more details?|deeper|dive (?:in|into)|expand(?: on)?|elaborate(?: on)?)\b/i;
const isExpansionRequest = (query: string): boolean =>
  EXPANSION_FOLLOW_UP_PATTERN.test(query) ||
  TOPIC_EXPANSION_PATTERN.test(query) ||
  DEPTH_REQUEST_PATTERN.test(query);
const OMITTED_DETAIL_FOLLOW_UP_PATTERN =
  /\b(?:left out|omitted|excluded|held back|could(?:n't| not) verify|unverified)\b[\s\S]{0,80}\b(?:details?|statements?|claims?|parts?|items?)\b|\b(?:details?|statements?|claims?|parts?|items?)\b[\s\S]{0,80}\b(?:left out|omitted|excluded|held back|could(?:n't| not) verify|unverified)\b/i;
const CONTINUATION_PATTERN =
  /^(?:and|but|also|so|then|what about|how about)\b/i;
const ELLIPTICAL_FOLLOW_UP_PATTERN =
  /^(?:what(?:'s| is) (?:the )?(?:status|deadline|due date|next step)|when is (?:it|that) due|who owns (?:it|that)|any (?:blockers?|risks?|updates?)|(?:what|which) (?:would|should|could) (?:you|i|we) (?:do|tackle|check) (?:first|next)|what(?:'s| is) (?:the )?(?:first|next) move|draft (?:a|the) follow-up(?: email| message)?|turn (?:that|this) into (?:an? )?(?:email|message|note))\b/i;
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

const ANALYSIS_INTENT_TOKENS = new Set([
  ...QUERY_CONVERSATIONAL_STOPWORDS,
  'advice',
  'any',
  'assess',
  'assessment',
  'better',
  'biggest',
  'challenge',
  'challenges',
  'coach',
  'coaching',
  'concern',
  'concerns',
  'feedback',
  'for',
  'focus',
  'immediately',
  'improve',
  'improvement',
  'important',
  'most',
  'priorities',
  'priority',
  'reflect',
  'risk',
  'risks',
  'should',
  'some',
  'strength',
  'strengths',
  'think',
  'thoughts',
  'weakness',
  'weaknesses',
]);

const hasStandaloneAnalysisSubject = (query: string): boolean =>
  (query.toLocaleLowerCase().match(/[\p{L}\p{N}'-]+/gu) || []).some(
    (token) => token.length >= 3 && !ANALYSIS_INTENT_TOKENS.has(token),
  );

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
  | 'omission_follow_up'
  | 'acknowledgment';

export type AskPlutoResearchTask =
  | 'lookup'
  | 'analysis'
  | 'comparison'
  | 'draft';

export interface AskPlutoConversationResolution {
  relation: AskPlutoConversationRelation;
  task: AskPlutoResearchTask;
  turnMode: ConversationTurnMode;
  retrievalPolicy: ConversationRetrievalPolicy;
  retrievalQuery: string;
  answerQuery: string;
  priorQuestion?: string;
}

export const isConversationalAcknowledgment = (query: string): boolean => {
  return (
    decideConversationTurn({ query, hasPriorAssistant: true }).mode === 'social'
  );
};

export const buildAskPlutoAcknowledgment = (
  query: string,
  previousAnswer?: string,
  previousTurnMode?: ConversationTurnMode,
): string => buildSocialReply({ query, previousAnswer, previousTurnMode });

const resolveResearchTask = (query: string): AskPlutoResearchTask => {
  if (
    /\b(?:create|draft|write|rewrite|compose)\b[\s\S]{0,60}\b(?:email|message|note|follow-up|follow up|summary)\b|\b(?:email|message)\s+draft\b/i.test(
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
    /\b(?:analy[sz]e|assess|evaluate|reflect|performance|feedback|strengths?|weaknesses?|patterns?|concern(?:ed|s)?|priorit(?:y|ies|ize|ized)|biggest (?:risk|challenge)|most important|could (?:i|we) have|should (?:i|we)|improve|do better|coach(?:ing)?|focus(?: on)?|what(?:'s| is) on my plate|where should (?:i|we) start|what to focus on|next steps? for (?:me|us)|what (?:would|should|could) (?:you|i|we) (?:do|tackle|check) (?:first|next)|what do you think (?:will|would) satisfy)\b/i.test(
      query,
    )
  ) {
    return 'analysis';
  }
  return 'lookup';
};

export const queryReferencesPriorConversation = (query: string): boolean =>
  REFERENTIAL_PATTERN.test(query) || CONTINUATION_PATTERN.test(query.trim());

export const asksToVerifyProjectAssociation = (query: string): boolean =>
  /\b(?:is|was)\s+(?:it|this|that)\s+(?:for|part of|related to|connected to)\b/i.test(
    query,
  );

export const asksForExplicitAttribution = (query: string): boolean =>
  /\bwho\s+(?:said|asked|requested|assigned|decided|told|stated)\b/i.test(
    query,
  );

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
  const task = resolveResearchTask(trimmedQuery);
  const latestUserQuestion = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')?.content;
  const previousAssistant = latestAssistantTurn(turns);
  const previousDraftRequest = [
    latestUserQuestion,
    previousAssistant?.conversationAnchor,
    previousAssistant?.conversationContext?.anchor,
  ].find(
    (candidate) => candidate && resolveResearchTask(candidate) === 'draft',
  );
  const isDraftRevision = Boolean(
    previousAssistant &&
      previousDraftRequest &&
      /^(?:make|keep|leave|remove|omit|add|include|revise|rewrite|shorten|expand|change|adjust|tighten|polish)\b/i.test(
        trimmedQuery,
      ) &&
      /\b(?:it|that|this|draft|message|email|shorter|longer|warmer|tone|formal|concise|brief|uncertainty|leave out|remove|omit|revise|rewrite|shorten|polish)\b/i.test(
        trimmedQuery,
      ),
  );
  if (isDraftRevision) {
    return {
      relation: 'follow_up',
      task: 'draft',
      turnMode: 'draft',
      retrievalPolicy: 'reuse',
      retrievalQuery: `${previousDraftRequest?.slice(0, 700)}\n${trimmedQuery}`,
      answerQuery: `Revise the previous draft and return the complete revised draft. ${trimmedQuery}`,
      priorQuestion: latestUserQuestion,
    };
  }
  const referencesPriorConversation =
    queryReferencesPriorConversation(trimmedQuery) ||
    (previousAssistant?.conversationContext?.topic?.kind === 'person' &&
      /\b(?:him|her|his|their)\b/i.test(trimmedQuery));
  const turnDecision = decideConversationTurn({
    query: trimmedQuery,
    hasPriorAssistant: Boolean(previousAssistant),
  });
  const latestQuestionWasExpansion = Boolean(
    latestUserQuestion && isExpansionRequest(latestUserQuestion.trim()),
  );
  const priorQuestion =
    latestUserQuestion && latestQuestionWasExpansion
      ? previousAssistant?.conversationAnchor ||
        [...turns]
          .reverse()
          .find(
            (turn) =>
              turn.role === 'user' && !isExpansionRequest(turn.content.trim()),
          )?.content
      : latestUserQuestion;
  if (
    previousAssistant &&
    /^(?:please\s+)?(?:try again|retry|try once more)[?.!]*$/i.test(
      trimmedQuery,
    )
  ) {
    const retryQuery = previousAssistant.conversationAnchor || priorQuestion;
    if (retryQuery)
      return {
        relation: 'follow_up',
        task: resolveResearchTask(retryQuery),
        turnMode: decideConversationTurn({
          query: retryQuery,
          hasPriorAssistant: false,
        }).mode,
        retrievalPolicy: 'fresh',
        retrievalQuery: retryQuery,
        answerQuery: retryQuery,
        priorQuestion: retryQuery,
      };
  }
  if (previousAssistant && turnDecision.mode === 'social') {
    return {
      relation: 'acknowledgment',
      task: 'lookup',
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery:
        previousAssistant.conversationAnchor || priorQuestion || trimmedQuery,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (
    priorQuestion &&
    previousAssistant?.outcome === 'partial' &&
    previousAssistant.unsupportedClaimCount &&
    OMITTED_DETAIL_FOLLOW_UP_PATTERN.test(trimmedQuery)
  ) {
    return {
      relation: 'omission_follow_up',
      task: 'analysis',
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
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
  const priorWorkItems =
    `${priorQuestion || ''}\n${previousAssistant?.content || ''}`
      .toLocaleLowerCase()
      .replace(/\bdependencies\b/g, 'dependency')
      .replace(/\b(owners|decisions|proposals|blockers)\b/g, (word) =>
        word.slice(0, -1),
      );
  const referencesPriorWorkItem = [
    ...trimmedQuery.matchAll(
      /\b(?:each|these|those|the)\s+(dependenc(?:y|ies)|owners?|decisions?|proposals?|blockers?)\b/gi,
    ),
  ].some((match) => {
    const item = match[1]
      .toLocaleLowerCase()
      .replace(/dependencies$/, 'dependency')
      .replace(/s$/, '');
    return new RegExp(`\\b${item}\\b`).test(priorWorkItems);
  });
  const contextDependentFollowUp =
    ELLIPTICAL_FOLLOW_UP_PATTERN.test(trimmedQuery) ||
    (Boolean(previousAssistant) && referencesPriorWorkItem) ||
    (task === 'analysis' &&
      Boolean(previousAssistant) &&
      !hasStandaloneAnalysisSubject(trimmedQuery)) ||
    (task === 'draft' &&
      /\b(?:follow-up|follow up|that|this|them|those|above)\b/i.test(
        trimmedQuery,
      )) ||
    (task === 'draft' &&
      previousAssistant?.conversationContext?.topic?.kind === 'project' &&
      turns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.conversationContext?.topic?.kind === 'project' &&
          turn.conversationContext.topic.id ===
            previousAssistant.conversationContext?.topic?.id &&
          Boolean(extractReferencedPriorContext(trimmedQuery, turn.content)),
      ));
  const referencedPriorContext =
    task !== 'draft' && previousAssistant?.content
      ? extractReferencedPriorContext(trimmedQuery, previousAssistant.content)
      : null;

  if (dispute?.cleanedQuery) {
    return {
      relation: 'follow_up',
      task,
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: dispute.cleanedQuery,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (
    !priorQuestion ||
    (!isExpansionRequest(trimmedQuery) &&
      !referencesPriorConversation &&
      !turnDecision.usesPriorTurn &&
      !continuesPriorSubject &&
      !referencedPriorContext &&
      !contextDependentFollowUp)
  ) {
    return {
      relation: 'new_topic',
      task,
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: trimmedQuery,
      answerQuery: trimmedQuery,
    };
  }
  if (assignee && isExpansionRequest(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: `What else is assigned to ${assignee}? Search all meeting notes and distinguish explicit assignments from possible follow-ups.`,
      answerQuery: `Tell me more about what is assigned to ${assignee}. Add supported context about why it matters, current status, constraints, and related decisions instead of repeating the same list.`,
      priorQuestion,
    };
  }
  if (EXPANSION_FOLLOW_UP_PATTERN.test(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: priorQuestion.slice(0, 700),
      answerQuery: `Add supported context for this earlier question: ${priorQuestion.slice(0, 700)}. Explain useful relationships, reasons, or outcomes when the meeting supports them. Avoid repeating the earlier answer.`,
      priorQuestion,
    };
  }
  if (referencedPriorContext && isExpansionRequest(trimmedQuery)) {
    return {
      relation: 'expansion',
      task: 'analysis',
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: `${trimmedQuery}\n${referencedPriorContext.matchedText}`,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (continuesPriorSubject) {
    return {
      relation: isExpansionRequest(trimmedQuery) ? 'expansion' : 'follow_up',
      task: isExpansionRequest(trimmedQuery) ? 'analysis' : task,
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: referencesPriorWorkItem
        ? `${previousAssistant?.conversationContext?.anchor || priorQuestion}\n${trimmedQuery}`
        : trimmedQuery,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  if (referencedPriorContext) {
    return {
      relation: 'follow_up',
      task: task === 'lookup' ? resolveResearchTask(trimmedQuery) : task,
      turnMode: turnDecision.mode,
      retrievalPolicy: turnDecision.retrieval,
      retrievalQuery: `${trimmedQuery}\n${referencedPriorContext.matchedText}`,
      answerQuery: trimmedQuery,
      priorQuestion,
    };
  }
  const retrievalQuery = `${priorQuestion.slice(0, 700)}\n${trimmedQuery}`;
  return {
    relation: isExpansionRequest(trimmedQuery) ? 'expansion' : 'follow_up',
    task: isExpansionRequest(trimmedQuery)
      ? 'analysis'
      : task === 'lookup'
        ? resolveResearchTask(retrievalQuery)
        : task,
    turnMode: turnDecision.mode,
    retrievalPolicy: turnDecision.retrieval,
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
