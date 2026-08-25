// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupWizard } from '../../src/components/Setup/SetupWizard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('SetupWizard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let listeners: Map<string, (event: unknown, payload: unknown) => void>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listeners = new Map();
    invoke = vi.fn(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING') {
        if (key === 'setup_complete') return null;
        if (key === 'setup_step') return null;
        return null;
      }
      if (channel === 'RECORDING_READINESS_STATUS') {
        return {
          ready: true,
          details: {
            parakeetClient: true,
            parakeetModel: true,
            parakeetEouReady: true,
            audiocapExists: true,
            audiocapExecutable: true,
            micPermission: true,
            systemAudioPermission: true,
          },
        };
      }
      if (channel === 'RECORDING_READINESS_PREPARE') {
        return {
          ready: true,
          details: {
            parakeetClient: true,
            parakeetModel: true,
            parakeetEouReady: true,
            audiocapExists: true,
            audiocapExecutable: true,
            micPermission: true,
            systemAudioPermission: true,
          },
        };
      }
      if (channel === 'CHECK_MICROPHONE_PERMISSION') return 'granted';
      if (channel === 'CHECK_SYSTEM_AUDIO_PERMISSION') return 'granted';
      return true;
    });
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

  it('prepares local recording requirements without Python or provider setup', async () => {
    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();

    expect(container.textContent).toContain('Meetings remembered, privately');
    const start = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set up Pluto'),
    );
    expect(start).toBeTruthy();

    await act(async () => start?.click());
    await flush();

    expect(invoke).toHaveBeenCalledWith('RECORDING_READINESS_PREPARE');
    expect(container.textContent).toContain('Ready to record');
    expect(container.textContent).not.toContain('Python');
    expect(container.textContent).not.toContain(
      'Choose your reasoning provider',
    );
    expect(container.textContent).toContain(
      'English Parakeet live transcription',
    );
  });

  it('offers a retry when local model preparation fails', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING') return key === 'setup_step' ? '2' : null;
      if (channel === 'RECORDING_READINESS_PREPARE') {
        throw new Error('network unavailable');
      }
      if (channel === 'RECORDING_READINESS_STATUS') {
        return {
          ready: false,
          details: {
            parakeetClient: true,
            parakeetModel: false,
            parakeetEouReady: true,
            audiocapExists: true,
            audiocapExecutable: true,
            micPermission: true,
            systemAudioPermission: true,
          },
        };
      }
      if (channel === 'CHECK_MICROPHONE_PERMISSION') return 'granted';
      if (channel === 'CHECK_SYSTEM_AUDIO_PERMISSION') return 'granted';
      return { ready: true };
    });

    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();

    expect(container.textContent).toContain('Could not prepare transcription');
    expect(container.textContent).toContain('Try again');
  });

  it('shows model size, downloaded bytes, speed, and determinate progress', async () => {
    let finishPreparation: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((channel: string, key?: string) => {
      if (channel === 'GET_SETTING') {
        return Promise.resolve(key === 'setup_step' ? '2' : null);
      }
      if (channel === 'RECORDING_READINESS_STATUS') {
        return Promise.resolve({
          ready: false,
          details: {
            parakeetClient: true,
            parakeetModel: false,
            parakeetEouReady: false,
            audiocapExists: true,
            audiocapExecutable: true,
            micPermission: true,
            systemAudioPermission: true,
          },
        });
      }
      if (channel === 'RECORDING_READINESS_PREPARE') {
        return new Promise((resolve) => {
          finishPreparation = resolve;
        });
      }
      return Promise.resolve(true);
    });

    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_000);
    act(() => {
      listeners.get('RECORDING_READINESS_PROGRESS')?.(undefined, {
        phase: 'downloading',
        downloadedBytes: 419_600_000,
        totalBytes: 986_000_000,
      });
      listeners.get('RECORDING_READINESS_PROGRESS')?.(undefined, {
        phase: 'downloading',
        downloadedBytes: 438_000_000,
        totalBytes: 986_000_000,
      });
    });

    expect(container.textContent).toContain('438 MB of 986 MB');
    expect(container.textContent).toContain('18.4 MB/s');
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('44');

    act(() => {
      listeners.get('RECORDING_READINESS_PROGRESS')?.(undefined, {
        phase: 'loading',
        downloadedBytes: 835_000_000,
        totalBytes: 986_000_000,
      });
    });
    expect(container.textContent).toContain('Loading models');
    expect(container.textContent).not.toContain('MB/s');

    await act(async () =>
      finishPreparation({
        ready: true,
        details: {
          parakeetClient: true,
          parakeetModel: true,
          parakeetEouReady: true,
          audiocapExists: true,
          audiocapExecutable: true,
          micPermission: true,
          systemAudioPermission: true,
        },
      }),
    );
  });
});
