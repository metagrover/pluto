import { describe, expect, it } from 'vitest';
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
});
