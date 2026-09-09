import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';

/** Retrospective diagnostics only: not a tokenizer or prospective admission. */
export function inspectNotesTokenAccounting(
  request: {
    messages: Array<{ content: string }>;
    options: { num_ctx: number; num_predict?: number };
  },
  terminal?: {
    done?: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
  },
) {
  const positiveInteger = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) > 0;
  const observed =
    terminal?.done && positiveInteger(terminal.prompt_eval_count)
      ? terminal.prompt_eval_count
      : null;
  const outputReserve = positiveInteger(request.options.num_predict)
    ? request.options.num_predict
    : null;
  const estimatedMessageJsonTokens = estimateNotesTokens(
    JSON.stringify(request.messages),
  );
  return {
    mode: 'retrospective_token_accounting',
    admissionDecision: false,
    contextTokens: request.options.num_ctx,
    outputReserve,
    // This excludes chat-template framing and is not an exact prompt count.
    estimatedContentTokens: request.messages.reduce(
      (sum, message) => sum + estimateNotesTokens(message.content),
      0,
    ),
    estimatedMessageJsonTokens,
    observedPromptTokens: observed,
    observedOutputTokens:
      terminal?.done &&
      Number.isSafeInteger(terminal.eval_count) &&
      Number(terminal.eval_count) >= 0
        ? terminal.eval_count
        : null,
    estimatedToObservedRatio: observed
      ? estimatedMessageJsonTokens / observed
      : null,
    observedPromptPlusOutputReserveAndSafety:
      observed !== null && outputReserve !== null
        ? observed + outputReserve + 512
        : null,
    limitation:
      'Observed counts are retrospective and profile-specific. Neither heuristic includes a verified model chat template; do not use this report to lower admission margins.',
  };
}
