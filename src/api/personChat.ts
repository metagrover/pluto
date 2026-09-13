import type {
  PersonChatMessage,
  PersonChatResponse,
  PersonChatSendRequest,
  PersonChatThread,
} from '../types/personChat';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  window.ipcRenderer.invoke(channel, ...args);

export const getPersonChatCapability = (): Promise<{ enabled: boolean }> =>
  invoke('intelligence:person-chat:capability');

export const listPersonChatThreads = (
  personId: string,
  includeArchived = false,
): Promise<PersonChatThread[]> =>
  invoke('intelligence:person-chat:list-threads', {
    personId,
    includeArchived,
  });

export const createPersonChatThread = (
  personId: string,
): Promise<PersonChatThread> =>
  invoke('intelligence:person-chat:create-thread', personId);

export const archivePersonChatThread = (
  personId: string,
  threadId: string,
): Promise<PersonChatThread> =>
  invoke('intelligence:person-chat:archive-thread', { personId, threadId });

export const resumePersonChatThread = (
  personId: string,
  threadId: string,
): Promise<PersonChatThread> =>
  invoke('intelligence:person-chat:resume-thread', { personId, threadId });

export const listPersonChatMessages = (
  personId: string,
  threadId: string,
): Promise<PersonChatMessage[]> =>
  invoke('intelligence:person-chat:list-messages', { personId, threadId });

export const sendPersonChatMessage = (
  request: PersonChatSendRequest,
): Promise<PersonChatResponse> =>
  invoke('intelligence:person-chat:send', request);

export const cancelPersonChatRequest = (
  requestId: string,
): Promise<{ cancelled: boolean }> =>
  invoke('intelligence:person-chat:cancel', requestId);
