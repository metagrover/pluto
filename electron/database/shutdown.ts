interface BeforeQuitEvent {
  preventDefault(): void;
}

interface BeforeQuitHandlerOptions {
  shutdownConsumers(): Promise<void>;
  closeDatabase(): void;
  quit(): void;
  onError?: (error: unknown) => void;
}

export const createBeforeQuitHandler = (
  options: BeforeQuitHandlerOptions,
): ((event: BeforeQuitEvent) => void) => {
  let state: 'idle' | 'stopping' | 'complete' = 'idle';
  const report = options.onError ?? console.error;

  return (event) => {
    if (state === 'complete') return;
    event.preventDefault();
    if (state === 'stopping') return;
    state = 'stopping';

    void (async () => {
      try {
        await options.shutdownConsumers();
      } catch (error) {
        report(error);
      }
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
