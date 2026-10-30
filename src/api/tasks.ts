import type {
  SaveTaskInput,
  TaskChatProposal,
  TaskTag,
  TasksSnapshot,
} from '../types/tasks';

const mutate = async <T>(channel: string, payload: unknown): Promise<T> => {
  const result = await window.ipcRenderer.invoke(channel, payload);
  window.dispatchEvent(new Event('pluto:tasks-changed'));
  return result as T;
};

export const listTasks = (): Promise<TasksSnapshot> =>
  window.ipcRenderer.invoke('TASKS_LIST');
export const saveTask = (input: SaveTaskInput): Promise<string> =>
  mutate('TASKS_SAVE', input);
export const setTaskStatus = (
  id: string,
  status: 'active' | 'completed',
): Promise<void> => mutate('TASKS_STATUS', { id, status });
export const reviewTask = (
  id: string,
  state: 'confirmed' | 'rejected',
): Promise<void> => mutate('TASKS_REVIEW', { id, state });
export const setTaskFocus = (id: string, focused: boolean): Promise<void> =>
  mutate('TASKS_FOCUS', { id, focused });
export const saveTaskTag = (input: {
  id?: string;
  name: string;
}): Promise<TaskTag> => mutate('TASKS_TAG_SAVE', input);
export const removeTaskTag = (id: string, mergeInto?: string): Promise<void> =>
  mutate('TASKS_TAG_REMOVE', { id, mergeInto });
export const applyTaskChatAction = (
  proposal: TaskChatProposal,
  requestId: string,
): Promise<string> => mutate('TASKS_CHAT_APPLY', { proposal, requestId });

export const subscribeTasksChanged = (listener: () => void): (() => void) => {
  window.addEventListener('pluto:tasks-changed', listener);
  const unsubscribe = window.ipcRenderer.on?.('TASKS_CHANGED', listener);
  return () => {
    window.removeEventListener('pluto:tasks-changed', listener);
    if (typeof unsubscribe === 'function') unsubscribe();
  };
};
