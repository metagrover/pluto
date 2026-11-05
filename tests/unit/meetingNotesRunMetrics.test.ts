import { describe, expect, it } from 'vitest';
import {
  type NotesStageEvent,
  createMeetingNotesRunMetrics,
  formatMeetingNotesRunTimings,
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

  it('adds primary scheduler wait to provider gate wait', () => {
    const metrics = createMeetingNotesRunMetrics(base);
    metrics.setPrimaryQueueMs(400);
    metrics.observe({
      phase: 'queued',
      sequence: 0,
      task: 'notesWriter',
      atMs: 1_400,
    });
    metrics.observe({ phase: 'started', sequence: 0, atMs: 1_450 });
    metrics.observe({
      phase: 'finished',
      sequence: 0,
      atMs: 1_500,
      outcome: 'complete',
    });

    expect(metrics.snapshot('published', 1_500).queueMs).toBe(450);
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

describe('notes timing log line', () => {
  const metrics = {
    schemaVersion: 1 as const,
    reason: 'automatic' as const,
    status: 'published' as const,
    sourceSegmentCount: 40,
    sourceCharacterCount: 9_000,
    plannedLeafCount: 2,
    generatedNodeCount: 2,
    repairCount: 1,
    repartitionCount: 0,
    queueMs: 1_200,
    modelMs: 48_000,
    totalMs: 51_000,
    stages: [
      {
        sequence: 0,
        task: 'notesWriter' as const,
        outcome: 'complete' as const,
        queueWaitMs: 900,
        modelMs: 30_000,
        inputTokens: 5_000,
        outputTokens: 800,
      },
    ],
  };

  it('writes only timings, counts and a short run prefix', () => {
    const line = formatMeetingNotesRunTimings({
      runId: '0123456789abcdef',
      reason: 'automatic',
      status: 'failed',
      errorCode:
        'notes_guardrail:[{"code":"missing_condition","segments":[3]}]',
      metrics,
      completedAt: '2026-11-04T10:02:30.000Z',
      meetingEndedAt: '2026-11-04T10:00:00.000Z',
    });
    expect(JSON.parse(line)).toEqual({
      run: '01234567',
      completedAt: '2026-11-04T10:02:30.000Z',
      reason: 'automatic',
      status: 'failed',
      error: 'notes_guardrail',
      meetingEndToDoneMs: 150_000,
      totalMs: 51_000,
      queueMs: 1_200,
      modelMs: 48_000,
      chars: 9_000,
      segments: 40,
      leaves: 2,
      nodes: 2,
      repairs: 1,
      repartitions: 0,
      stages: [['notesWriter', 'complete', 900, 30_000, 5_000, 800]],
    });
  });

  it('leaves the meeting-end gap empty when it is unknown or out of order', () => {
    for (const meetingEndedAt of [
      null,
      'not a date',
      '2026-11-04T11:00:00.000Z',
    ])
      expect(
        JSON.parse(
          formatMeetingNotesRunTimings({
            runId: 'run',
            reason: 'manual',
            status: 'published',
            metrics: null,
            completedAt: '2026-11-04T10:02:30.000Z',
            meetingEndedAt,
          }),
        ).meetingEndToDoneMs,
      ).toBeNull();
  });
});
