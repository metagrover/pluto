import type { ContextBundle, ContextEvidence } from './inferenceTypes';

const estimateTokens = (value: string) => Math.ceil(value.length / 4);

/**
 * Selects a deterministic, bounded evidence package in the main process.
 * Callers provide already-authorized local candidates in relevance order.
 */
export function buildContextBundle(input: {
  evidence: ContextEvidence[];
  recentTurns?: ContextBundle['recentTurns'];
  tokenBudget: number;
  sourceRevision?: string;
}): ContextBundle {
  const tokenBudget = Math.max(0, Math.floor(input.tokenBudget));
  let remaining = tokenBudget;
  const recentTurns: ContextBundle['recentTurns'] = [];
  for (const turn of [...(input.recentTurns ?? [])].reverse()) {
    const cost = estimateTokens(turn.content);
    if (cost > remaining) continue;
    recentTurns.unshift(turn);
    remaining -= cost;
  }
  const evidence: ContextEvidence[] = [];
  const seen = new Set<string>();
  for (const candidate of input.evidence) {
    if (!candidate.sourceId || seen.has(candidate.sourceId)) continue;
    const cost = estimateTokens(candidate.text);
    if (cost > remaining) continue;
    evidence.push({ ...candidate });
    seen.add(candidate.sourceId);
    remaining -= cost;
  }
  return {
    evidence,
    recentTurns,
    tokenBudget,
    sourceRevision: input.sourceRevision,
  };
}

export function estimateContextBundleTokens(bundle: ContextBundle): number {
  return [
    ...bundle.evidence.map((item) => item.text),
    ...bundle.recentTurns.map((turn) => turn.content),
  ].reduce((total, value) => total + estimateTokens(value), 0);
}
