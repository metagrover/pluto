import { describe, expect, it, vi } from 'vitest';

import { waitForMediaRecorderStop } from '../../src/utils/mediaRecorderLifecycle';

type StopListener = () => void;

const createRecorder = (onStop: (listener: StopListener) => void) => ({
  state: 'recording' as RecordingState,
  addEventListener: (_event: 'stop', listener: StopListener) => {
    onStop(listener);
  },
  stop: vi.fn(),
});

describe('media recorder lifecycle', () => {
  it('confirms replacement only after the recorder emits stop', async () => {
    let stopListener: StopListener | null = null;
    const recorder = createRecorder((listener) => {
      stopListener = listener;
    });

    const pending = waitForMediaRecorderStop(recorder, 1_000);
    await Promise.resolve();

    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(stopListener).not.toBeNull();

    stopListener!();
    await expect(pending).resolves.toBe(true);
  });

  it('rejects replacement when recorder shutdown exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const recorder = createRecorder(() => {});
      const pending = waitForMediaRecorderStop(recorder, 500);

      await vi.advanceTimersByTimeAsync(500);

      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the stop-event barrier across a timeout and later retry', async () => {
    vi.useFakeTimers();
    try {
      let stopListener: StopListener | null = null;
      const recorder = {
        state: 'recording',
        addEventListener: (_event: 'stop', listener: StopListener) => {
          stopListener = listener;
        },
        stop: vi.fn(() => {
          recorder.state = 'inactive';
        }),
      };

      const firstAttempt = waitForMediaRecorderStop(recorder, 500);
      await vi.advanceTimersByTimeAsync(500);
      await expect(firstAttempt).resolves.toBe(false);

      let retrySettled = false;
      const retry = waitForMediaRecorderStop(recorder, 500).then((result) => {
        retrySettled = true;
        return result;
      });
      await Promise.resolve();

      expect(retrySettled).toBe(false);
      expect(recorder.stop).toHaveBeenCalledOnce();

      stopListener!();
      await expect(retry).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
