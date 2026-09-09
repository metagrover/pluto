import { NOTES_REPLAY_MAX_SAMPLE_GAP_MS } from './notesReplayResources';
type ReplayEvent = Record<string, unknown>;
/** Public outcome labels omit private diagnostic suffixes, not error classes. */
export const notesReplayOutcomeLabel = (code: string) => code.split(':')[0];
/** Rebuild denominators from durable starts/terminals, including killed runs. */
export function summarizeNotesReplay(
  scheduled: Array<{ index: number; sourceIdSha256: string }>,
  events: ReplayEvent[],
) {
  const samples = events.filter(
    (event) =>
      ['resource_baseline', 'resource_sample', 'run_terminal'].includes(
        String(event.event),
      ) && typeof event.at === 'number',
  );
  const gaps = samples
    .slice(1)
    .map((event, index) => Number(event.at) - Number(samples[index].at));
  const timingContinuity = {
    status:
      events.some((event) => event.event === 'resource_sampling_gap') ||
      gaps.some((gap) => gap < 0 || gap > NOTES_REPLAY_MAX_SAMPLE_GAP_MS)
        ? 'gap_detected'
        : samples.some((event) => event.event === 'resource_baseline') &&
            samples.some((event) => event.event === 'run_terminal')
          ? 'no_recorded_gap'
          : 'unavailable',
    maxSampleGapMs: gaps.length ? Math.max(...gaps) : null,
  };
  const cases = new Map(
    scheduled.map((row) => [
      row.index,
      { ...row, started: false, terminal: null as ReplayEvent | null },
    ]),
  );
  if (cases.size !== scheduled.length)
    throw new Error('duplicate_scheduled_case');
  const attempts = new Map<
    number,
    { caseIndex: number; terminal: ReplayEvent | null }
  >();
  let outstanding = 0;
  let maxOutstandingPhysicalRequests = 0;
  for (const event of events) {
    if (
      event.event === 'meeting_started' ||
      event.event === 'meeting_terminal'
    ) {
      const row = cases.get(Number(event.index));
      if (!row || row.sourceIdSha256 !== event.sourceIdSha256)
        throw new Error('unscheduled_case');
      if (event.event === 'meeting_started') {
        if (row.started) throw new Error('duplicate_case_start');
        row.started = true;
      } else {
        if (!row.started || row.terminal)
          throw new Error('invalid_case_terminal');
        row.terminal = event;
      }
    }
    if (event.event === 'physical_started') {
      const id = Number(event.attempt);
      const caseIndex = Number(event.caseIndex);
      if (!cases.get(caseIndex)?.started || attempts.has(id))
        throw new Error('invalid_physical_start');
      attempts.set(id, { caseIndex, terminal: null });
      outstanding++;
      maxOutstandingPhysicalRequests = Math.max(
        maxOutstandingPhysicalRequests,
        outstanding,
      );
    }
    if (event.event === 'physical_terminal') {
      const attempt = attempts.get(Number(event.attempt));
      if (!attempt || attempt.terminal || attempt.caseIndex !== event.caseIndex)
        throw new Error('invalid_physical_terminal');
      attempt.terminal = event;
      outstanding--;
    }
  }
  const rows = [...cases.values()].map((row) => ({
    index: row.index,
    sourceIdSha256: row.sourceIdSha256,
    outcome:
      typeof row.terminal?.outcome === 'string'
        ? notesReplayOutcomeLabel(row.terminal.outcome)
        : row.started
          ? 'no_terminal_record'
          : 'not_started',
    physicalRequests: [...attempts.values()].filter(
      (attempt) => attempt.caseIndex === row.index,
    ).length,
    censoredRequests: [...attempts.values()].filter(
      (attempt) => attempt.caseIndex === row.index && !attempt.terminal,
    ).length,
    elapsedMs: row.terminal?.elapsedMs ?? null,
    durationSeconds: row.terminal?.durationSeconds ?? null,
    sourceCharacters: row.terminal?.sourceCharacters ?? null,
  }));
  return {
    timingContinuity,
    runStatus:
      [...events].reverse().find((event) => event.event === 'run_terminal')
        ?.status ?? 'no_terminal_record',
    scheduled: scheduled.length,
    physicalRequests: attempts.size,
    // Missing terminal records leave attempts outstanding; do not silently
    // interpret this upper bound as measured server-side concurrency.
    maxOutstandingPhysicalRequests,
    censoredRequests: [...attempts.values()].filter(
      (attempt) => !attempt.terminal,
    ).length,
    physicalOutcomes: [...attempts.entries()].map(([attempt, value]) => ({
      attempt,
      caseIndex: value.caseIndex,
      outcome:
        value.terminal?.doneReason === 'length'
          ? 'output_truncated'
          : (value.terminal?.outcome ?? 'no_terminal_record'),
      elapsedMs: value.terminal?.elapsedMs ?? null,
      firstAnswerMs: value.terminal?.firstAnswerMs ?? null,
      firstReasoningMs: value.terminal?.firstReasoningMs ?? null,
      metrics: value.terminal?.metrics ?? null,
    })),
    counts: Object.fromEntries(
      [...new Set(rows.map((row) => row.outcome))].map((outcome) => [
        outcome,
        rows.filter((row) => row.outcome === outcome).length,
      ]),
    ),
    rows,
    qualityApproved: false,
  };
}
