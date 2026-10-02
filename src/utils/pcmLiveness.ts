/** Transport health uses finite PCM frames, including digital silence. */
export const createPcmLivenessMonitor = (
  onTimeout: () => void,
  timeoutMs = 3000,
  onPersistentTimeout?: () => void,
) => {
  let stopped = false;
  let timedOut = false;
  let lastReceivedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    timer = null;
    if (stopped) return;
    const remaining = timeoutMs - (performance.now() - lastReceivedAt);
    if (remaining > 0) {
      timer = setTimeout(check, remaining);
      return;
    }
    if (timedOut) {
      onPersistentTimeout?.();
      return;
    }
    timedOut = true;
    onTimeout();
    // Give the native tap watchdog another window to recover before restarting.
    if (!stopped && onPersistentTimeout) {
      timer = setTimeout(check, timeoutMs);
    }
  };
  timer = setTimeout(check, timeoutMs);
  return {
    received(samples: Float32Array): boolean {
      if (stopped || samples.length === 0 || !samples.every(Number.isFinite)) {
        return false;
      }
      lastReceivedAt = performance.now();
      timedOut = false;
      // Healthy PCM updates a timestamp, rather than allocating a timer per frame.
      if (timer === null) timer = setTimeout(check, timeoutMs);
      return true;
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
