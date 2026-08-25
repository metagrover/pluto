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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    invoke = vi.fn();
    Object.assign(window, { ipcRenderer: { invoke } });
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

    expect(container.textContent).toContain('Preparing local transcription');
    expect(container.textContent).not.toContain('Pluto workspace');
    expect(invoke).toHaveBeenCalledWith('RECORDING_READINESS_PREPARE');

    await act(async () => finishPreparation(readiness(true)));

    expect(container.textContent).toContain('Pluto workspace');
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
