type KernelMemorySample = {
  wallTimeMs: number;
  memoryPressureFreePercent: number;
};

let nativeReader: (() => unknown) | undefined;
export const setLocalModelMemoryProbeReader = (read?: () => unknown): void => {
  nativeReader = read;
};

/** Read on the decision thread; never reuse a background producer's sample. */
export const createLocalModelMemoryProbe = (onFailure: () => void) => {
  let reader: (() => unknown) | undefined;
  let started = false;
  let disposed = false;
  let invalid = false;
  const fail = (reason: string, sample?: KernelMemorySample): never => {
    if (!invalid && !disposed) {
      invalid = true;
      const nowMs = Date.now();
      try {
        console.warn('[Local memory monitor]', {
          reason,
          nowMs,
          sampleWallTimeMs: sample?.wallTimeMs ?? null,
          sampleAgeMs: sample ? nowMs - sample.wallTimeMs : null,
          memoryPressureFreePercent: sample?.memoryPressureFreePercent ?? null,
          disposed,
        });
      } catch {
        // Closed diagnostic output must not prevent cancellation.
      }
      onFailure();
    }
    throw new Error('Local memory monitor sample unavailable.');
  };
  const read = (): number => {
    if (disposed || invalid || !started)
      throw new Error('Local memory monitor sample unavailable.');
    if (!reader) return fail('native_reader_unavailable');
    let value: unknown;
    try {
      value = reader();
    } catch {
      return fail('native_read_error');
    }
    const sample = value as KernelMemorySample | null;
    if (
      !sample ||
      !Number.isSafeInteger(sample.wallTimeMs) ||
      !Number.isInteger(sample.memoryPressureFreePercent) ||
      sample.memoryPressureFreePercent < 0 ||
      sample.memoryPressureFreePercent > 100
    )
      return fail('invalid_sample');
    const age = Date.now() - sample.wallTimeMs;
    if (age < 0 || age > 100)
      return fail(age < 0 ? 'future_sample' : 'stale_sample', sample);
    return sample.memoryPressureFreePercent;
  };
  return {
    read,
    start: async (signal?: AbortSignal): Promise<void> => {
      if (disposed || signal?.aborted)
        throw new Error('Local memory monitor cancelled.');
      if (!started) {
        reader = nativeReader;
        started = true;
      }
      read();
      signal?.throwIfAborted();
    },
    dispose: async (): Promise<void> => {
      disposed = true;
      reader = undefined;
    },
  };
};
