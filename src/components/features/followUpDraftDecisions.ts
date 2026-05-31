import type { DecisionV3 } from '../../types';

interface FollowUpDraftDecisionsInput {
  v3Decisions: DecisionV3[];
  fallbackDecisions: string[];
}

const normalizeDecisionText = (value: string | null | undefined): string =>
  (value || '').trim();

const normalizeDecisionKey = (value: string | null | undefined): string =>
  normalizeDecisionText(value).toLowerCase();

const formatDecision = (decision: DecisionV3): string => {
  const decidedBy = normalizeDecisionText(decision.decided_by);
  return decidedBy
    ? `${decision.text} (Decided by: ${decidedBy})`
    : decision.text;
};

export const buildFollowUpDraftDecisions = ({
  v3Decisions,
  fallbackDecisions,
}: FollowUpDraftDecisionsInput): string[] => {
  const normalizedV3Decisions = v3Decisions
    .map((decision) => ({
      ...decision,
      text: normalizeDecisionText(decision.text),
    }))
    .filter((decision) => decision.text);

  if (normalizedV3Decisions.length === 0) {
    return fallbackDecisions;
  }

  const v3DecisionKeys = new Set(
    normalizedV3Decisions.map((decision) => normalizeDecisionKey(decision.text)),
  );
  const fallbackOnlyDecisions = fallbackDecisions.filter(
    (decision) => !v3DecisionKeys.has(normalizeDecisionKey(decision)),
  );

  return [
    ...normalizedV3Decisions.map((decision) => formatDecision(decision)),
    ...fallbackOnlyDecisions,
  ];
};
