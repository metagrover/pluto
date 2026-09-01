export type MeetingNotesScheduleClass = 'manual' | 'automatic';

export type ScheduledMeetingNotesJob<T> = {
  key: string;
  scheduleClass: MeetingNotesScheduleClass;
  run: () => Promise<T>;
};

export type MeetingNotesSchedulerSnapshot = Array<{
  key: string;
  state: 'active' | 'queued';
  position: number | null;
}>;

type Entry = {
  key: string;
  scheduleClass: MeetingNotesScheduleClass;
  sequence: number;
  run: () => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const ordered = (entries: Entry[]): Entry[] =>
  [...entries].sort(
    (left, right) =>
      (left.scheduleClass === right.scheduleClass
        ? 0
        : left.scheduleClass === 'manual'
          ? -1
          : 1) || left.sequence - right.sequence,
  );

export const createMeetingNotesScheduler = (
  onSnapshot?: (snapshot: MeetingNotesSchedulerSnapshot) => void,
) => {
  let sequence = 0;
  let active: Entry | undefined;
  let queued: Entry[] = [];

  const snapshot = (): MeetingNotesSchedulerSnapshot => [
    ...(active
      ? [{ key: active.key, state: 'active' as const, position: null }]
      : []),
    ...ordered(queued).map((entry, index) => ({
      key: entry.key,
      state: 'queued' as const,
      position: index + 1,
    })),
  ];
  const notify = () => onSnapshot?.(snapshot());

  const admitNext = () => {
    if (active || queued.length === 0) return;
    const next = ordered(queued)[0]!;
    queued = queued.filter((entry) => entry !== next);
    active = next;
    notify();
    void Promise.resolve()
      .then(() => next.run())
      .then(next.resolve, next.reject)
      .finally(() => {
        if (active === next) active = undefined;
        notify();
        admitNext();
      });
  };

  const enqueue = <T>(job: ScheduledMeetingNotesJob<T>): Promise<T> => {
    const existing =
      active?.key === job.key
        ? active
        : queued.find((entry) => entry.key === job.key);
    if (existing) return existing.promise as Promise<T>;
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    queued.push({
      key: job.key,
      scheduleClass: job.scheduleClass,
      sequence: sequence++,
      run: job.run,
      promise,
      resolve,
      reject,
    });
    notify();
    admitNext();
    return promise as Promise<T>;
  };

  const cancel = (key: string, reason: unknown): boolean => {
    const entry = queued.find((candidate) => candidate.key === key);
    if (!entry) return false;
    queued = queued.filter((candidate) => candidate !== entry);
    entry.reject(reason);
    notify();
    return true;
  };

  return { enqueue, cancel, snapshot };
};

export type MeetingNotesScheduler = ReturnType<
  typeof createMeetingNotesScheduler
>;
