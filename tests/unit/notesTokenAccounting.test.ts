import { expect, it } from 'vitest';
import { inspectNotesTokenAccounting } from '../../scripts/lib/notesTokenAccounting';

const request = {
  messages: [
    { role: 'user', content: 'Private meeting text, not report content.' },
  ],
  options: { num_ctx: 16384, num_predict: 2048 },
};

it('keeps estimates and observed counts distinct without authorizing admission', () => {
  const result = inspectNotesTokenAccounting(request, {
    done: true,
    prompt_eval_count: 13648,
    eval_count: 1167,
  });
  expect(result.observedPromptPlusOutputReserveAndSafety).toBe(16208);
  expect(result.admissionDecision).toBe(false);
  expect(result.observedOutputTokens).toBe(1167);
  expect(JSON.stringify(result)).not.toContain('Private meeting');
});

it.each([
  undefined,
  { done: false, prompt_eval_count: 42 },
  { done: true, prompt_eval_count: 0 },
  { done: true, prompt_eval_count: -2 },
])(
  'does not turn missing or incomplete telemetry into a token count',
  (terminal) => {
    expect(
      inspectNotesTokenAccounting(request, terminal).observedPromptTokens,
    ).toBeNull();
  },
);

it('retains dense Unicode estimates and omits unknown output reservation', () => {
  const result = inspectNotesTokenAccounting(
    { messages: [{ content: '中文中文中文' }], options: { num_ctx: 16384 } },
    { done: true, prompt_eval_count: 8 },
  );
  expect(result.estimatedContentTokens).toBe(Buffer.byteLength('中文中文中文'));
  expect(result.outputReserve).toBeNull();
  expect(result.observedPromptPlusOutputReserveAndSafety).toBeNull();
});
