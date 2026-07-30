export const persistAttributedTranscriptBeforeDownstream = async <T>(params: {
  persistTranscript: () => Promise<unknown>;
  runDownstream: () => Promise<T>;
}): Promise<T> => {
  await params.persistTranscript();
  return await params.runDownstream();
};

export type LatencyPatchOutcome =
  | 'updated'
  | 'already_current'
  | 'conflict'
  | 'missing'
  | 'failed';

export const persistTranscriptThenRunLatencyPatchAndDownstream = async <
  Downstream,
>(params: {
  persistTranscript: () => Promise<unknown>;
  patchLatency: () => Promise<LatencyPatchOutcome>;
  runDownstream: () => Promise<Downstream>;
}): Promise<{
  patchOutcome: LatencyPatchOutcome;
  downstream: Downstream;
}> => {
  await params.persistTranscript();
  const [patchOutcome, downstream] = await Promise.all([
    params.patchLatency(),
    params.runDownstream(),
  ]);
  return { patchOutcome, downstream };
};

export const persistDerivedAfterLatencyPatch = async <Result>(params: {
  patchOutcome: LatencyPatchOutcome;
  persistDerived: () => Promise<Result>;
}): Promise<
  { outcome: 'persisted'; result: Result } | { outcome: 'suppressed' }
> => {
  if (
    params.patchOutcome !== 'updated' &&
    params.patchOutcome !== 'already_current'
  ) {
    return { outcome: 'suppressed' };
  }
  return { outcome: 'persisted', result: await params.persistDerived() };
};
