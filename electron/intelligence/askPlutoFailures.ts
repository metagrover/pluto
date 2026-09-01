export type AskPlutoFailureReason =
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'generation_failed';

export const classifyAskPlutoFailure = (
  error: unknown,
): { reason: AskPlutoFailureReason; answer: string } => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (
    name === 'TimeoutError' ||
    /timed?\s*out|operation was aborted/i.test(message)
  ) {
    return {
      reason: 'timeout',
      answer:
        'Local analysis took too long. Your question and meeting evidence are still here. Retry, or use Fast mode for a shorter answer.',
    };
  }

  if (
    /fetch failed|econnrefused|connection refused|socket hang up|ollama api error|provider unavailable/i.test(
      message,
    )
  ) {
    return {
      reason: 'provider_unavailable',
      answer:
        'Your local answer model is not reachable right now. Pluto kept your question and meeting evidence, so you can retry after the model reconnects.',
    };
  }

  if (
    name === 'SyntaxError' ||
    /unexpected token|invalid json|unterminated json|response_incomplete|response incomplete/i.test(
      message,
    )
  ) {
    return {
      reason: 'invalid_response',
      answer:
        'Pluto found relevant meeting evidence, but could not verify the response from the model. Nothing was added to the answer. Retry to generate a fresh response.',
    };
  }

  return {
    reason: 'generation_failed',
    answer:
      'Pluto found relevant meeting evidence, but could not finish the answer. Your question and sources are still here, so you can retry.',
  };
};
