import { ChatGPTError, chatGPTErrorMessage } from '../chatgpt/auth';

export type AskPlutoFailureReason =
  | 'timeout'
  | 'provider_unavailable'
  | 'memory_pressure'
  | 'invalid_response'
  | 'memory_pressure'
  | 'generation_failed';

export const classifyAskPlutoFailure = (
  error: unknown,
): { reason: AskPlutoFailureReason; answer: string } => {
  if (error instanceof Error && error.name === 'LocalModelMemoryError') {
    return {
      reason: 'memory_pressure',
      answer:
        'Pluto stopped this answer to protect system memory. Close other apps or choose a smaller local model in Settings, then retry. Your question and saved notes are preserved.',
    };
  }
  if (error instanceof ChatGPTError) {
    return {
      reason: 'provider_unavailable',
      answer: chatGPTErrorMessage(error),
    };
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (name === 'LocalModelMemoryError') {
    return {
      reason: 'memory_pressure',
      answer:
        'Pluto stopped this answer to protect system memory. Close other apps or choose a smaller local model in Settings, then retry. Your question and saved notes are preserved.',
    };
  }

  if (
    name === 'TimeoutError' ||
    /timed?\s*out|operation was aborted/i.test(message)
  ) {
    return {
      reason: 'timeout',
      answer:
        'Pluto stopped this answer because it took longer than expected. Retry to try again.',
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
        'The model returned an incomplete or invalid response. Retry to generate a fresh answer.',
    };
  }

  return {
    reason: 'generation_failed',
    answer:
      'Pluto found relevant meeting evidence, but could not finish the answer. Your question and sources are still here, so you can retry.',
  };
};
