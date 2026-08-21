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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
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
            mlxAvailable: true,
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
            mlxAvailable: true,
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
    Object.assign(window, { ipcRenderer: { invoke } });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
            mlxAvailable: true,
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
});
