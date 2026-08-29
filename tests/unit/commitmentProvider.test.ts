import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCommitmentSemanticReviewRequest,
  findSemanticCommitmentMatches,
} from '../../electron/commitmentSemanticReview';
import {
  buildIdentityResolutionRequest,
  resolveCommitmentOwner,
} from '../../electron/identityResolution';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import type { IdentityContext } from '../../src/types/identity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: { decisions: { type: 'array', items: { type: 'string' } } },
};
const structuredText = '{"decisions":[]}';
const semanticRecord = {
  id: 'candidate',
  text: 'Send the proposal',
  owner: 'Rowan',
  ownerKey: 'person:rowan',
  due: null,
  meetingId: 'meeting-a',
  meetingDate: null,
  context: 'Rowan will send the proposal.',
  reviewState: 'possible',
  status: 'active',
};
const semanticPrior = {
  ...semanticRecord,
  id: 'prior',
  reviewState: 'confirmed',
};
const identityInput = {
  text: 'Send the proposal',
  ownerLabel: 'Me',
  evidence: null,
};
const identityContext: IdentityContext = {
  meetingId: 'meeting-a',
  sourceRevision: 'revision-a',
  turns: [{ id: 't1', speaker: 'Me', text: 'I will send the proposal.' }],
  people: [{ id: 'rowan', name: 'Rowan' }],
  bindings: [],
  capture: { origin: 'unknown', selfPersonId: null },
};
const productionRequests = [
  {
    name: 'semantic',
    request: () =>
      buildCommitmentSemanticReviewRequest([semanticRecord], [semanticPrior]),
  },
  {
    name: 'identity',
    request: () =>
      buildIdentityResolutionRequest(identityInput, identityContext),
  },
];
const assertClaudeSchema = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(assertClaudeSchema);
  else if (value && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    for (const key of [
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'maxItems',
    ])
      expect(fields).not.toHaveProperty(key);
    if ('minItems' in fields) expect([0, 1]).toContain(fields.minItems);
    Object.values(fields).forEach(assertClaudeSchema);
  }
};
const cloudCases = [
  {
    type: 'openai' as const,
    settings: { openai_api_key: 'test-key', openai_model: 'configured-openai' },
    response: (truncated: boolean) => ({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: structuredText },
          finish_reason: truncated ? 'length' : 'stop',
        },
      ],
    }),
    format: {
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'commitmentReconciliation', schema, strict: true },
      },
    },
  },
  {
    type: 'claude' as const,
    settings: { claude_api_key: 'test-key', claude_model: 'configured-claude' },
    response: (truncated: boolean) => ({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: structuredText }],
      stop_reason: truncated ? 'max_tokens' : 'end_turn',
    }),
    format: { output_config: { format: { type: 'json_schema', schema } } },
  },
  {
    type: 'gemini' as const,
    settings: { gemini_api_key: 'test-key', gemini_model: 'configured-gemini' },
    response: (truncated: boolean) => ({
      candidates: [
        {
          index: 0,
          content: { role: 'model', parts: [{ text: structuredText }] },
          finishReason: truncated ? 'MAX_TOKENS' : 'STOP',
        },
      ],
    }),
    format: {
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    },
  },
];

