export const createSerializedTaskGate = <Key, Result>() => {
  type QueuedTask = {
    key: Key;
    task: () => Promise<Result>;
    priority: number;
    sequence: number;
    resolve: (result: Result) => void;
    reject: (error: unknown) => void;
    promise: Promise<Result>;
  };

  let active = false;
  let sequence = 0;
  const queue: QueuedTask[] = [];
  const inFlightByKey = new Map<Key, Promise<Result>>();

  const runNext = (): void => {
    if (active || queue.length === 0) return;
    let nextIndex = 0;
    for (let index = 1; index < queue.length; index += 1) {
      const candidate = queue[index];
      const selected = queue[nextIndex];
      if (
        candidate.priority > selected.priority ||
        (candidate.priority === selected.priority &&
          candidate.sequence < selected.sequence)
      ) {
        nextIndex = index;
      }
    }
    const [next] = queue.splice(nextIndex, 1);
    active = true;
    void Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .then(() => {
        if (inFlightByKey.get(next.key) === next.promise) {
          inFlightByKey.delete(next.key);
        }
        active = false;
        // A completed multi-pass workflow resumes in a promise microtask and
        // may immediately enqueue its next high-priority pass. Give that
        // continuation one event-loop turn before starting queued maintenance.
        setTimeout(runNext, 0);
      });
  };

  return (
    key: Key,
    task: () => Promise<Result>,
    priority = 0,
  ): Promise<Result> => {
    const existing = inFlightByKey.get(key);
    if (existing) return existing;

    let resolve!: (result: Result) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    inFlightByKey.set(key, promise);
    queue.push({
      key,
      task,
      priority,
      sequence: sequence++,
      resolve,
      reject,
      promise,
    });
    runNext();
    return promise;
  };
};
