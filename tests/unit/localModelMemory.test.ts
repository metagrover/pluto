import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  LocalModelMemoryError,
  assertLocalModelMemoryCapacity,
  getEstablishedGemmaLoadOptions,
  readContextBytesPerToken,
  readLocalModelMemory,
  usesQuickModelHeadroom,
  watchLocalModelMemory,
} from '../../electron/llm/localModelMemory';
import * as memoryProbe from '../../electron/llm/localModelMemoryProbe';

const GIB = 1024 ** 3;
afterEach(() => {
  vi.restoreAllMocks();
  memoryProbe.setLocalModelMemoryProbeReader();
  vi.useRealTimers();
});

it.each([
  { platform: 'darwin', total: 16 * GIB, known: true, bounded: true },
  { platform: 'darwin', total: 8 * GIB, known: true, bounded: true },
  { platform: 'darwin', total: 24 * GIB, known: true, bounded: false },
  { platform: 'linux', total: 16 * GIB, known: true, bounded: false },
  { platform: 'darwin', total: 16 * GIB, known: false, bounded: false },
  { platform: 'darwin', total: 0, known: true, bounded: false },
  { platform: 'darwin', total: Number.NaN, known: true, bounded: false },
  {
    platform: 'darwin',
    total: Number.POSITIVE_INFINITY,
    known: true,
    bounded: false,
  },
])(
  'bounds only the established Gemma artifact on supported Mac memory ($platform, $total, $known)',
  ({ platform, total, known, bounded }) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: platform });
    vi.spyOn(os, 'totalmem').mockReturnValue(total);
    try {
      expect(
        getEstablishedGemmaLoadOptions(
          known
            ? '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c'
            : 'different-artifact',
        ),
      ).toEqual(bounded ? { num_gpu: 16, use_mmap: true } : undefined);
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  },
);

it('admits the established Gemma artifact with cold runtime headroom and reserve', () => {
  const memory = {
    available: 14 * GIB,
    total: 16 * GIB,
    contextTokens: 8192,
    resident: false,
    modelBytes: 7_556_508_396,
    modelDigest:
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
  };
  expect(() => assertLocalModelMemoryCapacity(memory)).not.toThrow();
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, available: 10 * GIB }),
  ).toThrow('Not enough memory');
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      modelDigest: 'different-artifact',
    }),
  ).toThrow('Not enough memory');
});

it('reports a smaller cold context only when the unchanged admission rule admits it', () => {
  const total = 16 * GIB;
  const modelBytes = 7_556_508_396;
  const memory = {
    total,
    modelBytes,
    modelDigest:
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    resident: false,
    contextTokens: 16384,
    available: modelBytes + 2 * GIB + 8192 * 64 * 1024 + total * 0.08 + 1,
  };
  let refusal: unknown;
  try {
    assertLocalModelMemoryCapacity(memory);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(Error);
  expect(refusal).toHaveProperty('maxContextTokens', 8192);
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, contextTokens: 8192 }),
  ).not.toThrow();
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, contextTokens: 8193 }),
  ).toThrow('Not enough memory');
});

it.each([
  { resident: false, available: 10 * GIB },
  { resident: true, available: 3 * GIB },
])(
  'does not suggest shrinking when context is not the limiting allocation ($resident)',
  (state) => {
    try {
      assertLocalModelMemoryCapacity({
        ...state,
        total: 16 * GIB,
        modelBytes: 7_556_508_396,
        modelDigest:
          '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
        contextTokens: 16384,
      });
      expect.fail('Expected the unchanged memory guard to refuse');
    } catch (error) {
      expect(error).toHaveProperty('name', 'LocalModelMemoryError');
      expect(error).toHaveProperty('maxContextTokens', undefined);
    }
  },
);

it('does not charge allocated context again but retains the watchdog headroom for warm reuse', () => {
  const memory = {
    available: 5 * GIB,
    total: 16 * GIB,
    modelBytes: 7_556_508_396,
    resident: true,
    contextTokens: 16384,
  };
  expect(() => assertLocalModelMemoryCapacity(memory)).not.toThrow();
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, available: 3.2 * GIB }),
  ).toThrow('Not enough memory');
});

