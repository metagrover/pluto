import { describe, expect, it } from 'vitest';
import {
  notesReplayOutcomeLabel,
  summarizeNotesReplay,
} from '../../scripts/lib/notesReplaySummary';
const scheduled = [
  { index: 1, sourceIdSha256: 'a' },
  { index: 2, sourceIdSha256: 'b' },
];
const started = { event: 'meeting_started', index: 1, sourceIdSha256: 'a' };
describe('durable replay denominators', () => {
  it('detects historical sleep gaps even if the old run was labelled completed', () => {
    const summary = summarizeNotesReplay(scheduled, [
      { event: 'resource_baseline', at: 0 },
      { event: 'resource_sample', at: 5000 },
      { event: 'resource_sample', at: 1_000_000 },
      { event: 'run_terminal', at: 1_000_001, status: 'completed' },
    ]);
    expect(summary.timingContinuity).toEqual({
      status: 'gap_detected',
      maxSampleGapMs: 995000,
    });
    expect(summary.runStatus).toBe('completed');
    expect(summarizeNotesReplay(scheduled, []).timingContinuity.status).toBe(
      'unavailable',
    );
  });
  it('reports latency with outcomes and leaves unavailable measurements null', () => {
    const result = summarizeNotesReplay(scheduled, [
      started,
      { event: 'physical_started', caseIndex: 1, attempt: 1 },
      {
        event: 'physical_terminal',
        caseIndex: 1,
        attempt: 1,
        outcome: 'complete',
        elapsedMs: 400,
        firstAnswerMs: 150,
        metrics: { eval_count: 20 },
      },
      {
        event: 'meeting_terminal',
        index: 1,
        sourceIdSha256: 'a',
        outcome: 'accepted_in_replay',
        elapsedMs: 420,
        durationSeconds: 1800,
        sourceCharacters: 22000,
      },
    ]);
    expect(result.rows[0]).toMatchObject({
      elapsedMs: 420,
      durationSeconds: 1800,
      sourceCharacters: 22000,
    });
    expect(result.rows[1]).toMatchObject({ elapsedMs: null });
    expect(result.physicalOutcomes[0]).toMatchObject({
      elapsedMs: 400,
      firstAnswerMs: 150,
      firstReasoningMs: null,
      metrics: { eval_count: 20 },
    });
    expect(result.qualityApproved).toBe(false);
  });
  it('normalizes private suffixes without conflating distinct failure categories', () => {
    expect(
      notesReplayOutcomeLabel('notes_guardrail:[{"code":"missing_action"}]'),
    ).toBe('notes_guardrail');
    expect(notesReplayOutcomeLabel('notes_guardrail')).toBe('notes_guardrail');
    expect(notesReplayOutcomeLabel('notes_writer_invalid:detail')).not.toBe(
      'notes_guardrail',
    );
  });
  it('retains interrupted and never-started meetings plus censored physical calls', () => {
    expect(
      summarizeNotesReplay(scheduled, [
        started,
        { event: 'physical_started', caseIndex: 1, attempt: 1 },
      ]),
    ).toMatchObject({
      scheduled: 2,
      physicalRequests: 1,
      censoredRequests: 1,
      counts: { no_terminal_record: 1, not_started: 1 },
      qualityApproved: false,
    });
  });
  it('counts physical retries separately and redacts dynamic error details', () => {
    const events = [
      started,
      ...[1, 2].flatMap((attempt) => [
        { event: 'physical_started', caseIndex: 1, attempt },
        {
          event: 'physical_terminal',
          caseIndex: 1,
          attempt,
          outcome: 'complete',
        },
      ]),
      {
        event: 'meeting_terminal',
        index: 1,
        sourceIdSha256: 'a',
        outcome: 'notes_writer_invalid:private-detail',
      },
    ];
    expect(summarizeNotesReplay(scheduled, events)).toMatchObject({
      physicalRequests: 2,
      maxOutstandingPhysicalRequests: 1,
      censoredRequests: 0,
      counts: { notes_writer_invalid: 1, not_started: 1 },
    });
  });
  it('rejects duplicate or unknown case events', () => {
    expect(() => summarizeNotesReplay(scheduled, [started, started])).toThrow(
      'duplicate_case_start',
    );
    expect(() =>
      summarizeNotesReplay(scheduled, [{ ...started, index: 3 }]),
    ).toThrow('unscheduled_case');
  });
  it('keeps censored attempts outstanding instead of claiming serial completion', () => {
    expect(
      summarizeNotesReplay(scheduled, [
        started,
        { event: 'physical_started', caseIndex: 1, attempt: 1 },
        { event: 'physical_started', caseIndex: 1, attempt: 2 },
        {
          event: 'physical_terminal',
          caseIndex: 1,
          attempt: 2,
          outcome: 'complete',
        },
      ]),
    ).toMatchObject({ maxOutstandingPhysicalRequests: 2, censoredRequests: 1 });
  });
  it('rejects a terminal attached to the wrong case', () => {
    expect(() =>
      summarizeNotesReplay(scheduled, [
        started,
        { event: 'physical_started', caseIndex: 1, attempt: 1 },
        { event: 'physical_terminal', caseIndex: 2, attempt: 1 },
      ]),
    ).toThrow('invalid_physical_terminal');
  });
});
