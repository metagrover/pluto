/** Process restart is a fallback after the native tap's own recovery window. */
export const createNativeAudioRecovery = (input: {
  isActive: () => boolean;
  stopCapture: () => Promise<unknown>;
  startCapture: () => Promise<unknown>;
  onRecovering: () => void;
  onFailed: () => void;
}) => {
  let attempts = 0;
  let pending: Promise<void> | null = null;
  const recover = (): Promise<void> => {
    if (pending) return pending;
    if (!input.isActive()) return Promise.resolve();
    // Bound process churn across the entire meeting, including repeated stalls.
    if (attempts >= 2) {
      input.onFailed();
      return Promise.resolve();
    }
    attempts += 1;
    pending = Promise.resolve()
      .then(async () => {
        if (!input.isActive()) return;
        input.onRecovering();
        try {
          const stopped = await input.stopCapture();
          if (!input.isActive()) return;
          if (stopped === false) {
            input.onFailed();
            return;
          }
          const ready = await input.startCapture();
          if (input.isActive() && ready !== true) input.onFailed();
        } catch {
          if (input.isActive()) input.onFailed();
        }
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
  return { recover, isRecovering: () => pending !== null };
};
