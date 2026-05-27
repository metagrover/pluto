export type AttentionItemKind =
  | 'follow_up'
  | 'blocker'
  | 'risk'
  | 'dependency'
  | 'open_question'
  | 'stale_context'
  | 'repeated_pattern'
  | 'decision_conflict'
  | 'duplicate_commitment'
  | 'reference_context'
  | 'source_quality';

export type AttentionItemStatus =
  | 'active'
  | 'snoozed'
  | 'dismissed'
  | 'resolved'
  | 'pinned'
  | 'stale'
  | 'superseded';

export interface AttentionItem {
  id: string;
  kind: AttentionItemKind;
  status: AttentionItemStatus;
  related_entity_ids: string[];
  related_meeting_ids: string[];
}

const invoke = <T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
};

export const getMeetingAlerts = async (
  meetingId: string,
): Promise<AttentionItem[]> => {
  return invoke('intelligence:alerts', {
    meetingId,
    status: ['active', 'dismissed'],
  });
};

export const updateAlertStatus = async (
  id: string,
  status: AttentionItemStatus,
): Promise<AttentionItem | null> => {
  return invoke('intelligence:alerts:update-status', id, status);
};
