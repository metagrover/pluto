import type { AnalysisDocumentV3 } from '../../../electron/llm/analysisTypes';
import type {
  NotesSource,
  SourceSpan,
} from '../../../electron/llm/meetingNotesTypes';
import type {
  GoldClaim,
  LocalIntelligenceNotesCase,
} from './localIntelligenceEvaluationCases';

export type NotesProjectionExpectation = {
  kind: 'point' | 'action' | 'decision' | 'question';
  requiredTextTerms: string[];
  requiredEvidenceTerms: string[];
  forbiddenEvidenceTerms?: string[];
  owner?: string | null;
  due?: string | null;
};

export type NotesClaimScore = {
  id: string;
  critical: boolean;
  matchedBlockPath: string | null;
  projectionMatched: boolean;
  ownerMatched: boolean;
  dueMatched: boolean;
  provenanceMatched: boolean;
  evidenceMatched: boolean;
  passed: boolean;
};

export type ScoredVisibleNotesBlock = {
  path: string;
  kind:
    | NotesProjectionExpectation['kind']
    | 'aggregate_action'
    | 'aggregate_decision'
    | 'supporting_prose';
  text: string;
  owner: string | null;
  due: string | null;
  inlineEvidence: string | null;
  provenanceValid: boolean;
  resolvedEvidence: string | null;
  sourceSegments: number[];
};

const normalize = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

const subjectTokensForForbiddenPhrase = (phrase: string): string[] => {
  const tokens = phrase.split(/[^a-z0-9-]+/).filter(Boolean);
  const predicateStart = tokens.findIndex((token) =>
    ['is', 'are', 'was', 'were', 'has', 'have', 'will'].includes(token),
  );
  return predicateStart > 0
    ? tokens.slice(0, predicateStart)
    : tokens.slice(0, 1);
};

const predicateTokensForForbiddenPhrase = (phrase: string): string[] => {
  const tokens = phrase.split(/[^a-z0-9-]+/).filter(Boolean);
  const predicateStart = tokens.findIndex((token) =>
    ['is', 'are', 'was', 'were', 'has', 'have', 'will'].includes(token),
  );
  return predicateStart >= 0
    ? tokens.slice(predicateStart + 1)
    : tokens.slice(-1);
};

const containsUnnegatedPhrase = (text: string, phrase: string): boolean => {
  const subjectTokens = subjectTokensForForbiddenPhrase(phrase);
  const predicateTokens = predicateTokensForForbiddenPhrase(phrase);
  let index = text.indexOf(phrase);
  while (index >= 0) {
    const prefix = text.slice(0, index);
    const clauseStart =
      Math.max(
        prefix.lastIndexOf('.'),
        prefix.lastIndexOf(';'),
        prefix.lastIndexOf('!'),
        prefix.lastIndexOf('?'),
      ) + 1;
    const clausePrefix = text.slice(clauseStart, index);
    const negated =
      /\bno\s+$/.test(clausePrefix) ||
      /\bno evidence that\s+$/.test(clausePrefix);
    const sentenceEndOffset = text.slice(index + phrase.length).search(/[.!?]/);
    const sentenceEnd =
      sentenceEndOffset < 0
        ? text.length
        : index + phrase.length + sentenceEndOffset;
    const tail = text.slice(index + phrase.length, sentenceEnd);
    const contrastTail =
      /\b(?:but|however|although)\b(?<tail>.*)$/.exec(tail)?.groups?.tail ?? '';
    const contrastWords = contrastTail.split(/[^a-z0-9-]+/).filter(Boolean);
    const contrastTokens = new Set(contrastWords);
    const anaphoricContrast = contrastWords.some((token, tokenIndex) => {
      if (!['it', 'that', 'this'].includes(token)) return false;
      const nearby = contrastWords.slice(tokenIndex + 1, tokenIndex + 5);
      const predicateIndex = nearby.findIndex((word) =>
        predicateTokens.includes(word),
      );
      return (
        predicateIndex >= 0 &&
        !nearby
          .slice(0, predicateIndex)
          .some((word) => ['no', 'not', 'never'].includes(word))
      );
    });
    const postClaimContrast =
      /\bexcept\b/.test(tail) ||
      subjectTokens.some((token) => contrastTokens.has(token)) ||
      anaphoricContrast;
    if (!negated || postClaimContrast) return true;
    index = text.indexOf(phrase, index + phrase.length);
  }
  return false;
};

