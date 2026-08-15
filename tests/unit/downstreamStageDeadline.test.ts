import { describe, expect, it, vi } from 'vitest';
import {
  DownstreamStageTimeoutError,
  runDownstreamStageBeforeDeadline,
} from '../../src/services/downstreamStageDeadline';

describe('downstream stage deadline', () => {
  it('returns work that finishes before the deadline', async () => {
    await expect(
      runDownstreamStageBeforeDeadline('analysis', async () => 'ready', 50),
    ).resolves.toBe('ready');
  });

  it('aborts and rejects a stage that exceeds its deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const operation = runDownstreamStageBeforeDeadline(
      'analysis',
      async (stageSignal) => {
        signal = stageSignal;
        return await new Promise<string>(() => undefined);
      },
      1_000,
    );
    const rejection = expect(operation).rejects.toBeInstanceOf(
      DownstreamStageTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
