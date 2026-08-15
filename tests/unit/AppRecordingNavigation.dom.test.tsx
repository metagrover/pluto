// @vitest-environment happy-dom

import type React from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: ({
    onStartSessionRef,
    onStopSessionRef,
    onRecordingStarted,
    onRecordingChange,
    onProcessingChange,
    onCaptureHealthChange,
    onLiveTranscriptIntegrityChange,
  }: {
    onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
    onStopSessionRef?: React.MutableRefObject<(() => void) | null>;
    onRecordingStarted?: (startedAtMs: number) => void;
    onRecordingChange?: (recording: boolean) => void;
    onProcessingChange?: (processing: boolean) => void;
    onCaptureHealthChange?: (health: {
      microphone: 'healthy';
      systemAudio: 'healthy';
      captureDurability: 'healthy';
    }) => void;
    onLiveTranscriptIntegrityChange?: (state: 'healthy') => void;
  }) => {
    useEffect(() => {
      if (onStartSessionRef) {
        onStartSessionRef.current = () => {
          onRecordingStarted?.(Date.now());
          onCaptureHealthChange?.({
            microphone: 'healthy',
            systemAudio: 'healthy',
            captureDurability: 'healthy',
          });
          onLiveTranscriptIntegrityChange?.('healthy');
          onProcessingChange?.(false);
          onRecordingChange?.(true);
        };
      }
      if (onStopSessionRef) {
        onStopSessionRef.current = () => {
          onRecordingChange?.(false);
          onProcessingChange?.(false);
        };
      }
      return () => {
        if (onStartSessionRef) onStartSessionRef.current = null;
        if (onStopSessionRef) onStopSessionRef.current = null;
      };
    }, [
      onStartSessionRef,
      onStopSessionRef,
      onRecordingStarted,
      onRecordingChange,
      onProcessingChange,
      onCaptureHealthChange,
      onLiveTranscriptIntegrityChange,
    ]);
    return null;
  },
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('App recording navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    window.__PLUTO_BROWSER_PREVIEW__ = false;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string, key?: string) => {
          if (channel === 'GET_SETTING') {
            if (key === 'setup_complete') return 'true';
            if (key === 'theme') return 'system';
            if (key === 'auto_end_enabled') return 'false';
            if (key === 'llm_provider') return 'ollama';
            if (key === 'transcription_language') return '';
            return null;
          }
          if (channel === 'MLX_PREVIEW_HEALTH') return { status: 'ok' };
          if (channel === 'GET_MEETINGS') return [];
          if (channel === 'BOOT_PROBE_STATUS') return true;
          if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
          return null;
        }),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    window.__PLUTO_BROWSER_PREVIEW__ = undefined;
  });

  it('returns from home dashboard pill to the active Zen meeting', async () => {
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    expect(container.textContent).toContain('Dashboard');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });
    expect(container.textContent).toContain('Back home');
    expect(container.textContent).toContain('Live transcript');
    expect(container.textContent).not.toContain('Active recording');

    const backHome = container.querySelector<HTMLButtonElement>(
      'button.recording-back-home',
    );
    expect(backHome).not.toBeNull();
    await act(async () => {
      backHome?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Dashboard');
    expect(container.textContent).toContain('Meeting');
    expect(
      container.querySelector('[aria-label="Active recording"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'header.app-titlebar [aria-label="Active recording"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('.recording-name-status-dot--active'),
    ).not.toBeNull();

    const activeRecording = container.querySelector<HTMLElement>(
      '[aria-label="Active recording"]',
    );
    expect(activeRecording).not.toBeNull();
    await act(async () => {
      activeRecording?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Back home');
    expect(container.textContent).toContain('Live transcript');

    await act(async () => root.unmount());
  });
});
