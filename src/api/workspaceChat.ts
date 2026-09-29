import type {
  WorkspaceChatMemory,
  WorkspaceChatMessage,
  WorkspaceChatMessagePayload,
  WorkspaceChatThread,
} from '../types/workspaceChat';

export const listWorkspaceChatThreads = (includeArchived = false) =>
  window.ipcRenderer.invoke<WorkspaceChatThread[]>(
    'intelligence:workspace-chat:list-threads',
    { includeArchived },
  );

export const createWorkspaceChatThread = () =>
  window.ipcRenderer.invoke<WorkspaceChatThread>(
    'intelligence:workspace-chat:create-thread',
  );

export const listWorkspaceChatMessages = (threadId: string) =>
  window.ipcRenderer.invoke<WorkspaceChatMessage[]>(
    'intelligence:workspace-chat:list-messages',
    threadId,
  );

export const appendWorkspaceChatMessage = (input: {
  id?: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  payload?: WorkspaceChatMessagePayload;
}) =>
  window.ipcRenderer.invoke<WorkspaceChatMessage>(
    'intelligence:workspace-chat:append-message',
    input,
  );

export const updateWorkspaceChatMessagePayload = (input: {
  threadId: string;
  messageId: string;
  payload: WorkspaceChatMessagePayload;
}) =>
  window.ipcRenderer.invoke<WorkspaceChatMessage>(
    'intelligence:workspace-chat:update-message-payload',
    input,
  );

export const updateWorkspaceChatMemory = (input: {
  threadId: string;
  memory: WorkspaceChatMemory;
}) =>
  window.ipcRenderer.invoke<WorkspaceChatThread>(
    'intelligence:workspace-chat:update-memory',
    input,
  );
