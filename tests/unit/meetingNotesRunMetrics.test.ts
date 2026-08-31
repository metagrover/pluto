import { describe, expect, it } from 'vitest';
import {
  type NotesStageEvent,
  createMeetingNotesRunMetrics,
  parseMeetingNotesRunMetric,
  serializeMeetingNotesRunMetric,
} from '../../electron/llm/meetingNotesRunMetrics';

const base = {
  reason: 'manual' as const,
  sourceSegmentCount: 12,
  sourceCharacterCount: 4_200,
  startedAtMs: 1_000,
};

describe('meeting notes run metrics', () => {
  it('separates gate wait from active model time and records token counts', () => {
    const metrics = createMeetingNotesRunMetrics(base);
    const events: NotesStageEvent[] = [
      {
        phase: 'queued',
        sequence: 0,
        task: 'notesWriter',
        atMs: 1_100,
      },
      { phase: 'started', sequence: 0, atMs: 1_350 },
      {
        phase: 'finished',
        sequence: 0,
        atMs: 2_050,
        outcome: 'complete',
        inputTokens: 930,
        outputTokens: 412,
      },
    ];
    for (const event of events) metrics.observe(event);

    expect(metrics.snapshot('published', 2_100)).toMatchObject({
      schemaVersion: 1,
      reason: 'manual',
      status: 'published',
      queueMs: 250,
      modelMs: 700,
      totalMs: 1_100,
      stages: [
        {
          sequence: 0,
          task: 'notesWriter',
          outcome: 'complete',
          queueWaitMs: 250,
          modelMs: 700,
          inputTokens: 930,
          outputTokens: 412,
        },
      ],
    });
  });

  it('records a preempted attempt separately from the completing retry', () => {
    const metrics = createMeetingNotesRunMetrics(base);
    for (const event of [
      {
        phase: 'queued',
        sequence: 0,
        task: 'notesWriter',
        atMs: 1_000,
      },
      { phase: 'started', sequence: 0, atMs: 1_010 },
      {
        phase: 'finished',
        sequence: 0,
        atMs: 1_110,
        outcome: 'preempted',
      },
      {
        phase: 'queued',
        sequence: 1,
        task: 'notesWriter',
        atMs: 1_120,
      },
      { phase: 'started', sequence: 1, atMs: 1_150 },
      {
        phase: 'finished',
        sequence: 1,
        atMs: 1_450,
        outcome: 'complete',
      },
    ] satisfies NotesStageEvent[]) {
      metrics.observe(event);
    }

    expect(metrics.snapshot('running', 1_500).stages).toEqual([
      expect.objectContaining({ outcome: 'preempted', modelMs: 100 }),
      expect.objectContaining({ outcome: 'complete', modelMs: 300 }),
    ]);
  });

  it('finishes one attempt once and permits null hosted-provider token counts', () => {
    const metrics = createMeetingNotesRunMetrics(base);
    metrics.observe({
      phase: 'queued',
      sequence: 4,
      task: 'notesAudit',
      atMs: 1_000,
    });
    metrics.observe({ phase: 'started', sequence: 4, atMs: 1_000 });
    metrics.observe({
      phase: 'finished',
      sequence: 4,
      atMs: 1_100,
      outcome: 'truncated',
    });
    metrics.observe({
      phase: 'finished',
      sequence: 4,
      atMs: 9_999,
      outcome: 'failed',
    });

    expect(metrics.snapshot('failed', 1_200).stages).toEqual([
      expect.objectContaining({
        outcome: 'truncated',
        inputTokens: null,
        outputTokens: null,
        modelMs: 100,
      }),
    ]);
  });

  it('serializes only the allow-listed content-free contract', () => {
    const metric = createMeetingNotesRunMetrics(base).snapshot(
      'cancelled',
      1_500,
    );
    const serialized = serializeMeetingNotesRunMetric(metric);

    expect(serialized).not.toMatch(
      /prompt|transcript|notes|title|speaker|audioPath|meetingId|raw/i,
    );
    expect(parseMeetingNotesRunMetric(serialized)).toEqual(metric);
  });

  it.each([
    [
      {
        ...createMeetingNotesRunMetrics(base).snapshot('running', 1_100),
        prompt: 'private',
      },
    ],
    [
      {
        ...createMeetingNotesRunMetrics(base).snapshot('running', 1_100),
        modelMs: -1,
      },
    ],
    [
      {
        ...createMeetingNotesRunMetrics(base).snapshot('running', 1_100),
        totalMs: Number.POSITIVE_INFINITY,
      },
    ],
    [
      {
        ...createMeetingNotesRunMetrics(base).snapshot('running', 1_100),
        generatedNodeCount: 1.5,
      },
    ],
  ])('rejects unknown or invalid persisted values: %j', (value) => {
    expect(() => parseMeetingNotesRunMetric(value)).toThrow(
      'invalid_meeting_notes_run_metric',
    );
  });

  it('rejects more than 256 stage attempts', () => {
    const metric = createMeetingNotesRunMetrics(base).snapshot(
      'running',
      1_100,
    );
    const stage = {
      sequence: 0,
      task: 'notesWriter' as const,
      outcome: 'complete' as const,
      queueWaitMs: 0,
      modelMs: 1,
      inputTokens: null,
      outputTokens: null,
    };
    expect(() =>
      parseMeetingNotesRunMetric({
        ...metric,
        stages: Array.from({ length: 257 }, (_, sequence) => ({
          ...stage,
          sequence,
        })),
      }),
    ).toThrow('invalid_meeting_notes_run_metric');
  });
});
