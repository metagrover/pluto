import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import {
  makeDirectNotesFixture,
  makeNotesContext,
} from '../fixtures/meeting-notes-v10';

it('uses one writer and one audit without segmentation or a third rewrite', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(fixture.draft))
    .mockResolvedValueOnce(JSON.stringify(fixture.audit));

  const result = await generateMeetingNotes({
    source: fixture.source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'qwen3.5:9b',
    contextTokens: 16384,
  });

  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesAudit',
  ]);
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(result.generation_metadata).toMatchObject({
    prompt_version: 'notes-v10',
    pipeline_version: 'writer-audit-v1',
    audit_status: 'complete',
  });
});

it('rejects a malformed writer response after one bounded repair', async () => {
  const fixture = makeDirectNotesFixture();
  const generate = vi.fn().mockResolvedValue('{broken');

  await expect(
    generateMeetingNotes({
      source: fixture.source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'qwen3.5:9b',
      contextTokens: 16384,
    }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(2);
});
