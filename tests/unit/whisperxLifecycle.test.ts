import { EventEmitter } from 'node:events';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pluto-whisperx-test',
    getAppPath: () => '/tmp/pluto-whisperx-test-app',
  },
}));

describe('WhisperX lifecycle', () => {
  let WhisperXManager: typeof import('../../electron/whisperx').WhisperXManager;

  beforeAll(async () => {
    ({ WhisperXManager } = await import('../../electron/whisperx'));
  });

  it('does not release a stopped child until its close event arrives', async () => {
    const manager = new WhisperXManager();
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: ReturnType<typeof vi.fn>;
    };
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => true);
    (manager as unknown as { process: typeof child }).process = child;

    let resolved = false;
    const stopping = manager.stop().then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    child.exitCode = 0;
    child.emit('close', 0);
    await stopping;

    expect(resolved).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('keeps forced-stop lifecycle locked until SIGKILL produces close', async () => {
    vi.useFakeTimers();
    const manager = new WhisperXManager();
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: ReturnType<typeof vi.fn>;
    };
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => true);
    (manager as unknown as { process: typeof child }).process = child;

    let resolved = false;
    const stopping = manager.stop().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(resolved).toBe(false);

    child.signalCode = 'SIGKILL';
    child.emit('close', null, 'SIGKILL');
    await stopping;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