it('blocks a cold 12B load on 16 GiB while admitting a smaller model with reserve', () => {
  const memory = {
    available: 10 * GIB,
    total: 16 * GIB,
    contextTokens: 4096,
    resident: false,
  };
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, modelBytes: 7.5 * GIB }),
  ).toThrow('Not enough memory');
  expect(() =>
    assertLocalModelMemoryCapacity({ ...memory, modelBytes: 1.5 * GIB }),
  ).not.toThrow();
});

it('refuses an unknown artifact when its conservative cold estimate consumes reserve', () => {
  expect(() =>
    assertLocalModelMemoryCapacity({
      available: 8 * GIB,
      total: 16 * GIB,
      modelBytes: 2_491_876_774,
      resident: false,
      contextTokens: 4096,
    }),
  ).toThrow('Not enough memory');
});

it('accounts for existing target residency without spending the system reserve', () => {
  expect(() =>
    assertLocalModelMemoryCapacity({
      available: 5 * GIB,
      total: 16 * GIB,
      modelBytes: 7.5 * GIB,
      resident: true,
      contextTokens: 4096,
    }),
  ).not.toThrow();
  expect(() =>
    assertLocalModelMemoryCapacity({
      available: 3 * GIB,
      total: 16 * GIB,
      modelBytes: 7.5 * GIB,
      resident: true,
      contextTokens: 4096,
    }),
  ).toThrow('Not enough memory');
});

it.each([
  { available: 3.2 * GIB, aborted: true },
  { available: 3.5 * GIB, aborted: false },
  { available: Number.NaN, aborted: true },
])(
  'keeps warm admission and the early watchdog threshold consistent ($available bytes)',
  async ({ available, aborted }) => {
    vi.useFakeTimers();
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    vi.spyOn(os, 'freemem').mockReturnValue(available);
    // Exercise the portable fallback without executing a system command.
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const guard = watchLocalModelMemory();
    guard.start();
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(guard.signal.aborted).toBe(aborted);
      if (aborted) {
        expect(guard.signal.reason.message).toContain('protect system memory');
      }
    } finally {
      guard.dispose();
      Object.defineProperty(process, 'platform', descriptor);
    }
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('reserves runtime headroom before an 8B load even when its file alone fits', () => {
  expect(() =>
    assertLocalModelMemoryCapacity({
      available: 12 * GIB,
      total: 16 * GIB,
      modelBytes: 5.6 * GIB,
      resident: false,
      contextTokens: 16384,
    }),
  ).toThrow('Not enough memory');
});

it('refuses macOS admission rather than substituting raw free pages when native memory is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  const free = vi.spyOn(os, 'freemem').mockReturnValue(14 * GIB);
  memoryProbe.setLocalModelMemoryProbeReader();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(readLocalModelMemory()).rejects.toMatchObject({
      name: 'LocalModelMemoryError',
    });
    expect(free).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});

it('preserves portable admission outside macOS without a native export', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  vi.spyOn(os, 'freemem').mockReturnValue(3 * GIB);
  try {
    await expect(readLocalModelMemory()).resolves.toEqual({
      total: 16 * GIB,
      available: 3 * GIB,
    });
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});

it.each([
  { total: 8 * GIB, floor: GIB },
  { total: 16 * GIB, floor: 16 * GIB * 0.08 },
  { total: 64 * GIB, floor: 64 * GIB * 0.08 },
])(
  'retains the shared native admission floor with warm reaction headroom ($total bytes)',
  ({ total, floor }) => {
    const memory = {
      available: floor + 2 * GIB,
      total,
      modelBytes: 7_556_508_396,
      resident: true,
      contextTokens: 16384,
    };
    expect(() => assertLocalModelMemoryCapacity(memory)).not.toThrow();
    expect(() =>
      assertLocalModelMemoryCapacity({
        ...memory,
        available: memory.available - 1,
      }),
    ).toThrow('Not enough memory');
  },
);

