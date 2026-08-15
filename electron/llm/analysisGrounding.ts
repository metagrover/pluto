import type {
  ActionItemV3,
  AnalysisDocumentV3,
  AnalysisErrorCategory,
  DecisionV3,
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
  sourceLine: string;
  lineIndex: number;
};

export const resolveTranscriptEvidence = (
  evidence: string | undefined,
  transcript: string,
): ResolvedTranscriptEvidence | null => {
  const normalizedEvidence = normalizeTranscriptEvidence(evidence ?? '');
  if (!normalizedEvidence) return null;
  const lines = transcript.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (
      normalizeTranscriptEvidence(lines[lineIndex]).includes(normalizedEvidence)
    ) {
      return {
        evidence: evidence?.trim() ?? '',
        sourceLine: lines[lineIndex],
        lineIndex,
      };
    }
  }
  return null;
};

const claimSupportRatio = (claim: string, evidence: string): number => {
  const claimTokens = normalizeTranscriptEvidence(claim)
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
};

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

export const groundAnalysisDocument = (
  analysis: AnalysisDocumentV3,
  transcript: string,
): {
  analysis: AnalysisDocumentV3;
  errorCategories: AnalysisErrorCategory[];
} => {
  const errorCategories: AnalysisErrorCategory[] = [];
  const topics = analysis.topics.map((topic) => {
    const decisions = topic.decisions.flatMap((decision): DecisionV3[] => {
      const resolved = resolveTranscriptEvidence(decision.evidence, transcript);
      if (
        !resolved ||
        claimSupportRatio(decision.text, resolved.evidence) < 0.8
      ) {
        pushCategory(errorCategories, 'unsupported_decision');
        return [];
      }
      const grounded: DecisionV3 = {
        text: decision.text,
        evidence: resolved.evidence,
      };
      if (decision.decided_by) {
        if (fieldSupportedBySource(decision.decided_by, resolved.sourceLine)) {
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
      const resolved = resolveTranscriptEvidence(item.evidence, transcript);
      if (!resolved || claimSupportRatio(item.text, resolved.evidence) < 0.8) {
        pushCategory(errorCategories, 'unsupported_action_item');
        return [];
      }
      const grounded: ActionItemV3 = {
        text: item.text,
        evidence: resolved.evidence,
        topic: topic.title,
      };
      if (item.assignee) {
        if (fieldSupportedBySource(item.assignee, resolved.sourceLine)) {
          grounded.assignee = item.assignee;
        } else {
          pushCategory(errorCategories, 'unsupported_action_item_owner');
        }
      }
      if (item.due) {
        if (fieldSupportedBySource(item.due, resolved.sourceLine)) {
          grounded.due = item.due;
        } else {
          pushCategory(errorCategories, 'unsupported_action_item_due');
        }
      }
      return [grounded];
    });

    return {
      ...topic,
      decisions: deduplicateByText(decisions),
      action_items: deduplicateByText(action_items),
    };
  });

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
    },
    errorCategories,
  };
};