describe('commitment semantic provider task', () => {
  it('still rejects oversized identity quotes after adapting the Ollama wire schema', async () => {
    const quote = 'x'.repeat(2001);
    const answer = JSON.stringify({
      status: 'unresolved',
      personId: null,
      speaker: null,
      ownershipKind: 'ambiguous',
      evidence: [{ turnId: 't1', quote }],
      identityEvidence: [],
      reason: 'Ambiguous',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `${JSON.stringify({ response: answer, done: true, done_reason: 'stop' })}\n`,
            { headers: { 'Content-Type': 'application/x-ndjson' } },
          ),
      ),
    );
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-local',
    });
    await expect(
      resolveCommitmentOwner(
        identityInput,
        {
          ...identityContext,
          turns: [{ id: 't1', speaker: 'Me', text: quote }],
        },
        (prompt, responseSchema) =>
          provider.synthesizeKnowledgeDocument(prompt, {
            purpose: 'commitmentReconciliation',
            responseSchema,
          }),
      ),
    ).rejects.toThrow('invalid evidence reference');
  });
  it('avoids oversized Ollama grammar repetitions while retaining the original identity limits', async () => {
    const request = buildIdentityResolutionRequest(
      identityInput,
      identityContext,
    );
    const original = structuredClone(request.schema);
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(
          `${JSON.stringify({ response: '{}', done: true, done_reason: 'stop' })}\n`,
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-local',
    });
    await provider.synthesizeKnowledgeDocument(request.prompt, {
      purpose: 'commitmentReconciliation',
      responseSchema: request.schema,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const quoteSchema = body.format.properties.evidence.items.properties.quote;
    expect(quoteSchema).not.toHaveProperty('maxLength');
    expect(quoteSchema.minLength).toBe(1);
    expect(quoteSchema.description).toContain('2000');
    expect(body.format.properties.personId).toEqual(
      (original.properties as Record<string, unknown>).personId,
    );
    expect(body.format.additionalProperties).toBe(false);
    expect(request.schema).toEqual(original);
  });
  for (const production of productionRequests) {
    it(`adapts the actual ${production.name} schema to Claude without mutating local constraints`, async () => {
      const request = production.request();
      const originalSchema = structuredClone(request.schema);
      expect(JSON.stringify(originalSchema)).toContain('maxLength');
      expect(JSON.stringify(originalSchema)).toContain('maxItems');
      const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
        Response.json({
          content: [{ type: 'text', text: structuredText }],
          stop_reason: 'end_turn',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const provider = new UnifiedLLMProvider('claude', {
        claude_api_key: 'test-key',
      });
      await provider.synthesizeKnowledgeDocument(request.prompt, {
        purpose: 'commitmentReconciliation',
        responseSchema: request.schema,
      });
      const wireSchema = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
        .output_config.format.schema;
      assertClaudeSchema(wireSchema);
      expect(wireSchema.additionalProperties).toBe(false);
      expect(wireSchema.required).toEqual(originalSchema.required);
      expect(JSON.stringify(wireSchema)).toContain('maxLength:');
      expect(request.schema).toEqual(originalSchema);
    });
  }

  for (const reason of ['', 'x'.repeat(501)]) {
    it(`retains local semantic reason validation after Claude schema adaptation (${reason.length} chars)`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  decisions: [
                    {
                      candidateId: 'c0',
                      decision: 'distinct',
                      matchId: null,
                      reason,
                    },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
          }),
        ),
      );
      const provider = new UnifiedLLMProvider('claude', {
        claude_api_key: 'test-key',
      });
      await expect(
        findSemanticCommitmentMatches(
          [semanticRecord],
          [semanticPrior],
          (prompt, responseSchema) =>
            provider.synthesizeKnowledgeDocument(prompt, {
              purpose: 'commitmentReconciliation',
              responseSchema,
            }),
        ),
      ).rejects.toThrow('Invalid semantic commitment review');
    });
    it(`retains local identity reason validation after Claude schema adaptation (${reason.length} chars)`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'unresolved',
                  personId: null,
                  speaker: null,
                  ownershipKind: 'ambiguous',
                  evidence: [],
                  identityEvidence: [],
                  reason,
                }),
              },
            ],
            stop_reason: 'end_turn',
          }),
        ),
      );
      const provider = new UnifiedLLMProvider('claude', {
        claude_api_key: 'test-key',
      });
      await expect(
        resolveCommitmentOwner(
          identityInput,
          identityContext,
          (prompt, responseSchema) =>
            provider.synthesizeKnowledgeDocument(prompt, {
              purpose: 'commitmentReconciliation',
              responseSchema,
            }),
        ),
      ).rejects.toThrow('Invalid identity resolution');
    });
  }

  for (const providerCase of cloudCases) {
    it(`forwards the strict schema to the configured ${providerCase.type} wire request`, async () => {
      const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
        Response.json(providerCase.response(false)),
      );
      vi.stubGlobal('fetch', fetchMock);
      const provider = new UnifiedLLMProvider(
        providerCase.type,
        providerCase.settings,
      );
      await expect(
        provider.synthesizeKnowledgeDocument('Compare obligations', {
          purpose: 'commitmentReconciliation',
          responseSchema: schema,
        }),
      ).resolves.toBe(structuredText);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject(providerCase.format);
      expect(provider.name).not.toBe('Ollama (Local)');
    });

    it(`rejects ${providerCase.type} token-limit termination even when the JSON is valid`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(providerCase.response(true))),
      );
      const provider = new UnifiedLLMProvider(
        providerCase.type,
        providerCase.settings,
      );
      await expect(
        provider.synthesizeKnowledgeDocument('Compare obligations', {
          purpose: 'commitmentReconciliation',
          responseSchema: schema,
        }),
      ).rejects.toThrow('commitment_response_incomplete');
    });
  }

  it('forwards schema and cancellation through the dedicated generation task', async () => {
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: 'test-model',
    });
    const generate = vi
      .spyOn(
        provider as unknown as {
          generateText(options: unknown): Promise<string>;
        },
        'generateText',
      )
      .mockResolvedValue('{"decisions":[]}');
    const controller = new AbortController();
    const schema = {
      type: 'object',
      properties: { decisions: { type: 'array' } },
    };
    await provider.synthesizeKnowledgeDocument('Compare obligations', {
      purpose: 'commitmentReconciliation',
      responseSchema: schema,
      signal: controller.signal,
    });
    expect(generate).toHaveBeenCalledWith({
      prompt: 'Compare obligations',
      task: 'commitmentReconciliation',
      jsonMode: true,
      responseSchema: schema,
      signal: controller.signal,
    });
  });
});
