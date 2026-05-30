import type {
  AttentionItem,
  AttentionItemStatus,
} from '../../electron/intelligence/intelligenceTypes';

export interface AttentionItemQueryOptions {
  meetingId?: string;
  limit?: number;
  status?: AttentionItemStatus | AttentionItemStatus[];
}

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getAttentionItems = async (
  options?: AttentionItemQueryOptions,
): Promise<AttentionItem[]> => {
  return invoke('intelligence:alerts', options);
};

export const clearAttentionItemsForMeeting = async (
  meetingId: string,
): Promise<boolean> => {
  return invoke('intelligence:alerts:clear', meetingId);
};

export const updateAttentionItemStatus = async (
  id: string,
  status: AttentionItemStatus,
): Promise<AttentionItem | null> => {
  return invoke('intelligence:alerts:update-status', id, status);
};

export const getAttentionAlerts = async (): Promise<AttentionItem[]> => {
  return getAttentionItems();
};

export const getMeetingAlerts = async (
  meetingId: string,
): Promise<AttentionItem[]> => {
  return getAttentionItems({
    meetingId,
    status: ['active', 'dismissed'],
  });
};

export const updateAlertStatus = async (
  id: string,
  status: AttentionItemStatus,
): Promise<AttentionItem | null> => {
  return updateAttentionItemStatus(id, status);
};