const matchesTerms = (value: string, terms: readonly string[]): boolean => {
  const text = normalize(value);
  return terms.every((term) =>
    term
      .split('|')
      .map(normalize)
      .some((alternative) => text.includes(alternative)),
  );
};

const sameOptionalValue = (
  expected: string | null | undefined,
  actual: string | null,
): boolean =>
  expected === undefined
    ? true
    : expected === null
      ? actual === null
      : actual !== null && normalize(actual) === normalize(expected);

const resolveSpans = (
  source: NotesSource,
  spans: readonly SourceSpan[],
): { evidence: string; segments: Set<number> } | null => {
  if (!spans.length) return null;
  const evidence: string[] = [];
  const segments = new Set<number>();
  for (const span of spans) {
    const segment = source.segments.find(
      (entry) => entry.index === span.segment,
    );
    if (
      !segment ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > segment.text.length
    ) {
      return null;
    }
    evidence.push(segment.text.slice(span.start, span.end));
    segments.add(segment.index);
  }
  return { evidence: evidence.join('\n'), segments };
};

const expectedEvidenceMatches = (
  claim: GoldClaim,
  resolved: { evidence: string; segments: Set<number> },
): boolean =>
  claim.evidence.every(({ sourceId, excerpt }) => {
    const match = /^segment-(\d+)$/.exec(sourceId);
    return (
      match !== null &&
      resolved.segments.has(Number(match[1])) &&
      normalize(resolved.evidence).includes(normalize(excerpt))
    );
  });

export const visibleBlocks = (
  analysis: AnalysisDocumentV3,
  source: NotesSource,
): ScoredVisibleNotesBlock[] => {
  const provenance = analysis.generation_metadata?.source_provenance;
  const revisionMatches = provenance?.source_revision === source.revision;
  const blocks: ScoredVisibleNotesBlock[] = [];
  const add = (
    path: string,
    kind: ScoredVisibleNotesBlock['kind'],
    text: string,
    owner: string | null = null,
    due: string | null = null,
    inlineEvidence: string | null = null,
  ) => {
    const metadata = provenance?.blocks[path];
    const resolved = metadata ? resolveSpans(source, metadata.sources) : null;
    const requiresInlineEvidence =
      kind === 'action' ||
      kind === 'decision' ||
      kind === 'aggregate_action' ||
      kind === 'aggregate_decision';
    const inlineEvidenceMatches = requiresInlineEvidence
      ? inlineEvidence !== null &&
        resolved !== null &&
        normalize(inlineEvidence) === normalize(resolved.evidence)
      : inlineEvidence === null;
    blocks.push({
      path,
      kind,
      text,
      owner,
      due,
      inlineEvidence,
      provenanceValid: Boolean(
        revisionMatches &&
          metadata?.id.trim() &&
          resolved &&
          inlineEvidenceMatches,
      ),
      resolvedEvidence: resolved?.evidence ?? null,
      sourceSegments: resolved ? [...resolved.segments] : [],
    });
  };

  add('overview', 'supporting_prose', analysis.overview);
  analysis.topics.forEach((topic, topicIndex) => {
    add(`topic:${topicIndex}:title`, 'supporting_prose', topic.title);
    if (topic.summary.trim()) {
      add(`topic:${topicIndex}:summary`, 'point', topic.summary);
    }
    topic.key_points.forEach((point, pointIndex) =>
      add(`topic:${topicIndex}:point:${pointIndex}`, 'point', point.text),
    );
    topic.action_items.forEach((action, actionIndex) =>
      add(
        `topic:${topicIndex}:action:${actionIndex}`,
        'action',
        action.text,
        action.assignee ?? null,
        action.due ?? null,
        action.evidence ?? null,
      ),
    );
    topic.decisions.forEach((decision, decisionIndex) =>
      add(
        `topic:${topicIndex}:decision:${decisionIndex}`,
        'decision',
        decision.text,
        decision.decided_by ?? null,
        null,
        decision.evidence ?? null,
      ),
    );
    topic.open_questions.forEach((question, questionIndex) =>
      add(
        `topic:${topicIndex}:question:${questionIndex}`,
        'question',
        question,
      ),
    );
  });
  analysis.all_action_items.forEach((action, actionIndex) =>
    add(
      `all_action_items:${actionIndex}`,
      'aggregate_action',
      action.text,
      action.assignee ?? null,
      action.due ?? null,
      action.evidence ?? null,
    ),
  );
  analysis.all_decisions.forEach((decision, decisionIndex) =>
    add(
      `all_decisions:${decisionIndex}`,
      'aggregate_decision',
      decision.text,
      decision.decided_by ?? null,
      null,
      decision.evidence ?? null,
    ),
  );
  if (analysis.recent_win) {
    add('recent_win:win', 'supporting_prose', analysis.recent_win.win);
    add(
      'recent_win:why_it_counts',
      'supporting_prose',
      analysis.recent_win.why_it_counts,
    );
  }
  return blocks;
};

