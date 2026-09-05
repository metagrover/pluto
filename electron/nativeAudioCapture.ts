export const canReuseRunningCaptureForProbe = (
  captureRunning: boolean,
  targetPids?: number[],
) =>
  captureRunning &&
  !targetPids?.some((pid) => Number.isInteger(pid) && pid > 0);

type PcmEventSource = {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  off(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
};

type NativePcmProcess = {
  stdout: PcmEventSource | null;
  once(event: 'error' | 'close', listener: () => void): unknown;
  off(event: 'error' | 'close', listener: () => void): unknown;
};

/** A spawned process is not ready until its PCM transport produces a frame. */
export const waitForNativeAudioPcm = (
  child: NativePcmProcess,
  timeoutMs = 3000,
): Promise<boolean> =>
  new Promise((resolve) => {
    const firstFrame = new Uint8Array(4);
    let byteCount = 0;
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      child.off('error', failed);
      child.off('close', failed);
      child.stdout?.off('data', received);
      resolve(ready);
    };
    const failed = () => finish(false);
    const received = (chunk: Uint8Array) => {
      for (const byte of chunk) {
        firstFrame[byteCount++] = byte;
        if (byteCount === 4) {
          finish(
            Number.isFinite(
              new DataView(firstFrame.buffer).getFloat32(0, true),
            ),
          );
          return;
        }
      }
    };
    const timer = setTimeout(failed, timeoutMs);
    child.once('error', failed);
    child.once('close', failed);
    child.stdout?.on('data', received);
  });
