import type { ProviderType } from './provider';

export type InferenceActivity = {
  requestId: string;
  task: string;
  provider: ProviderType;
  model: string;
  location: 'local' | 'cloud';
  state: 'started' | 'completed' | 'failed' | 'cancelled';
  at: number;
};

const listeners = new Set<(activity: InferenceActivity) => void>();

export const publishInferenceActivity = (activity: InferenceActivity) => {
  for (const listener of listeners) listener(activity);
};

export const subscribeInferenceActivity = (
  listener: (activity: InferenceActivity) => void,
) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
