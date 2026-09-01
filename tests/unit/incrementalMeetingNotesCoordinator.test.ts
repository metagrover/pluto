import { expect, it, vi } from 'vitest';
import {
  createIncrementalMeetingNotesCoordinator,
  evaluateIncrementalMeetingNotesAdmission,
} from '../../electron/incrementalMeetingNotesCoordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const offer = (revision: number) => ({
  meetingId: 'meeting-a',
  sourceRevision: `revision-${revision}`,
  sourceSegmentCount: revision * 10,
  sourceCharacterCount: revision * 1_000,
});

it('runs one job and replaces stale pending offers with the latest revision', async () => {
  const first = deferred<'generated'>();
  const run = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce('reused');
  const events: string[] = [];
  const coordinator = createIncrementalMeetingNotesCoordinator({
    admit: async () => true,
    run,
    onMetric: (event) => events.push(event.outcome),
  });

  coordinator.offer(offer(1));
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  coordinator.offer(offer(2));
  coordinator.offer(offer(3));
  first.resolve('generated');
  await coordinator.drain();

  expect(run.mock.calls.map(([input]) => input.sourceRevision)).toEqual([
    'revision-1',
    'revision-3',
  ]);
  expect(events).toEqual(['superseded', 'generated', 'reused']);
});

it('fails closed when capture headroom admission is denied', async () => {
  const run = vi.fn();
  const onMetric = vi.fn();
  const coordinator = createIncrementalMeetingNotesCoordinator({
    admit: async () => false,
    run,
    onMetric,
  });

  coordinator.offer(offer(1));
  await coordinator.drain();

  expect(run).not.toHaveBeenCalled();
  expect(onMetric).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'discarded' }),
  );
});

it('discards a duplicate or older source offer instead of running it', async () => {
  const run = vi.fn().mockResolvedValue('generated');
  const events: string[] = [];
  const coordinator = createIncrementalMeetingNotesCoordinator({
    admit: async () => true,
    run,
    onMetric: (event) => events.push(event.outcome),
  });

  coordinator.offer(offer(3));
  await coordinator.drain();
  coordinator.offer(offer(2));
  coordinator.offer(offer(3));
  await coordinator.drain();

  expect(run).toHaveBeenCalledTimes(1);
  expect(events).toEqual(['generated', 'discarded', 'discarded']);
});

it('aborts active work and discards pending work for a stopped meeting', async () => {
  const started = deferred<void>();
  const run = vi.fn(async (_input, signal: AbortSignal) => {
    started.resolve();
    await new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
    return 'generated' as const;
  });
  const events: string[] = [];
  const coordinator = createIncrementalMeetingNotesCoordinator({
    admit: async () => true,
    run,
    onMetric: (event) => events.push(event.outcome),
  });

  coordinator.offer(offer(1));
  await started.promise;
  coordinator.offer(offer(2));
  coordinator.cancel('meeting-a');
  await coordinator.drain();

  expect(run).toHaveBeenCalledTimes(1);
  expect(events).toContain('preempted');
  expect(events).toContain('discarded');
});

const healthyPolicy = {
  captureOwned: true,
  liveTranscriptHealthy: true,
  onBattery: false,
  thermalState: 'nominal' as const,
  freeMemoryBytes: 8 * 1024 ** 3,
  totalMemoryBytes: 16 * 1024 ** 3,
};

it('admits incremental notes only with explicit healthy capture headroom', () => {
  expect(evaluateIncrementalMeetingNotesAdmission(healthyPolicy)).toEqual({
    admitted: true,
  });
});

it.each([
  [{ ...healthyPolicy, captureOwned: false }, 'capture_not_owned'],
  [
    { ...healthyPolicy, liveTranscriptHealthy: false },
    'live_transcript_unhealthy',
  ],
  [{ ...healthyPolicy, onBattery: true }, 'battery_power'],
  [{ ...healthyPolicy, thermalState: 'fair' as const }, 'thermal_headroom'],
  [{ ...healthyPolicy, freeMemoryBytes: 100 }, 'memory_pressure'],
])('denies incremental work when headroom is unsafe: %j', (policy, reason) => {
  expect(evaluateIncrementalMeetingNotesAdmission(policy)).toEqual({
    admitted: false,
    reason,
  });
});
