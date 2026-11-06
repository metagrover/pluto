import { ChatGPTError } from '../../chatgpt/auth';
import {
  assertChatGPTSelected,
  getChatGPTAuth,
  getChatGPTInferenceSignal,
  getChatGPTUsage,
} from '../../chatgpt/runtime';
import type { InferenceRequest, InferenceResult } from '../inferenceTypes';

export class ChatGPTInferenceError extends ChatGPTError {
  readonly reportsInputOverflow: boolean;
  constructor(code: string, status = 0, requestId?: string) {
    super(code, status, requestId);
    this.reportsInputOverflow = code === 'context_length_exceeded';
  }
}

function responseError(
  payload: unknown,
  status: number,
  requestId?: string,
): ChatGPTInferenceError {
  const error =
    payload && typeof payload === 'object'
      ? (payload as { error?: { code?: unknown } }).error
      : undefined;
  const code =
    typeof error?.code === 'string' && /^[a-z_0-9]{1,100}$/.test(error.code)
      ? error.code
      : status === 401
        ? 'chatgpt_sign_in_required'
        : 'chatgpt_request_failed';
  if (code === 'subscription_sharing_usage_limit_exceeded') {
    getChatGPTAuth().pauseUsage();
    getChatGPTUsage().pause(true);
  }
  return new ChatGPTInferenceError(code, status, requestId);
}

/** Only text is accepted here. Audio capture and transcription never enter this transport. */
export async function executeChatGPT(
  request: InferenceRequest,
  callbacks: {
    onToken?: (delta: string) => void;
    onProgress?: () => void;
    onStart?: () => void;
  } = {},
): Promise<InferenceResult> {
  assertChatGPTSelected(request.egress.memoryFallback === true);
  const auth = getChatGPTAuth();
  auth.assertUsageAvailable();
  return getChatGPTUsage().run(
    request,
    getChatGPTInferenceSignal(),
    callbacks,
    (signal, listeners) =>
      executeChatGPTRequest({ ...request, signal }, listeners),
  );
}

async function executeChatGPTRequest(
  request: InferenceRequest,
  callbacks: { onToken?: (delta: string) => void; onProgress?: () => void },
): Promise<InferenceResult> {
  const startedAt = Date.now();
  const auth = getChatGPTAuth();
  const signal = AbortSignal.any([
    getChatGPTInferenceSignal(),
    ...(request.signal ? [request.signal] : []),
    AbortSignal.timeout(300_000),
  ]);
  signal.throwIfAborted();
  auth.assertUsageAvailable();
  const token = await auth.accessToken();
  signal.throwIfAborted();
  assertChatGPTSelected(request.egress.memoryFallback === true);
  const body = {
    model: request.model,
    store: false,
    stream: true,
    instructions: request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n'),
    input: request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content })),
    ...(request.jsonMode
      ? {
          text: {
            format: request.responseSchema
              ? {
                  type: 'json_schema',
                  name: request.task,
                  schema: request.responseSchema,
                  strict: request.responseSchemaStrict ?? false,
                }
              : { type: 'json_object' },
          },
        }
      : {}),
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw responseError(payload, response.status, requestId);
  }
  if (!response.body)
    throw new ChatGPTInferenceError(
      'chatgpt_response_incomplete',
      200,
      requestId,
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let completed: Record<string, any> | undefined;
  const consume = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let event: Record<string, any>;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ChatGPTInferenceError('chatgpt_invalid_stream', 200, requestId);
    }
    if (event.type === 'response.failed' || event.type === 'error')
      throw responseError(
        event.response ?? { error: event.error ?? event },
        200,
        requestId,
      );
    if (event.type === 'response.incomplete')
      throw new ChatGPTInferenceError(
        'chatgpt_response_incomplete',
        200,
        requestId,
      );
    if (event.type === 'response.refusal.delta')
      throw new ChatGPTInferenceError(
        'chatgpt_response_refused',
        200,
        requestId,
      );
    if (
      event.type === 'response.output_text.delta' &&
      typeof event.delta === 'string'
    ) {
      text += event.delta;
      callbacks.onToken?.(event.delta);
      callbacks.onProgress?.();
    }
    if (text.length > 8_000_000)
      throw new ChatGPTInferenceError(
        'chatgpt_response_too_large',
        200,
        requestId,
      );
    if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed')
        throw new ChatGPTInferenceError(
          'chatgpt_response_incomplete',
          200,
          requestId,
        );
      completed = event.response;
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 8_000_000)
        throw new ChatGPTInferenceError(
          'chatgpt_response_too_large',
          200,
          requestId,
        );
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match) {
        consume(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r?\n\r?\n/.exec(buffer);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    signal.throwIfAborted();
    if (!completed)
      throw new ChatGPTInferenceError(
        'chatgpt_response_incomplete',
        200,
        requestId,
      );
    const outputText = (completed.output ?? [])
      .flatMap((item: any) => item.content ?? [])
      .filter(
        (content: any) =>
          content.type === 'output_text' && typeof content.text === 'string',
      )
      .map((content: any) => content.text)
      .join('');
    text = outputText || text;
    if (!text.trim())
      throw new ChatGPTInferenceError(
        'chatgpt_response_incomplete',
        200,
        requestId,
      );
    return {
      text,
      finishReason: 'stop',
      usage: {
        inputTokens: completed.usage?.input_tokens ?? null,
        outputTokens: completed.usage?.output_tokens ?? null,
      },
      latencyMs: Date.now() - startedAt,
      requestedModel: request.model,
      resolvedModel: completed.model ?? request.model,
      provider: 'chatgpt',
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