it.each([
  { available: Number.NaN, total: 16 * GIB },
  { available: Number.POSITIVE_INFINITY, total: 16 * GIB },
  { available: -GIB, total: 16 * GIB },
  { available: 16 * GIB, total: Number.NaN },
  { available: 16 * GIB, total: Number.POSITIVE_INFINITY },
  { available: 16 * GIB, total: 0 },
])(
  'rejects invalid memory readings through shared admission ($available, $total)',
  (memory) => {
    expect(() =>
      assertLocalModelMemoryCapacity({
        ...memory,
        modelBytes: GIB,
        resident: true,
        contextTokens: 4096,
      }),
    ).toThrow('Not enough memory');
  },
);

it('applies the shared reserve to memory remaining after the cold allocation estimate', () => {
  const coldAllocation = GIB * 2.5 + GIB + 4096 * 64 * 1024;
  const memory = {
    available: coldAllocation + 16 * GIB * 0.08,
    total: 16 * GIB,
    modelBytes: GIB,
    resident: false,
    contextTokens: 4096,
  };
  expect(() => assertLocalModelMemoryCapacity(memory)).not.toThrow();
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      available: memory.available - 1,
    }),
  ).toThrow('Not enough memory');
});

it.each([
  {
    digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    resident: false,
    available: 3 * GIB,
    fail: false,
    aborted: true,
  },
  {
    digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    resident: true,
    available: 3 * GIB,
    fail: false,
    aborted: false,
  },
  {
    digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    resident: true,
    available: 2 * GIB,
    fail: false,
    aborted: true,
  },
  {
    digest: 'unknown-artifact',
    resident: true,
    available: 3 * GIB,
    fail: false,
    aborted: true,
  },
  {
    digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    resident: true,
    available: 3 * GIB,
    fail: true,
    aborted: true,
  },
])(
  'uses steady-state headroom only after the established artifact is verified resident ($resident, $available, $fail, $digest)',
  async ({ digest, resident, available, fail, aborted }) => {
    vi.useFakeTimers();
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    vi.spyOn(os, 'freemem').mockReturnValue(available);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const guard = watchLocalModelMemory();
    guard.start();
    const probe = vi.fn(async () => {
      if (fail) throw new Error('residency unavailable');
      return resident;
    });
    guard.setResidentCheck(digest, probe);
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(guard.signal.aborted).toBe(aborted);
      if (digest === 'unknown-artifact') expect(probe).not.toHaveBeenCalled();
    } finally {
      guard.dispose();
      Object.defineProperty(process, 'platform', descriptor);
    }
  },
);

