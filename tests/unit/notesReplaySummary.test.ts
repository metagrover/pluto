import { describe, expect, it } from 'vitest';
import { summarizeNotesReplay } from '../../scripts/lib/notesReplaySummary';
const scheduled = [
  { index: 1, sourceIdSha256: 'a' },
  { index: 2, sourceIdSha256: 'b' },
];
const started = { event: 'meeting_started', index: 1, sourceIdSha256: 'a' };
describe('durable replay denominators', () => {
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
