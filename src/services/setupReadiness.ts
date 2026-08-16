export type SetupReadinessInput = {
  transcription: 'checking' | 'preparing' | 'ready' | 'error';
  microphone: 'checking' | 'granted' | 'blocked';
  systemAudio: 'checking' | 'granted' | 'blocked';
};

export type SetupReadiness = {
  status: 'preparing' | 'blocked' | 'ready';
  canComplete: boolean;
  action: 'wait' | 'retry-model' | 'open-permissions' | 'finish';
};

export const deriveSetupReadiness = (
  input: SetupReadinessInput,
): SetupReadiness => {
  if (
    input.transcription === 'checking' ||
    input.transcription === 'preparing' ||
    input.microphone === 'checking' ||
    input.systemAudio === 'checking'
  ) {
    return { status: 'preparing', canComplete: false, action: 'wait' };
  }
  if (input.transcription === 'error') {
    return { status: 'blocked', canComplete: false, action: 'retry-model' };
  }
  if (input.microphone === 'blocked' || input.systemAudio === 'blocked') {
    return {
      status: 'blocked',
      canComplete: false,
      action: 'open-permissions',
    };
  }
  return { status: 'ready', canComplete: true, action: 'finish' };
};