it('ignores a resident check that finishes after disposal', async () => {
  vi.useFakeTimers();
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  vi.spyOn(os, 'freemem').mockReturnValue(4 * GIB);
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  let finish!: (resident: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const guard = watchLocalModelMemory();
  guard.start();
  guard.setResidentCheck(
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    () => pending,
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    guard.dispose();
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(guard.signal.aborted).toBe(false);
  } finally {
    guard.dispose();
    Object.defineProperty(process, 'platform', descriptor);
  }
});

it('does not apply loading pressure checks before model admission starts the watcher', async () => {
  vi.useFakeTimers();
  const guard = watchLocalModelMemory();
  await vi.advanceTimersByTimeAsync(500);
  expect(guard.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  guard.dispose();
  guard.start();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, 58, 100])(
  'uses the same validated kernel percentage for cold admission: %s',
  async (percent) => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    const reader = vi.fn(() => ({
      wallTimeMs: Date.now(),
      memoryPressureFreePercent: percent,
    }));
    memoryProbe.setLocalModelMemoryProbeReader(reader);
    try {
      await expect(readLocalModelMemory()).resolves.toEqual({
        total: 16 * GIB,
        available: (16 * GIB * percent) / 100,
      });
      expect(reader).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  },
);
it.each(['throw', 'stale', 'future', 'invalid'])(
  'refuses invalid cold native sample %s with a typed memory error',
  async (kind) => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    memoryProbe.setLocalModelMemoryProbeReader(() => {
      if (kind === 'throw') throw Error('kernel unavailable');
      return {
        wallTimeMs:
          Date.now() + (kind === 'stale' ? -101 : kind === 'future' ? 1 : 0),
        memoryPressureFreePercent: kind === 'invalid' ? 101 : 50,
      };
    });
    try {
      await expect(readLocalModelMemory()).rejects.toMatchObject({
        name: 'LocalModelMemoryError',
      });
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  },
);

it.each([
  { percent: 21, fail: false },
  { percent: 20, fail: true },
])(
  'checks the unchanged loading floor immediately after native monitor readiness ($percent)',
  async ({ percent, fail }) => {
    vi.useFakeTimers();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
    let ready!: () => void;
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const dispose = vi.fn(async () => {});
    const factory = vi
      .spyOn(memoryProbe, 'createLocalModelMemoryProbe')
      .mockReturnValue({ read: () => percent, start: () => pending, dispose });
    const guard = watchLocalModelMemory();
    let finished = false;
    const start = guard.start().then(
      () => {
        finished = true;
        return 'ready';
      },
      () => 'refused',
    );
    expect(finished).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    ready();
    expect(await start).toBe(fail ? 'refused' : 'ready');
    expect(guard.signal.aborted).toBe(fail);
    await guard.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    factory.mockRestore();
    Object.defineProperty(process, 'platform', platform);
  },
);

it('aborts the native watchdog when the last fresh sample becomes unavailable', async () => {
  vi.useFakeTimers();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  const read = vi.fn(() => 50);
  const factory = vi
    .spyOn(memoryProbe, 'createLocalModelMemoryProbe')
    .mockReturnValue({ read, start: async () => {}, dispose: async () => {} });
  const guard = watchLocalModelMemory();
  await guard.start();
  read.mockImplementation(() => {
    throw new Error('stale');
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(guard.signal.aborted).toBe(true);
  await guard.dispose();
  factory.mockRestore();
  Object.defineProperty(process, 'platform', platform);
});

it('refreshes residency before its proof expires despite reserve timer jitter', async () => {
  vi.useFakeTimers();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  const read = vi.fn(() => 50);
  vi.spyOn(memoryProbe, 'createLocalModelMemoryProbe').mockReturnValue({
    read,
    start: async () => {},
    dispose: async () => {},
  });
  const guard = watchLocalModelMemory();
  const check = vi.fn(async () => true);
  guard.setResidentCheck(
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    check,
  );
  try {
    await guard.start();
    await vi.advanceTimersByTimeAsync(99);
    read.mockReturnValue(20);
    vi.setSystemTime(Date.now() + 3);
    await vi.advanceTimersByTimeAsync(1);
    expect(guard.signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    // A stalled proof still expires under the original 100 ms limit.
    check.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(200);
    expect(guard.signal.aborted).toBe(true);
  } finally {
    await guard.dispose();
    Object.defineProperty(process, 'platform', platform);
  }
});

it('checks the native reserve every100ms while one residency request remains pending', async () => {
  vi.useFakeTimers();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  const read = vi.fn(() => 50);
  vi.spyOn(memoryProbe, 'createLocalModelMemoryProbe').mockReturnValue({
    read,
    start: async () => {},
    dispose: async () => {},
  });
  const guard = watchLocalModelMemory();
  await guard.start();
  let finish!: (resident: boolean) => void;
  const check = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  guard.setResidentCheck(
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    check,
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(guard.signal.aborted).toBe(false);
    read.mockReturnValue(18);
    await vi.advanceTimersByTimeAsync(100);
    expect(guard.signal.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(check).toHaveBeenCalledOnce();
    finish(true);
  } finally {
    await guard.dispose();
    Object.defineProperty(process, 'platform', platform);
  }
});

it('never reuses a previous workload residency result or overlaps its lookup', async () => {
  vi.useFakeTimers();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  const read = vi.fn(() => 50);
  vi.spyOn(memoryProbe, 'createLocalModelMemoryProbe').mockReturnValue({
    read,
    start: async () => {},
    dispose: async () => {},
  });
  const guard = watchLocalModelMemory();
  await guard.start();
  let finish!: (resident: boolean) => void;
  const oldCheck = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const currentCheck = vi.fn(async () => false);
  const digest =
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
  guard.setResidentCheck(digest, oldCheck);
  await vi.advanceTimersByTimeAsync(0);
  guard.setResidentCheck(digest, currentCheck);
  try {
    expect(currentCheck).not.toHaveBeenCalled();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    read.mockReturnValue(18);
    await vi.advanceTimersByTimeAsync(100);
    expect(guard.signal.aborted).toBe(true);
    expect(oldCheck).toHaveBeenCalledOnce();
    expect(currentCheck).toHaveBeenCalledTimes(2);
  } finally {
    await guard.dispose();
    Object.defineProperty(process, 'platform', platform);
  }
});

it('does not read queued old native data from a residency completion microtask', async () => {
  vi.useFakeTimers();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  let sampleTime = Date.now();
  const read = vi.fn(() => {
    if (Date.now() - sampleTime > 100) throw new Error('stale native sample');
    return 50;
  });
  vi.spyOn(memoryProbe, 'createLocalModelMemoryProbe').mockReturnValue({
    read,
    start: async () => {},
    dispose: async () => {},
  });
  const guard = watchLocalModelMemory();
  await guard.start();
  let finish!: (resident: boolean) => void;
  guard.setResidentCheck(
    '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 176);
    finish(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    expect(guard.signal.aborted).toBe(false);
    // The next pipe event publishes its latest sample before the next reserve tick.
    sampleTime = Date.now() + 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
    expect(guard.signal.aborted).toBe(false);
  } finally {
    await guard.dispose();
    Object.defineProperty(process, 'platform', platform);
  }
});

it('admits from a measured cold-load peak only when it is smaller than the estimate', () => {
  const memory = {
    available: 10.6 * GIB,
    total: 16 * GIB,
    contextTokens: 8192,
    resident: false,
    modelBytes: 7_556_508_396,
    modelDigest:
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
  };
  // The file-size estimate refuses 10.6 GiB available after the reserve.
  expect(() => assertLocalModelMemoryCapacity(memory)).toThrow(
    'Not enough memory',
  );
  // A 7 GiB measured peak at the same context, plus 20 percent, fits.
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      measuredColdPeak: { bytes: 7 * GIB, contextTokens: 8192 },
    }),
  ).not.toThrow();
  // A larger requested context adds its allowance to the measured peak.
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      contextTokens: 32_768,
      measuredColdPeak: { bytes: 7 * GIB, contextTokens: 8192 },
    }),
  ).toThrow('Not enough memory');
  // A measured peak larger than the estimate never loosens admission.
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      available: 14 * GIB,
      measuredColdPeak: { bytes: 12 * GIB, contextTokens: 8192 },
    }),
  ).not.toThrow();
});

