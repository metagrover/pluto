export const isGrantedStatus = (status: string) =>
  status === 'authorized' || status === 'granted';

export const shouldRunBootPermissionProbe = (setupNeeded: boolean | null) =>
  setupNeeded === false;

export const resolveMicrophoneStatus = (
  nativeStatus: string,
  probeSucceeded: boolean,
) => {
  if (isGrantedStatus(nativeStatus) || probeSucceeded) {
    return 'granted';
  }

  return nativeStatus || 'unknown';
};

export const resolveSystemAudioStatus = (
  probeSucceeded: boolean,
  allowSilent: boolean,
) => {
  if (probeSucceeded) return 'granted';
  return allowSilent ? 'unknown' : 'needs-audio';
};
