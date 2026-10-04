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

export const preparationFailureCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  return /^parakeet_[a-z_]{1,64}$/.test(message)
    ? message
    : 'parakeet_setup_failed';
};

export const describeTranscriptionSetupFailure = (status?: {
  preparationError?: string;
  details?: {
    audiocapExists: boolean;
    audiocapExecutable: boolean;
    parakeetClient: boolean;
  };
}) => {
  const details = status?.details;
  const code = status?.preparationError
    ? preparationFailureCode(new Error(status.preparationError))
    : details && !details.audiocapExists
      ? 'audiocap_missing'
      : details && !details.audiocapExecutable
        ? 'audiocap_not_executable'
        : details && !details.parakeetClient
          ? 'parakeet_client_missing'
          : 'parakeet_setup_failed';
  let message =
    'Pluto could not verify local transcription. Try again. If it fails again, share the setup code below.';
  if (code === 'parakeet_model_preparation_failed') {
    message =
      'The model download or verification failed. Check your connection and available disk space, then try again.';
  } else if (
    code === 'parakeet_process_error' ||
    code === 'parakeet_client_missing' ||
    code.startsWith('audiocap_')
  ) {
    message =
      'Pluto could not start a required recording component. Reinstall the current release and check whether macOS blocked Pluto in Privacy & Security.';
  } else if (code === 'parakeet_process_exited') {
    message =
      'The local transcription runtime stopped unexpectedly. Reopen Pluto. If it happens again, share the setup code below.';
  } else if (code === 'parakeet_request_timeout') {
    message =
      'Local transcription setup timed out. Try again; Pluto will reuse verified models already on this Mac.';
  }
  return { code, message };
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
