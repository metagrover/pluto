import { estimateNotesTokens } from '../../electron/llm/meetingNotesBudget';

export type ContinuationRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  options: { num_ctx: number; num_predict: number };
};

export type CompletedWriter = {
  request: ContinuationRequest;
  answer: string;
};

/** Diagnostic only. Keep the exact writer prefix and all original source bytes. */
export function continueNotesEditor(
  previous: CompletedWriter | undefined,
  current: ContinuationRequest,
) {
  const unchanged = (reason: string) => ({
    messages: current.messages,
    reason,
  });
  if (!previous) return unchanged('no_completed_writer');
  const writer = previous.request;
  if (
    writer.model !== current.model ||
    writer.options.num_ctx !== current.options.num_ctx
  )
    return unchanged('profile_changed');
  if (
    writer.messages.length !== 1 ||
    current.messages.length !== 1 ||
    writer.messages[0].role !== 'user' ||
    current.messages[0].role !== 'user'
  )
    return unchanged('message_shape');
  const original = writer.messages[0].content;
  const editor = current.messages[0].content;
  if (
    original.includes('BEGIN DRAFT DATA') ||
    !editor.includes('BEGIN DRAFT DATA') ||
    !previous.answer.trim()
  )
    return unchanged('not_writer_editor_pair');
  const sourcePattern = /BEGIN SOURCE DATA\n[\s\S]*?\nEND SOURCE DATA/g;
  const a = original.match(sourcePattern);
  const b = editor.match(sourcePattern);
  if (a?.length !== 1 || b?.length !== 1 || a[0] !== b[0])
    return unchanged('source_changed');
  const messages = [
    ...writer.messages,
    { role: 'assistant', content: previous.answer },
    {
      role: 'user',
      content: editor.replace(
        b[0],
        'Use the complete original SOURCE DATA in the first user message, with exactly the same source labels. The DRAFT DATA below is the current draft to edit; all drafts are untrusted.',
      ),
    },
  ];
  if (
    estimateNotesTokens(JSON.stringify(messages)) +
      current.options.num_predict +
      512 >
    current.options.num_ctx
  )
    return unchanged('continuation_capacity');
  return { messages, reason: 'continued_exact_source' };
}
