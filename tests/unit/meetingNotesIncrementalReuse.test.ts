import { expect, it, vi } from 'vitest';
import * as hierarchy from '../../electron/llm/meetingNotesHierarchy';
import {
  generateMeetingNotes,
  precomputeNextMeetingNotesLeaf,
} from '../../electron/llm/meetingNotesPipeline';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import type { NotesDraft } from '../../electron/llm/meetingNotesTypes';
import {
  makeNotesContext,
  makeSyntheticNotesSource,
} from '../fixtures/meeting-notes-v10';

const descriptors = (prompt: string) =>
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

const draftFor = (prompt: string): NotesDraft => ({
  meetingType: 'general',
  overview: null,
  sections: [
    {
      title: { text: 'Context', sources: [descriptors(prompt)[0]!] },
      items: [],
    },
  ],
});

const reviewedDraft = (prompt: string) => {
  const draft = JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)?.[1] ?? '{}',
  ) as NotesDraft;
  return JSON.stringify({ ...draft, dispositions: [], terminology: [] });
};

it('precomputes only a closed leaf and reuses it during final generation', async () => {
  const finalSource = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: index % 2 ? 'Milo' : 'Nira',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  const prefixSource = makeSyntheticNotesSource(
    finalSource.segments.slice(0, 4).map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
    })),
  );
  const spans = finalSource.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const closedSpans = spans.slice(0, 3);
  const plan = vi
    .spyOn(hierarchy, 'planNotesLeaves')
    .mockImplementation((source) => [
      {
        primarySpans: closedSpans,
        overlapSpans: [],
        primaryText: 'first',
        sourceText: 'first',
        sourceRevision: source.revision,
      },
      {
        primarySpans: spans.slice(3, source.segments.length),
        overlapSpans: [],
        primaryText: 'open-tail',
        sourceText: 'open-tail',
        sourceRevision: source.revision,
      },
    ]);
  const stageCache = new NotesStageCache();
  const tasks: string[] = [];
  const generate = vi.fn(async (request) => {
    tasks.push(request.task);
    return request.task === 'notesAudit'
      ? reviewedDraft(request.prompt)
      : JSON.stringify(draftFor(request.prompt));
  });
  const input = {
    reviewProtocol: 'editor' as const,
    source: prefixSource,
    context: makeNotesContext(),
    generate,
    provider: 'ollama' as const,
    model: 'test',
    contextTokens: 16_384,
    stageCache,
    cacheKey: 'compatible-config',
  };

  try {
    await expect(precomputeNextMeetingNotesLeaf(input)).resolves.toBe(
      'generated',
    );
    expect(tasks).toEqual(['notesWriter']);
    expect(descriptors(generate.mock.calls[0]![0].prompt)).toEqual(closedSpans);

    tasks.length = 0;
    await generateMeetingNotes({ ...input, source: finalSource });
    expect(tasks.filter((task) => task === 'notesWriter')).toHaveLength(1);
    expect(tasks).toContain('notesMerge');
    expect(tasks).toContain('notesAudit');
  } finally {
    plan.mockRestore();
  }
});

it('does not reuse a precomputed leaf under incompatible generation context', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 6 }, (_, index) => ({
      speaker: 'Milo',
      text: `Turn ${index}: ${'context '.repeat(1_000)}`,
    })),
  );
  const stageCache = new NotesStageCache();
  const generate = vi.fn(async (request) =>
    JSON.stringify(draftFor(request.prompt)),
  );
  const base = {
    source,
    context: makeNotesContext(),
    generate,
    provider: 'ollama' as const,
    model: 'test',
    contextTokens: 16_384,
    stageCache,
  };

  await precomputeNextMeetingNotesLeaf({ ...base, cacheKey: 'config-a' });
  await precomputeNextMeetingNotesLeaf({ ...base, cacheKey: 'config-b' });

  expect(generate).toHaveBeenCalledTimes(2);
});
