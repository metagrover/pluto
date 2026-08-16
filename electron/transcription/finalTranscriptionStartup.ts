export const prepareFinalTranscriptionBeforeRecovery = async (input: {
  prepare: () => Promise<unknown>;
  recover: () => Promise<unknown>;
}): Promise<
  { prepared: true } | { prepared: false; reason: 'parakeet_prepare_failed' }
> => {
  let prepared = true;
  try {
    await input.prepare();
  } catch {
    prepared = false;
  }
  await input.recover();
  return prepared
    ? { prepared: true }
    : { prepared: false, reason: 'parakeet_prepare_failed' };
};
