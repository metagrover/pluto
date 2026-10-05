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

export async function refreshRecordingPermissions({
  invoke,
  probeMicrophone,
}: {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  probeMicrophone: () => Promise<boolean>;
}) {
  const nativeStatus = String(await invoke('CHECK_MICROPHONE_PERMISSION'));
  const mic = resolveMicrophoneStatus(
    nativeStatus,
    isGrantedStatus(nativeStatus) || (await probeMicrophone()),
  );
  let systemGranted = false;
  try {
    systemGranted = Boolean(
      await invoke('SYSTEM_AUDIO_PROBE', {
        durationMs: 1500,
        allowSilent: true,
        silentProbe: true,
      }),
    );
  } catch {
    // A failed probe leaves access unverified, not silently granted.
  }
  return { mic, systemAudio: resolveSystemAudioStatus(systemGranted, true) };
}
