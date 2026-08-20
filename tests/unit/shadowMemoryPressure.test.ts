import { describe, expect, it } from 'vitest';

import {
  CachedMemoryPressureFreePercent,
  selectShadowFreePercent,
} from '../../electron/transcription/shadowMemoryPressure';

describe('shadow memory pressure sampling', () => {
  it('uses a trustworthy macOS pressure percentage over lower os free memory', () => {
    expect(
      selectShadowFreePercent({
        memoryPressureFreePercent: 20,
        osFreePercent: 9,
      }),
    ).toBe(20);
  });

  it('falls back to os free memory when no pressure result is available', () => {
    expect(
      selectShadowFreePercent({
        memoryPressureFreePercent: undefined,
        osFreePercent: 9,
      }),
    ).toBe(9);
  });

  it('updates the cached value asynchronously without making reads wait', async () => {
    let resolveProbe: (value: number | null) => void = () => {};
    const cache = new CachedMemoryPressureFreePercent(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );

    cache.refresh();
    expect(cache.current()).toBeUndefined();

    resolveProbe(20);
    await Promise.resolve();
    expect(cache.current()).toBe(20);
  });

  it('clears the cached value when the next pressure probe is unavailable', async () => {
    const results = [20, null];
    const cache = new CachedMemoryPressureFreePercent(
      async () => results.shift() ?? null,
    );

    cache.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.current()).toBe(20);

    cache.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.current()).toBeUndefined();
  });
});
