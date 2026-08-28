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

const negativeDecisionDisposition = (text: string) =>
  /\bno\b.*\bneed(?:ed)?\b|\bnot\s+needed\b/i.test(text)
    ? 'not_needed'
    : /\bunassigned\b/i.test(text)
      ? 'unassigned'
      : undefined;
const DECISION_DISPOSITION_FRAMING = new Set(
  'a an the that this is are be needed need no not'.split(' '),
);
const DECISION_PREREQUISITE =
  /\b(?:if|unless|until|once|after|when|pending|subject to|provided|conditional on|contingent (?:on|upon))\b/i;

/** A narrow decision-only escape from whole-turn question/offer checks. The
 * explicit disposition must support this target, not just a neighboring topic.
 * Original evidence and citations remain untouched outside this local check. */
const explicitDispositionClause = (
  claim: string,
  resolved: ResolvedTranscriptEvidence,
): { evidence: string; speaker?: string } | undefined => {
  if (!/\b(?:need|needed|assigned|unassigned)\b/i.test(claim)) return undefined;
  const contentTokens = (text: string) =>
    normalizeTranscriptEvidence(
      negativeDecisionDisposition(text) === 'unassigned' ||
        (/\bassigned\b/i.test(text) && !negativeDecisionDisposition(text))
        ? text
            .replace(/\b(?:is|are)\s+to\s+(?:remain|be left)\b/gi, '')
            .replace(
              /\b(?:let us|let['’]s|leave|left|remains|remain|assigned|unassigned)\b/gi,
              '',
            )
        : // Only the leading disposition uses for/to as framing. A later
          // "to us" or "for us" is recipient/scope and must stay in the claim.
          text.replace(/^\s*no need\s+(?:for|to)\s+/i, ''),
    )
      .split(' ')
      .filter((token) => !DECISION_DISPOSITION_FRAMING.has(token));
  const prerequisite = (text: string) => {
    const index = text.search(DECISION_PREREQUISITE);
    return index < 0 ? '' : normalizeTranscriptEvidence(text.slice(index));
  };
  const withoutPrerequisite = (text: string) => {
    const index = text.search(DECISION_PREREQUISITE);
    return index < 0 ? text : text.slice(0, index);
  };
  const target = contentTokens(withoutPrerequisite(claim));
  if (!target.length) return undefined;
  for (const line of resolved.sourceLines) {
    for (const part of transcriptLineContent(line).match(/[^.?!;]+[.?!;]?/g) ??
      []) {
      const clause = part.trim();
      if (
        (!/^(?:no need\b|(?:thanks(?:,?\s+[^,]+)?,?\s+but\s+)?(?:let us|let['’]s)\s+leave\b.*\bunassigned\b)/i.test(
          clause,
        ) &&
          !/\b(?:agreed|decided|the decision is)\b/i.test(clause)) ||
        clause.includes('?') ||
        isUnsettledProposal(clause) ||
        !negativeDecisionDisposition(clause)
      )
        continue;
      // Strip only speech framing. The complete source predicate must survive:
      // "no need to cancel the report" does not mean "no report is needed".
      const subject = withoutPrerequisite(clause)
        .replace(/^thanks(?:,?\s+[^,]+)?,?\s+but\s+/i, '')
        .replace(
          /^(?:(?:we|i)\s+)?(?:agreed|decided)(?:\s+that)?\s+|^the decision is\s+/i,
          '',
        );
      const sourceTokens = contentTokens(subject);
      const sameContent = target.join(' ') === sourceTokens.join(' ');
      // A single leading modifier must qualify this same target in provided
      // context ("launch announcement"), not merely occur elsewhere in it.
      const qualifiedTarget =
        negativeDecisionDisposition(clause) === 'unassigned' &&
        target.length === sourceTokens.length + 1 &&
        target.slice(1).join(' ') === sourceTokens.join(' ') &&
        !/^(?:and|or|not|no|another|other)$/.test(target[0]!) &&
        resolved.sourceLines.some((context) =>
          ` ${normalizeTranscriptEvidence(transcriptLineContent(context))} `.includes(
            ` ${target[0]} ${sourceTokens[0]} `,
          ),
        );
      if (
        (sameContent || qualifiedTarget) &&
        prerequisite(claim) === prerequisite(clause)
      ) {
        return { evidence: clause, speaker: transcriptLineSpeaker(line) };
      }
    }
  }
  return undefined;
};

/** A rejected offer is not a prerequisite on a separately settled choice.
 * Scope only an adjacent, unambiguous offer/rejection pair whose complete
 * choice predicate (including rationale and conditions) is copied faithfully.
 * This local view never replaces the caller's original evidence or citations. */
const rejectedOfferDecisionClause = (
  claim: string,
  resolved: ResolvedTranscriptEvidence,
): string | undefined => {
  if (resolved.sourceLines.length !== 2) return undefined;
  const decision = transcriptLineContent(resolved.sourceLines[1]!);
  const sourceChoice = /^we(?: have)? (?:decided|agreed)\s+(.+)$/i.exec(
    decision,
  );
  const claimedChoice =
    /^(?:we|the (?:team|group))(?: have)? (?:decided|agreed)\s+(.+)$/i.exec(
      claim,
    );
  if (!sourceChoice || !claimedChoice) return undefined;
  const rejected =
    /^(.*?),\s*(?:so\s+)?we\s+(?:will\s+not\s+take\s+up|declined|rejected)\s+(?:that|the)\s+offer[.!]?$/i.exec(
      sourceChoice[1]!,
    );
  const claimedRejection =
    /^(.*?),\s*(?:and\s+)?(?:declining|declined|rejecting|rejected)\s+(?:the|that)\s+offer(?:\s+to\s+(.+?))?[.!]?$/i.exec(
      claimedChoice[1]!,
    );
  if (
    !rejected ||
    !claimedRejection ||
    normalizeTranscriptEvidence(rejected[1]!) !==
      normalizeTranscriptEvidence(claimedRejection[1]!)
  )
    return undefined;
  const offer = transcriptLineContent(resolved.sourceLines[0]!);
  const offered = /^i (?:could|can)\s+(.+?)[.!]?$/i.exec(offer);
  if (!offered || /[.?!;]/.test(offered[1]!)) return undefined;
  const condition = DECISION_PREREQUISITE.exec(offered[1]!);
  const conditionIndex = condition?.index ?? -1;
  if (condition) {
    const tail = offered[1]!.slice(condition.index + condition[0].length);
    // A coordinated/modal tail or another prerequisite may introduce another
    // offer. Never discard it and assume "that offer" names the first task.
    if (
      /[,:]|\b(?:and|or|but|can|could|would|might|will|shall|may)\b/i.test(
        tail,
      ) ||
      DECISION_PREREQUISITE.test(tail)
    )
      return undefined;
  }
  const offeredTask = normalizeTranscriptEvidence(
    conditionIndex < 0 ? offered[1]! : offered[1]!.slice(0, conditionIndex),
  );
  const claimedTask = normalizeTranscriptEvidence(claimedRejection[2] ?? '');
  const omittedObject = offeredTask.slice(claimedTask.length).trim();
  const repeatedDirectObject =
    offeredTask.startsWith(`${claimedTask} `) &&
    !/\b(?:to|for|from|with|without|and|or|by|via|on|in|at|using)\b/.test(
      omittedObject,
    ) &&
    ` ${normalizeTranscriptEvidence(claimedRejection[1]!)} `.includes(
      ` ${omittedObject} `,
    );
  if (
    !offeredTask ||
    (claimedTask && offeredTask !== claimedTask && !repeatedDirectObject)
  )
    return undefined;
  return decision;
};

const decisionCopyPredicate = (value: string) =>
  normalizeTranscriptEvidence(
    value.replace(/^\s*(?:the decision is|decision)\s+/i, ''),
  );

/** A copied offer cannot borrow acceptance from a neighboring settlement.
 * Match the entire offered task, including its prerequisite and recipient.
 * Other audited actions/paraphrases are outside this narrow rejection guard. */
const isUnacceptedSourceOffer = (
  text: string,
  owner: string | null,
  resolved: ResolvedTranscriptEvidence,
): boolean => {
  const predicate = (value: string) =>
    normalizeTranscriptEvidence(
      canonicalizeActionText(
        value.replace(/^\s*(?:yes|sure|agreed)[,.!\s]+/i, ''),
        owner ?? undefined,
      ),
    );
  const lines = resolved.sourceLines.map(transcriptLineContent);
  const offeredLine = lines.findIndex((line) => {
    const offer = /^i (could|can)\s+([^.!?;]+)[.!]?$/i.exec(line.trim());
    return (
      offer &&
      (offer[1]!.toLowerCase() === 'could' || /\bif\b/i.test(offer[2]!)) &&
      normalizeTranscriptEvidence(offer[2]!) === predicate(text)
    );
  });
  if (offeredLine < 0) return false;
  if (
    lines.some((line) =>
      (line.match(/[^.?!;]+[.?!;]?/g) ?? []).some(
        (clause) =>
          hasExplicitResolutionCue(clause) &&
          !clause.includes('?') &&
          predicate(clause.trim()) === predicate(text),
      ),
    )
  )
    return false;
  return !(
    offeredLine === 0 &&
    lines.length === 2 &&
    /^(?:(?:yes|sure|agreed)(?: (?:please(?: do)?|(?:i|we) (?:will|can) do (?:that|it)))?|(?:i|we) will do (?:that|it)|will do)$/.test(
      normalizeTranscriptEvidence(lines[1]!),
    )
  );
};

export const groundSourceReviewedItem = (
  item: {
    text: string;
    kind: 'action' | 'decision';
    owner: string | null;
    due: string | null;
  },
  resolved: ResolvedTranscriptEvidence,
): { text: string; owner: string | null; due: string | null } | null => {
  const disposition =
    item.kind === 'decision'
      ? explicitDispositionClause(item.text, resolved)
      : undefined;
  const rejectedChoice =
    item.kind === 'decision'
      ? rejectedOfferDecisionClause(item.text, resolved)
      : undefined;
  const evidence = disposition?.evidence ?? rejectedChoice ?? resolved.evidence;
  // An explicit settled choice copied in full can use "may" as permission.
  // This exception never borrows a neighboring cue or relaxes other modalities.
  const exactDecisionCopy =
    item.kind === 'decision' &&
    /^\s*the decision is\b/i.test(evidence) &&
    !isUnsettledProposal(evidence.replace(/\bmay\b/gi, '')) &&
    !/\btentative(?:ly)?\b/i.test(evidence) &&
    // Pending publication can be a condition; a pending decision is not settled.
    !/\b(?:the decision|but it)\s+is\s+(?:pending\b|not\s+(?:yet\s+)?final(?:ized|ised)?\b)/i.test(
      evidence,
    ) &&
    decisionCopyPredicate(item.text) === decisionCopyPredicate(evidence);
  const conditional =
    /\b(?:if|unless|until|once|after|when|pending|subject to|provided|conditional on|contingent (?:on|upon))\b/i;
  // Only a proven refusal object gets refusal morphology; declining prices or
  // sales are not negation. Exact choice matching also protects prerequisites.
  const normalizeDecline = Boolean(rejectedChoice);
  const numbers = (value: string): string[] =>
    value.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
  if (
    (disposition &&
      negativeDecisionDisposition(item.text) !==
        negativeDecisionDisposition(disposition.evidence)) ||
    (item.kind === 'decision' &&
      negativeDecisionDisposition(item.text) &&
      !disposition) ||
    (item.kind === 'decision' &&
      !disposition &&
      (isUnsettledProposal(evidence) ||
        /\b(?:no|not|unassigned)\b/i.test(item.text)) &&
      !/\b(?:agreed|decided|approved|selected|will use|we will|proceed|the decision is)\b/i.test(
        evidence,
      )) ||
    !hasMatchingScopedPolarity(
      normalizeDecline
        ? item.text.replace(/\bdeclining\b/gi, 'declined')
        : item.text,
      normalizeDecline
        ? evidence.replace(/\bdeclining\b/gi, 'declined')
        : evidence,
    ) ||
    hasLexicalContradiction(item.text, evidence) ||
    numbers(item.text).some((number) => !numbers(evidence).includes(number)) ||
    (conditional.test(evidence) && !conditional.test(item.text)) ||
    isUnacceptedRequest(evidence) ||
    (item.kind === 'action' &&
      isUnacceptedSourceOffer(item.text, item.owner, resolved)) ||
    (/\b(?:may|might|could|should|maybe|perhaps)\b/i.test(evidence) &&
      !hasExplicitResolutionCue(evidence) &&
      !exactDecisionCopy) ||
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
          (disposition
            ? normalizeTranscriptEvidence(item.owner) ===
              normalizeTranscriptEvidence(disposition.speaker ?? '')
            : settledFieldSupportedByTurn(item.owner, resolved, 'decision'))
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
