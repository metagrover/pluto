export const startBoundedSampler = (
  sample: () => void,
  intervalMs: number,
): (() => void) => {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('bounded_sampler_invalid_interval');
  }

  sample();
  const interval = globalThis.setInterval(sample, intervalMs);
  return () => globalThis.clearInterval(interval);
};
