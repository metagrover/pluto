export type CaptureComputePolicy = {
  onBattery: boolean;
  thermalState: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';
};

export const isBackgroundValidationAllowed = (
  policy: CaptureComputePolicy,
): boolean =>
  !policy.onBattery &&
  (policy.thermalState === 'nominal' || policy.thermalState === 'fair');

type ValidationJob = (signal: AbortSignal) => Promise<void>;

type QueueOptions = {
  waitForLiveIdle: (timeoutMs: number) => Promise<boolean>;
  getPolicy: () => Promise<CaptureComputePolicy>;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  minIntervalMs?: number;
  liveIdleTimeoutMs?: number;
  onError?: (error: unknown) => void;
};

export type BackgroundValidationAdmission =
  | 'started'
  | 'skipped_backpressure'
  | 'closed';

export class BackgroundTranscriptValidationQueue {
  private accepting = true;
  private currentKey: string | null = null;
  private lastStartedAt: number | null = null;
  private controller: AbortController | null = null;
  private idleWaiters = new Set<() => void>();
  private readonly now: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly liveIdleTimeoutMs: number;

  constructor(private readonly options: QueueOptions) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      (async (delayMs) =>
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    this.minIntervalMs = options.minIntervalMs ?? 20_000;
    this.liveIdleTimeoutMs = options.liveIdleTimeoutMs ?? 2_000;
  }

  enqueue(key: string, run: ValidationJob): BackgroundValidationAdmission {
    if (!this.accepting) return 'closed';
    if (this.currentKey !== null) return 'skipped_backpressure';
    this.currentKey = key;
    void this.start(run);
    return 'started';
  }

  close(): void {
    this.accepting = false;
    this.controller?.abort();
  }

  whenIdle(): Promise<void> {
    if (this.currentKey === null) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  snapshot(): { accepting: boolean; currentKey: string | null } {
    return { accepting: this.accepting, currentKey: this.currentKey };
  }

  private async start(run: ValidationJob): Promise<void> {
    try {
      if (this.lastStartedAt !== null) {
        const delayMs = Math.max(
          0,
          this.lastStartedAt + this.minIntervalMs - this.now(),
        );
        if (delayMs > 0) await this.sleep(delayMs);
      }
      if (!this.accepting) return;
      const liveIdle = await this.options.waitForLiveIdle(
        this.liveIdleTimeoutMs,
      );
      if (!liveIdle || !this.accepting) return;
      const policy = await this.options.getPolicy();
      if (!isBackgroundValidationAllowed(policy) || !this.accepting) return;
      this.lastStartedAt = this.now();
      this.controller = new AbortController();
      await run(this.controller.signal);
    } catch (error) {
      if (!this.controller?.signal.aborted) this.options.onError?.(error);
    } finally {
      this.controller = null;
      this.currentKey = null;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }
}
