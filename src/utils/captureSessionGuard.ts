export const isCaptureSessionAlreadyActiveError = (error: unknown) =>
  String(error).includes('capture_session_already_active');

export const shouldPreventCaptureUnload = ({
  recording,
  processing,
}: {
  recording: boolean;
  processing: boolean;
}) => recording || processing;

export const attachCaptureUnloadGuard = (
  target: EventTarget,
  state: {
    isRecording: () => boolean;
    isProcessing: () => boolean;
  },
) => {
  const handleBeforeUnload = (event: Event) => {
    if (
      !shouldPreventCaptureUnload({
        recording: state.isRecording(),
        processing: state.isProcessing(),
      })
    ) {
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
