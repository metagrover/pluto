export type SilenceWatchdogOptions = {
  /** Silence threshold duration in milliseconds, or null if auto-stop is disabled */
  silenceTimeoutMs: number | (() => number | null) | null;
  /** Scheduled calendar event end time in epoch milliseconds (or null if none) */
  calendarEndTimeMs?: number | (() => number | null) | null;
  /** Callback returning true if conference app audio or system audio is silent/inactive */
  isConferenceSilent?: () => boolean;
  /** Callback when auto-stop condition is triggered */
  onTriggerAutoStop?: (reason: string) => void;
  /** Clock override for testing */
  now?: () => number;
};

export type SilenceCheckResult = {
  shouldStop: boolean;
  reason: string | null;
};

export class SilenceWatchdog {
  private lastSpeechTimestampMs: number;
  private armed = true;
  private intervalId: number | null = null;

  constructor(private readonly options: SilenceWatchdogOptions) {
    const getTime = options.now ?? Date.now;
    this.lastSpeechTimestampMs = getTime();
  }

  /**
   * Resets the silence watchdog timer whenever speech or voice activity is detected.
   */
  recordSpeechActivity(timestampMs?: number): void {
    if (!this.armed) return;
    const getTime = this.options.now ?? Date.now;
    this.lastSpeechTimestampMs = timestampMs ?? getTime();
  }

  /**
   * Evaluates current silence duration and boundary conditions.
   */
  checkSilence(): SilenceCheckResult {
    const timeoutMs =
      typeof this.options.silenceTimeoutMs === 'function'
        ? this.options.silenceTimeoutMs()
        : this.options.silenceTimeoutMs;

    if (!this.armed || timeoutMs === null) {
      return { shouldStop: false, reason: null };
    }

    const getTime = this.options.now ?? Date.now;
    const nowMs = getTime();
    const elapsedSilenceMs = nowMs - this.lastSpeechTimestampMs;

    if (elapsedSilenceMs < timeoutMs) {
      return { shouldStop: false, reason: null };
    }

    // Silence duration exceeded. Evaluate secondary conditions:
    const calendarEnd =
      typeof this.options.calendarEndTimeMs === 'function'
        ? this.options.calendarEndTimeMs()
        : (this.options.calendarEndTimeMs ?? null);

    // Condition 1: Scheduled calendar event end time has passed
    if (calendarEnd !== null && nowMs >= calendarEnd) {
      return {
        shouldStop: true,
        reason: 'auto:calendar_silence_timeout',
      };
    }

    // Condition 2: Conference app audio output has dropped to zero / silent
    const conferenceSilent = this.options.isConferenceSilent?.() ?? true;
    if (calendarEnd === null && conferenceSilent) {
      return {
        shouldStop: true,
        reason: 'auto:silence_timeout',
      };
    }

    // If calendar event exists and conference output is silent past silenceTimeoutMs,
    // also trigger auto-stop
    if (conferenceSilent && calendarEnd !== null && nowMs >= calendarEnd) {
      return {
        shouldStop: true,
        reason: 'auto:calendar_silence_timeout',
      };
    }

    return { shouldStop: false, reason: null };
  }

  /**
   * Starts an interval loop checking silence at regular intervals.
   */
  start(intervalMs = 5000): void {
    this.stop();
    this.armed = true;
    this.intervalId = window.setInterval(() => {
      const result = this.checkSilence();
      if (result.shouldStop && result.reason) {
        this.stop();
        this.options.onTriggerAutoStop?.(result.reason);
      }
    }, intervalMs);
  }

  /**
   * Disarms and stops the watchdog timer.
   */
  disarm(): void {
    this.armed = false;
    this.stop();
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const createSilenceWatchdog = (
  options: SilenceWatchdogOptions,
): SilenceWatchdog => new SilenceWatchdog(options);
