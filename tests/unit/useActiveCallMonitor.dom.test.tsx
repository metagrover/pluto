// @vitest-environment happy-dom

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { useRef } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveCallMonitor } from '../../src/hooks/useActiveCallMonitor';

type HarnessProps = {
  isRecording?: boolean;
  isProcessing?: boolean;
  setupNeeded?: boolean;
};

const Harness = ({
  isRecording = false,
  isProcessing = false,
  setupNeeded = false,
}: HarnessProps) => {
  const startSessionRef = useRef<(() => void) | null>(vi.fn());
  useActiveCallMonitor({
    setupNeeded,
    isRecording,
    isProcessing,
    startSessionRef,
  });
  return null;
};

const flushPolling = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useActiveCallMonitor', () => {
  let container: HTMLDivElement;
  let root: Root;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    invoke = vi.fn();
    window.ipcRenderer = {
      invoke,
      send: vi.fn(),
      on: vi.fn(() => vi.fn()),
      off: vi.fn(),
    } as unknown as typeof window.ipcRenderer;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.classList.remove('dark');
  });

  it('shows one themed alert when monitoring starts during an active call', async () => {
    document.documentElement.classList.add('dark');
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'DETECT_ACTIVE_CALL') {
        return {
          active: true,
          appName: 'Google Meet',
          pidCount: 3,
          confidence: 'high',
          reason: 'call-app-running-with-active-audio',
        };
      }
      return true;
    });

    await act(async () => root.render(<Harness />));
    await flushPolling();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await flushPolling();

    expect(invoke).toHaveBeenCalledWith('SHOW_ACTIVE_CALL_ALERT', {
      appName: 'Google Meet',
      theme: 'dark',
    });
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === 'SHOW_ACTIVE_CALL_ALERT',
      ),
    ).toHaveLength(1);
  });

  it('waits for high confidence before showing the alert', async () => {
    const observations = [
      {
        active: true,
        appName: 'Zoom',
        pidCount: 2,
        confidence: 'medium',
        reason: 'call-app-running-silent-fallback',
      },
      {
        active: true,
        appName: 'Zoom',
        pidCount: 2,
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
    ];
    invoke.mockImplementation(async (channel: string) =>
      channel === 'DETECT_ACTIVE_CALL' ? observations.shift() : true,
    );

    await act(async () => root.render(<Harness />));
    await flushPolling();
    expect(invoke).not.toHaveBeenCalledWith(
      'SHOW_ACTIVE_CALL_ALERT',
      expect.anything(),
    );

    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await flushPolling();
    expect(invoke).toHaveBeenCalledWith('SHOW_ACTIVE_CALL_ALERT', {
      appName: 'Zoom',
      theme: 'light',
    });
  });

  it('retries a high-confidence alert when the controller initially suppresses it', async () => {
    let showAttempts = 0;
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'DETECT_ACTIVE_CALL') {
        return {
          active: true,
          appName: 'Slack',
          pidCount: 2,
          confidence: 'high',
          reason: 'call-app-running-with-active-audio',
        };
      }
      if (channel === 'SHOW_ACTIVE_CALL_ALERT') {
        showAttempts += 1;
        return showAttempts > 1;
      }
      return true;
    });

    await act(async () => root.render(<Harness />));
    await flushPolling();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await flushPolling();

    expect(showAttempts).toBe(2);
  });

  it('does not notify again for a leave and rejoin inside the cooldown', async () => {
    const observations = [
      {
        active: true,
        appName: 'Zoom',
        pidCount: 2,
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
      {
        active: false,
        appName: 'Zoom',
        pidCount: 2,
        confidence: 'low',
        reason: 'call-app-running-without-target-audio',
      },
      {
        active: true,
        appName: 'Zoom',
        pidCount: 2,
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      },
    ];
    invoke.mockImplementation(async (channel: string) =>
      channel === 'DETECT_ACTIVE_CALL'
        ? (observations.shift() ?? observations.at(-1))
        : true,
    );

    await act(async () => root.render(<Harness />));
    await flushPolling();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await flushPolling();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await flushPolling();

    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === 'SHOW_ACTIVE_CALL_ALERT',
      ),
    ).toHaveLength(1);
  });

  it('logs browser inspection failure once without exposing tab data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    invoke.mockImplementation(async (channel: string) =>
      channel === 'DETECT_ACTIVE_CALL'
        ? {
            active: false,
            appName: 'Chrome',
            pidCount: 4,
            confidence: 'low',
            reason: 'browser-tab-inspection-unavailable',
          }
        : true,
    );

    await act(async () => root.render(<Harness />));
    await flushPolling();
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    await flushPolling();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.join(' ')).not.toContain('http');
  });

  it('hides only the call alert while recording without polling detection', async () => {
    invoke.mockResolvedValue(true);

    await act(async () => root.render(<Harness isRecording />));
    await flushPolling();

    expect(invoke).toHaveBeenCalledWith('HIDE_ACTIVE_CALL_ALERT');
    expect(invoke).not.toHaveBeenCalledWith('DETECT_ACTIVE_CALL');
  });

  it('does not show a fresh alert immediately after capture finishes', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'DETECT_ACTIVE_CALL') {
        return {
          active: true,
          appName: 'Google Meet',
          pidCount: 3,
          confidence: 'high',
          reason: 'call-app-running-with-active-audio',
        };
      }
      return true;
    });

    await act(async () => root.render(<Harness isRecording />));
    await flushPolling();
    await act(async () => root.render(<Harness />));
    await flushPolling();

    expect(invoke).not.toHaveBeenCalledWith(
      'SHOW_ACTIVE_CALL_ALERT',
      expect.anything(),
    );
  });
});
