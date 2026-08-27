import type {
  ActionItemV3,
  AnalysisDocumentV3,
  AnalysisErrorCategory,
  DecisionV3,
  RecentWinV3,
} from './analysisTypes';

export const normalizeTranscriptEvidence = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type ResolvedTranscriptEvidence = {
  evidence: string;
  quotedEvidence: string;
  sourceLine: string;
  sourceLines: string[];
  lineIndex: number;
};

const MAX_EVIDENCE_SPAN_LINES = 3;
const MIN_FULL_CLAIM_SUPPORT = 0.8;
const MIN_PARTIAL_CLAIM_SUPPORT = 0.5;

const transcriptLineContent = (line: string): string => {
  const bracketed = line.match(/^\s*\[[^\]]+\]\s*(?:\([^)]*\))?\s*:\s*(.*)$/);
  if (bracketed) return bracketed[1];
  return line.replace(/^\s*[^:\n]{1,80}:\s*/, '');
};

const transcriptLineSpeaker = (line: string): string | undefined => {
  const bracketed = line.match(/^\s*\[([^\]]+)\]\s*(?:\([^)]*\))?\s*:/);
  if (bracketed?.[1]?.trim()) return bracketed[1].trim();
  const plain = line.match(/^\s*([^:\n]{1,80})\s*:/);
  return plain?.[1]?.trim() || undefined;
};

const hasExplicitResolutionCue = (value: string): boolean =>
  /\b(?:agreed|decided|will use|we will|i will|i'll|approved|selected|yes|sure|will do|proceed)\b/i.test(
    value,
  );

