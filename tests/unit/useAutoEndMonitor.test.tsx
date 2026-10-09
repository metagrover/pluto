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
              sourceApp: appName === 'Chrome' ? 'Google Chrome' : 'Zoom',
              confidence: 'medium',
              reason:
                appName === 'Zoom'
                  ? 'call-app-running-silent-fallback'
                  : 'browser-call-tab-open-silent-fallback',
            }
          : {
              active: false,
              appName: null,
              confidence: 'low',
              reason:
                appName === 'Chrome'
                  ? 'browser-call-tab-closed'
                  : 'no-call-app-running',
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
    expect(invoke).toHaveBeenCalledWith('LOG_AUTO_END_EVENT', {
      reason_code: 'call_app_locked',
      app_name: appName,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(detectionCount).toBe(2);
    expect(invoke).toHaveBeenCalledWith(
      'DETECT_ACTIVE_CALL',
      appName === 'Chrome' ? 'Google Chrome' : 'Zoom',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_SHORT_MS);
    });
    expect(stopSession).toHaveBeenCalledOnce();
    expect(stopSession).toHaveBeenCalledWith('auto:call_app_exited');

    await act(async () => root.unmount());
  });
});

describe('quiet meeting breaks', () => {
  it.each(['inactive', 'resumed', 'unavailable', 'exited'])(
    'handles %s after a quiet break without an inactivity deadline',
    async (outcome) => {
      vi.useFakeTimers();
      const stopSession = vi.fn();
      const stopSessionRef = createRef<((reason?: string) => void) | null>();
      stopSessionRef.current = stopSession;
      let count = 0;
      const active = {
        active: true,
        appName: 'Zoom',
        confidence: 'high',
        reason: 'call-app-running-with-active-audio',
      };
      const inactive = {
        active: false,
        appName: 'Zoom',
        confidence: 'low',
        reason: 'call-app-running-without-target-audio',
      };
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: {
          invoke: vi.fn(async (channel: string) => {
            if (channel !== 'DETECT_ACTIVE_CALL') return true;
            count += 1;
            if (count === 1) return active;
            if (count === 2 || outcome === 'inactive') return inactive;
            if (outcome === 'resumed') return active;
            return {
              ...inactive,
              reason:
                outcome === 'exited'
                  ? 'no-call-app-running'
                  : 'browser-tab-inspection-unavailable',
            };
          }),
        },
      });
      const root = createRoot(document.createElement('div'));
      await act(async () =>
        root.render(createElement(Harness, { stopSessionRef })),
      );
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(stopSession).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(5_001));
      if (outcome === 'exited') {
        expect(stopSession).toHaveBeenCalledExactlyOnceWith(
          'auto:call_app_exited',
        );
      } else {
        expect(stopSession).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(30 * 60_000));
        expect(stopSession).not.toHaveBeenCalled();
      }
      await act(async () => root.unmount());
    },
  );
});
