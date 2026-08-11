import { describe, expect, it, vi } from 'vitest';
import { createPauseReasonCoordinator } from '../../electron/pauseReasonCoordinator';

describe('pause reason coordinator', () => {
  it('stays paused until overlapping foreground work has fully cleared', () => {
    const onPausedChange = vi.fn();
    const coordinator = createPauseReasonCoordinator(onPausedChange);

    coordinator.acquire('capture');
    coordinator.acquire('transcription');
    coordinator.acquire('transcription');
    coordinator.acquire('downstream');
    expect(onPausedChange).toHaveBeenCalledTimes(1);
    expect(onPausedChange).toHaveBeenLastCalledWith(true);

    coordinator.release('transcription');
    coordinator.release('capture');
    coordinator.release('downstream');
    expect(onPausedChange).toHaveBeenCalledTimes(1);

    coordinator.release('transcription');
    expect(onPausedChange).toHaveBeenLastCalledWith(false);
    expect(coordinator.snapshot()).toEqual({});
  });

  it('ignores unmatched releases without resuming work', () => {
    const onPausedChange = vi.fn();
    const coordinator = createPauseReasonCoordinator(onPausedChange);
    coordinator.acquire('capture');

    coordinator.release('downstream');
    expect(onPausedChange).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot()).toEqual({ capture: 1 });
  });
});
