import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import {
  MeetingNotesError,
  type NotesDraft,
} from '../../electron/llm/meetingNotesTypes';
import {
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

const COMPACT_RETRY = 'COMPACT RETRY';

const sourceSpans = (prompt: string) =>
  (prompt.match(/BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/)?.[1] ?? '')
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        (
          JSON.parse(line) as {
            descriptor: { segment: number; start: number; end: number };
          }
        ).descriptor,
    );

const reviewedDraft = (prompt: string) => {
  const draft = JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)?.[1] ?? '{}',
  ) as NotesDraft;
  return JSON.stringify({ ...draft, dispositions: [], terminology: [] });
};

const draftFor = (prompt: string): NotesDraft => ({
  meetingType: 'general',
  overview: null,
  sections: [
    {
      title: { text: 'Context', sources: [sourceSpans(prompt)[0]!] },
      items: [],
    },
  ],
});

it('retries one truncated leaf compactly without including the partial response', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  let truncated = false;
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesWriter' && !truncated) {
      truncated = true;
      throw new MeetingNotesError('notes_output_truncated');
    }
    return request.task === 'notesAudit'
      ? reviewedDraft(request.prompt)
      : JSON.stringify(draftFor(request.prompt));
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
  });

  const writerPrompts = generate.mock.calls
    .filter(([request]) => request.task === 'notesWriter')
    .map(([request]) => request.prompt);
  expect(writerPrompts[1]).toContain(COMPACT_RETRY);
  expect(writerPrompts[1]).not.toContain('REJECTED RESPONSE');
  expect(sourceSpans(writerPrompts[1]!)).toEqual(
    sourceSpans(writerPrompts[0]!),
  );
  expect(result.generation_metadata.mode).toBe('hierarchical');
});

it('bisects only the leaf that truncates twice and retains completed siblings', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  let truncatedKey: string | undefined;
  const writerCounts = new Map<string, number>();
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesAudit') return reviewedDraft(request.prompt);
    if (request.task === 'notesMerge')
      return JSON.stringify(draftFor(request.prompt));
    const key = JSON.stringify(sourceSpans(request.prompt));
    writerCounts.set(key, (writerCounts.get(key) ?? 0) + 1);
    truncatedKey ??= key;
    if (key === truncatedKey && writerCounts.get(key)! <= 2) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    return JSON.stringify(draftFor(request.prompt));
  });

  await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
    onRepartition,
  });

  expect(writerCounts.get(truncatedKey!)).toBe(2);
  expect(onRepartition).toHaveBeenCalled();
  expect(
    [...writerCounts.entries()]
      .filter(([key]) => key !== truncatedKey)
      .every(([, count]) => count === 1),
  ).toBe(true);
});

it('repartitions a leaf when its compact retry no longer fits the provider context', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  let writerCalls = 0;
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesAudit') return reviewedDraft(request.prompt);
    if (request.task === 'notesMerge')
      return JSON.stringify(draftFor(request.prompt));
    writerCalls += 1;
    if (writerCalls === 1) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    if (writerCalls === 2) {
      expect(request.prompt).toContain(COMPACT_RETRY);
      throw new MeetingNotesError('notes_context_exhausted');
    }
    return JSON.stringify(draftFor(request.prompt));
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
    onRepartition,
  });

  expect(writerCalls).toBeGreaterThan(2);
  expect(onRepartition).toHaveBeenCalled();
  expect(result.generation_metadata.mode).toBe('hierarchical');
});

it('repacks only the affected merge after its compact retry also truncates', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  let mergeTruncations = 0;
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesAudit') return reviewedDraft(request.prompt);
    if (request.task === 'notesMerge' && mergeTruncations < 2) {
      mergeTruncations += 1;
      throw new MeetingNotesError('notes_output_truncated');
    }
    return JSON.stringify(draftFor(request.prompt));
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
    onRepartition,
  });

  expect(mergeTruncations).toBe(2);
  expect(onRepartition).toHaveBeenCalled();
  expect(result.generation_metadata.mode).toBe('hierarchical');
});

