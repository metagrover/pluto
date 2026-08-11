// @vitest-environment happy-dom

import { type MutableRefObject, act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GRACE_SHORT_MS } from '../../src/autoEnd/decision';
import { useAutoEndMonitor } from '../../src/hooks/useAutoEndMonitor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({
  stopSessionRef,
}: {
  stopSessionRef: MutableRefObject<((reason?: string) => void) | null>;
}) => {
  useAutoEndMonitor({
    isRecording: true,
    autoEndEnabled: true,
    stopSessionRef,
  });
  return null;
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each(['Zoom', 'Chrome'])('useAutoEndMonitor for %s', (appName) => {
  it('ends through the shared stop-session callback after the call app exits', async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn();
    const stopSessionRef = createRef<((reason?: string) => void) | null>();
    stopSessionRef.current = stopSession;
    let detectionCount = 0;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'DETECT_ACTIVE_CALL') {
        detectionCount += 1;
        return detectionCount === 1
          ? {
              active: true,
              appName,
              confidence: 'high',
              reason: 'call-app-running-with-active-audio',
            }
          : {
              active: false,
              appName: null,
              confidence: 'low',
              reason: 'no-call-app-running',
            };
      }
      return true;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness, { stopSessionRef }));
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledWith('DETECT_ACTIVE_CALL');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(detectionCount).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_SHORT_MS);
    });
    expect(stopSession).toHaveBeenCalledOnce();
    expect(stopSession).toHaveBeenCalledWith('auto:call_app_exited');

    await act(async () => root.unmount());
  });
});
