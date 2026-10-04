import type { PlutoMcpSnapshot } from '../../electron/mcp/types';

export type { PlutoMcpSnapshot };

const invoke = async (
  channel: string,
  ...args: unknown[]
): Promise<PlutoMcpSnapshot> => {
  if (
    typeof window === 'undefined' ||
    window.__PLUTO_BROWSER_PREVIEW__ ||
    !window.ipcRenderer?.invoke
  ) {
    throw new Error('This connection is available in the Pluto desktop app.');
  }
  const result = await window.ipcRenderer.invoke(channel, ...args);
  if (
    !result ||
    typeof result !== 'object' ||
    typeof result.enabled !== 'boolean' ||
    typeof result.running !== 'boolean' ||
    typeof result.pluginReady !== 'boolean' ||
    !['pluginName', 'marketplaceName', 'error'].every(
      (field) => result[field] === null || typeof result[field] === 'string',
    )
  ) {
    throw new Error('This connection is unavailable in this version of Pluto.');
  }
  return result as PlutoMcpSnapshot;
};

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
