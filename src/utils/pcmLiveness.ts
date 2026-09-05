/** Transport health uses finite PCM frames, including digital silence. */
export const createPcmLivenessMonitor = (
  onTimeout: () => void,
  timeoutMs = 3000,
) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(onTimeout, timeoutMs);
  };
  arm();
  return {
    received(samples: Float32Array): boolean {
      if (stopped || samples.length === 0 || !samples.every(Number.isFinite)) {
        return false;
      }
      arm();
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
};