// phi4-mini 3.8B as Ollama 0.40 reports it; its 4,096-token load allocated
// 2,849 MiB of weights, 512 MiB of cache and 104 MiB of compute buffers.
const PHI4_MINI_INFO = {
  'general.architecture': 'phi3',
  'phi3.block_count': 32,
  'phi3.attention.head_count': 24,
  'phi3.attention.head_count_kv': 8,
  'phi3.embedding_length': 3072,
};
const PHI4_MINI_BYTES = 2_491_876_774;

it.each([
  { name: 'derived head length', info: PHI4_MINI_INFO, bytes: 128 * 1024 },
  {
    name: 'explicit key and value length',
    info: {
      'general.architecture': 'llama',
      'llama.block_count': 28,
      'llama.attention.head_count': 24,
      'llama.attention.head_count_kv': 8,
      'llama.attention.key_length': 128,
      'llama.attention.value_length': 128,
      'llama.embedding_length': 3072,
    },
    bytes: 112 * 1024,
  },
  {
    name: 'per-layer cache heads',
    info: {
      'general.architecture': 'x',
      'x.block_count': 3,
      'x.attention.head_count_kv': [8, 1, 8],
      'x.attention.key_length': 64,
      'x.attention.value_length': 64,
    },
    bytes: 17 * 128 * 2,
  },
  { name: 'missing metadata', info: undefined, bytes: undefined },
  {
    name: 'unknown cache heads',
    info: { ...PHI4_MINI_INFO, 'phi3.attention.head_count_kv': undefined },
    bytes: undefined,
  },
  {
    name: 'mismatched per-layer heads',
    info: { ...PHI4_MINI_INFO, 'phi3.attention.head_count_kv': [8, 8] },
    bytes: undefined,
  },
])(
  'reads per-token cache bytes from model metadata ($name)',
  ({ info, bytes }) => {
    expect(readContextBytesPerToken(info)).toBe(bytes);
  },
);