it('repartitions a middle leaf audit without rerunning its completed predecessor', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  const auditKeys: string[] = [];
  const auditCounts = new Map<string, number>();
  const writerCounts = new Map<string, number>();
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    const key = JSON.stringify(sourceSpans(request.prompt));
    if (request.task === 'notesWriter') {
      writerCounts.set(key, (writerCounts.get(key) ?? 0) + 1);
      return JSON.stringify(draftFor(request.prompt));
    }
    if (request.task === 'notesMerge')
      return JSON.stringify(draftFor(request.prompt));
    if (!auditKeys.includes(key)) auditKeys.push(key);
    auditCounts.set(key, (auditCounts.get(key) ?? 0) + 1);
    if (key === auditKeys[1] && auditCounts.get(key)! <= 2) {
      throw new MeetingNotesError('notes_output_truncated');
    }
    return reviewedDraft(request.prompt);
  });

  await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
    onRepartition,
  });

  expect(auditCounts.get(auditKeys[1]!)).toBe(2);
  expect(writerCounts.get(auditKeys[0]!)).toBe(1);
  expect(onRepartition).toHaveBeenCalled();
});

it('re-enters the merge frontier when the final merge audit truncates twice', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  let mergeStarted = false;
  let auditTruncations = 0;
  const onRepartition = vi.fn();
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesMerge') {
      mergeStarted = true;
      return JSON.stringify(draftFor(request.prompt));
    }
    if (request.task === 'notesAudit' && mergeStarted && auditTruncations < 2) {
      auditTruncations += 1;
      throw new MeetingNotesError('notes_output_truncated');
    }
    return request.task === 'notesAudit'
      ? reviewedDraft(request.prompt)
      : JSON.stringify(draftFor(request.prompt));
  });

  const result = await generateMeetingNotes({
    reviewProtocol: 'editor',
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama',
    model: 'test',
    contextTokens: 16_384,
    onRepartition,
  });

  expect(auditTruncations).toBe(2);
  expect(onRepartition).toHaveBeenCalled();
  expect(result.generation_metadata.mode).toBe('hierarchical');
});

it('fails an unsplittable repeatedly truncated leaf with the bounded recovery code', async () => {
  const source = makeSyntheticNotesSource([{ speaker: 'Milo', text: 'x' }]);
  let calls = 0;
  const generate = vi.fn(async () => {
    calls += 1;
    if (calls === 1) throw new MeetingNotesError('notes_input_overflow');
    throw new MeetingNotesError('notes_output_truncated');
  });

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16_384,
    }),
  ).rejects.toThrow('notes_repartition_exhausted');
  expect(calls).toBe(3);
});

it('maps the recovery node ceiling to notes_repartition_exhausted', async () => {
  const source = makeSyntheticNotesSource([
    { speaker: 'Milo', text: 'x'.repeat(256) },
  ]);
  let calls = 0;
  const generate = vi.fn(async () => {
    calls += 1;
    if (calls === 1) throw new MeetingNotesError('notes_input_overflow');
    throw new MeetingNotesError('notes_output_truncated');
  });

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16_384,
    }),
  ).rejects.toThrow('notes_repartition_exhausted');
});

it('keeps cancellation exact and does not repartition after a truncated stage aborts', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: 'Milo',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  const controller = new AbortController();
  const onRepartition = vi.fn();
  const generate = vi.fn(async () => {
    controller.abort();
    throw new MeetingNotesError('notes_output_truncated');
  });

  await expect(
    generateMeetingNotes({
      reviewProtocol: 'editor',
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16_384,
      signal: controller.signal,
      onRepartition,
    }),
  ).rejects.toThrow('notes_cancelled');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(onRepartition).not.toHaveBeenCalled();
});
