import type { PollInput } from './decision';

export type ObservationEvent = {
  signature: string;
  reasonCode:
    | 'call_observation_high'
    | 'call_observation_medium'
    | 'call_observation_low';
  appName: string | null;
};

export const toObservationEvent = (
  previousSignature: string | null,
  poll: PollInput,
): ObservationEvent | null => {
  const signature = `${poll.appName ?? ''}|${poll.confidence}|${poll.reason}`;
  if (signature === previousSignature) return null;

  return {
    signature,
    reasonCode: `call_observation_${poll.confidence}`,
    appName: poll.appName,
  };
};
