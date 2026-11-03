// Ask Pluto budgets for local models, planned from this Mac's measured
// throughput (see electron/llm/localInferenceProfile.ts).
//
// Local speed varies by an order of magnitude across Apple Silicon Macs and
// GPU placements. A fixed prompt size and deadline either wastes fast Macs or
// cannot finish on slower ones, so the prompt is sized to reach a first token
// within a target, and the deadline follows the request's expected cost.

export interface LocalThroughput {
  promptTokensPerSecond: number;
  coldLoadMs: number;
}

export interface AskPlutoLocalPromptBudget {
  // Combined allowance for meeting evidence and structured fields.
  evidenceChars: number;
  // Per prior turn, so long follow-up threads stay inside the same budget.
  priorUserChars: number;
  priorAssistantChars: number;
}

// One stable chat allocation so follow-ups and repairs reuse loaded weights.
export const ASK_PLUTO_CHAT_CONTEXT_TOKENS = 8192;

// Upper bound for any local first-token allowance.
export const ASK_PLUTO_LOCAL_MAX_FIRST_TOKEN_MS = 300_000;

// Target time to evaluate the prompt on a loaded model.
const PROMPT_EVALUATION_TARGET_MS = { fast: 60_000, deep: 120_000 } as const;
// Instructions, question and trimmed prior turns.
const FIXED_PROMPT_TOKENS = 2_400;
const CHARACTERS_PER_TOKEN = 2.4;
// Below this, answers lose too much evidence to be useful.
const MIN_EVIDENCE_CHARS = 4_000;
// At or above this, the existing evidence allowances already fit the target.
const UNBOUNDED_EVIDENCE_CHARS = 30_000;

export const planAskPlutoLocalPromptBudget = ({
  throughput,
  mode,
}: {
  throughput: LocalThroughput;
  mode: 'fast' | 'deep' | undefined;
}): AskPlutoLocalPromptBudget | undefined => {
  const rate = throughput.promptTokensPerSecond;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const targetMs =
    PROMPT_EVALUATION_TARGET_MS[mode === 'deep' ? 'deep' : 'fast'];
  const evidenceTokens = (rate * targetMs) / 1000 - FIXED_PROMPT_TOKENS;
  const evidenceChars = Math.max(
    MIN_EVIDENCE_CHARS,
    Math.floor(evidenceTokens * CHARACTERS_PER_TOKEN),
  );
  if (evidenceChars >= UNBOUNDED_EVIDENCE_CHARS) return undefined;
  return {
    evidenceChars,
    priorUserChars: 400,
    priorAssistantChars: Math.min(
      2_000,
      Math.max(600, Math.floor(evidenceChars * 0.15)),
    ),
  };
};

// Allowance before the first streamed token: model load (when cold) plus
// prompt evaluation, with headroom for variance and competing load. Never
// shorter than the task's existing deadline.
export const estimateLocalFirstTokenMs = ({
  inputTokens,
  resident,
  throughput,
  minimumMs,
}: {
  inputTokens: number;
  resident: boolean;
  throughput: LocalThroughput;
  minimumMs: number;
}): number => {
  const tokens = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const rate =
    Number.isFinite(throughput.promptTokensPerSecond) &&
    throughput.promptTokensPerSecond > 0
      ? throughput.promptTokensPerSecond
      : 1;
  const estimate =
    1.5 * ((resident ? 0 : throughput.coldLoadMs) + (tokens / rate) * 1000) +
    20_000;
  return Math.min(
    ASK_PLUTO_LOCAL_MAX_FIRST_TOKEN_MS,
    Math.max(minimumMs, Math.ceil(estimate)),
  );
};
