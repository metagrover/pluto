import type { UnifiedLLMProvider } from '../../../electron/llm/unifiedProvider';
import type { EvaluationModelIdentity } from '../../../scripts/lib/local_intelligence_evaluation';

type CapturedWire = { endpoint: string; body: Record<string, unknown> };
type ResponseContract = 'reconciliation' | 'compact_draft' | 'editor' | 'other';

type ProviderTransport = {
  ollamaStream: (
    endpoint: string,
    options: RequestInit,
    onChunk: (chunk: string) => void,
  ) => Promise<unknown>;
  ollamaFetch: (
    endpoint: string,
    options: RequestInit | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<Response>;
};

export const captureDryRunWire = async (
  provider: UnifiedLLMProvider,
  model: EvaluationModelIdentity,
  run: () => Promise<unknown>,
  hooks?: {
    beforeResponse?: (wire: CapturedWire) => void | Promise<void>;
    response?: (wire: CapturedWire) => unknown;
  },
): Promise<CapturedWire[]> => {
  const captured: CapturedWire[] = [];
  const transport = provider as unknown as ProviderTransport;
  const originalStream = transport.ollamaStream;
  const originalFetch = transport.ollamaFetch;
  const capture = (endpoint: string, options: RequestInit) => {
    if (!/\/api\/(?:chat|generate)$/.test(endpoint)) {
      throw new Error('evaluation_dry_run_unexpected_endpoint');
    }
    if (typeof options.body !== 'string') {
      throw new Error('evaluation_dry_run_body_missing');
    }
    const body = JSON.parse(options.body) as Record<string, unknown>;
    captured.push({ endpoint, body });
    return body;
  };
  const readPath = (value: unknown, keys: readonly (string | number)[]) => {
    let current: unknown = value;
    for (const key of keys) {
      if (
        current === null ||
        typeof current !== 'object' ||
        !(key in current)
      ) {
        return undefined;
      }
      current = (current as Record<string | number, unknown>)[key];
    }
    return current;
  };
  const sourceLabels = (
    body: Record<string, unknown>,
    contract: ResponseContract,
  ): string[] => {
    const path =
      contract === 'reconciliation'
        ? ['properties', 'facts', 'items', 'properties', 'sources']
        : contract === 'compact_draft'
          ? [
              'properties',
              'sections',
              'items',
              'properties',
              'items',
              'items',
              'properties',
              'sources',
            ]
          : ['properties', 'overview', 'anyOf', 0, 'properties', 'sources'];
    const labels = readPath(body.format, [...path, 'items', 'enum']);
    return Array.isArray(labels) &&
      labels.every((label) => typeof label === 'string')
      ? labels
      : [];
  };
  const promptFor = (body: Record<string, unknown>): string => {
    const messages = body.messages as Array<{ content?: unknown }> | undefined;
    return typeof messages?.[0]?.content === 'string'
      ? messages[0].content
      : '';
  };
  const firstSourceText = (prompt: string): string => {
    const packet = prompt.match(
      /BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/,
    );
    const first = packet?.[1]?.split('\n').find(Boolean);
    if (!first) throw new Error('evaluation_dry_run_source_missing');
    const parsed = JSON.parse(first) as { text?: unknown };
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
      throw new Error('evaluation_dry_run_source_missing');
    }
    return parsed.text;
  };
  const responseFor = (body: Record<string, unknown>) => {
    const properties = readPath(body.format, ['properties']);
    const hasProperty = (key: string) =>
      properties !== null &&
      typeof properties === 'object' &&
      key in properties;
    const contract: ResponseContract = hasProperty('facts')
      ? 'reconciliation'
      : hasProperty('dispositions')
        ? 'editor'
        : hasProperty('sections')
          ? 'compact_draft'
          : 'other';
    if (contract === 'other') {
      throw new Error('evaluation_dry_run_wire_captured');
    }
    const prompt = promptFor(body);
    const text = firstSourceText(prompt);
    const label = sourceLabels(body, contract)[0];
    if (!label) throw new Error('evaluation_dry_run_source_label_missing');
    if (contract === 'reconciliation') {
      return {
        facts: [{ text, sources: [label] }],
        actions: [],
        decisions: [],
        questions: [],
      };
    }
    if (contract === 'compact_draft') {
      return {
        sections: [
          {
            title: 'Dry-run source inventory',
            items: [
              { kind: 'point', text, owner: null, due: null, sources: [label] },
            ],
          },
        ],
      };
    }
    return {
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Dry-run source inventory', sources: [label] },
          items: [
            { kind: 'point', text, owner: null, due: null, sources: [label] },
          ],
        },
      ],
      dispositions: [],
      terminology: [],
    };
  };
  transport.ollamaStream = async (endpoint, options, onChunk) => {
    const body = capture(endpoint, options);
    await hooks?.beforeResponse?.({ endpoint, body });
    const content = JSON.stringify(
      hooks?.response ? hooks.response({ endpoint, body }) : responseFor(body),
    );
    onChunk(
      `${JSON.stringify({
        ...(endpoint === '/api/generate'
          ? { response: content }
          : { message: { content } }),
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 10,
        eval_count: 10,
      })}\n`,
    );
    return { ok: true, statusText: 'OK', errorBody: '' };
  };
  transport.ollamaFetch = async (endpoint, options) => {
    if (endpoint === '/api/tags') {
      return new Response(
        JSON.stringify({ models: [{ name: model.tag, digest: model.digest }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (endpoint === '/api/ps') {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!options) throw new Error('evaluation_dry_run_body_missing');
    const body = capture(endpoint, options);
    const unload =
      body.keep_alive === 0 &&
      !Object.hasOwn(body, 'prompt') &&
      !Object.hasOwn(body, 'messages');
    if (!unload) await hooks?.beforeResponse?.({ endpoint, body });
    const content = unload
      ? ''
      : JSON.stringify(
          hooks?.response
            ? hooks.response({ endpoint, body })
            : responseFor(body),
        );
    return new Response(JSON.stringify({ done: true, response: content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await run();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'evaluation_dry_run_wire_captured'
    ) {
      throw error;
    }
  } finally {
    transport.ollamaStream = originalStream;
    transport.ollamaFetch = originalFetch;
  }
  if (!captured.length) throw new Error('evaluation_dry_run_no_wire_intent');
  return captured;
};
