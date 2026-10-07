import { describe, expect, it } from 'vitest';
import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';
import { continueNotesEditor } from '../../scripts/lib/notesReplayContinuation';

const source =
  'BEGIN SOURCE DATA\n["R0","Me","Keep every word."]\nEND SOURCE DATA';
const writer = {
  model: 'gemma4:12b',
  options: { num_ctx: 24576, num_predict: 2048 },
  messages: [{ role: 'user', content: `Write notes.\n${source}` }],
};
const editor = {
  ...writer,
  messages: [
    {
      role: 'user',
      content: `Review.\n${source}\nBEGIN DRAFT DATA\n{}\nEND DRAFT DATA`,
    },
  ],
};
const previous = { request: writer, answer: '{"sections":[]}' };
describe('diagnostic context continuation', () => {
  it('preserves exact source, writer prefix, raw answer and canonical editor draft', () => {
    const result = continueNotesEditor(previous, editor);
    expect(result.reason).toBe('continued_exact_source');
    expect(result.messages[0]).toEqual(writer.messages[0]);
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: previous.answer,
    });
    expect(result.messages[2].content).toContain(
      'BEGIN DRAFT DATA\n{}\nEND DRAFT DATA',
    );
    expect(
      result.messages
        .map((x) => x.content)
        .join('\n')
        .split(source),
    ).toHaveLength(2);
    expect(continueNotesEditor(previous, editor)).toEqual(result);
  });
  it('fails closed without a completed same-source writer', () => {
    for (const prior of [
      undefined,
      { ...previous, answer: '' },
      { ...previous, request: { ...writer, model: 'other' } },
      {
        ...previous,
        request: { ...writer, options: { ...writer.options, num_ctx: 16384 } },
      },
      {
        ...previous,
        request: {
          ...writer,
          messages: [
            {
              role: 'user',
              content: writer.messages[0].content.replace('R0', 'R1'),
            },
          ],
        },
      },
      { ...previous, request: editor },
    ]) {
      expect(continueNotesEditor(prior, editor).messages).toEqual(
        editor.messages,
      );
    }
  });
  it('falls back to the original request when history exceeds capacity', () => {
    expect(
      continueNotesEditor({ ...previous, answer: 'x'.repeat(100000) }, editor)
        .reason,
    ).toBe('continuation_capacity');
  });
  it('budgets message contents and chat delimiters rather than HTTP JSON escaping', () => {
    const messages = continueNotesEditor(previous, editor).messages;
    const capacity = messages.reduce(
      (total, message) => total + estimateNotesTokens(message.content) + 32,
      editor.options.num_predict + 512,
    );
    const atCapacity = (num_ctx: number) => ({
      ...editor,
      options: { ...editor.options, num_ctx },
    });
    const prior = (num_ctx: number) => ({
      ...previous,
      request: { ...writer, options: { ...writer.options, num_ctx } },
    });
    expect(
      continueNotesEditor(prior(capacity), atCapacity(capacity)).reason,
    ).toBe('continued_exact_source');
    expect(
      continueNotesEditor(prior(capacity - 1), atCapacity(capacity - 1)).reason,
    ).toBe('continuation_capacity');
  });
  it('uses a measured unchanged prefix while keeping estimates for new messages', () => {
    const messages = continueNotesEditor(previous, editor).messages;
    const inputTokens = 10;
    const capacity =
      inputTokens +
      32 +
      messages
        .slice(1)
        .reduce(
          (total, message) => total + estimateNotesTokens(message.content) + 32,
          editor.options.num_predict + 512,
        );
    const current = {
      ...editor,
      options: { ...editor.options, num_ctx: capacity },
    };
    const prior = {
      ...previous,
      request: { ...writer, options: { ...writer.options, num_ctx: capacity } },
    };
    expect(continueNotesEditor({ ...prior, inputTokens }, current).reason).toBe(
      'continued_exact_source',
    );
    for (const inputTokens of [
      undefined,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(
        continueNotesEditor({ ...prior, inputTokens }, current).reason,
      ).toBe('continuation_capacity');
  });
});
