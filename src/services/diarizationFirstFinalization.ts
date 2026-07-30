export const persistAttributedTranscriptBeforeDownstream = async <T>(params: {
  persistTranscript: () => Promise<unknown>;
  runDownstream: () => Promise<T>;
}): Promise<T> => {
  await params.persistTranscript();
  return await params.runDownstream();
};
