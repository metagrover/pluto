export const createSerializedTaskGate = <Key, Result>() => {
  let serialTail: Promise<void> = Promise.resolve();
  const inFlightByKey = new Map<Key, Promise<Result>>();

  return (key: Key, task: () => Promise<Result>): Promise<Result> => {
    const existing = inFlightByKey.get(key);
    if (existing) return existing;

    const result = serialTail.then(task);
    serialTail = result.then(
      () => undefined,
      () => undefined,
    );
    inFlightByKey.set(key, result);

    const clear = () => {
      if (inFlightByKey.get(key) === result) inFlightByKey.delete(key);
    };
    void result.then(clear, clear);
    return result;
  };
};
