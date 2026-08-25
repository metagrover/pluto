import type { CaptureLifecycleSnapshot } from '../services/captureLifecycle.ts';

export const isCaptureSessionAlreadyActiveError = (error: unknown) =>
  String(error).includes('capture_session_already_active');

export const shouldPreventCaptureUnload = ({
  state,
}: CaptureLifecycleSnapshot) => state !== 'idle';

export const attachCaptureUnloadGuard = (
  target: EventTarget,
  state: {
    snapshot: () => CaptureLifecycleSnapshot;
  },
) => {
  const handleBeforeUnload = (event: Event) => {
    if (!shouldPreventCaptureUnload(state.snapshot())) {
      return;
    }
    event.preventDefault();
    if ('returnValue' in event) {
      (event as BeforeUnloadEvent).returnValue = '';
    }
  };

  target.addEventListener('beforeunload', handleBeforeUnload);
  return () => target.removeEventListener('beforeunload', handleBeforeUnload);
};
