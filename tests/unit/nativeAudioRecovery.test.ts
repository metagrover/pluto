import { expect, it, vi } from 'vitest';
import { createNativeAudioRecovery } from '../../src/utils/nativeAudioRecovery';

const setup = () => {
  let active = true;
  const input = {
    isActive: () => active,
    stopCapture: vi.fn(async () => true),
    startCapture: vi.fn(async () => true),
    onRecovering: vi.fn(),
    onFailed: vi.fn(),
  };
  return {
    input,
    recovery: createNativeAudioRecovery(input),
    stop: () => {
      active = false;
    },
  };
};

it('does no capture work until requested, serializes recovery, and bounds repeated stalls', async () => {
  const { input, recovery } = setup();
  expect(input.stopCapture).not.toHaveBeenCalled();
  expect(input.startCapture).not.toHaveBeenCalled();
  const first = recovery.recover();
  expect(recovery.recover()).toBe(first);
  await first;
  expect(input.stopCapture).toHaveBeenCalledTimes(1);
  expect(input.startCapture).toHaveBeenCalledTimes(1);
  expect(input.stopCapture.mock.invocationCallOrder[0]).toBeLessThan(
    input.startCapture.mock.invocationCallOrder[0],
  );
  expect(recovery.isRecovering()).toBe(false);
  await recovery.recover();
  await recovery.recover();
  expect(input.startCapture).toHaveBeenCalledTimes(2);
  expect(input.onFailed).toHaveBeenCalledTimes(1);
});

it('does not resurrect capture when stop or a new session supersedes a pending restart', async () => {
  const { input, recovery, stop } = setup();
  let release!: () => void;
  input.stopCapture.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      }),
  );
  const attempt = recovery.recover();
  await Promise.resolve();
  stop();
  release();
  await attempt;
  await recovery.recover();
  expect(input.startCapture).not.toHaveBeenCalled();
  expect(input.onFailed).not.toHaveBeenCalled();
});

it.each(['not_ready', 'error'])(
  'reports failed recovery when capture returns %s',
  async (failure) => {
    const { input, recovery } = setup();
    if (failure === 'error')
      input.startCapture.mockRejectedValue(new Error('unavailable'));
    else input.startCapture.mockResolvedValue(false);
    await recovery.recover();
    expect(input.onFailed).toHaveBeenCalledTimes(1);
    expect(recovery.isRecovering()).toBe(false);
  },
);

it('ignores a queued restart and late failure after the recording ends', async () => {
  const { input, recovery, stop } = setup();
  const attempt = recovery.recover();
  stop();
  await attempt;
  expect(input.stopCapture).not.toHaveBeenCalled();
  expect(input.onRecovering).not.toHaveBeenCalled();
  expect(input.onFailed).not.toHaveBeenCalled();
});

it('does not start another capture if stopping the current owner is rejected', async () => {
  const { input, recovery } = setup();
  input.stopCapture.mockResolvedValue(false);
  await recovery.recover();
  expect(input.startCapture).not.toHaveBeenCalled();
  expect(input.onFailed).toHaveBeenCalledTimes(1);
});

it('ignores startup settlement from a recovery superseded by stop', async () => {
  const { input, recovery, stop } = setup();
  let rejectStart!: (error: Error) => void;
  input.startCapture.mockImplementation(
    () =>
      new Promise<boolean>((_, reject) => {
        rejectStart = reject;
      }),
  );
  const attempt = recovery.recover();
  await Promise.resolve();
  await Promise.resolve();
  expect(input.startCapture).toHaveBeenCalledTimes(1);
  stop();
  rejectStart(new Error('capture_session_not_owned'));
  await attempt;
  expect(input.onFailed).not.toHaveBeenCalled();
});
