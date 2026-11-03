import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ASK_PLUTO_LOCAL_MAX_FIRST_TOKEN_MS,
  estimateLocalFirstTokenMs,
  planAskPlutoLocalPromptBudget,
} from '../../electron/intelligence/askPlutoLocalBudget';
import type { RetrievalResult } from '../../electron/intelligence/intelligenceTypes';
import { getAskPlutoPrompt } from '../../electron/intelligence/queryPrompts';
import * as provider from '../../electron/llm/unifiedProvider';

const noteSources = (count: number): RetrievalResult[] =>
  Array.from({ length: count }, (_, index) => ({
    meeting_id: `fictional-${index}`,
    meeting_title: `Fictional review ${index}`,
    evidence_kind: 'note',
    evidence_text: Array.from(
      { length: 120 },
      (_, line) =>
        `Fictional note ${index} line ${line}: the pilot owner reviewed item ${line}.`,
    ).join(' '),
    mid: {
      title: `Fictional review ${index}`,
      topics: [{ name: 'Rollout' }, { name: 'Pilot' }],
      decisions: Array.from({ length: 6 }, (_, item) => ({
        description: `Decision ${item} keeps the pilot on its current schedule.`,
      })),
      action_items: Array.from({ length: 6 }, (_, item) => ({
        description: `Action ${item} follows up with the fictional client.`,
      })),
    },
    score: 1,
    score_breakdown: {
      fts_rank: 1,
      graph_proximity: 0,
      recency_decay: 0,
      mention_weight: 0,
    },
  })) as unknown as RetrievalResult[];

const priorTurns = [
  { role: 'user' as const, content: 'Earlier question. '.repeat(80) },
  { role: 'assistant' as const, content: 'Earlier answer. '.repeat(300) },
];

const query = 'What decisions were made about the fictional pilot?';

describe('Ask Pluto local prompt planning', () => {
  it('leaves fast Macs on the existing evidence allowances', () => {
    expect(
      planAskPlutoLocalPromptBudget({
        throughput: { promptTokensPerSecond: 400, coldLoadMs: 5_000 },
        mode: 'fast',
      }),
    ).toBeUndefined();
    expect(
      planAskPlutoLocalPromptBudget({
        throughput: { promptTokensPerSecond: 200, coldLoadMs: 5_000 },
        mode: 'deep',
      }),
    ).toBeUndefined();
  });

  it('shrinks evidence in proportion to measured prompt speed', () => {
    const plan = (rate: number, mode: 'fast' | 'deep') =>
      planAskPlutoLocalPromptBudget({
        throughput: { promptTokensPerSecond: rate, coldLoadMs: 30_000 },
        mode,
      })?.evidenceChars ?? Number.POSITIVE_INFINITY;
    expect(plan(55, 'deep')).toBeLessThan(plan(120, 'deep'));
    expect(plan(55, 'fast')).toBeLessThanOrEqual(plan(55, 'deep'));
    // Very slow measurements keep a useful minimum rather than no evidence.
    expect(plan(5, 'fast')).toBe(4_000);
  });

  it('keeps a slow-Mac twelve-source prompt inside the shared chat context', () => {
    const localBudget = planAskPlutoLocalPromptBudget({
      throughput: { promptTokensPerSecond: 55, coldLoadMs: 25_000 },
      mode: 'deep',
    });
    expect(localBudget).toBeDefined();
    const bounded = getAskPlutoPrompt(
      query,
      noteSources(12),
      'factual',
      priorTurns,
      'None',
      'lookup',
      { localBudget },
    );
    const unbounded = getAskPlutoPrompt(
      query,
      noteSources(12),
      'factual',
      priorTurns,
      'None',
      'lookup',
      { isPlanningQuery: false },
    );
    // ~2.4 characters per estimated token; deep output + margin is 1,536.
    expect(bounded.length / 2.4 + 1536).toBeLessThan(8192);
    expect(bounded.length).toBeLessThan(unbounded.length);
    // Every selected source remains citable after trimming.
    for (let index = 0; index < 12; index++)
      expect(bounded).toContain(`Fictional review ${index}`);
  });

  it('leaves prompts unchanged when no local budget applies', () => {
    expect(
      getAskPlutoPrompt(
        query,
        noteSources(4),
        'factual',
        priorTurns,
        'None',
        'lookup',
        { isPlanningQuery: false },
      ),
    ).toBe(
      getAskPlutoPrompt(
        query,
        noteSources(4),
        'factual',
        priorTurns,
        'None',
        'lookup',
        { isPlanningQuery: false, localBudget: undefined },
      ),
    );
  });
});

describe('local first-token allowance', () => {
  const slow = { promptTokensPerSecond: 55, coldLoadMs: 25_000 };
  const fast = { promptTokensPerSecond: 500, coldLoadMs: 3_000 };

  it('grows with prompt size and cold loads on slower Macs', () => {
    const cold = estimateLocalFirstTokenMs({
      inputTokens: 6000,
      resident: false,
      throughput: slow,
      minimumMs: 120_000,
    });
    const warm = estimateLocalFirstTokenMs({
      inputTokens: 6000,
      resident: true,
      throughput: slow,
      minimumMs: 120_000,
    });
    expect(cold).toBeGreaterThan(warm);
    expect(warm).toBeGreaterThan(120_000);
  });

  it('keeps the existing deadline on fast Macs and caps the slowest', () => {
    expect(
      estimateLocalFirstTokenMs({
        inputTokens: 12_000,
        resident: false,
        throughput: fast,
        minimumMs: 90_000,
      }),
    ).toBe(90_000);
    expect(
      estimateLocalFirstTokenMs({
        inputTokens: 1_000_000,
        resident: false,
        throughput: slow,
        minimumMs: 90_000,
      }),
    ).toBe(ASK_PLUTO_LOCAL_MAX_FIRST_TOKEN_MS);
  });
});

describe('chat model warm window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not attempt release before the warm window elapses', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    provider.scheduleIdleOllamaModelRelease(provider.CHAT_MODEL_WARM_MS);
    await vi.advanceTimersByTimeAsync(provider.CHAT_MODEL_WARM_MS - 1_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
