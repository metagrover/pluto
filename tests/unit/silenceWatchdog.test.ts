import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilenceWatchdog } from '../../src/autoStop/silenceWatchdog';

describe('silence watchdog auto-stop coordinator', () => {
  let currentTime = 1_000_000;
  const now = () => currentTime;

  beforeEach(() => {
    currentTime = 1_000_000;
  });

  it('resets silence timer whenever speech activity is recorded', () => {
    let autoStopReason: string | null = null;
    const watchdog = createSilenceWatchdog({
      silenceTimeoutMs: 180_000, // 3 minutes
      calendarEndTimeMs: 1_050_000, // already passed
      isConferenceSilent: () => true,
      onTriggerAutoStop: (reason) => {
        autoStopReason = reason;
      },
      now,
    });

    // Advance 2 minutes (120s) - no speech
    currentTime += 120_000;
    expect(watchdog.checkSilence()).toEqual({
      shouldStop: false,
      reason: null,
    });

    // Speech detected at minute 2!
    watchdog.recordSpeechActivity();

    // Advance another 2 minutes (total 4m from start, but 2m from speech)
    currentTime += 120_000;
    expect(watchdog.checkSilence()).toEqual({
      shouldStop: false,
      reason: null,
    });

    // Advance another 1.5 minutes (total 3.5m from speech -> exceeds 3m silence)
    currentTime += 90_000;
    const result = watchdog.checkSilence();
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe('auto:calendar_silence_timeout');
  });

  it('triggers auto-stop when continuous silence exceeds duration AND calendar end time passed', () => {
    const calendarEnd = 1_200_000; // Scheduled end at +200s
    let autoStopReason: string | null = null;
    const watchdog = createSilenceWatchdog({
      silenceTimeoutMs: 180_000, // 3 minutes (180s)
      calendarEndTimeMs: calendarEnd,
      isConferenceSilent: () => false, // Conference audio not silent, but calendar end has passed
      onTriggerAutoStop: (reason) => {
        autoStopReason = reason;
      },
      now,
    });

    // At +180s: silence timeout reached, but calendarEnd (1_200_000) not reached yet (currentTime is 1_180_000)
    currentTime += 180_000;
    expect(watchdog.checkSilence().shouldStop).toBe(false);

    // At +205s: both silence timeout (>180s) and calendarEnd (1_200_000) have passed!
    currentTime = 1_205_000;
    const result = watchdog.checkSilence();
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe('auto:calendar_silence_timeout');
  });

  it('triggers auto-stop when continuous silence exceeds duration AND conference audio is silent (no calendar event)', () => {
    const watchdog = createSilenceWatchdog({
      silenceTimeoutMs: 300_000, // 5 minutes
      calendarEndTimeMs: null,
      isConferenceSilent: () => true,
      onTriggerAutoStop: vi.fn(),
      now,
    });

    currentTime += 301_000;
    const result = watchdog.checkSilence();
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe('auto:silence_timeout');
  });

  it('does not trigger auto-stop if silence timeout is disabled', () => {
    const watchdog = createSilenceWatchdog({
      silenceTimeoutMs: null, // Disabled
      calendarEndTimeMs: 1_000_000,
      isConferenceSilent: () => true,
      onTriggerAutoStop: vi.fn(),
      now,
    });

    currentTime += 10_000_000;
    expect(watchdog.checkSilence()).toEqual({
      shouldStop: false,
      reason: null,
    });
  });

  it('manual stop disarms the watchdog timer lifecycle', () => {
    const onTriggerAutoStop = vi.fn();
    const watchdog = createSilenceWatchdog({
      silenceTimeoutMs: 60_000,
      calendarEndTimeMs: 1_000_000,
      isConferenceSilent: () => true,
      onTriggerAutoStop,
      now,
    });

    watchdog.disarm();
    currentTime += 120_000;
    expect(watchdog.checkSilence()).toEqual({
      shouldStop: false,
      reason: null,
    });
    expect(onTriggerAutoStop).not.toHaveBeenCalled();
  });
});
