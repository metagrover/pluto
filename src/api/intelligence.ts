import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getAttentionAlerts = async (): Promise<AttentionItem[]> => {
  return invoke('intelligence:alerts');
};
