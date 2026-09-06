export type OllamaGenerationDeadline = {
  signal: AbortSignal;
  recordProgress(): void;
  dispose(): void;
};

const timeoutReason = (phase: 'capacity' | 'idle' | 'active') =>
  new DOMException(
    `Ollama generation timed out during ${phase} phase`,
    'TimeoutError',
  );

export const createOllamaGenerationDeadline = ({
  capacityTimeoutMs,
  idleTimeoutMs,
  activeTimeoutMs,
  callerSignal,
}: {
  capacityTimeoutMs: number;
  idleTimeoutMs: number;
  activeTimeoutMs: number;
  callerSignal?: AbortSignal;
}): OllamaGenerationDeadline => {
  const controller = new AbortController();
  let capacityTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let active = false;

  const schedule = (callback: () => void, timeoutMs: number) => {
    const timer = setTimeout(callback, timeoutMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    return timer;
  };
  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimeout(timer);
  };
  const abort = (phase: 'capacity' | 'idle' | 'active') => {
    if (!controller.signal.aborted) controller.abort(timeoutReason(phase));
  };
  const resetIdleTimer = () => {
    clear(idleTimer);
    idleTimer = schedule(() => abort('idle'), idleTimeoutMs);
  };

  capacityTimer = schedule(() => abort('capacity'), capacityTimeoutMs);

  return {
    signal: callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal,
    recordProgress: () => {
      if (controller.signal.aborted) return;
      if (!active) {
        active = true;
        clear(capacityTimer);
        capacityTimer = null;
        activeTimer = schedule(() => abort('active'), activeTimeoutMs);
      }
      resetIdleTimer();
    },
    dispose: () => {
      clear(capacityTimer);
      clear(idleTimer);
      clear(activeTimer);
      capacityTimer = null;
      idleTimer = null;
      activeTimer = null;
    },
  };
};
