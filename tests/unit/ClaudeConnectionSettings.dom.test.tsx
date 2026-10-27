// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlutoMcpSnapshot } from '../../electron/mcp/types';
import { ChatGptConnectionSettings } from '../../src/components/features/ChatGptConnectionSettings';
import { ClaudeConnectionSettings } from '../../src/components/features/ClaudeConnectionSettings';

const api = vi.hoisted(() => ({
  getClaudeConnectionStatus: vi.fn(),
  setClaudeConnectionEnabled: vi.fn(),
  openClaude: vi.fn(),
  openClaudeSetupGuide: vi.fn(),
}));
const chatgpt = vi.hoisted(() => ({
  getChatGptConnectionStatus: vi.fn(),
  setChatGptConnectionEnabled: vi.fn(),
  openChatGpt: vi.fn(),
  openChatGptSetupGuide: vi.fn(),
}));
vi.mock('../../src/api/claudeConnection', () => api);
vi.mock('../../src/api/chatgptConnection', () => chatgpt);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const snapshot = (
  overrides: Partial<PlutoMcpSnapshot> = {},
): PlutoMcpSnapshot => ({
  enabled: false,
  running: false,
  pluginReady: false,
  pluginName: null,
  marketplaceName: null,
  error: null,
  ...overrides,
});
const ready = snapshot({
  enabled: true,
  running: true,
  pluginReady: true,
  pluginName: 'pluto-notes',
});
let root: Root | undefined;
const originalIpc = window.ipcRenderer;
const button = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  )!;
async function render(both = false) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <>
        {both ? <ChatGptConnectionSettings /> : null}
        <ClaudeConnectionSettings />
      </>,
    ),
  );
  return container;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getClaudeConnectionStatus.mockResolvedValue(snapshot());
  chatgpt.getChatGptConnectionStatus.mockResolvedValue(ready);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: originalIpc,
  });
});

describe('Claude meeting note access', () => {
  it('shows the handoff and Anthropic disclosure before requiring consent', async () => {
    const container = await render();
    expect(container.textContent).toContain('all your meeting notes');
    expect(container.textContent).toContain('sent to Anthropic');
    expect(container.textContent).toContain(
      'Raw transcripts and audio are not shared',
    );
    expect(container.textContent).toContain('Restart Claude once');
    expect(container.textContent).toContain('preserves existing connectors');
    expect(button(container, 'Connect to Claude').disabled).toBe(true);
    expect(api.setClaudeConnectionEnabled).not.toHaveBeenCalled();
    api.setClaudeConnectionEnabled.mockResolvedValue(ready);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to Claude').click());
    expect(api.setClaudeConnectionEnabled).toHaveBeenCalledWith(true);
    expect(api.openClaude).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Local setup ready',
    );
  });

  it('disables Claude independently while retaining ChatGPT access and requires consent to re-enable', async () => {
    api.getClaudeConnectionStatus.mockResolvedValue(ready);
    api.setClaudeConnectionEnabled.mockResolvedValue(snapshot());
    const container = await render(true);
    const claude = container.querySelector(
      '[aria-labelledby="claude-connection-heading"]',
    ) as HTMLElement;
    await act(async () => button(claude, 'Disable access').click());
    expect(api.setClaudeConnectionEnabled).toHaveBeenCalledWith(false);
    expect(chatgpt.setChatGptConnectionEnabled).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '[aria-labelledby="chatgpt-connection-heading"] [role="status"]',
      )?.textContent,
    ).toBe('Note access enabled');
    expect(button(claude, 'Connect to Claude').disabled).toBe(true);
    expect(claude.querySelector<HTMLInputElement>('input')!.checked).toBe(
      false,
    );
  });

  it('keeps disable available after incomplete setup and does not claim a Claude conversation succeeded', async () => {
    api.getClaudeConnectionStatus.mockResolvedValue(
      snapshot({ enabled: true, running: true, error: 'private details' }),
    );
    const container = await render();
    expect(container.textContent).toContain('Connection needs attention');
    expect(button(container, 'Disable access').disabled).toBe(false);
    expect(button(container, 'Open Claude Desktop')).toBeUndefined();
    expect(container.textContent).not.toContain('private details');
    expect(container.textContent).toContain('configuration is valid');
  });

  it('keeps the connection enabled when Claude is not installed', async () => {
    api.setClaudeConnectionEnabled.mockResolvedValue(ready);
    api.openClaude.mockRejectedValue(new Error('private failure'));
    const container = await render();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to Claude').click());
    expect(container.textContent).toContain('Local setup ready');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Install Claude Desktop',
    );
    expect(button(container, 'Disable access').disabled).toBe(false);
  });

  it('handles unavailable IPC and setup guide failures', async () => {
    api.getClaudeConnectionStatus.mockRejectedValue(new Error('unavailable'));
    api.openClaudeSetupGuide.mockRejectedValue(new Error('unavailable'));
    const container = await render();
    expect(container.textContent).toContain('Connection unavailable');
    expect(button(container, 'Connect to Claude').disabled).toBe(true);
    await act(async () => button(container, 'Open Claude setup guide').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'setup guide could not be opened',
    );
  });

  it('keeps the local-server handoff visible after setup instead of sending users to the directory', async () => {
    api.getClaudeConnectionStatus.mockResolvedValue(ready);
    const container = await render();
    const steps = container.querySelector('ol')!;
    expect(steps.closest('details')).toBeNull();
    expect(steps.textContent).toContain('Restart Claude once');
    expect(steps.textContent).toContain('Developer → Local MCP servers');
    expect(container.textContent).toContain(
      'won’t appear in Claude’s public connector directory',
    );
    expect(container.textContent).toContain('No servers added');
  });

  it('uses the development connector name', async () => {
    api.getClaudeConnectionStatus.mockResolvedValue({
      ...ready,
      pluginName: 'pluto-notes-development',
    });
    const container = await render();
    expect(container.querySelector('ol')?.textContent).toContain(
      'pluto-notes-development',
    );
    expect(container.textContent).toContain('Development connection');
  });

  it('locks while preparing, reports failures, and allows retry', async () => {
    let reject!: (reason: Error) => void;
    api.setClaudeConnectionEnabled.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    const container = await render();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to Claude').click());
    expect(button(container, 'Preparing…').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(
      true,
    );
    await act(async () => reject(new Error('private failure')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be enabled',
    );
    expect(button(container, 'Connect to Claude').disabled).toBe(false);
    expect(api.openClaude).not.toHaveBeenCalled();
  });
});

it('routes Claude desktop actions separately and validates status responses', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/api/claudeConnection')
  >('../../src/api/claudeConnection');
  const invoke = vi.fn().mockResolvedValue(snapshot());
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke },
  });
  await actual.getClaudeConnectionStatus();
  await actual.setClaudeConnectionEnabled(true);
  await actual.openClaude();
  await actual.openClaudeSetupGuide();
  expect(invoke.mock.calls).toEqual([
    ['PLUTO_CLAUDE_GET_STATUS'],
    ['PLUTO_CLAUDE_SET_ENABLED', { enabled: true }],
    ['PLUTO_CLAUDE_OPEN'],
    ['PLUTO_CLAUDE_OPEN_SETUP_GUIDE'],
  ]);
  invoke.mockResolvedValue({ enabled: true });
  await expect(actual.getClaudeConnectionStatus()).rejects.toThrow(
    'unavailable',
  );
});