const polarityTokens = (value: string): string[] =>
  normalizeTranscriptEvidence(
    value
      .replace(/\bdo-not-contact\b/gi, 'donotcontact')
      .replace(/\bdon't\b/gi, 'do not')
      .replace(/\bwon't\b/gi, 'will not')
      .replace(/\bcan't\b/gi, 'cannot'),
  ).split(' ');

const POLARITY_NEGATIONS = new Set([
  'not',
  'never',
  'cannot',
  'rejected',
  'declined',
  'cancelled',
  'canceled',
]);

const CLAIM_SCOPE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'by',
  'do',
  'for',
  'i',
  'is',
  'not',
  'the',
  'to',
  'we',
  'will',
]);

const scopedNegativePolarity = (value: string, claim: string): boolean => {
  const valueTokens = polarityTokens(value);
  const claimTokens = polarityTokens(claim).filter(
    (token) => token.length >= 2 && !CLAIM_SCOPE_STOP_WORDS.has(token),
  );
  const positions = claimTokens
    .map((token) => valueTokens.indexOf(token))
    .filter((position) => position >= 0);
  if (positions.length === 0) return false;
  const start = Math.max(0, Math.min(...positions) - 3);
  const end = Math.min(valueTokens.length, Math.max(...positions) + 1);
  return valueTokens
    .slice(start, end)
    .some((token) => POLARITY_NEGATIONS.has(token));
};

const hasMatchingScopedPolarity = (claim: string, evidence: string): boolean =>
  scopedNegativePolarity(claim, claim) ===
  scopedNegativePolarity(evidence, claim);

const hasLexicalContradiction = (claim: string, evidence: string): boolean => {
  const normalizedClaim = normalizeTranscriptEvidence(claim);
  const normalizedEvidence = normalizeTranscriptEvidence(evidence);
  const containsTerm = (value: string, term: string): boolean => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^| )${escaped}(?: |$)`).test(value);
  };
  const opposites = [
    ['enable', 'disable'],
    ['allow', 'block'],
    ['remove', 'retain'],
    ['include', 'exclude'],
    ['increase', 'decrease'],
    ['start', 'stop'],
    ['accept', 'reject'],
    ['approve', 'reject'],
    ['before', 'after'],
  ];
  if (
    opposites.some(
      ([left, right]) =>
        (containsTerm(normalizedClaim, left) &&
          containsTerm(normalizedEvidence, right)) ||
        (containsTerm(normalizedClaim, right) &&
          containsTerm(normalizedEvidence, left)),
    )
  ) {
    return true;
  }
  const relationSides = (value: string, relation: string) => {
    const tokens = value.split(' ');
    const relationIndex = tokens.indexOf(relation);
    if (relationIndex < 1 || relationIndex >= tokens.length - 1) return null;
    const ignored = new Set([
      'a',
      'an',
      'and',
      'i',
      'run',
      'the',
      'to',
      'we',
      'will',
    ]);
    const left = tokens
      .slice(0, relationIndex)
      .filter((token) => !ignored.has(token));
    const right = tokens
      .slice(relationIndex + 1)
      .filter((token) => !ignored.has(token));
    return left.length > 0 && right.length > 0 ? { left, right } : null;
  };
  const relationSideMatches = (left: string[], right: string[]): boolean => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const intersection = [...leftSet].filter((token) => rightSet.has(token));
    return intersection.length >= 1;
  };
  const distinguishingRelationSides = (sides: {
    left: string[];
    right: string[];
  }) => {
    const leftSet = new Set(sides.left);
    const rightSet = new Set(sides.right);
    const shared = new Set([...leftSet].filter((token) => rightSet.has(token)));
    return {
      left: sides.left.filter((token) => !shared.has(token)),
      right: sides.right.filter((token) => !shared.has(token)),
    };
  };
  return ['before', 'after'].some((relation) => {
    const claimSides = relationSides(normalizedClaim, relation);
    const evidenceSides = relationSides(normalizedEvidence, relation);
    const distinguishingClaimSides = claimSides
      ? distinguishingRelationSides(claimSides)
      : null;
    const distinguishingEvidenceSides = evidenceSides
      ? distinguishingRelationSides(evidenceSides)
      : null;
    return (
      distinguishingClaimSides !== null &&
      distinguishingEvidenceSides !== null &&
      relationSideMatches(
        distinguishingClaimSides.left,
        distinguishingEvidenceSides.right,
      ) &&
      relationSideMatches(
        distinguishingClaimSides.right,
        distinguishingEvidenceSides.left,
      )
    );
  });
};

export const resolveTranscriptEvidence = (
  evidence: string | undefined,
  transcript: string,
  claim?: string,
  options: AnalysisGroundingOptions = {},
): ResolvedTranscriptEvidence | null => {
  const normalizedEvidence = normalizeTranscriptEvidence(evidence ?? '');
  if (!normalizedEvidence) return null;
  const evidenceClaimSupport = claim
    ? claimSupportRatio(claim, evidence ?? '', options.terminologyAliases)
    : 1;
  const evidenceSupportsClaim = evidenceClaimSupport >= MIN_FULL_CLAIM_SUPPORT;
  const lines = transcript.split(/\r?\n/);
  for (
    let spanLength = 1;
    spanLength <= MAX_EVIDENCE_SPAN_LINES;
    spanLength += 1
  ) {
    for (
      let lineIndex = 0;
      lineIndex + spanLength <= lines.length;
      lineIndex += 1
    ) {
      const span = lines.slice(lineIndex, lineIndex + spanLength);
      const sourceLine = span
        .map((line, index) =>
          index === 0 ? line : transcriptLineContent(line),
        )
        .filter((line) => line.trim().length > 0)
        .join(' ');
      if (
        normalizeTranscriptEvidence(sourceLine).includes(normalizedEvidence)
      ) {
        if (
          !evidenceSupportsClaim &&
          (spanLength !== 2 ||
            !hasExplicitResolutionCue(evidence ?? '') ||
            (!normalizeTranscriptEvidence(
              transcriptLineContent(span[span.length - 1]),
            ).includes(normalizedEvidence) &&
              !normalizeTranscriptEvidence(
                transcriptLineContent(span[0]),
              ).includes(normalizedEvidence)) ||
            evidenceClaimSupport < MIN_PARTIAL_CLAIM_SUPPORT)
        ) {
          continue;
        }
        if (
          !evidenceSupportsClaim &&
          (!claim ||
            claimSupportRatio(claim, sourceLine, options.terminologyAliases) <
              MIN_FULL_CLAIM_SUPPORT)
        ) {
          continue;
        }
        const expandedEvidence = span
          .map(transcriptLineContent)
          .filter((line) => line.trim().length > 0)
          .join(' ');
        return {
          evidence: evidenceSupportsClaim
            ? (evidence?.trim() ?? '')
            : expandedEvidence,
          quotedEvidence: evidence?.trim() ?? '',
          sourceLine,
          sourceLines: span,
          lineIndex,
        };
      }
    }
  }
  return null;
};

export interface AnalysisGroundingOptions {
  terminologyAliases?: Record<string, string[]>;
}

const normalizeClaimTerminology = (
  claim: string,
  aliases: Record<string, string[]> = {},
): string => {
  let normalized = normalizeTranscriptEvidence(claim);
  for (const [preferred, rawForms] of Object.entries(aliases)) {
    const normalizedPreferred = normalizeTranscriptEvidence(preferred);
    const normalizedRaw = normalizeTranscriptEvidence(rawForms[0] ?? '');
    if (
      !normalizedPreferred ||
      !normalizedRaw ||
      /\d/.test(normalizedPreferred) ||
      /\d/.test(normalizedRaw) ||
      /\b(?:no|not|never|without)\b/.test(normalizedPreferred) ||
      /\b(?:no|not|never|without)\b/.test(normalizedRaw)
    ) {
      continue;
    }
    const escaped = normalizedPreferred.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(
      new RegExp(`\\b${escaped}\\b`, 'g'),
      normalizedRaw,
    );
  }
  return normalized;
};

function claimSupportRatio(
  claim: string,
  evidence: string,
  terminologyAliases: Record<string, string[]> = {},
): number {
  const claimTokens = normalizeClaimTerminology(claim, terminologyAliases)
    .replace(/\b(?:proceed|move forward) with\b/g, 'use')
    .split(' ')
    .filter((token) => token.length >= 2);
  if (claimTokens.length === 0) return 0;
  const evidenceTokens = new Set(
    normalizeTranscriptEvidence(evidence)
      .split(' ')
      .filter((token) => token.length >= 2),
  );
  return (
    claimTokens.filter((token) => evidenceTokens.has(token)).length /
    claimTokens.length
  );
}

const fieldSupportedBySource = (
  value: string | undefined,
  sourceLine: string,
): boolean => {
  const normalized = normalizeTranscriptEvidence(value ?? '');
  return (
    normalized.length > 0 &&
    normalizeTranscriptEvidence(sourceLine).includes(normalized)
  );
};

const settledFieldSupportedByTurn = (
  value: string,
  resolved: ResolvedTranscriptEvidence,
  kind: 'action' | 'decision',
): boolean => {
  const normalizedValue = normalizeTranscriptEvidence(value);
  return resolved.sourceLines.some((line) => {
    const speaker = transcriptLineSpeaker(line);
    const normalizedSpeaker = normalizeTranscriptEvidence(speaker ?? '');
    const content = transcriptLineContent(line);
    if (normalizedSpeaker === normalizedValue) {
      return kind === 'action'
        ? /\b(?:i can|i will|i'll|i own|i'll own|will do)\b/i.test(content)
        : /\b(?:i decided|i approved|i selected|we decided|we approved|we selected|we will|will use|proceed|the decision is)\b/i.test(
            content,
          );
    }
    const escapedValue = normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedContent = normalizeTranscriptEvidence(content);
    return kind === 'action'
      ? new RegExp(
          `\\b${escapedValue}\\b(?: is| was)? (?:assigned|owns|will)\\b|\\bassigned to ${escapedValue}\\b`,
        ).test(normalizedContent)
      : new RegExp(
          `\\b${escapedValue}\\b (?:decided|approved|selected)\\b`,
        ).test(normalizedContent);
  });
};

const fieldExplicitlySuperseded = (
  value: string,
  sourceLine: string,
): boolean => {
  const normalizedValue = normalizeTranscriptEvidence(value);
  const normalizedSource = normalizeTranscriptEvidence(sourceLine);
  if (!normalizedValue) return false;
  const escapedValue = normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:not|no longer|instead of|rather than) ${escapedValue}\\b|\\b${escapedValue}(?: is| was| has been)? (?:cancelled|canceled|superseded|replaced|moved|off)\\b|\\b${escapedValue} (?:won t|will not|doesn t|does not) work\\b|\\b${escapedValue} no longer works?\\b`,
  ).test(normalizedSource);
};

