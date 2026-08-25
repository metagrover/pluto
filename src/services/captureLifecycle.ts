export type CaptureLifecycleState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'sealing';

export type CaptureLifecycleSnapshot = {
  state: CaptureLifecycleState;
};

export type CaptureStartResult =
  | { admitted: true; meetingId: string }
  | {
      admitted: false;
      state: CaptureLifecycleState;
      reason: string;
    };

export type CaptureAction = {
  label: string;
  enabled: boolean;
  command: 'start' | 'return' | 'wait';
};

export const resolveCaptureAction = (
  snapshot: CaptureLifecycleSnapshot,
): CaptureAction => {
  if (snapshot.state === 'idle') {
    return { label: 'New meeting', enabled: true, command: 'start' };
  }
  if (snapshot.state === 'recording') {
    return {
      label: 'Return to recording',
      enabled: true,
      command: 'return',
    };
  }
  return {
    label:
      snapshot.state === 'starting' ? 'Starting meeting' : 'Finishing meeting',
    enabled: false,
    command: 'wait',
  };
};
