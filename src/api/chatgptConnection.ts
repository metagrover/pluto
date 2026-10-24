import type { PlutoMcpSnapshot } from '../../electron/mcp/types';

export type { PlutoMcpSnapshot };
import { invokeNotesConnection as invoke } from './notesConnection';

export const getChatGptConnectionStatus = (): Promise<PlutoMcpSnapshot> =>
  invoke('PLUTO_MCP_GET_STATUS');

export const setChatGptConnectionEnabled = (
  enabled: boolean,
): Promise<PlutoMcpSnapshot> => invoke('PLUTO_MCP_SET_ENABLED', { enabled });

export const openChatGptSetupGuide = async (): Promise<void> => {
  if (
    typeof window === 'undefined' ||
    window.__PLUTO_BROWSER_PREVIEW__ ||
    !window.ipcRenderer?.invoke
  ) {
    throw new Error('Open the setup guide from the Pluto desktop app.');
  }
  await window.ipcRenderer.invoke('PLUTO_MCP_OPEN_SETUP_GUIDE');
};

export const openChatGpt = async (): Promise<void> => {
  if (
    typeof window === 'undefined' ||
    window.__PLUTO_BROWSER_PREVIEW__ ||
    !window.ipcRenderer?.invoke
  ) {
    throw new Error('Open ChatGPT from the Pluto desktop app.');
  }
  await window.ipcRenderer.invoke('PLUTO_MCP_OPEN_CHATGPT');
};