const isSettledDueValue = (value: string): boolean => {
  const normalized = normalizeTranscriptEvidence(value);
  return (
    normalized.length > 0 &&
    !/^(?:tbd|unknown|none|unset|not set(?: yet)?|no (?:date|deadline|timing))$/.test(
      normalized,
    )
  );
};

const isUnacceptedRequest = (evidence: string): boolean =>
  evidence.includes('?') &&
  !/\b(?:agreed|i can|i will|i'll|sure|yes|will do)\b/i.test(evidence);

const isPassiveUnownedNeed = (evidence: string): boolean =>
  /\bneeds? to be\b/i.test(evidence) &&
  !/\b(?:assigned|i can|i will|i'll|owns?|sure|yes|will do)\b/i.test(evidence);

const GENERIC_ACTION_ASSIGNEE =
  /^(?:group|team|the team|we|everyone|i|me|you)$/i;
const FIRST_PERSON_ACTION_COMMITMENT =
  /\b(?:i will|i['’]ll|i can|i am going to|i['’]m going to|i commit to)\b/i;
const GROUP_ACTION_COMMITMENT = /\b(?:we will|we['’]ll|we commit to)\b/i;
const NAMED_ACTION_COMMITMENT =
  /\b([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,2})\s+(?:will|shall|can|owns?|is assigned|was assigned)\b/gu;

const capitalizeActionText = (value: string): string =>
  value.replace(/^\p{Ll}/u, (character) =>
    character.toLocaleUpperCase('en-US'),
  );

const canonicalizeActionText = (text: string, assignee?: string): string => {
  const subjectPatterns = [
    '(?:the\\s+team|team|we|i)',
    ...(assignee && !GENERIC_ACTION_ASSIGNEE.test(assignee.trim())
      ? [assignee.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]
      : []),
  ];
  const framing = new RegExp(
    `^(?:${subjectPatterns.join('|')})\\s+(?:will|shall|can|(?:is|are|am)\\s+going\\s+to|(?:has|have)\\s+(?:agreed|committed)\\s+to)\\s+`,
    'i',
  );
  const canonical = text
    .trim()
    .replace(/^(?:i|we)['’]ll\s+/i, '')
    .replace(framing, '')
    .trim();
  return capitalizeActionText(canonical || text.trim());
};

const resolveActionAssignee = (
  claimedAssignee: string | undefined,
  resolved: ResolvedTranscriptEvidence,
): { assignee?: string; rejectedClaimedAssignee: boolean } => {
  const firstPersonSpeakers = new Set(
    resolved.sourceLines
      .filter((line) =>
        FIRST_PERSON_ACTION_COMMITMENT.test(transcriptLineContent(line)),
      )
      .map(transcriptLineSpeaker)
      .filter((speaker): speaker is string => Boolean(speaker)),
  );
  if (firstPersonSpeakers.size === 1) {
    const [assignee] = firstPersonSpeakers;
    return {
      assignee,
      rejectedClaimedAssignee: Boolean(
        claimedAssignee &&
          !GENERIC_ACTION_ASSIGNEE.test(claimedAssignee) &&
          normalizeTranscriptEvidence(claimedAssignee) !==
            normalizeTranscriptEvidence(assignee),
      ),
    };
  }

  if (
    resolved.sourceLines.some((line) =>
      GROUP_ACTION_COMMITMENT.test(transcriptLineContent(line)),
    )
  ) {
    return {
      assignee: 'Group',
      rejectedClaimedAssignee: Boolean(
        claimedAssignee && !GENERIC_ACTION_ASSIGNEE.test(claimedAssignee),
      ),
    };
  }

  const namedAssignees = new Set(
    resolved.sourceLines.flatMap((line) =>
      [...transcriptLineContent(line).matchAll(NAMED_ACTION_COMMITMENT)]
        .map((match) => match[1]?.trim())
        .filter(
          (assignee): assignee is string =>
            Boolean(assignee) && !GENERIC_ACTION_ASSIGNEE.test(assignee),
        ),
    ),
  );
  if (namedAssignees.size === 1) {
    const [assignee] = namedAssignees;
    return {
      assignee,
      rejectedClaimedAssignee: Boolean(
        claimedAssignee &&
          normalizeTranscriptEvidence(claimedAssignee) !==
            normalizeTranscriptEvidence(assignee),
      ),
    };
  }

  if (
    claimedAssignee &&
    !GENERIC_ACTION_ASSIGNEE.test(claimedAssignee) &&
    fieldSupportedBySource(claimedAssignee, resolved.sourceLine) &&
    settledFieldSupportedByTurn(claimedAssignee, resolved, 'action')
  ) {
    return { assignee: claimedAssignee, rejectedClaimedAssignee: false };
  }

  return {
    rejectedClaimedAssignee: Boolean(claimedAssignee),
  };
};

const isDecisionEquivalentAction = (
  action: ActionItemV3,
  decisions: DecisionV3[],
): boolean => {
  if (
    !/^(?:adopt|approve|choose|default to|go with|migrate to|move to|proceed with|select|settle on|standardize on|switch to|use)\b/i.test(
      action.text.trim(),
    )
  ) {
    return false;
  }
  const actionEvidence = normalizeTranscriptEvidence(action.evidence ?? '');
  const objectTokens = (text: string): Set<string> =>
    new Set(
      normalizeTranscriptEvidence(text)
        .split(' ')
        .slice(1)
        .filter((token) => !['on', 'to', 'with'].includes(token)),
    );
  const actionObject = objectTokens(action.text);
  return decisions.some((decision) => {
    if (
      !actionEvidence ||
      normalizeTranscriptEvidence(decision.evidence ?? '') !== actionEvidence
    ) {
      return false;
    }
    const decisionObject = objectTokens(decision.text);
    return [...actionObject].some((token) => decisionObject.has(token));
  });
};

const isUnresolvedDeferral = (claim: string): boolean =>
  /\b(?:leave|leaving|left|remain|remains|remaining)\b[^.]*\bopen\b/i.test(
    claim,
  );

const isUnsettledProposal = (sourceLine: string): boolean =>
  /\b(?:can|could|may|might|maybe|perhaps|should|would|consider|propos(?:e|ed)|suggest(?:ed)?)\b/i.test(
    sourceLine.replace(/\bi can\b/gi, ''),
  );

const isSettledClaimSupported = (
  claim: string,
  resolved: ResolvedTranscriptEvidence,
  terminologyAliases: Record<string, string[]> = {},
): boolean => {
  const clauses = resolved.sourceLines.flatMap((line) =>
    (transcriptLineContent(line).match(/[^.?!;]+[.?!;]?/g) ?? [])
      .map((clause) => clause.trim())
      .filter(Boolean),
  );
  const supportingClauses = clauses.filter(
    (clause) =>
      claimSupportRatio(claim, clause, terminologyAliases) >=
      MIN_FULL_CLAIM_SUPPORT,
  );
  const quotedClauseCount = (
    resolved.quotedEvidence.match(/[^.?!;]+[.?!;]?/g) ?? []
  ).length;
  if (
    supportingClauses.some(
      (clause) =>
        hasMatchingScopedPolarity(claim, clause) &&
        !hasLexicalContradiction(claim, clause) &&
        !isUnacceptedRequest(clause) &&
        !isUnsettledProposal(clause),
    )
  ) {
    return true;
  }
  return (
    supportingClauses.length === 0 &&
    claimSupportRatio(claim, resolved.sourceLine, terminologyAliases) >=
      MIN_FULL_CLAIM_SUPPORT &&
    claimSupportRatio(claim, resolved.quotedEvidence, terminologyAliases) >=
      MIN_PARTIAL_CLAIM_SUPPORT &&
    quotedClauseCount === 1 &&
    hasExplicitResolutionCue(resolved.quotedEvidence) &&
    hasMatchingScopedPolarity(claim, resolved.quotedEvidence) &&
    !hasLexicalContradiction(claim, resolved.quotedEvidence)
  );
};

const resolveKeyPointSpeaker = (
  text: string,
  claimedSpeaker: string,
  transcript: string,
  terminologyAliases: Record<string, string[]> = {},
): string | undefined => {
  const supportedSpeakers = new Set(
    transcript
      .split(/\r?\n/)
      .filter(
        (line) =>
          claimSupportRatio(
            text,
            transcriptLineContent(line),
            terminologyAliases,
          ) >= MIN_FULL_CLAIM_SUPPORT &&
          hasMatchingScopedPolarity(text, transcriptLineContent(line)) &&
          !hasLexicalContradiction(text, transcriptLineContent(line)),
      )
      .map(transcriptLineSpeaker)
      .filter((speaker): speaker is string => Boolean(speaker))
      .map(normalizeTranscriptEvidence),
  );
  const normalizedClaimedSpeaker = normalizeTranscriptEvidence(claimedSpeaker);
  return supportedSpeakers.size === 1 &&
    supportedSpeakers.has(normalizedClaimedSpeaker)
    ? claimedSpeaker
    : undefined;
};

const deduplicateByText = <T extends { text: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeTranscriptEvidence(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const pushCategory = (
  categories: AnalysisErrorCategory[],
  category: AnalysisErrorCategory,
) => {
  if (!categories.includes(category)) categories.push(category);
};

const POSITIVE_OUTCOME_SIGNAL =
  /\b(?:prais(?:e|ed|ing)|recogniz(?:e|ed|ing)|kudos|compliment(?:ed|s)?|great job|excellent work|impressed|delivered|shipped|launched|released|completed|finished|went live|hit (?:the )?(?:target|milestone|goal)|exceeded (?:the )?(?:target|goal)|resolved (?:the )?blocker|revenue|bookings?)\b|\b(?:closed|won|signed)\b.{0,60}\b(?:deal|account|contract|renewal|sale|customer)\b/i;

export const groundRecentWin = (
  recentWin: RecentWinV3 | undefined,
  transcript: string,
  options: AnalysisGroundingOptions,
): RecentWinV3 | undefined => {
  if (!recentWin) return undefined;
  const resolved = resolveTranscriptEvidence(
    recentWin.evidence,
    transcript,
    recentWin.win,
    options,
  );
  if (
    !resolved ||
    claimSupportRatio(
      recentWin.win,
      resolved.evidence,
      options.terminologyAliases,
    ) < MIN_PARTIAL_CLAIM_SUPPORT ||
    claimSupportRatio(
      recentWin.why_it_counts,
      resolved.sourceLine,
      options.terminologyAliases,
    ) < MIN_PARTIAL_CLAIM_SUPPORT ||
    !POSITIVE_OUTCOME_SIGNAL.test(resolved.sourceLine)
  ) {
    return undefined;
  }
  return { ...recentWin, evidence: resolved.evidence };
};

/** Field/polarity checks for a claim already reviewed against exact canonical
 * spans. Deliberately no lexical-overlap threshold: paraphrases are audited.
 * Never select this path from persisted metadata or a model confidence flag. */
export const isUnacceptedConditionalWillingness = (evidence: string): boolean =>
  /\bif\b/i.test(evidence) &&
  /\bi can\b/i.test(evidence) &&
  !/\b(?:agreed|yes|will|commit)\b/i.test(evidence);

export const groundSourceReviewedItem = (
  item: {
    text: string;
    kind: 'action' | 'decision';
    owner: string | null;
    due: string | null;
  },
  resolved: ResolvedTranscriptEvidence,
): { text: string; owner: string | null; due: string | null } | null => {
  const evidence = resolved.evidence;
  const conditional =
    /\b(?:if|unless|until|once|after|when|pending|subject to|provided)\b/i;
  const numbers = (value: string): string[] =>
    value.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
  if (
    !hasMatchingScopedPolarity(item.text, evidence) ||
    hasLexicalContradiction(item.text, evidence) ||
    numbers(item.text).some((number) => !numbers(evidence).includes(number)) ||
    (conditional.test(evidence) && !conditional.test(item.text)) ||
    isUnacceptedRequest(evidence) ||
    (/\b(?:may|might|could|should|maybe|perhaps)\b/i.test(evidence) &&
      !hasExplicitResolutionCue(evidence)) ||
    isUnacceptedConditionalWillingness(evidence)
  )
    return null;
  const ownership =
    item.kind === 'action'
      ? resolveActionAssignee(item.owner ?? undefined, resolved)
      : null;
  const owner =
    item.kind === 'action'
      ? (ownership?.assignee ?? null)
      : item.owner &&
          settledFieldSupportedByTurn(item.owner, resolved, 'decision')
        ? item.owner
        : null;
  const due =
    item.due &&
    isSettledDueValue(item.due) &&
    fieldSupportedBySource(item.due, evidence) &&
    !fieldExplicitlySuperseded(item.due, evidence) &&
    new RegExp(
      `\\b(?:by|before|on|due|deadline(?: is)?|no later than)\\s+(?:the\\s+)?${item.due.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    ).test(evidence)
      ? item.due
      : null;
  return {
    text:
      item.kind === 'action'
        ? canonicalizeActionText(item.text, owner ?? undefined)
        : item.text,
    owner,
    due,
  };
};

export const groundAnalysisDocument = (
  analysis: AnalysisDocumentV3,
  transcript: string,
  options: AnalysisGroundingOptions = {},
): {
  analysis: AnalysisDocumentV3;
  errorCategories: AnalysisErrorCategory[];
} => {
  const errorCategories: AnalysisErrorCategory[] = [];
  const recent_win = groundRecentWin(analysis.recent_win, transcript, options);
  if (analysis.recent_win && !recent_win) {
    pushCategory(errorCategories, 'unsupported_recent_win');
  }
  const groundedTopics = analysis.topics.map((topic) => {
    const key_points = topic.key_points.map((point) => {
      if (!point.speaker) return point;
      const speaker = resolveKeyPointSpeaker(
        point.text,
        point.speaker,
        transcript,
        options.terminologyAliases,
      );
      if (speaker) return { ...point, speaker };
      pushCategory(errorCategories, 'unsupported_key_point_speaker');
      const { speaker: _unsupportedSpeaker, ...groundedPoint } = point;
      return groundedPoint;
    });
    const decisions = topic.decisions.flatMap((decision): DecisionV3[] => {
      const resolved = resolveTranscriptEvidence(
        decision.evidence,
        transcript,
        decision.text,
        options,
      );
      if (
        !resolved ||
        claimSupportRatio(
          decision.text,
          resolved.evidence,
          options.terminologyAliases,
        ) < MIN_FULL_CLAIM_SUPPORT ||
        !isSettledClaimSupported(
          decision.text,
          resolved,
          options.terminologyAliases,
        ) ||
        isUnresolvedDeferral(decision.text)
      ) {
        pushCategory(errorCategories, 'unsupported_decision');
        return [];
      }
      const grounded: DecisionV3 = {
        text: decision.text,
        evidence: resolved.evidence,
      };
      if (decision.decided_by) {
        if (
          fieldSupportedBySource(decision.decided_by, resolved.sourceLine) &&
          settledFieldSupportedByTurn(decision.decided_by, resolved, 'decision')
        ) {
          grounded.decided_by = decision.decided_by;
        } else {
          pushCategory(errorCategories, 'unsupported_decision_decider');
        }
      }
      if (decision.rationale) {
        if (fieldSupportedBySource(decision.rationale, resolved.sourceLine)) {
          grounded.rationale = decision.rationale;
        } else {
          pushCategory(errorCategories, 'unsupported_decision_rationale');
        }
      }
      return [grounded];
    });

    const action_items = topic.action_items.flatMap((item): ActionItemV3[] => {
      const canonicalItem = {
        ...item,
        text: canonicalizeActionText(item.text, item.assignee),
      };
      const resolved = resolveTranscriptEvidence(
        canonicalItem.evidence,
        transcript,
        canonicalItem.text,
        options,
      );
      if (
        !resolved ||
        claimSupportRatio(
          canonicalItem.text,
          resolved.evidence,
          options.terminologyAliases,
        ) < MIN_FULL_CLAIM_SUPPORT ||
        !isSettledClaimSupported(
          canonicalItem.text,
          resolved,
          options.terminologyAliases,
        ) ||
        isDecisionEquivalentAction(canonicalItem, decisions) ||
        isPassiveUnownedNeed(resolved.sourceLine)
      ) {
        pushCategory(errorCategories, 'unsupported_action_item');
        return [];
      }
      const grounded: ActionItemV3 = {
        text: canonicalItem.text,
        evidence: resolved.evidence,
        topic: topic.title,
      };
      const ownership = resolveActionAssignee(item.assignee, resolved);
      if (ownership.assignee) {
        grounded.assignee = ownership.assignee;
      }
      if (ownership.rejectedClaimedAssignee) {
        pushCategory(errorCategories, 'unsupported_action_item_owner');
      }
      if (item.due) {
        if (
          isSettledDueValue(item.due) &&
          fieldSupportedBySource(item.due, resolved.sourceLine) &&
          !fieldExplicitlySuperseded(item.due, resolved.sourceLine)
        ) {
          grounded.due = item.due;
        } else {
          pushCategory(errorCategories, 'unsupported_action_item_due');
        }
      }
      return [grounded];
    });

    return {
      ...topic,
      key_points,
      decisions: deduplicateByText(decisions),
      action_items: deduplicateByText(action_items),
    };
  });

  const allGroundedDecisions = groundedTopics.flatMap(
    (topic) => topic.decisions,
  );
  const topics = groundedTopics.map((topic) => ({
    ...topic,
    action_items: topic.action_items.filter((item) => {
      if (!isDecisionEquivalentAction(item, allGroundedDecisions)) {
        return true;
      }
      pushCategory(errorCategories, 'unsupported_action_item');
      return false;
    }),
  }));

  return {
    analysis: {
      ...analysis,
      topics,
      all_action_items: deduplicateByText(
        topics.flatMap((topic) => topic.action_items),
      ),
      all_decisions: deduplicateByText(
        topics.flatMap((topic) => topic.decisions),
      ),
      ...(recent_win ? { recent_win } : { recent_win: undefined }),
    },
    errorCategories,
  };
};
