import type {
  AskPlutoConversationRelation,
  AskPlutoResearchTask,
} from './askPlutoConversation';
import type { ParsedQuery } from './intelligenceTypes';

export type AskPlutoReasoningMode = 'fast' | 'deep';
export type AskPlutoReasoningOverride = 'auto' | AskPlutoReasoningMode;

const DEEP_REASONING_PATTERN =
  /\b(compare|comparison|changed?|difference|conflict|contradict|trend|pattern|risk|rationale|why|advise|advice|recommend|across meetings)\b/i;
const MULTI_MEETING_SYNTHESIS_PATTERN =
  /\b(?:summari[sz]e|recap|overview|breakdown|analy[sz]e)\b[\s\S]{0,60}\b(?:meetings|calls)\b/i;
const BOUNDED_SYNTHESIZED_ANALYSIS_PATTERN =
  /\bwhat\s+do\s+you\s+think\s+(?:will|would)\s+satisfy\b/i;
const WORKSPACE_PLANNING_PATTERN =
  /\bwhat\s+do\s+you\s+think\s+(?:i|we)\s+should\s+(?:focus|prioritize)(?:\s+on)?\b|\bwhat\s+(?:should|do)\s+(?:i|we)\s+(?:need\s+to\s+)?(?:focus|prioritize)(?:\s+on)?\b|\bwhat\s+(?:are|is)\s+(?:my|our)\s+(?:top\s+)?priorit(?:y|ies)\b/i;

export const queryReferencesPriorTurn = (query: string): boolean =>
  /\b(it|that|those|them|previous|earlier|you said|you suggested|why)\b/i.test(
    query,
  );

export const shouldIncludePriorConversation = (
  query: string,
  hasExplicitMeetingScope: boolean,
  relation?: AskPlutoConversationRelation,
): boolean => {
  if (relation) return relation !== 'new_topic';
  return !hasExplicitMeetingScope || queryReferencesPriorTurn(query);
};

export const getCrossMeetingCandidateLimit = (
  query: string,
  intent: ParsedQuery['intent'],
): number => {
  if (intent !== 'comparative' && !/\bacross meetings\b/i.test(query)) return 0;
  return /\b(last|previous)\s+(one|meeting)\b/i.test(query) ? 1 : 3;
};

export const shouldRestrictToCurrentMeetingEvidence = ({
  currentMeetingRequested,
  historicalCandidateLimit,
  priorPinnedCount,
}: {
  currentMeetingRequested: boolean;
  historicalCandidateLimit: number;
  priorPinnedCount: number;
}): boolean =>
  currentMeetingRequested &&
  historicalCandidateLimit === 0 &&
  priorPinnedCount === 0;

export const shouldRestrictToPriorConversationEvidence = ({
  currentMeetingRequested,
  intent,
  priorPinnedCount,
  task = 'lookup',
  relation = 'new_topic',
  retrievalPolicy,
}: {
  currentMeetingRequested: boolean;
  intent: ParsedQuery['intent'];
  priorPinnedCount: number;
  task?: AskPlutoResearchTask;
  relation?: string;
  retrievalPolicy?: 'none' | 'reuse' | 'fresh';
}): boolean =>
  !currentMeetingRequested &&
  priorPinnedCount > 0 &&
  (retrievalPolicy === 'reuse' ||
    (retrievalPolicy !== 'fresh' &&
      (task !== 'analysis' || relation === 'follow_up') &&
      task !== 'comparison' &&
      intent !== 'comparative' &&
      intent !== 'exploratory'));

export const shouldRestrictToPinnedCurrentComparison = ({
  currentMeetingRequested,
  historicalCandidateLimit,
}: {
  currentMeetingRequested: boolean;
  historicalCandidateLimit: number;
}): boolean => currentMeetingRequested && historicalCandidateLimit === 1;

export const resolveAskPlutoReasoningMode = ({
  query,
  intent,
  override = 'auto',
  task = 'lookup',
  relation = 'new_topic',
}: {
  query: string;
  intent: ParsedQuery['intent'];
  override?: AskPlutoReasoningOverride;
  task?: AskPlutoResearchTask;
  relation?: AskPlutoConversationRelation;
}): AskPlutoReasoningMode => {
  if (override !== 'auto') return override;
  if (task === 'comparison') return 'deep';
  if (task === 'draft') return 'fast';
  if (WORKSPACE_PLANNING_PATTERN.test(query)) return 'deep';
  if (task === 'analysis' && BOUNDED_SYNTHESIZED_ANALYSIS_PATTERN.test(query))
    return 'fast';
  if (
    task === 'analysis' &&
    relation !== 'expansion' &&
    relation !== 'omission_follow_up'
  )
    return 'deep';
  if (intent === 'comparative' || intent === 'exploratory') return 'deep';
  return DEEP_REASONING_PATTERN.test(query) ||
    MULTI_MEETING_SYNTHESIS_PATTERN.test(query)
    ? 'deep'
    : 'fast';
};
