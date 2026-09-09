import { describe, expect, it, vi } from 'vitest';
import {
  notesReplayResourceStop,
  parseNotesReplayResources,
  watchNotesReplayResources,
} from '../../scripts/lib/notesReplayResources';
const baseline = {
  swapUsedBytes: 3 * 1024 ** 3,
  memoryFreePercent: 20,
  thermalNominal: true,
};
describe('notes replay safety guard', () => {
  it.each(['before_read', 'during_read', 'dispose'])(
    'censors a monitoring gap %s without silently resuming',
    async (phase) => {
      vi.useFakeTimers();
      let now = 0;
      try {
        const stop = vi.fn();
        const record = vi.fn();
        const read = vi.fn(async () => {
          if (phase === 'during_read') now = 100;
          return baseline;
        });
        const dispose = watchNotesReplayResources({
          baseline,
          read,
          record,
          stop,
          now: () => now,
          intervalMs: 5,
          maxSampleGapMs: 30,
        });
        if (phase !== 'during_read') now = 100;
        if (phase !== 'dispose') await vi.advanceTimersByTimeAsync(5);
        await dispose();
        await dispose();
        expect(stop).toHaveBeenCalledExactlyOnceWith('resource_sampling_gap');
        expect(record).toHaveBeenCalledWith({
          event: 'resource_sampling_gap',
          gapMs: 100,
        });
        expect(
          record.mock.calls.some(
            ([event]) => event.event === 'resource_sample',
          ),
        ).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('parses telemetry and rejects missing evidence', () => {
    expect(
      parseNotesReplayResources(
        'used = 1024.00M',
        'System-wide memory free percentage: 19%',
        'No thermal warning level has been recorded\nNo performance warning level has been recorded',
      ),
    ).toMatchObject({
      swapUsedBytes: 1024 ** 3,
      memoryFreePercent: 19,
      thermalNominal: true,
    });
    expect(() => parseNotesReplayResources('', '', '')).toThrow(
      'resource_telemetry_unavailable',
    );
  });
  it('permits preexisting swap but stops growth, low headroom or warning', () => {
    expect(
      notesReplayResourceStop(
        { ...baseline, powerSource: 'ac' },
        { ...baseline, powerSource: 'battery' },
      ),
    ).toBe('power_source_changed');
    expect(notesReplayResourceStop(baseline, baseline)).toBeNull();
    expect(
      notesReplayResourceStop(baseline, {
        ...baseline,
        swapUsedBytes: baseline.swapUsedBytes + 513 * 1024 ** 2,
      }),
    ).toBe('swap_growth_exceeded');
    expect(
      notesReplayResourceStop(baseline, { ...baseline, memoryFreePercent: 9 }),
    ).toBe('low_memory_headroom');
    expect(
      notesReplayResourceStop(baseline, { ...baseline, thermalNominal: false }),
    ).toBe('thermal_or_performance_warning');
  });
  it('cancels once on bad telemetry and does not continue polling', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      const read = vi.fn(async () => {
        throw new Error('unavailable');
      });
      const dispose = watchNotesReplayResources({
        baseline,
        read,
        record: vi.fn(),
        stop,
        intervalMs: 5,
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(stop).toHaveBeenCalledExactlyOnceWith(
        'resource_telemetry_unavailable',
      );
      expect(read).toHaveBeenCalledTimes(1);
      await dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it('records and aborts on growth, preserving the sample', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      const record = vi.fn();
      const dispose = watchNotesReplayResources({
        baseline,
        read: async () => ({
          ...baseline,
          swapUsedBytes: baseline.swapUsedBytes + 1024 ** 3,
        }),
        record,
        stop,
        intervalMs: 5,
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(stop).toHaveBeenCalledExactlyOnceWith('swap_growth_exceeded');
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'resource_sample' }),
      );
      await dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
