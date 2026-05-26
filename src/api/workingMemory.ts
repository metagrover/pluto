import type {
  WorkingMemorySnapshot,
  WorkingMemorySnapshotScopeType,
} from '../../electron/db';

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getWorkingMemorySnapshot = async (
  scopeType: WorkingMemorySnapshotScopeType,
  scopeKey: string,
): Promise<WorkingMemorySnapshot | undefined> => {
  return invoke('GET_WORKING_MEMORY_SNAPSHOT', { scopeType, scopeKey });
};

export const listWorkingMemorySnapshots = async (): Promise<
  WorkingMemorySnapshot[]
> => {
  return invoke('LIST_WORKING_MEMORY_SNAPSHOTS');
};
