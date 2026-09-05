import { describe, expect, it, vi } from 'vitest';
import { createBeforeQuitHandler } from '../../electron/database/shutdown';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('database shutdown ownership', () => {
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
      onError,
    });
    handler({ preventDefault: vi.fn() });
    await flushPromises();
    expect(onError).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });
});
