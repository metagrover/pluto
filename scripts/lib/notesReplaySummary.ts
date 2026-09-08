type ReplayEvent = Record<string, unknown>;
/** Rebuild denominators from durable starts/terminals, including killed runs. */
export function summarizeNotesReplay(
  scheduled: Array<{ index: number; sourceIdSha256: string }>,
  events: ReplayEvent[],
) {
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
    }
    if (event.event === 'physical_terminal') {
      const attempt = attempts.get(Number(event.attempt));
      if (!attempt || attempt.terminal || attempt.caseIndex !== event.caseIndex)
        throw new Error('invalid_physical_terminal');
      attempt.terminal = event;
    }
  }
  const rows = [...cases.values()].map((row) => ({
    index: row.index,
    sourceIdSha256: row.sourceIdSha256,
    outcome:
      typeof row.terminal?.outcome === 'string'
        ? row.terminal.outcome.split(':')[0]
        : row.started
          ? 'no_terminal_record'
          : 'not_started',
    physicalRequests: [...attempts.values()].filter(
      (attempt) => attempt.caseIndex === row.index,
    ).length,
    censoredRequests: [...attempts.values()].filter(
      (attempt) => attempt.caseIndex === row.index && !attempt.terminal,
    ).length,
  }));
  return {
    runStatus:
      [...events].reverse().find((event) => event.event === 'run_terminal')
        ?.status ?? 'no_terminal_record',
    scheduled: scheduled.length,
    physicalRequests: attempts.size,
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
