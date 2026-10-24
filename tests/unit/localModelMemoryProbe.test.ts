import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createLocalModelMemoryProbe,
  setLocalModelMemoryProbeReader,
} from '../../electron/llm/localModelMemoryProbe';

const valid = (percentage = 50) => ({
  wallTimeMs: Date.now(),
  memoryPressureFreePercent: percentage,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setLocalModelMemoryProbeReader(() => valid());
});
afterEach(() => {
  setLocalModelMemoryProbeReader();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('reads the kernel immediately at startup and anew on every guard decision', async () => {
  const reader = vi.fn(() => valid(42));
  setLocalModelMemoryProbeReader(reader);
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await probe.start();
  expect(reader).toHaveBeenCalledOnce();
  vi.setSystemTime(Date.now() + 150);
  expect(probe.read()).toBe(42);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  expect(failure).not.toHaveBeenCalled();
  await probe.dispose();
});

it.each([0, 100])('accepts valid kernel percentage %s', async (percentage) => {
  setLocalModelMemoryProbeReader(() => valid(percentage));
  const probe = createLocalModelMemoryProbe(vi.fn());
  await probe.start();
  expect(probe.read()).toBe(percentage);
  await probe.dispose();
});

it.each([
  null,
  undefined,
  {},
  50,
  { wallTimeMs: 'today', memoryPressureFreePercent: 50 },
  { wallTimeMs: Number.NaN, memoryPressureFreePercent: 50 },
  { wallTimeMs: Number.POSITIVE_INFINITY, memoryPressureFreePercent: 50 },
  { wallTimeMs: 1792497600000.5, memoryPressureFreePercent: 50 },
  { wallTimeMs: 1792497600000, memoryPressureFreePercent: -1 },
  { wallTimeMs: 1792497600000, memoryPressureFreePercent: 101 },
  { wallTimeMs: 1792497600000, memoryPressureFreePercent: 50.5 },
  { wallTimeMs: 1792497600000, memoryPressureFreePercent: Number.NaN },
  { wallTimeMs: 1792497600000, memoryPressureFreePercent: '50' },
])('fails closed once on invalid native result %j', async (sample) => {
  const reader = vi.fn(() => sample);
  const failure = vi.fn();
  setLocalModelMemoryProbeReader(reader);
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start()).rejects.toThrow('sample unavailable');
  expect(() => probe.read()).toThrow('sample unavailable');
  expect(reader).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
});

it.each([-1, 0, 100, 101])(
  'preserves exact consumer freshness boundary at age %s',
  async (age) => {
    setLocalModelMemoryProbeReader(() => ({
      ...valid(),
      wallTimeMs: Date.now() - age,
    }));
    const failure = vi.fn();
    const probe = createLocalModelMemoryProbe(failure);
    if (age >= 0 && age <= 100) {
      await probe.start();
      expect(probe.read()).toBe(50);
      expect(failure).not.toHaveBeenCalled();
    } else {
      await expect(probe.start()).rejects.toThrow('sample unavailable');
      expect(failure).toHaveBeenCalledOnce();
    }
    await probe.dispose();
  },
);

it('timestamps before native work and rejects a syscall or scheduling delay over100ms', async () => {
  setLocalModelMemoryProbeReader(() => {
    const sample = valid();
    vi.setSystemTime(Date.now() + 101);
    return sample;
  });
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start()).rejects.toThrow('sample unavailable');
  expect(console.warn).toHaveBeenCalledWith(
    '[Local memory monitor]',
    expect.objectContaining({ reason: 'stale_sample', sampleAgeMs: 101 }),
  );
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
});

it('does not rescue a stale read by retrying for another native sample', async () => {
  const reader = vi
    .fn()
    .mockImplementationOnce(() => valid())
    .mockImplementationOnce(() => ({
      ...valid(),
      wallTimeMs: Date.now() - 101,
    }))
    .mockImplementation(() => valid());
  setLocalModelMemoryProbeReader(reader);
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await probe.start();
  expect(() => probe.read()).toThrow('sample unavailable');
  expect(() => probe.read()).toThrow('sample unavailable');
  expect(reader).toHaveBeenCalledTimes(2);
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
});

it('fails before admission when an old or missing addon provides no reader', async () => {
  setLocalModelMemoryProbeReader();
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start()).rejects.toThrow('sample unavailable');
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('fails closed once if the native export throws', async () => {
  const reader = vi.fn(() => {
    throw Error('sysctl unavailable');
  });
  setLocalModelMemoryProbeReader(reader);
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start()).rejects.toThrow('sample unavailable');
  expect(() => probe.read()).toThrow();
  expect(reader).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
});

it('cancels startup before calling native code', async () => {
  const reader = vi.fn(() => valid());
  setLocalModelMemoryProbeReader(reader);
  const controller = new AbortController();
  controller.abort();
  const probe = createLocalModelMemoryProbe(vi.fn());
  await expect(probe.start(controller.signal)).rejects.toThrow('cancelled');
  expect(reader).not.toHaveBeenCalled();
  await probe.dispose();
});
it('honors caller cancellation during synchronous startup before inference can start', async () => {
  const controller = new AbortController();
  setLocalModelMemoryProbeReader(() => {
    controller.abort(Error('caller cancelled'));
    return valid();
  });
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start(controller.signal)).rejects.toThrow(
    'caller cancelled',
  );
  expect(failure).not.toHaveBeenCalled();
  await probe.dispose();
});
it('disposes idempotently and never samples or reports a later failure', async () => {
  const reader = vi.fn(() => valid());
  setLocalModelMemoryProbeReader(reader);
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await probe.start();
  await probe.dispose();
  await probe.dispose();
  expect(() => probe.read()).toThrow();
  await expect(probe.start()).rejects.toThrow('cancelled');
  expect(reader).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});
it('isolates the captured reader from later registration for another workload', async () => {
  const first = vi.fn(() => valid(35));
  setLocalModelMemoryProbeReader(first);
  const old = createLocalModelMemoryProbe(vi.fn());
  await old.start();
  setLocalModelMemoryProbeReader(() => valid(70));
  const next = createLocalModelMemoryProbe(vi.fn());
  await next.start();
  expect(old.read()).toBe(35);
  expect(next.read()).toBe(70);
  await old.dispose();
  await next.dispose();
});
it('still invokes cancellation if diagnostic output throws', async () => {
  vi.mocked(console.warn).mockImplementation(() => {
    throw Error('closed output');
  });
  setLocalModelMemoryProbeReader(() => null);
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await expect(probe.start()).rejects.toThrow('sample unavailable');
  expect(failure).toHaveBeenCalledOnce();
  await probe.dispose();
});
