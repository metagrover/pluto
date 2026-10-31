// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupWizard } from '../../src/components/Setup/SetupWizard';
import { emptyIdentityProfile } from '../../src/types/identity';

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
      if (channel === 'GET_IDENTITY_STATE')
        return { profile: emptyIdentityProfile(), revision: 0, people: [] };
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('types just into the setup promise after the initial load', async () => {
    vi.useFakeTimers();
    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();

    expect(container.textContent).toContain('Ready in three minutes.');

    await act(async () => vi.advanceTimersByTime(800));

    expect(container.textContent).toContain('Ready in just three minutes.');
    expect(
      container.querySelector('[data-testid="setup-typewriter-cursor"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="setup-typewriter-qualifier"]')
        ?.classList.contains('text-[oklch(0.52_0.015_258)]'),
    ).toBe(true);

    await act(async () => vi.advanceTimersByTime(400));

    expect(
      container.querySelector('[data-testid="setup-typewriter-cursor"]'),
    ).toBeFalsy();
    expect(
      container
        .querySelector('[data-testid="setup-typewriter-qualifier"]')
        ?.classList.contains('text-current'),
    ).toBe(true);
  });

  it('offers intelligence selection after local recording setup', async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, key?: string) =>
      channel === 'GET_SETTING' && key === 'setup_step'
        ? '2'
        : original(channel, key),
    );
    await act(async () => root.render(<SetupWizard onComplete={vi.fn()} />));
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Continue')!
        .click(),
    );
    expect(container.textContent).toContain('Choose your intelligence');
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'setup_step',
      value: 'intelligence',
    });
  });

  it('does not ask completed users to choose a provider again', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) =>
      channel === 'GET_SETTING' && key === 'setup_complete' ? 'true' : null,
    );
    const complete = vi.fn();
    await act(async () => root.render(<SetupWizard onComplete={complete} />));
    expect(complete).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Choose your intelligence');
    expect(invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
  });

  it('resumes past provider choice when installation was interrupted after saving it', async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING' && key === 'setup_step')
        return 'intelligence';
      if (channel === 'GET_SETTING' && key === 'intelligence_setup_complete')
        return 'true';
      return original(channel, key);
    });
    await act(async () => root.render(<SetupWizard onComplete={vi.fn()} />));
    expect(
      container.querySelector('[aria-label="About you setup"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('Choose your intelligence');
    expect(invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
  });

  it('resumes optional note connections and finishes without enabling either app', async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING' && key === 'setup_step')
        return 'connections';
      if (channel === 'GET_SETTING' && key === 'intelligence_setup_complete')
        return 'true';
      return original(channel, key);
    });
    const complete = vi.fn();
    await act(async () => root.render(<SetupWizard onComplete={complete} />));
    expect(
      container.querySelector('[aria-label="Note connections setup"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain('ChatGPT Desktop');
    expect(container.textContent).toContain('Claude Desktop');
    expect(container.textContent).toContain('separate from the AI');
    expect(
      invoke.mock.calls.some(([channel]) => channel.includes('SET_ENABLED')),
    ).toBe(false);
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Skip for now')!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'notes_connections_notice_seen',
      value: 'true',
    });
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'setup_complete',
      value: 'true',
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('keeps optional connection setup retryable when persistence fails', async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING' && key === 'setup_step')
        return 'connections';
      if (channel === 'GET_SETTING' && key === 'intelligence_setup_complete')
        return 'true';
      if (channel === 'SET_SETTING') throw new Error('disk unavailable');
      return original(channel, key);
    });
    const complete = vi.fn();
    await act(async () => root.render(<SetupWizard onComplete={complete} />));
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Skip for now')!
        .click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not finish setup',
    );
    expect(complete).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>('button:last-of-type')
        ?.disabled,
    ).toBe(false);
  });

  it('prepares local recording requirements without Python or provider setup', async () => {
    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();

    expect(container.textContent).toContain(
      'Every conversation, remembered and understood.',
    );
    expect(container.textContent).toContain(
      'notes, decisions, people, and next steps',
    );
    expect(container.textContent).toContain('Ready in three minutes.');
    expect(container.textContent).toContain(
      'Local recording. Your choice of intelligence.',
    );
    expect(container.textContent).toContain('Local transcription');
    expect(container.textContent).toContain('Microphone access');
    expect(container.textContent).toContain('System audio access');
    expect(container.textContent).toContain(
      'Records everyone else in the meeting',
    );
    expect(container.querySelector('.drag-region')).toBeTruthy();
    expect(container.querySelectorAll('ol li')).toHaveLength(3);
    const start = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Begin setup'),
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

  it('requests and verifies the native system audio permission before continuing', async () => {
    let verified = false;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'GET_SETTING' && key === 'setup_step') return '2';
      if (channel === 'SYSTEM_AUDIO_PROBE') {
        verified = true;
        return true;
      }
      const result = await original(channel, key);
      if (channel.startsWith('RECORDING_READINESS')) {
        return {
          ...result,
          ready: verified,
          details: { ...result.details, systemAudioPermission: verified },
        };
      }
      return result;
    });
    act(() => root.render(<SetupWizard onComplete={vi.fn()} />));
    await flush();
    const allow = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Allow system audio'),
    );
    expect(allow).toBeTruthy();
    await act(async () => allow?.click());
    await flush();
    expect(invoke).toHaveBeenCalledWith('SYSTEM_AUDIO_PROBE', {
      durationMs: 1500,
      allowSilent: true,
    });
    expect(container.textContent).toContain('Everything is ready.');
    expect(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Continue'),
      )?.disabled,
    ).toBe(false);
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

    expect(container.textContent).toContain(
      'could not verify local transcription',
    );
    expect(container.textContent).toContain(
      'Setup code: parakeet_setup_failed',
    );
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
