/** Narrow diagnostic mirror of Ollama v0.33.3's resolved gemma4-large renderer.
 * Source: model/renderers/gemma4.go and server/renderer_resolution.go at v0.33.3.
 * Unsupported requests fail closed; this is not a general chat-template engine.
 */
export function renderNotesGemmaPrompt(
  request: {
    model: string;
    think?: unknown;
    tools?: unknown[];
    messages: Array<{ role: string; content: string; [key: string]: unknown }>;
  },
  runtimeVersion: string,
) {
  if (
    runtimeVersion !== '0.33.3' ||
    request.model !== 'gemma4:12b' ||
    request.think !== false ||
    request.tools?.length ||
    !request.messages.length
  )
    throw new Error('unsupported_notes_tokenizer_profile');
  const trim = (text: string) =>
    text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  let result = '<bos>';
  let expected = 'user';
  for (const [index, message] of request.messages.entries()) {
    if (
      Object.keys(message).some((key) => !['role', 'content'].includes(key)) ||
      typeof message.content !== 'string' ||
      /<\|channel>|<channel\|>/.test(message.content)
    )
      throw new Error('unsupported_notes_tokenizer_message');
    if (index === 0 && message.role === 'system') {
      result += `<|turn>system\n${trim(message.content)}<turn|>\n`;
      continue;
    }
    if (message.role !== expected)
      throw new Error('unsupported_notes_tokenizer_roles');
    result += `<|turn>${message.role === 'assistant' ? 'model' : 'user'}\n${trim(message.content)}<turn|>\n`;
    expected = expected === 'user' ? 'assistant' : 'user';
  }
  if (expected !== 'assistant')
    throw new Error('unsupported_notes_tokenizer_roles');
  // v0.33.3 resolves 12B to the large renderer, including this no-think prefix.
  return `${result}<|turn>model\n<|channel>thought\n<channel|>`;
}
