export type SpawnEventSource = {
  once(event: 'spawn', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'spawn', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
};

export const waitForNativeAudioSpawn = (
  child: SpawnEventSource,
): Promise<boolean> =>
  new Promise((resolve) => {
    const onSpawn = () => {
      child.off('error', onError);
      resolve(true);
    };
    const onError = () => {
      child.off('spawn', onSpawn);
      resolve(false);
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
