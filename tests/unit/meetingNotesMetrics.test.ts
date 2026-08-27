import { expect, it } from 'vitest';
import { readNotesMetrics } from '../../electron/llm/meetingNotesMetrics';

it('retains a final metrics-only packet without recording private model text', () => {
  expect(
    readNotesMetrics({
      done: true,
      response: '',
      prompt_eval_count: 100,
      eval_count: 20,
      prompt_eval_duration: 2_000_000,
      eval_duration: 4_000_000,
      secret: 'private source text',
    }),
  ).toEqual({
    inputTokens: 100,
    outputTokens: 20,
    promptMs: 2,
    outputMs: 4,
    loadMs: null,
  });
});
