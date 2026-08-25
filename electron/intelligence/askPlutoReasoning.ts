import type { ParsedQuery } from './intelligenceTypes';

export type AskPlutoReasoningMode = 'fast' | 'deep';
export type AskPlutoReasoningOverride = 'auto' | AskPlutoReasoningMode;

const DEEP_REASONING_PATTERN =
  /\b(compare|comparison|changed?|difference|conflict|contradict|trend|pattern|risk|rationale|why|advise|advice|recommend|across meetings)\b/i;

export const queryReferencesPriorTurn = (query: string): boolean =>
  /\b(it|that|those|them|previous|earlier|you said|you suggested|why)\b/i.test(
    query,
  );

export const getCrossMeetingCandidateLimit = (
  query: string,
  intent: ParsedQuery['intent'],
): number => {
  if (intent !== 'comparative' && !/\bacross meetings\b/i.test(query)) return 0;
  return /\b(last|previous)\s+(one|meeting)\b/i.test(query) ? 1 : 3;
};

export const resolveAskPlutoReasoningMode = ({
  query,
  intent,
  override = 'auto',
}: {
  query: string;
  intent: ParsedQuery['intent'];
  override?: AskPlutoReasoningOverride;
}): AskPlutoReasoningMode => {
  if (override !== 'auto') return override;
  if (intent === 'comparative' || intent === 'exploratory') return 'deep';
  return DEEP_REASONING_PATTERN.test(query) ? 'deep' : 'fast';
};