it('sizes a known-layout model by its weights and real cache, not 2.5x its file', () => {
  const total = 16 * GIB;
  const contextBytesPerToken = readContextBytesPerToken(PHI4_MINI_INFO);
  const memory = {
    total,
    modelBytes: PHI4_MINI_BYTES,
    modelDigest: 'phi4-mini-artifact',
    resident: false,
    contextTokens: 16384,
    // Previously measured from the system-wide drop, inflated by other apps.
    measuredColdPeak: { bytes: 6_012_954_214, contextTokens: 4096 },
  };
  const required =
    PHI4_MINI_BYTES * 1.25 + 3 * GIB + 16384 * 128 * 1024 + total * 0.08;
  // Admission is exact at the real layout plus the watchdog's headroom.
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      available: required - 1,
      contextBytesPerToken,
    }),
  ).toThrow('Not enough memory');
  expect(() =>
    assertLocalModelMemoryCapacity({
      ...memory,
      available: required + 1,
      contextBytesPerToken,
    }),
  ).not.toThrow();
});

it('keeps the watchdog headroom after a known-layout cold load', () => {
  // Measured on a 16 GiB Mac: phi4-mini at 32K dropped availability from
  // about 10.2 GiB to 2.4 GiB, below the watchdog's 2 GiB + 8% stop line.
  const total = 16 * GIB;
  const contextBytesPerToken = readContextBytesPerToken(PHI4_MINI_INFO);
  try {
    assertLocalModelMemoryCapacity({
      total,
      available: 10.24 * GIB,
      modelBytes: PHI4_MINI_BYTES,
      modelDigest: 'phi4-mini-artifact',
      resident: false,
      contextTokens: 32768,
      contextBytesPerToken,
    });
    expect.fail('Expected a 32K load the watchdog would stop to be refused');
  } catch (error) {
    expect(error).toBeInstanceOf(LocalModelMemoryError);
    // A smaller context that leaves the headroom is still offered.
    expect(
      (error as LocalModelMemoryError).maxContextTokens,
    ).toBeGreaterThanOrEqual(16384);
  }
});

it('offers a smaller chat context without relaxing cold-load headroom', () => {
  const total = 16 * GIB;
  const request = {
    total,
    available: total * 0.48,
    modelBytes: PHI4_MINI_BYTES,
    resident: false,
    contextTokens: 4096,
    contextBytesPerToken: readContextBytesPerToken(PHI4_MINI_INFO),
  };
  expect(() => assertLocalModelMemoryCapacity(request)).toThrow(
    expect.objectContaining({ maxContextTokens: undefined }),
  );
  expect(() =>
    assertLocalModelMemoryCapacity({ ...request, minimumContextTokens: 2048 }),
  ).toThrow(expect.objectContaining({ maxContextTokens: 3072 }));
  expect(() =>
    assertLocalModelMemoryCapacity({ ...request, contextTokens: 3072 }),
  ).not.toThrow();
});

it('charges the real cache size when suggesting a smaller context', () => {
  const total = 16 * GIB;
  const contextBytesPerToken = 128 * 1024;
  try {
    assertLocalModelMemoryCapacity({
      total,
      modelBytes: PHI4_MINI_BYTES,
      resident: false,
      contextTokens: 16384,
      contextBytesPerToken,
      available:
        PHI4_MINI_BYTES * 1.25 +
        3 * GIB +
        8192 * contextBytesPerToken +
        total * 0.08 +
        1,
    });
    expect.fail('Expected a 16K context to be refused');
  } catch (error) {
    expect(error).toHaveProperty('maxContextTokens', 8192);
  }
});

it('keeps the established Gemma estimate when cache metadata is supplied', () => {
  const memory = {
    available: 11 * GIB,
    total: 16 * GIB,
    contextTokens: 8192,
    resident: false,
    modelBytes: 7_556_508_396,
    modelDigest:
      '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    contextBytesPerToken: 1,
  };
  // The generic 1.25x rule would refuse; Gemma keeps weights plus 2 GiB.
  expect(() => assertLocalModelMemoryCapacity(memory)).not.toThrow();
});

