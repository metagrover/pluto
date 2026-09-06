import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOllamaGenerationDeadline } from '../../electron/llm/ollamaGenerationDeadline';

describe('Ollama progress-aware generation deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('bounds model-capacity wait before the first response byte', () => {
    vi.useFakeTimers();
    const deadline = createOllamaGenerationDeadline({
      capacityTimeoutMs: 500,
      idleTimeoutMs: 200,
      activeTimeoutMs: 1_000,
    });

    vi.advanceTimersByTime(499);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: 'TimeoutError' });
  });

  it('preserves a caller cancellation as an abort rather than a timeout', () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const deadline = createOllamaGenerationDeadline({
      capacityTimeoutMs: 500,
      idleTimeoutMs: 200,
      activeTimeoutMs: 1_000,
      callerSignal: caller.signal,
    });

    caller.abort(new DOMException('cancelled', 'AbortError'));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: 'AbortError' });
  });

  it('switches from capacity wait to idle and bounded active generation', () => {
    vi.useFakeTimers();
    const deadline = createOllamaGenerationDeadline({
      capacityTimeoutMs: 500,
      idleTimeoutMs: 200,
      activeTimeoutMs: 1_000,
    });

    vi.advanceTimersByTime(400);
    deadline.recordProgress();
    vi.advanceTimersByTime(150);
    deadline.recordProgress();
    vi.advanceTimersByTime(199);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
  });

  it('does not extend the total active-generation budget on progress', () => {
    vi.useFakeTimers();
    const deadline = createOllamaGenerationDeadline({
      capacityTimeoutMs: 500,
      idleTimeoutMs: 700,
      activeTimeoutMs: 1_000,
    });

    deadline.recordProgress();
    vi.advanceTimersByTime(600);
    deadline.recordProgress();
    vi.advanceTimersByTime(400);
    expect(deadline.signal.aborted).toBe(true);
  });

  it('cleans up its timers after successful completion', () => {
    vi.useFakeTimers();
    const deadline = createOllamaGenerationDeadline({
      capacityTimeoutMs: 500,
      idleTimeoutMs: 200,
      activeTimeoutMs: 1_000,
    });

    deadline.recordProgress();
    deadline.dispose();
    vi.runAllTimers();
    expect(deadline.signal.aborted).toBe(false);
  });
});
