import type { PlutoMcpSnapshot } from '../../electron/mcp/types';

export const invokeNotesConnection = async (
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

export const invokeNotesAction = async (channel: string): Promise<void> => {
  if (
    typeof window === 'undefined' ||
    window.__PLUTO_BROWSER_PREVIEW__ ||
    !window.ipcRenderer?.invoke
  )
    throw new Error('Use this action from the Pluto desktop app.');
  await window.ipcRenderer.invoke(channel);
};
