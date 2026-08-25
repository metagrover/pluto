// @vitest-environment happy-dom

import type React from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let recordingCompleted = false;

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: ({
    onStartSessionRef,
    onStopSessionRef,
    onRecordingStarted,
    onRecordingChange,
    onProcessingChange,
    onSessionComplete,
    onCaptureHealthChange,
    onLiveTranscriptIntegrityChange,
  }: {
    onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
    onStopSessionRef?: React.MutableRefObject<(() => void) | null>;
    onRecordingStarted?: (startedAtMs: number) => void;
    onRecordingChange?: (recording: boolean) => void;
    onProcessingChange?: (processing: boolean) => void;
    onSessionComplete?: (meetingId: string) => void | Promise<void>;
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
          recordingCompleted = true;
          onRecordingChange?.(false);
          onProcessingChange?.(false);
          void onSessionComplete?.('meeting-just-stopped');
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
      onSessionComplete,
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
    recordingCompleted = false;
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
          if (channel === 'RECORDING_READINESS_STATUS') {
            return {
              details: {
                parakeetClient: true,
                parakeetModel: true,
                parakeetEouReady: true,
                audiocapExists: true,
                audiocapExecutable: true,
              },
            };
          }
          if (channel === 'GET_MEETING_ENTITIES') return [];
          if (channel === 'intelligence:alerts') return [];
          if (channel === 'GET_MEETINGS') {
            return recordingCompleted
              ? [
                  {
                    id: 'meeting-just-stopped',
                    title: 'Just stopped meeting',
                    meeting_type: 'Recording',
                    created_at: '2026-08-17T18:00:00.000Z',
                    started_at: '2026-08-17T18:00:00.000Z',
                    transcript_status: 'validating',
                    finalization_status: 'finalized',
                    transcript_json: JSON.stringify({
                      lifecycleStatus: 'validating',
                      segments: [
                        {
                          speaker: 'Me',
                          text: 'Visible as soon as recording stops.',
                          startTime: 0,
                          endTime: 2,
                        },
                      ],
                    }),
                  },
                ]
              : [];
          }
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

  it('returns to the active Zen meeting from the sidebar after going home', async () => {
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
    const returnToRecording = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Return to recording'));
    expect(returnToRecording).not.toBeUndefined();

    await act(async () => {
      returnToRecording?.click();
      await flushPromises();
    });
    expect(container.textContent).toContain('Back home');
    expect(container.textContent).toContain('Live transcript');

    await act(async () => root.unmount());
  });

  it('opens a completed meeting on the note with Transcript secondary', async () => {
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
      await flushPromises();
    });

    const finish = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Finish recording'),
    );
    expect(finish).not.toBeUndefined();

    await act(async () => {
      finish?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Just stopped meeting');
    expect(
      container.querySelector('[data-meeting-artifact="analysis"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-meeting-transcript-toggle]')
        ?.click();
      await flushPromises();
    });
    expect(
      container.querySelector('[data-meeting-artifact="analysis"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-meeting-artifact="transcript"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      'Visible as soon as recording stops.',
    );

    await act(async () => root.unmount());
  });
});