const scoreClaimAgainstBlock = (
  claim: GoldClaim,
  block: ScoredVisibleNotesBlock | null,
): NotesClaimScore => {
  const expectation = claim.notesProjection;
  const projectionMatched = Boolean(
    expectation &&
      block &&
      block.kind === expectation.kind &&
      matchesTerms(block.text, expectation.requiredTextTerms),
  );
  const ownerMatched = Boolean(
    expectation && block && sameOptionalValue(expectation.owner, block.owner),
  );
  const dueMatched = Boolean(
    expectation && block && sameOptionalValue(expectation.due, block.due),
  );
  const provenanceMatched = Boolean(block?.provenanceValid);
  const resolvedEvidence = block?.resolvedEvidence ?? '';
  const evidenceMatched = Boolean(
    expectation &&
      block &&
      block.resolvedEvidence !== null &&
      matchesTerms(resolvedEvidence, expectation.requiredEvidenceTerms) &&
      !(expectation.forbiddenEvidenceTerms ?? []).some((term) =>
        matchesTerms(resolvedEvidence, [term]),
      ) &&
      expectedEvidenceMatches(claim, {
        evidence: resolvedEvidence,
        segments: new Set(block.sourceSegments),
      }),
  );
  return {
    id: claim.id,
    critical: claim.critical,
    matchedBlockPath: block?.path ?? null,
    projectionMatched,
    ownerMatched,
    dueMatched,
    provenanceMatched,
    evidenceMatched,
    passed:
      projectionMatched &&
      ownerMatched &&
      dueMatched &&
      provenanceMatched &&
      evidenceMatched,
  };
};

export const scoreNotesGoldOutput = (
  candidate: LocalIntelligenceNotesCase,
  analysis: AnalysisDocumentV3,
  source: NotesSource,
) => {
  const blocks = visibleBlocks(analysis, source);
  const available = new Set(blocks.map((_, index) => index));
  const claimResults = candidate.gold.requiredClaims.map((claim) => {
    const expectation = claim.notesProjection;
    const candidates = expectation
      ? [...available]
          .map((index) => ({ index, block: blocks[index]! }))
          .filter(
            ({ block }) =>
              block.kind === expectation.kind &&
              matchesTerms(block.text, expectation.requiredTextTerms),
          )
      : [];
    candidates.sort(
      (left, right) =>
        Number(right.block.provenanceValid) -
        Number(left.block.provenanceValid),
    );
    const selected = candidates[0];
    if (selected) available.delete(selected.index);
    return scoreClaimAgainstBlock(claim, selected?.block ?? null);
  });
  const forbiddenMatches = candidate.gold.forbiddenClaims.filter((forbidden) =>
    blocks.some((block) =>
      containsUnnegatedPhrase(normalize(block.text), normalize(forbidden)),
    ),
  );
  const provenanceFailures = blocks
    .filter((block) => !block.provenanceValid)
    .map((block) => block.path);
  return {
    requiredCount: claimResults.length,
    passedRequiredCount: claimResults.filter((result) => result.passed).length,
    criticalPassed: claimResults
      .filter((result) => result.critical)
      .every((result) => result.passed),
    claimResults,
    unmatchedVisibleBlocks: [...available].map((index) => blocks[index]!),
    provenanceFailures,
    forbiddenMatches,
    passed:
      claimResults.every((result) => result.passed) &&
      forbiddenMatches.length === 0 &&
      provenanceFailures.length === 0,
  };
};
