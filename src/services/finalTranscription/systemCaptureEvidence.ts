// Silence is useful as a reference only when capture itself was available.
// Permission/UI state and ASR no-speech results cannot establish that fact.
export const hasCompleteSystemCapture = (
  value: unknown,
  generation: string,
): boolean => {
  if (!value || typeof value !== 'object') return false;
  const journal = value as {
    schemaVersion?: unknown;
    generation?: unknown;
    lifecycleState?: unknown;
    sourceAvailability?: { system?: unknown };
    intervals?: Array<{ sources?: { system?: { disposition?: unknown } } }>;
  };
  return (
    (journal.schemaVersion === 3 || journal.schemaVersion === 4) &&
    Boolean(generation) &&
    journal.generation === generation &&
    journal.lifecycleState === 'sealed' &&
    journal.sourceAvailability?.system === 'available' &&
    Array.isArray(journal.intervals) &&
    journal.intervals.length > 0 &&
    journal.intervals.every((interval) =>
      ['captured', 'verified_silence'].includes(
        String(interval?.sources?.system?.disposition),
      ),
    )
  );
};
