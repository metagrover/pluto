// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeReadinessGate } from '../../src/components/RuntimeReadinessGate';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const readiness = (transcriptionReady: boolean) => ({
  ready: transcriptionReady,
  blockers: transcriptionReady ? [] : ['parakeet_model_missing'],
  details: {
    parakeetClient: true,
    parakeetModel: transcriptionReady,
    parakeetEouReady: transcriptionReady,
    audiocapExists: true,
    audiocapExecutable: true,
    micPermission: true,
    systemAudioPermission: true,
  },
});

describe('RuntimeReadinessGate', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let listeners: Map<string, (event: unknown, payload: unknown) => void>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn();
    listeners = new Map();
    Object.assign(window, {
      ipcRenderer: {
        invoke,
        on: vi.fn((channel: string, listener) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        }),
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('verifies an already prepared runtime before revealing Pluto', async () => {
    invoke.mockResolvedValue(readiness(true));

    act(() =>
      root.render(
        <RuntimeReadinessGate>
          <div>Pluto workspace</div>
        </RuntimeReadinessGate>,
      ),
    );
    expect(container.textContent).toContain('Checking local transcription');
    expect(container.querySelector('img[alt="Pluto Logo"]')).not.toBeNull();
    expect(
      container.querySelector('img[alt="Pluto Logo"]')?.getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);

    await act(async () => await Promise.resolve());

    expect(container.textContent).toContain('Pluto workspace');
    expect(invoke).toHaveBeenCalledWith('RECORDING_READINESS_STATUS');
    expect(invoke).not.toHaveBeenCalledWith('RECORDING_READINESS_PREPARE');
  });

  it('automatically prepares missing models while keeping loading visible', async () => {
    let finishPreparation: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((channel: string) => {
      if (channel === 'RECORDING_READINESS_STATUS') {
        return Promise.resolve(readiness(false));
      }
      return new Promise((resolve) => {
        finishPreparation = resolve;
      });
    });

    act(() =>
      root.render(
        <RuntimeReadinessGate>
          <div>Pluto workspace</div>
        </RuntimeReadinessGate>,
      ),
    );
    await act(async () => await Promise.resolve());

    expect(container.textContent).toContain('Checking local transcription');
    expect(container.textContent).not.toContain('Downloading or repairing');
    expect(container.textContent).not.toContain('Pluto workspace');
    expect(invoke).toHaveBeenCalledWith('RECORDING_READINESS_PREPARE');

    act(() => {
      listeners.get('RECORDING_READINESS_PROGRESS')?.(undefined, {
        phase: 'downloading',
        downloadedBytes: 438_000_000,
        totalBytes: 986_000_000,
      });
    });
    expect(container.textContent).toContain('Downloading local transcription');
    expect(container.textContent).toContain('438 MB of 986 MB');
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuenow'),
    ).toBe('44');

    await act(async () => finishPreparation(readiness(true)));

    expect(container.textContent).toContain('Pluto workspace');
  });

  it('shows local verification on restart without claiming a download', async () => {
    let finish: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((channel: string) =>
      channel === 'RECORDING_READINESS_STATUS'
        ? Promise.resolve(readiness(false))
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    act(() =>
      root.render(
        <RuntimeReadinessGate>
          <div>Workspace</div>
        </RuntimeReadinessGate>,
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() =>
      listeners.get('RECORDING_READINESS_PROGRESS')?.(undefined, {
        phase: 'verifying',
        downloadedBytes: 0,
        totalBytes: 0,
      }),
    );
    expect(container.textContent).toContain('Verifying installed models');
    expect(container.textContent).not.toContain(
      'Downloading local transcription',
    );
    expect(container.textContent).not.toContain('KB downloaded');
    await act(async () => finish(readiness(true)));
    expect(container.textContent).toContain('Workspace');
  });

  it('ends in an explicit retry state when automatic repair fails', async () => {
    invoke
      .mockResolvedValueOnce(readiness(false))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(readiness(false))
      .mockResolvedValueOnce(readiness(true));

    act(() =>
      root.render(
        <RuntimeReadinessGate>
          <div>Pluto workspace</div>
        </RuntimeReadinessGate>,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'Local transcription needs attention',
    );
    expect(container.textContent).not.toContain('Pluto workspace');

    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Try again'),
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Pluto workspace');
    expect(invoke).toHaveBeenCalledTimes(4);
  });
});
