export const prepareFinalTranscriptionBeforeRecovery = async (input: {
  shouldPrepare: boolean;
  prepare: () => Promise<unknown>;
  recover: () => Promise<unknown>;
}): Promise<
  | { prepared: true }
  | {
      prepared: false;
      reason: 'parakeet_prepare_failed' | 'setup_incomplete';
    }
> => {
  if (!input.shouldPrepare) {
    await input.recover();
    return { prepared: false, reason: 'setup_incomplete' };
  }
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
