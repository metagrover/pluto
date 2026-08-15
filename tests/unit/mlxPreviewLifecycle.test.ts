import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MlxPreviewManager as MlxPreviewManagerConstructor } from '../../electron/transcription/mlxPreviewClient';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pluto-mlx-preview-test',
    getAppPath: () => '/tmp/pluto-mlx-preview-test-app',
  },
}));

describe('MLX preview lifecycle', () => {
  let MlxPreviewManager: typeof MlxPreviewManagerConstructor;

  beforeAll(async () => {
    ({ MlxPreviewManager } = await import(
      '../../electron/transcription/mlxPreviewClient'
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds model configuration to each transcribe request', async () => {
    const manager = new MlxPreviewManager();
    vi.spyOn(manager, 'start').mockResolvedValue();
    vi.spyOn(
      manager as unknown as { applyConfigFromOptions: () => Promise<void> },
      'applyConfigFromOptions',
    ).mockResolvedValue();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ segments: [], language: 'en', duration: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await manager.transcribe('/tmp/synthetic.wav', {
      model: 'medium',
      device: 'mlx',
      computeType: 'float16',
      language: 'en',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'medium',
      device: 'mlx',
      compute_type: 'float16',
      language: 'en',
    });
  });

  it('does not release a stopped child until its close event arrives', async () => {
    const manager = new MlxPreviewManager();
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
    const manager = new MlxPreviewManager();
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
