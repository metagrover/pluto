import { useEffect, useState } from 'react';
import type { InferenceActivity } from '../../electron/llm/inferenceActivity';

export const useInferenceActivity = (tasks?: string[]) => {
  const [activities, setActivities] = useState(
    () => new Map<string, InferenceActivity>(),
  );
  useEffect(() => {
    if (typeof window.ipcRenderer?.on !== 'function') return undefined;
    const unsubscribe = window.ipcRenderer.on(
      'llm:activity',
      (_event, activity) => {
        const value = activity as InferenceActivity;
        setActivities((current) => {
          const next = new Map(current);
          if (value.state === 'started') next.set(value.requestId, value);
          else next.delete(value.requestId);
          return next;
        });
      },
    );
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, []);
  return [...activities.values()].find(
    (activity) => !tasks || tasks.includes(activity.task),
  );
};
