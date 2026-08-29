export const isSerializedTaskPreemption = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.message === 'foreground_preempted') return true;
  return isSerializedTaskPreemption(
    (error as Error & { cause?: unknown }).cause,
  );
};

export const createSerializedTaskGate = <Key, Result>() => {
  type QueuedTask = {
    key: Key;
    task: (signal: AbortSignal) => Promise<Result>;
    priority: number;
    preemptible: boolean;
    sequence: number;
    resolve: (result: Result) => void;
    reject: (error: unknown) => void;
    promise: Promise<Result>;
  };

  let active = false;
  let activeTask: (QueuedTask & { controller: AbortController }) | null = null;
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
    const controller = new AbortController();
    active = true;
    activeTask = { ...next, controller };
    void Promise.resolve()
      .then(() => next.task(controller.signal))
      .then(next.resolve, next.reject)
      .then(() => {
        if (inFlightByKey.get(next.key) === next.promise) {
          inFlightByKey.delete(next.key);
        }
        active = false;
        activeTask = null;
        // A completed multi-pass workflow resumes in a promise microtask and
        // may immediately enqueue its next high-priority pass. Give that
        // continuation one event-loop turn before starting queued maintenance.
        setTimeout(runNext, 0);
      });
  };

  return (
    key: Key,
    task: (signal: AbortSignal) => Promise<Result>,
    priority = 0,
    options: { preemptible?: boolean; signal?: AbortSignal } = {},
  ): Promise<Result> => {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
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
      preemptible: options.preemptible === true,
      sequence: sequence++,
      resolve,
      reject,
      promise,
    });
    const abort = () => {
      const index = queue.findIndex((entry) => entry.promise === promise);
      if (index >= 0) {
        queue.splice(index, 1);
        if (inFlightByKey.get(key) === promise) inFlightByKey.delete(key);
        reject(options.signal?.reason);
      } else if (activeTask?.promise === promise) {
        activeTask.controller.abort(options.signal?.reason);
      }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    void promise.then(cleanup, cleanup);
    if (
      activeTask?.preemptible &&
      priority > activeTask.priority &&
      !activeTask.controller.signal.aborted
    ) {
      activeTask.controller.abort(
        new DOMException('foreground_preempted', 'AbortError'),
      );
    }
    runNext();
    return promise;
  };
};
