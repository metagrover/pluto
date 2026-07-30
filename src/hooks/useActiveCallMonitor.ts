import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { isAlertEligible } from '../activeCall/alertDecision';

const ACTIVE_CALL_ALERT_COOLDOWN_MS = 30_000;
const ACTIVE_CALL_POLL_INTERVAL_MS = 6_000;

type UseActiveCallMonitorArgs = {
  setupNeeded: boolean | null;
  isRecording: boolean;
  isProcessing: boolean;
  startSessionRef: MutableRefObject<(() => void) | null>;
};

export const useActiveCallMonitor = ({
  setupNeeded,
  isRecording,
  isProcessing,
  startSessionRef,
}: UseActiveCallMonitorArgs) => {
  const activeCallAlertInFlightRef = useRef<string | null>(null);
  const activeCallAlertCooldownRef = useRef<Map<string, number>>(new Map());
  const callMonitorInitializedRef = useRef(false);
  const callMonitorWasActiveRef = useRef(false);
  const callMonitorLastAppRef = useRef<string | null>(null);
  const callMonitorLastConfidenceRef = useRef<'low' | 'medium' | 'high'>('low');
  const callMonitorLastPidCountRef = useRef<number | null>(null);
  const callMonitorPollInFlightRef = useRef(false);
  const alertVisibilityAutoResetRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    isProcessingRef.current = isProcessing;
  }, [isRecording, isProcessing]);

  const setCallAlertVisibility = async (
    visible: boolean,
    appName?: string,
  ): Promise<boolean> => {
    if (alertVisibilityAutoResetRef.current !== null) {
      window.clearTimeout(alertVisibilityAutoResetRef.current);
      alertVisibilityAutoResetRef.current = null;
    }

    if (visible) {
      const shown = await window.ipcRenderer.invoke('SHOW_ACTIVE_CALL_ALERT', {
        appName: appName || 'Call',
      });
      if (!shown) {
        return false;
      }
      alertVisibilityAutoResetRef.current = window.setTimeout(() => {
        alertVisibilityAutoResetRef.current = null;
      }, 16000);
      return true;
    }

    await window.ipcRenderer.invoke('HIDE_ACTIVE_CALL_ALERT');
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const pollActiveCall = async () => {
      if (callMonitorPollInFlightRef.current) return;
      callMonitorPollInFlightRef.current = true;
      if (setupNeeded !== false || isRecording || isProcessing) {
        activeCallAlertInFlightRef.current = null;
        callMonitorInitializedRef.current = false;
        callMonitorWasActiveRef.current = false;
        callMonitorLastAppRef.current = null;
        callMonitorLastConfidenceRef.current = 'low';
        await setCallAlertVisibility(false);
        callMonitorPollInFlightRef.current = false;
        return;
      }

      try {
        const result = await window.ipcRenderer.invoke('DETECT_ACTIVE_CALL');
        if (cancelled) return;

        const appName =
          typeof result?.appName === 'string' ? result.appName : null;
        const pidCount = Number.isInteger(result?.pidCount)
          ? Number(result.pidCount)
          : null;
        const confidence =
          result?.confidence === 'high' || result?.confidence === 'medium'
            ? result.confidence
            : 'low';
        const isActive = isAlertEligible({
          active: Boolean(result?.active),
          appName,
          confidence,
        });

        // Establish startup baseline: do not alert for calls that were already active
        // before monitoring began.
        if (!callMonitorInitializedRef.current) {
          const baselineActive = isActive;
          callMonitorInitializedRef.current = true;
          callMonitorWasActiveRef.current = baselineActive;
          callMonitorLastAppRef.current = baselineActive ? appName : null;
          callMonitorLastConfidenceRef.current = baselineActive
            ? confidence
            : 'low';
          callMonitorLastPidCountRef.current = baselineActive ? pidCount : null;
          // Do not mark in-flight on baseline; this allows a later
          // medium->high upgrade on the same app to still trigger an alert.
          activeCallAlertInFlightRef.current = null;
          return;
        }

        if (!isActive || !appName) {
          activeCallAlertInFlightRef.current = null;
          callMonitorWasActiveRef.current = false;
          callMonitorLastAppRef.current = null;
          callMonitorLastConfidenceRef.current = 'low';
          callMonitorLastPidCountRef.current = null;
          await setCallAlertVisibility(false);
          return;
        }

        const previousApp = callMonitorLastAppRef.current;
        const previousConfidence = callMonitorLastConfidenceRef.current;
        const previousPidCount = callMonitorLastPidCountRef.current;
        const isFreshJoin =
          !callMonitorWasActiveRef.current || previousApp !== appName;
        const confidenceEscalatedToHigh =
          !isFreshJoin &&
          previousApp === appName &&
          previousConfidence !== 'high' &&
          confidence === 'high';
        const pidCountIncreased =
          !isFreshJoin &&
          previousApp === appName &&
          typeof previousPidCount === 'number' &&
          typeof pidCount === 'number' &&
          pidCount > previousPidCount;
        callMonitorWasActiveRef.current = true;
        callMonitorLastAppRef.current = appName;
        callMonitorLastConfidenceRef.current = confidence;
        callMonitorLastPidCountRef.current = pidCount;

        if (
          (isFreshJoin || confidenceEscalatedToHigh || pidCountIncreased) &&
          activeCallAlertInFlightRef.current !== appName
        ) {
          const now = Date.now();
          const lastShownAt =
            activeCallAlertCooldownRef.current.get(appName) ?? 0;
          if (now - lastShownAt < ACTIVE_CALL_ALERT_COOLDOWN_MS) {
            activeCallAlertInFlightRef.current = appName;
            return;
          }

          activeCallAlertInFlightRef.current = appName;
          activeCallAlertCooldownRef.current.set(appName, now);
          const shown = await setCallAlertVisibility(true, appName);
          if (!shown) {
            activeCallAlertInFlightRef.current = null;
          }
        }
      } catch {
        activeCallAlertInFlightRef.current = null;
        callMonitorInitializedRef.current = false;
        callMonitorWasActiveRef.current = false;
        callMonitorLastAppRef.current = null;
        callMonitorLastConfidenceRef.current = 'low';
        callMonitorLastPidCountRef.current = null;
      } finally {
        callMonitorPollInFlightRef.current = false;
      }
    };

    void pollActiveCall();
    intervalId = window.setInterval(() => {
      void pollActiveCall();
    }, ACTIVE_CALL_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [setupNeeded, isRecording, isProcessing]);

  useEffect(() => {
    return () => {
      if (alertVisibilityAutoResetRef.current !== null) {
        window.clearTimeout(alertVisibilityAutoResetRef.current);
        alertVisibilityAutoResetRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleTakeNotesFromAlert = () => {
      if (isRecordingRef.current || isProcessingRef.current) return;

      if (startSessionRef.current) {
        startSessionRef.current();
        return;
      }

      // Fallback for cases where the ref hasn't been wired yet.
      window.dispatchEvent(new Event('START_RECORDING'));
    };

    window.ipcRenderer.on('ACTIVE_CALL_TAKE_NOTES', handleTakeNotesFromAlert);
    return () =>
      window.ipcRenderer.off(
        'ACTIVE_CALL_TAKE_NOTES',
        handleTakeNotesFromAlert,
      );
  }, [startSessionRef]);
};
