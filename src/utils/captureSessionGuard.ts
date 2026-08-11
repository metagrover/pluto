export const isCaptureSessionAlreadyActiveError = (error: unknown) =>
  String(error).includes('capture_session_already_active');

export const shouldPreventCaptureUnload = ({
  recording,
  processing,
}: {
  recording: boolean;
  processing: boolean;
}) => recording || processing;
