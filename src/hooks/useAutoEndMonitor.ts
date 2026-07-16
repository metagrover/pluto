import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { autoEndDecision } from '../autoEnd/decision';

const AUTO_END_POLL_INTERVAL_MS = 10_000;
const TOAST_AUTO_DISMISS_MS = 30_000;

type UseAutoEndMonitorArgs = {
  isRecording: boolean;
  autoEndEnabled: boolean;
  stopSessionRef: MutableRefObject<((endReason?: string) => void) | null>;
};

type AutoEndState = {
  autoEndTriggered: boolean;
  autoEndReason: string | null;
  autoEndAppName: string | null;
};

export const useAutoEndMonitor = ({
  isRecording,
  autoEndEnabled,
  stopSessionRef,
}: UseAutoEndMonitorArgs) => {
  const [state, setState] = useState<AutoEndState>({
    autoEndTriggered: false,
    autoEndReason: null,
    autoEndAppName: null,
  });

  const graceTimerRef = useRef<number | null>(null);
  const graceActiveRef = useRef(false);
  const trackedAppRef = useRef<string | null>(null);
  const pollInFlightRef = useRef(false);
  const dismissTimeoutRef = useRef<number | null>(null);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current !== null) {
      window.clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    graceActiveRef.current = false;
  }, []);

  const dismissAutoEndToast = useCallback(() => {
    setState({
      autoEndTriggered: false,
      autoEndReason: null,
      autoEndAppName: null,
    });
    if (dismissTimeoutRef.current !== null) {
      window.clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isRecording || !autoEndEnabled) {
      clearGraceTimer();
      trackedAppRef.current = null;
      pollInFlightRef.current = false;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (pollInFlightRef.current || cancelled) return;
      pollInFlightRef.current = true;

      try {
        const result = await window.ipcRenderer.invoke('DETECT_ACTIVE_CALL');
        if (cancelled) return;

        const action = autoEndDecision({
          poll: {
            active: Boolean(result?.active),
            appName:
              typeof result?.appName === 'string' ? result.appName : null,
            confidence:
              result?.confidence === 'high' ||
              result?.confidence === 'medium' ||
              result?.confidence === 'low'
                ? result.confidence
                : 'low',
            reason: typeof result?.reason === 'string' ? result.reason : '',
          },
          trackedApp: trackedAppRef.current,
          graceActive: graceActiveRef.current,
        });

        switch (action.type) {
          case 'lock_app':
            trackedAppRef.current = action.appName;
            break;

          case 'cancel_grace':
            console.log('[AutoEnd] Call resumed, cancelling grace timer');
            void window.ipcRenderer.invoke('LOG_AUTO_END_EVENT', {
              reason_code: 'grace_cancelled',
              app_name: trackedAppRef.current,
            });
            clearGraceTimer();
            break;

          case 'start_grace': {
            const { graceMs, reasonCode } = action;
            const graceSeconds = Math.round(graceMs / 1000);

            console.log(
              `[AutoEnd] Call inactive (${reasonCode}), starting ${graceSeconds}s grace period`,
            );
            void window.ipcRenderer.invoke('LOG_AUTO_END_EVENT', {
              reason_code: reasonCode,
              app_name: trackedAppRef.current,
              grace_seconds: graceSeconds,
            });

            graceActiveRef.current = true;
            graceTimerRef.current = window.setTimeout(() => {
              if (cancelled) return;
              graceTimerRef.current = null;
              graceActiveRef.current = false;

              const endReasonStr = `auto:${reasonCode}`;
              console.log(
                `[AutoEnd] Grace expired, ending session (${endReasonStr})`,
              );

              void window.ipcRenderer.invoke('LOG_AUTO_END_EVENT', {
                reason_code: 'auto_end_completed',
                app_name: trackedAppRef.current,
                grace_seconds: graceSeconds,
              });

              if (stopSessionRef.current) {
                stopSessionRef.current(endReasonStr);
              }

              setState({
                autoEndTriggered: true,
                autoEndReason: reasonCode,
                autoEndAppName: trackedAppRef.current,
              });

              dismissTimeoutRef.current = window.setTimeout(() => {
                dismissAutoEndToast();
              }, TOAST_AUTO_DISMISS_MS);
            }, graceMs);
            break;
          }

          case 'no_op':
            break;
        }
      } catch (err) {
        console.error('[AutoEnd] Poll failed:', err);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, AUTO_END_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      clearGraceTimer();
      trackedAppRef.current = null;
    };
  }, [isRecording, autoEndEnabled]);

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  return {
    autoEndTriggered: state.autoEndTriggered,
    autoEndReason: state.autoEndReason,
    autoEndAppName: state.autoEndAppName,
    dismissAutoEndToast,
  };
};
