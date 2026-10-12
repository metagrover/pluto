import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBeforeQuitHandler,
  SHUTDOWN_DEADLINE_MS,
} from '../../electron/database/shutdown';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('database shutdown ownership', () => {
  afterEach(() => vi.useRealTimers());
  it('prevents quit until async consumers settle and the database closes', async () => {
    let finishConsumers: (() => void) | undefined;
    const shutdownConsumers = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConsumers = resolve;
        }),
    );
    const closeDatabase = vi.fn();
    const quit = vi.fn();
    const handler = createBeforeQuitHandler({
      shutdownConsumers,
      closeDatabase,
      quit,
      forceQuit: vi.fn(),
    });
    const event = { preventDefault: vi.fn() };

    handler(event);
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(shutdownConsumers).toHaveBeenCalledOnce();
    expect(closeDatabase).not.toHaveBeenCalled();
    finishConsumers?.();
    await flushPromises();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();

    const finalEvent = { preventDefault: vi.fn() };
    handler(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('closes and resumes quit even when consumer shutdown rejects', async () => {
    const onError = vi.fn();
    const closeDatabase = vi.fn();
    const quit = vi.fn();
    const handler = createBeforeQuitHandler({
      shutdownConsumers: async () => {
        throw new Error('consumer failed');
      },
      closeDatabase,
      quit,
      forceQuit: vi.fn(),
      onError,
    });
    handler({ preventDefault: vi.fn() });
    await flushPromises();
    expect(onError).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)(
    'exits stalled cleanup without closing a live database, even after late %s',
    async (outcome) => {
      vi.useFakeTimers();
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const shutdownConsumers = vi.fn(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const closeDatabase = vi.fn();
      const quit = vi.fn();
      const forceQuit = vi.fn();
      const onError = vi.fn();
      const handler = createBeforeQuitHandler({
        shutdownConsumers,
        closeDatabase,
        quit,
        forceQuit,
        onError,
      });
      const event = { preventDefault: vi.fn() };
      handler(event);
      handler(event);
      await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
      expect(forceQuit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(forceQuit).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Shutdown exceeded'),
        }),
      );
      if (outcome === 'resolve') resolve();
      else reject(new Error('late failure'));
      await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
      expect(shutdownConsumers).toHaveBeenCalledOnce();
      expect(closeDatabase).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
      expect(forceQuit).toHaveBeenCalledOnce();
    },
  );

  it('keeps a deadline after graceful cleanup if Electron quit is vetoed', async () => {
    vi.useFakeTimers();
    const closeDatabase = vi.fn();
    const quit = vi.fn();
    const forceQuit = vi.fn();
    const handler = createBeforeQuitHandler({
      shutdownConsumers: async () => {},
      closeDatabase,
      quit,
      forceQuit,
      onError: vi.fn(),
    });
    handler({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(forceQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
    expect(forceQuit).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });

  it('does not start shutdown or its deadline during capture, and allows a later retry', async () => {
    vi.useFakeTimers();
    let capturing = true;
    const shutdownConsumers = vi.fn(async () => {});
    const forceQuit = vi.fn();
    const quit = vi.fn();
    const handler = createBeforeQuitHandler({
      canQuit: () => !capturing,
      shutdownConsumers,
      closeDatabase: vi.fn(),
      quit,
      forceQuit,
      onError: vi.fn(),
    });
    const event = { preventDefault: vi.fn() };
    handler(event);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(shutdownConsumers).not.toHaveBeenCalled();
    expect(forceQuit).not.toHaveBeenCalled();
    capturing = false;
    handler(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(shutdownConsumers).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });
});
