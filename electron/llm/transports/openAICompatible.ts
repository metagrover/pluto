import type {
  InferenceRequest,
  InferenceResult,
  ProviderId,
} from '../inferenceTypes';

type OpenAICompatibleProvider = Extract<ProviderId, 'openai' | 'openrouter'>;

export class InferenceTransportError extends Error {
  constructor(
    readonly status: number,
    readonly provider: OpenAICompatibleProvider,
    readonly reportsInputOverflow: boolean,
  ) {
    super(`${provider}_request_failed`);
  }
}

export async function executeOpenAICompatible(
  provider: OpenAICompatibleProvider,
  apiKey: string,
  request: InferenceRequest,
): Promise<InferenceResult> {
  const startedAt = Date.now();
  const baseUrl =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    store: false,
    ...(request.maxOutputTokens
      ? { max_completion_tokens: request.maxOutputTokens }
      : {}),
    ...(provider === 'openrouter'
      ? {
          provider: {
            zdr: true,
            data_collection: 'deny',
            require_parameters: true,
          },
        }
      : {}),
  };
  if (request.jsonMode) {
    body.response_format = request.responseSchema
      ? {
          type: 'json_schema',
          json_schema: {
            name: request.task,
            schema: request.responseSchema,
            strict: true,
          },
        }
      : { type: 'json_object' };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter'
        ? { 'X-OpenRouter-Title': 'Pluto', 'HTTP-Referer': 'https://pluto.app' }
        : {}),
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // Provider error bodies are optional and are deliberately not logged.
    }
    throw new InferenceTransportError(
      response.status,
      provider,
      /context_length_exceeded|context[_ ](?:window|length|size).*(?:exceed|overflow|too (?:large|long))|(?:prompt|input) (?:is )?too long/i.test(
        detail,
      ),
    );
  }

  const data = (await response.json()) as any;
  const usage = data.usage ?? {};
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    usage: {
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
    },
    latencyMs: Date.now() - startedAt,
    requestedModel: request.model,
    resolvedModel: data.model ?? request.model,
    provider,
    upstream: provider === 'openrouter' ? data.provider : undefined,
    costUsd: typeof usage.cost === 'number' ? usage.cost : undefined,
  };
}
