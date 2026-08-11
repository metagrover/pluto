type LiveTranscriptionJob = () => Promise<unknown>;

type QueuedJob = {
  sequence: number;
  run: LiveTranscriptionJob;
};

type LiveTranscriptionQueueOptions = {
  onError?: (error: unknown) => void;
};

type LiveTranscriptionQueueCloseOptions = {
  drainQueued?: boolean;
};

export type LiveTranscriptionQueueAdmission =
  | 'started'
  | 'queued'
  | 'replaced'
  | 'closed';

export class LiveTranscriptionQueue {
  private accepting = true;
  private active: QueuedJob | null = null;
  private queued: QueuedJob | null = null;
  private replacedCount = 0;
  private drainQueuedAfterClose = false;
  private idleWaiters = new Set<() => void>();
  private readonly onError: (error: unknown) => void;

  constructor(options: LiveTranscriptionQueueOptions = {}) {
    this.onError = options.onError ?? (() => undefined);
  }

  enqueue(
    sequence: number,
    run: LiveTranscriptionJob,
  ): LiveTranscriptionQueueAdmission {
    if (!this.accepting) return 'closed';
    const job = { sequence, run };
    if (!this.active) {
      this.start(job);
      return 'started';
    }
    if (this.queued) {
      this.queued = job;
      this.replacedCount += 1;
      return 'replaced';
    }
    this.queued = job;
    return 'queued';
  }

  close(options: LiveTranscriptionQueueCloseOptions = {}): {
    discardedSequence: number | null;
  } {
    this.accepting = false;
    this.drainQueuedAfterClose = options.drainQueued === true;
    const discardedSequence = this.drainQueuedAfterClose
      ? null
      : (this.queued?.sequence ?? null);
    if (!this.drainQueuedAfterClose) this.queued = null;
    if (!this.active) this.resolveIdle();
    return { discardedSequence };
  }

  whenIdle(): Promise<void> {
    if (!this.active && !this.queued) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.whenIdle().then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  snapshot() {
    return {
      activeSequence: this.active?.sequence ?? null,
      queuedSequence: this.queued?.sequence ?? null,
      replacedCount: this.replacedCount,
      accepting: this.accepting,
    };
  }

  private start(job: QueuedJob) {
    this.active = job;
    void Promise.resolve()
      .then(job.run)
      .catch(this.onError)
      .finally(() => {
        if (this.active !== job) return;
        this.active = null;
        const next =
          this.accepting || this.drainQueuedAfterClose ? this.queued : null;
        this.queued = null;
        this.drainQueuedAfterClose = false;
        if (next) this.start(next);
        else this.resolveIdle();
      });
  }

  private resolveIdle() {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
