import type {
  InferenceRequest,
  InferenceResult,
  ProviderId,
} from '../inferenceTypes';

type OpenAICompatibleProvider = Extract<ProviderId, 'openai' | 'openrouter'>;

export type InferenceTransportErrorCode =
  | 'openai_request_failed'
  | 'openrouter_request_failed'
  | 'openrouter_model_id_invalid'
  | 'openrouter_no_eligible_endpoint'
  | 'provider_authentication_failed'
  | 'provider_rate_limited';

const normalizeOpenRouterModelId = (model: string): string => {
  const trimmed = model.trim();
  if (trimmed.includes('/')) return trimmed;
  return /^(?:chatgpt-|gpt-|o\d(?:-|$))/i.test(trimmed)
    ? `openai/${trimmed}`
    : trimmed;
};

const providerErrorDetail = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const { code, message } = error as { code?: unknown; message?: unknown };
  return [code, message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
};

const classifyTransportError = (
  provider: OpenAICompatibleProvider,
  status: number,
): InferenceTransportErrorCode => {
  if (status === 401 || status === 403) return 'provider_authentication_failed';
  if (status === 429) return 'provider_rate_limited';
  if (provider === 'openrouter' && status === 404) {
    return 'openrouter_no_eligible_endpoint';
  }
  return `${provider}_request_failed`;
};

export class InferenceTransportError extends Error {
  constructor(
    readonly status: number,
    readonly provider: OpenAICompatibleProvider,
    readonly reportsInputOverflow: boolean,
    readonly code: InferenceTransportErrorCode = `${provider}_request_failed`,
  ) {
    super(code);
    this.name = 'InferenceTransportError';
  }
}

export const inferenceTransportErrorRationale = (error: unknown): string => {
  if (!(error instanceof InferenceTransportError))
    return 'Pluto could not answer right now.';
  switch (error.code) {
    case 'openrouter_model_id_invalid':
      return 'Enter an OpenRouter model ID in author/model format, such as openai/gpt-4o-mini.';
    case 'openrouter_no_eligible_endpoint':
      return 'OpenRouter could not find a zero-retention endpoint for this model. Check the exact author/model ID or choose another model.';
    case 'provider_authentication_failed':
      return `The ${error.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API key was rejected. Update it in Settings.`;
    case 'provider_rate_limited':
      return `${error.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} is rate-limiting requests. Try again shortly.`;
    default:
      return `${error.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} could not complete this request.`;
  }
};

export async function executeOpenAICompatible(
  provider: OpenAICompatibleProvider,
  apiKey: string,
  request: InferenceRequest,
): Promise<InferenceResult> {
  const startedAt = Date.now();
  const model =
    provider === 'openrouter'
      ? normalizeOpenRouterModelId(request.model)
      : request.model;
  if (provider === 'openrouter' && !model.includes('/')) {
    throw new InferenceTransportError(
      0,
      provider,
      false,
      'openrouter_model_id_invalid',
    );
  }
  const baseUrl =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    // OpenRouter's ZDR routing is the storage control. Sending the OpenAI-only
    // `store` option with require_parameters can exclude otherwise eligible
    // OpenRouter endpoints and result in a misleading 404.
    ...(provider === 'openai' ? { store: false } : {}),
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
      detail = providerErrorDetail(await response.json());
    } catch {
      // Provider error bodies are optional and are deliberately not logged.
    }
    throw new InferenceTransportError(
      response.status,
      provider,
      /context_length_exceeded|context[_ ](?:window|length|size).*(?:exceed|overflow|too (?:large|long))|(?:prompt|input) (?:is )?too long/i.test(
        detail,
      ),
      classifyTransportError(provider, response.status),
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
    requestedModel: model,
    resolvedModel: data.model ?? model,
    provider,
    upstream: provider === 'openrouter' ? data.provider : undefined,
    costUsd: typeof usage.cost === 'number' ? usage.cost : undefined,
  };
}
