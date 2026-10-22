import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTAuth } from '../../electron/chatgpt/auth';
import {
  getChatGPTUsage,
  initializeChatGPTAuth,
} from '../../electron/chatgpt/runtime';
import { createMemoryChatGPTUsage } from '../../electron/chatgpt/usage';
import { resolveSemanticMeetingScope } from '../../electron/intelligence/askPlutoSemanticScope';
import {
  getAllSettings,
  getProvider,
  invalidateProviderCache,
} from '../../electron/llm/factory';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

function response(text: string) {
  return new Response(
    [
      { type: 'response.output_text.delta', delta: text },
      {
        type: 'response.completed',
        response: { status: 'completed', model: 'account-model' },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
  );
}

let selection: Record<string, string>;

beforeEach(() => {
  selection = { llm_provider: 'chatgpt', cloud_consent_chatgpt: '1' };
  initializeChatGPTAuth(
    new ChatGPTAuth({
      load: () =>
        JSON.stringify({
          clientId: 'oaiapp_test',
          subject: 'fictional-user',
          scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'],
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
          expiresAt: Date.now() + 3600_000,
        }),
      save: vi.fn(),
      getHostId: () => 'urn:uuid:test',
      saveHostId: vi.fn(),
      openBrowser: vi.fn(),
    }),
    createMemoryChatGPTUsage(),
    (key) => selection[key],
  );
  getChatGPTUsage().setPolicy({
    dailyRequests: 50,
    dailyTokens: 200000,
    backgroundEnabled: true,
  });
  invalidateProviderCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  invalidateProviderCache();
});

describe('ChatGPT intelligence routing', () => {
  it.each([
    [1, false],
    [50, false],
    [50, true],
  ] as const)(
    'bounds a removed-owner semantic check within a %s-request policy (publication reserve: %s)',
    async (dailyRequests, nearDeadline) => {
      getChatGPTUsage().setPolicy({
        dailyRequests,
        dailyTokens: 200000,
        backgroundEnabled: false,
      });
      const source = createNotesSource(
        JSON.stringify([
          {
            speaker: 'Speaker 1',
            text: 'Riley agreed to send the checklist by Monday.',
          },
        ]),
      );
      const draft = {
        meetingType: 'general',
        overview: null,
        sections: [
          {
            id: 'section',
            title: { id: 'heading', text: 'Checklist', sources: ['R0'] },
            items: [
              {
                id: 'action',
                kind: 'action',
                text: 'Send the checklist',
                owner: 'Riley',
                due: 'Monday',
                sources: ['R0'],
              },
            ],
          },
        ],
      };
      const fetcher = vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        const schema = body.text.format.schema;
        if (schema.properties?.resolutions) {
          return response(
            JSON.stringify({
              resolutions:
                schema.properties.resolutions.items.anyOf[0].properties.id.enum.map(
                  (id: string) => ({
                    id,
                    kind: 'accepted_action',
                    text: 'Riley will send the checklist by Monday.',
                    owner: 'Riley',
                    due: 'Monday',
                    discussion: null,
                  }),
                ),
            }),
          );
        }
        return response(JSON.stringify(draft));
      });
      vi.stubGlobal('fetch', fetcher);
      const provider = new UnifiedLLMProvider('chatgpt', {
        chatgpt_model: 'account-model',
      });
      const generation = provider.generateStructuredAnalysis('', '', 'auto', {
        source,
        ...(nearDeadline
          ? { optionalReviewDeadlineAtMs: Date.now() + 10000 }
          : {}),
      });
      const shouldReview = dailyRequests > 1 && !nearDeadline;
      if (shouldReview) {
        const result = await generation;
        expect(result.all_action_items).toHaveLength(1);
        expect(result.generation_metadata.source_action_review_version).toBe(1);
        expect(
          getChatGPTUsage().summary().tasks['notesWriter (account-model)']
            ?.requests,
        ).toBe(1);
        expect(
          getChatGPTUsage().summary().tasks['notesAudit (account-model)']
            ?.requests,
        ).toBe(1);
      } else {
        await expect(generation).rejects.toThrow(
          'notes_semantic_review_incomplete',
        );
      }
      expect(fetcher).toHaveBeenCalledTimes(shouldReview ? 2 : 1);
    },
  );

  it.each(['provider', 'consent'])(
    'blocks a previously acquired ChatGPT provider after changing %s',
    async (change) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const provider = await getProvider({
        llm_provider: 'chatgpt',
        chatgpt_model: 'account-model',
        cloud_consents: { chatgpt: '1' },
      });
      if (change === 'provider') selection.llm_provider = 'ollama';
      else selection.cloud_consent_chatgpt = '';
      await expect(
        provider.answerAskPluto('Fictional question', { mode: 'fast' }),
      ).rejects.toMatchObject({
        code:
          change === 'provider'
            ? 'chatgpt_not_selected'
            : 'chatgpt_cloud_consent_required',
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(getChatGPTUsage().summary().requests).toBe(0);
    },
  );

  it('recognizes persisted ChatGPT settings, requires cloud consent, and never probes Ollama', async () => {
    const settings = {
      llm_provider: 'chatgpt',
      chatgpt_model: 'account-model',
      cloud_consent_chatgpt: '1',
    };
    const loaded = await getAllSettings({
      getSetting: (key) => settings[key as keyof typeof settings],
    });
    expect(loaded).toMatchObject({
      llm_provider: 'chatgpt',
      chatgpt_model: 'account-model',
      cloud_consents: { chatgpt: '1' },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const provider = await getProvider(loaded);
    expect(provider.name).toBe('ChatGPT');
    expect(provider.requiresApiKey).toBe(false);
    expect(await provider.isAvailable()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    invalidateProviderCache();
    await expect(
      getProvider({ ...loaded, cloud_consents: {} }),
    ).rejects.toThrow('chatgpt_cloud_consent_required');
  });

  it('routes one notes writer through ChatGPT while retaining local source checks and provider provenance', async () => {
    const fixture = makeDirectNotesFixture();
    const outputs = [fixture.draft];
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('account-model');
      expect(body.text.format.type).toBe('json_schema');
      if (body.text.format.schema.properties?.resolutions) {
        return response(
          JSON.stringify({
            resolutions:
              body.text.format.schema.properties.resolutions.items.anyOf[0].properties.id.enum.map(
                (id: string) => ({
                  id,
                  kind: 'accepted_action',
                  text: 'Send the outline',
                  owner: 'Milo',
                  due: null,
                  discussion: null,
                }),
              ),
          }),
        );
      }
      const output = outputs.shift();
      if (!output) throw new Error('unexpected_request');
      // The wire contract replaces source spans with local reference labels.
      return response(
        JSON.stringify(output, (key, value) =>
          key === 'sources' ? ['R0'] : value,
        ),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    const result = await provider.generateStructuredAnalysis('', '', 'auto', {
      source: fixture.source,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.generation_metadata).toMatchObject({
      provider: 'chatgpt',
      model: 'account-model',
      source_provenance: expect.any(Object),
    });
    expect(result.all_action_items).toHaveLength(1);
  });

  it('sends the complete cloud writer source then refuses an oversized single factual-review window', async () => {
    const source = createNotesSource(
      JSON.stringify({
        segments: [
          {
            speaker: 'Milo',
            text: `BEGIN FULL MEETING. ${'We discussed fictional requirements and test coverage. '.repeat(1100)} END FULL MEETING.`,
          },
        ],
      }),
    );
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const prompt = JSON.stringify(body.input);
      expect(prompt).toContain('BEGIN FULL MEETING');
      expect(prompt).toContain('END FULL MEETING');
      return response(
        JSON.stringify({
          title: { text: 'Fictional discussion', sources: ['R0'] },
          sections: [
            {
              title: 'Requirements',
              items: [
                {
                  kind: 'point',
                  text: 'We discussed fictional requirements and test coverage.',
                  owner: null,
                  due: null,
                  sources: ['R0'],
                },
              ],
            },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    expect(source.segments[0]!.text.length).toBeGreaterThan(48_000);
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source,
        compactWriterContract: true,
        hierarchyAuditStrategy: 'deterministic_only',
      }),
    ).rejects.toThrow('notes_semantic_review_incomplete');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fan out paid requests when full-source context is exhausted', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: makeDirectNotesFixture().source,
        contextTokens: 100,
        compactWriterContract: true,
        hierarchyAuditStrategy: 'deterministic_only',
      }),
    ).rejects.toThrow('notes_context_exhausted');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, 'every_node', 'final_only'] as const)(
    'enforces one cloud writer at the provider boundary when a caller requests %s review',
    async (hierarchyAuditStrategy) => {
      const fetcher = vi.fn(async () => response('{}'));
      vi.stubGlobal('fetch', fetcher);
      const provider = new UnifiedLLMProvider('chatgpt', {
        chatgpt_model: 'account-model',
      });
      await expect(
        provider.generateStructuredAnalysis('', '', 'auto', {
          source: makeDirectNotesFixture().source,
          compactWriterContract: true,
          hierarchyAuditStrategy,
        }),
      ).rejects.toThrow('notes_writer_invalid');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('stops after an invalid cloud draft instead of paying for an automatic repair', async () => {
    const fetcher = vi.fn(async () => response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: makeDirectNotesFixture().source,
        compactWriterContract: true,
        hierarchyAuditStrategy: 'deterministic_only',
      }),
    ).rejects.toThrow('notes_writer_invalid');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry a cloud context rejection as a hierarchy of paid calls', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'context_length_exceeded',
              message: 'context_length_exceeded',
            },
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', {
        source: makeDirectNotesFixture().source,
        compactWriterContract: true,
        hierarchyAuditStrategy: 'deterministic_only',
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses ChatGPT for saved/live chat, classification, knowledge, preparation, commitments, and background synthesis', async () => {
    const fetcher = vi.fn(async () => response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const provider = new UnifiedLLMProvider('chatgpt', {
      chatgpt_model: 'account-model',
    });
    const onToken = vi.fn();
    const onProgress = vi.fn();
    await provider.answerAskPluto('Fictional question', { onToken });
    await provider.answerAskPluto('Fictional live question', { live: true });
    await provider.classifyQueryIntent('Fictional classification');
    await provider.synthesizeKnowledgeDocument('Fictional knowledge');
    await provider.synthesizeKnowledgeDocument('Fictional prep', {
      purpose: 'projectScope',
    });
    await provider.synthesizeKnowledgeDocument('Fictional commitments', {
      purpose: 'commitmentReconciliation',
    });
    await provider.synthesizeKnowledgeDocument('Fictional synthesis', {
      purpose: 'dreaming',
      model: 'account-model',
      promptVersion: 'test-prompt',
      onProgress,
    });
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(
      fetcher.mock.calls.every(
        ([url]) => url === 'https://api.openai.com/v1/responses',
      ),
    ).toBe(true);
    expect(onToken).toHaveBeenCalledWith('{}');
    expect(onProgress).toHaveBeenCalled();
  });
});

it('routes semantic scope through the foreground usage gate and reuses exact scope without a second charge', async () => {
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
    response(
      JSON.stringify({
        kind: 'single',
        meetingIds: ['meeting-1'],
        intent: 'factual',
        expanded_keywords: [],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const provider = new UnifiedLLMProvider('chatgpt', {
    chatgpt_model: 'account-model',
  });
  const before = getChatGPTUsage().summary().requests;
  const onStart = vi.fn();
  const onProgress = vi.fn();
  const input = {
    query: 'Use the meeting recorded October 15 at 3:42 PM.',
    meetings: [
      { id: 'meeting-1', title: 'Meeting', started_at: '2026-10-15T22:42:00Z' },
    ],
    provider,
    now: new Date('2026-10-16T12:00:00Z'),
    timeZone: 'America/Los_Angeles',
    onStart,
    onProgress,
  };
  expect(await resolveSemanticMeetingScope(input)).toMatchObject({
    kind: 'single',
    meetingIds: ['meeting-1'],
  });
  expect(await resolveSemanticMeetingScope(input)).toMatchObject({
    kind: 'single',
    meetingIds: ['meeting-1'],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(getChatGPTUsage().summary().requests - before).toBe(1);
  expect(onStart).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenCalled();
  const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
  expect(body.text.format.schema.properties.meetingIds.items.enum).toEqual([
    'meeting-1',
  ]);
  expect(body.text.format.name).toBe('askPlutoScope');
  expect(body.model).toBe('account-model');
  getChatGPTUsage().setPolicy({
    dailyRequests: before + 1,
    dailyTokens: 200000,
    backgroundEnabled: false,
  });
  await expect(
    provider.answerAskPluto('Answer using the selected meeting.'),
  ).rejects.toMatchObject({ code: 'chatgpt_daily_limit' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
