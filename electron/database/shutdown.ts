interface BeforeQuitEvent {
  preventDefault(): void;
}

interface BeforeQuitHandlerOptions {
  canQuit?(): boolean;
  shutdownConsumers(): Promise<void>;
  closeDatabase(): void;
  quit(): void;
  forceQuit(): void;
  onError?: (error: unknown) => void;
}

export const SHUTDOWN_DEADLINE_MS = 10_000;

export const createBeforeQuitHandler = (
  options: BeforeQuitHandlerOptions,
): ((event: BeforeQuitEvent) => void) => {
  let state: 'idle' | 'stopping' | 'complete' = 'idle';
  const report = options.onError ?? console.error;

  return (event) => {
    if (state === 'complete') return;
    event.preventDefault();
    if (state === 'stopping') return;
    if (options.canQuit?.() === false) return;
    state = 'stopping';
    let timedOut = false;
    // Keep the watchdog through app.quit(): a renderer can also veto window close.
    const deadline = setTimeout(() => {
      timedOut = true;
      state = 'complete';
      report(new Error('Shutdown exceeded 10 seconds; exiting Pluto.'));
      options.forceQuit();
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref?.();

    void (async () => {
      try {
        await options.shutdownConsumers();
      } catch (error) {
        report(error);
      }
      // A timed-out consumer may still use SQLite. Let process exit release it.
      if (timedOut) return;
      try {
        options.closeDatabase();
      } catch (error) {
        report(error);
      } finally {
        state = 'complete';
        options.quit();
      }
    })();
  };
};
