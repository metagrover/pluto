import { expect, it } from 'vitest';
import { renderNotesGemmaPrompt } from '../../scripts/lib/notesGemmaPrompt';

const request = {
  model: 'gemma4:12b',
  think: false,
  messages: [{ role: 'user', content: ' Hello 中文 ' }],
};
it('includes the BOS, turns and resolved large-model no-think prefix', () => {
  expect(renderNotesGemmaPrompt(request, '0.33.3')).toBe(
    '<bos><|turn>user\nHello 中文<turn|>\n<|turn>model\n<|channel>thought\n<channel|>',
  );
});
it('preserves an exact writer answer prefix in a supported continuation', () => {
  expect(
    renderNotesGemmaPrompt(
      {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: '{"sections":[]}' },
          { role: 'user', content: 'Review source' },
        ],
      },
      '0.33.3',
    ),
  ).toContain(
    '<|turn>model\n{"sections":[]}<turn|>\n<|turn>user\nReview source',
  );
});
it('matches Go whitespace behavior rather than stripping a BOM', () => {
  const result = renderNotesGemmaPrompt(
    {
      ...request,
      messages: [{ role: 'user', content: '\u0085\ufefftext\u0085' }],
    },
    '0.33.3',
  );
  expect(result).toContain('\n\ufefftext<turn|>');
});
it.each([
  { ...request, model: 'another-model' },
  { ...request, think: true },
  { ...request, tools: [{}] },
  { ...request, messages: [{ role: 'user', content: 'hi', images: [] }] },
  { ...request, messages: [{ role: 'assistant', content: 'hi' }] },
  { ...request, messages: [{ role: 'user', content: '<|channel>thought' }] },
])('refuses unimplemented renderer behavior', (input) => {
  expect(() => renderNotesGemmaPrompt(input, '0.33.3')).toThrow(
    /unsupported_notes_tokenizer/,
  );
});
it('refuses a runtime version change', () => {
  expect(() => renderNotesGemmaPrompt(request, '0.34.0')).toThrow(
    'unsupported_notes_tokenizer_profile',
  );
});
