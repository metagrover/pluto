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

export const persistLatencyAndDerivedIntelligence = async <
  Artifacts,
  DerivedOutcome,
>(params: {
  persistTranscript: () => Promise<unknown>;
  patchLatency: () => Promise<LatencyPatchOutcome>;
  runDownstream: () => Promise<Artifacts>;
  persistDerived: () => Promise<DerivedOutcome>;
}): Promise<{
  artifacts: Artifacts;
  patchOutcome: LatencyPatchOutcome;
  derivedOutcome: DerivedOutcome | 'suppressed';
}> => {
  await params.persistTranscript();
  const [patchOutcome, artifacts] = await Promise.all([
    params.patchLatency(),
    params.runDownstream(),
  ]);
  const derivedOutcome =
    patchOutcome === 'updated' || patchOutcome === 'already_current'
      ? await params.persistDerived()
      : 'suppressed';
  return { artifacts, patchOutcome, derivedOutcome };
};
