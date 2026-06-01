import type {
  AttentionItem,
  AttentionItemStatus,
} from '../../electron/intelligence/intelligenceTypes';

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getAttentionAlerts = async (): Promise<AttentionItem[]> => {
  return invoke('intelligence:alerts');
};

export const getMeetingAlerts = async (
  meetingId: string,
): Promise<AttentionItem[]> => {
  return invoke('intelligence:alerts', {
    meetingId,
    status: ['active', 'dismissed', 'snoozed'],
  });
};

export const updateAlertStatus = async (
  id: string,
  status: AttentionItemStatus,
): Promise<AttentionItem | null> => {
  return invoke('intelligence:alerts:update-status', id, status);
};
