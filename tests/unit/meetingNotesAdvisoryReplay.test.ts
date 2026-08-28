import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type { NotesRequest } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';
import captured from '../manual/fixtures/meetingNotesRelativeCandidateSeed41.json';

// Replays immutable responses; this is policy regression coverage, not new inference
// or a retrospective change to the recorded model evaluation scores.
it.each([
  'personal',
  'qualified-publication',
  'accepted-request-privacy',
  'long-exhibition-planning',
])('publishes the frozen candidate response sequence: %s', async (caseName) => {
  const events = captured.events.filter((event) => event.case === caseName);
  const source = structuredClone(events.find((event) => event.source)!.source!);
  const attempts = events.filter((event) => event.event === 'raw_attempt');
  let consumed = 0;
  const generate = vi.fn(async (request: NotesRequest) => {
    const attempt = attempts[consumed++];
    if (!attempt?.raw) throw new Error('saved_responses_exhausted');
    expect(request.task).toBe(attempt.task);
    return createNotesWireRequest(
      request.prompt,
      request.sourceSpans ?? [],
    ).decode(attempt.raw);
  });
  const result = await generateMeetingNotes({
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16384,
  });
  expect(consumed).toBe(attempts.length);
  expect(result.quality.format_pass).toBe(true);
  expect(result.quality.fallback_used).toBe(false);
  expect(result.topics.length).toBeGreaterThan(0);
  if (caseName === 'qualified-publication') {
    expect(result.all_action_items).toEqual([]);
    expect(result.topics.flatMap((topic) => topic.action_items ?? [])).toEqual(
      [],
    );
    expect(result.quality.issues.length).toBeGreaterThan(0);
    expect(result.generation_metadata?.audit_status).toBe(
      'complete_with_warnings',
    );
    expect(generate).toHaveBeenCalledTimes(3);
  } else {
    expect(result.generation_metadata?.audit_status).toBe('complete');
  }
});
