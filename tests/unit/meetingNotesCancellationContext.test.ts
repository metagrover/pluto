import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type { NotesRequest } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import captured from '../fixtures/meeting-notes-qualified-publication-seed41.json';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';
import postFix from '../manual/fixtures/meetingNotesGemmaSchemaPostFix.json';

const droppedContextAudit = postFix.events.find(
  (event) => event.event === 'raw_attempt' && event.task === 'notesAudit',
)!.raw!;

const replay = (repair: string) => {
  const replies = [captured.writerRaw, droppedContextAudit, repair];
  const generate = vi.fn(async (request: NotesRequest) => {
    const raw = replies.shift();
    if (!raw) throw new Error('offline_replay_exhausted');
    return createNotesWireRequest(
      request.prompt,
      request.sourceSpans ?? [],
    ).decode(raw);
  });
  return {
    generate,
    result: generateMeetingNotes({
      source: structuredClone(captured.source),
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
    }),
  };
};

it('repairs captured audit deletion of cancellation context instead of publishing the omission', async () => {
  const { generate, result } = replay(captured.repairedAuditRaw);
  const analysis = await result;
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[2]![0].prompt).toContain(
    'missing_cancellation_context',
  );
  expect(analysis.quality.retry_count).toBe(1);
  expect(JSON.stringify(analysis.topics)).toContain(
    'Cleo withdrew the promise to replace product screenshots because the images are still accurate.',
  );
});

it('records a quality warning after the one repair if the captured cancellation omission persists', async () => {
  const { generate, result } = replay(droppedContextAudit);
  const analysis = await result;
  expect(analysis.quality.fallback_used).toBe(false);
  expect(analysis.quality.issues).toContain(
    'notes_guardrail:missing_cancellation_context',
  );
  expect(analysis.generation_metadata?.audit_status).toBe(
    'complete_with_warnings',
  );
  expect(JSON.stringify(analysis.all_action_items)).not.toContain(
    'replace product screenshots',
  );
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[2]![0].prompt).toContain(
    'missing_cancellation_context',
  );
});
