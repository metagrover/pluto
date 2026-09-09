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

it('does not spend live inference on a compact meeting that still fits the direct final path', async () => {
  const source = makeSyntheticNotesSource(
    Array.from({ length: 250 }, (_, i) => ({
      speaker: 'Milo',
      text: `Dense meeting detail ${i}. Follow-up context.`,
    })),
  );
  const generate = vi.fn();
  await expect(
    precomputeNextMeetingNotesLeaf({
      source,
      reviewProtocol: 'editor',
      compactWriterContract: true,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'test',
      contextTokens: 16384,
      stageCache: new NotesStageCache(),
      cacheKey: 'compact-config',
    }),
  ).resolves.toBe('discarded');
  expect(generate).not.toHaveBeenCalled();
});

it('reuses compact live work in the real bounded final plan, without skipping final review', async () => {
  const finalSource = makeSyntheticNotesSource(
    Array.from({ length: 443 }, (_, i) => ({
      speaker: i % 2 ? 'Milo' : 'Nira',
      text: `Dense meeting detail ${i}. Follow-up context.`,
    })),
  );
  const prefixSource = makeSyntheticNotesSource(
    finalSource.segments.slice(0, 420),
  );
  const stageCache = new NotesStageCache();
  const generate = vi.fn(async (request) => {
    if (request.task === 'notesAudit') return reviewedDraft(request.prompt);
    const span = descriptors(request.prompt)[0]!;
    const sourceRow = JSON.parse(
      request.prompt.split('BEGIN SOURCE DATA\n')[1].split('\n')[0],
    );
    return JSON.stringify({
      sections: [
        {
          title: 'Context',
          items: [
            {
              kind: 'point',
              text: sourceRow.text,
              owner: null,
              due: null,
              sources: [span],
            },
          ],
        },
      ],
    });
  });
  const input = {
    source: prefixSource,
    reviewProtocol: 'editor' as const,
    compactWriterContract: true,
    context: makeNotesContext(),
    generate,
    provider: 'ollama' as const,
    model: 'test',
    contextTokens: 16384,
    stageCache,
    cacheKey: 'compact-config',
  };
  await expect(precomputeNextMeetingNotesLeaf(input)).resolves.toBe(
    'generated',
  );
  const cachedPrompt = generate.mock.calls[0][0].prompt;
  await expect(precomputeNextMeetingNotesLeaf(input)).resolves.toBe(
    'generated',
  );
  generate.mockClear();
  await expect(precomputeNextMeetingNotesLeaf(input)).resolves.toBe('reused');
  expect(generate).not.toHaveBeenCalled();
  const onPlan = vi.fn();
  await generateMeetingNotes({ ...input, source: finalSource, onPlan });
  expect(onPlan).toHaveBeenCalledWith({ plannedLeafCount: 3 });
  expect(
    generate.mock.calls.filter(([request]) => request.task === 'notesWriter'),
  ).toHaveLength(1);
  expect(
    generate.mock.calls.filter(([request]) => request.task === 'notesAudit'),
  ).toHaveLength(3);
  expect(
    generate.mock.calls
      .filter(([request]) => request.task === 'notesWriter')
      .every(([request]) => request.prompt !== cachedPrompt),
  ).toBe(true);
  generate.mockClear();
  const corrected = makeSyntheticNotesSource(
    finalSource.segments.map((segment, i) => ({
      speaker: segment.speaker,
      text: i === 0 ? segment.text.replace('Dense', 'Fresh') : segment.text,
    })),
  );
  await generateMeetingNotes({ ...input, source: corrected });
  expect(
    generate.mock.calls.filter(([request]) => request.task === 'notesWriter'),
  ).toHaveLength(1);
  expect(
    generate.mock.calls.find(([request]) => request.task === 'notesWriter')![0]
      .prompt,
  ).toContain('Fresh meeting detail');
});

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