it.each([
  // Context, measured cold-load drop on a 16 GiB Mac.
  { contextTokens: 2048, measuredDrop: 3.04 * GIB },
  { contextTokens: 4096, measuredDrop: 3.68 * GIB },
  { contextTokens: 8192, measuredDrop: 4.0 * GIB },
])(
  'admits the quick model with less headroom and the watchdog keeps it ($contextTokens)',
  async ({ contextTokens, measuredDrop }) => {
    const total = 16 * GIB;
    const contextBytesPerToken = readContextBytesPerToken(PHI4_MINI_INFO);
    const request = {
      total,
      modelBytes: PHI4_MINI_BYTES,
      modelDigest: 'phi4-mini-artifact',
      resident: false,
      contextTokens,
      contextBytesPerToken,
    };
    // Lowest availability each rule admits, in 1/16 GiB steps.
    const lowestAdmitted = (quickModel: boolean) => {
      for (let available = 2 * GIB; available <= total; available += GIB / 16)
        try {
          assertLocalModelMemoryCapacity({ ...request, available, quickModel });
          return available;
        } catch {}
      return Number.POSITIVE_INFINITY;
    };
    const quick = lowestAdmitted(true);
    expect(lowestAdmitted(false) - quick).toBeGreaterThanOrEqual(1.4 * GIB);
    expect(
      usesQuickModelHeadroom({
        quickModel: true,
        modelDigest: 'phi4-mini-artifact',
        contextBytesPerToken,
        contextTokens,
      }),
    ).toBe(true);

    // After the measured load, the watchdog with the same margin keeps going.
    vi.useFakeTimers();
    vi.spyOn(os, 'totalmem').mockReturnValue(total);
    vi.spyOn(os, 'freemem').mockReturnValue(quick - measuredDrop);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const guard = watchLocalModelMemory();
    guard.setQuickModelHeadroom(true);
    guard.start();
    try {
      await vi.advanceTimersByTimeAsync(300);
      expect(guard.signal.aborted).toBe(false);
    } finally {
      guard.dispose();
      Object.defineProperty(process, 'platform', descriptor);
    }
  },
);

it.each([
  {
    name: 'large context',
    contextTokens: 16384,
    digest: 'phi4-mini-artifact',
    known: true,
  },
  {
    name: 'unknown layout',
    contextTokens: 4096,
    digest: 'phi4-mini-artifact',
    known: false,
  },
  {
    name: 'established Gemma',
    contextTokens: 4096,
    digest: '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
    known: true,
  },
])(
  'keeps the usual headroom for a quick model with a $name',
  ({ contextTokens, digest, known }) => {
    const contextBytesPerToken = known
      ? readContextBytesPerToken(PHI4_MINI_INFO)
      : undefined;
    expect(
      usesQuickModelHeadroom({
        quickModel: true,
        modelDigest: digest,
        contextBytesPerToken,
        contextTokens,
      }),
    ).toBe(false);
    const request = {
      total: 16 * GIB,
      modelBytes: PHI4_MINI_BYTES,
      modelDigest: digest,
      resident: false,
      contextTokens,
      contextBytesPerToken,
    };
    for (let available = 2 * GIB; available <= 16 * GIB; available += GIB / 4) {
      const outcome = (quickModel: boolean) => {
        try {
          assertLocalModelMemoryCapacity({ ...request, available, quickModel });
          return 'admitted';
        } catch {
          return 'refused';
        }
      };
      expect(outcome(true)).toBe(outcome(false));
    }
  },
);

it('stops a quick-model load the watchdog margin cannot cover', async () => {
  vi.useFakeTimers();
  vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB);
  // 8% of 16 GiB is 1.28 GiB; with the 1 GiB margin the stop line is 2.28 GiB.
  vi.spyOn(os, 'freemem').mockReturnValue(2.2 * GIB);
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const guard = watchLocalModelMemory();
  guard.setQuickModelHeadroom(true);
  guard.start();
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(guard.signal.aborted).toBe(true);
  } finally {
    guard.dispose();
    Object.defineProperty(process, 'platform', descriptor);
  }
});
