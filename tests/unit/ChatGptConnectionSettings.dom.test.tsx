// @vitest-environment happy-dom

import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlutoMcpSnapshot } from '../../electron/mcp/types';
import { ChatGptConnectionSettings } from '../../src/components/features/ChatGptConnectionSettings';

const api = vi.hoisted(() => ({
  getChatGptConnectionStatus: vi.fn(),
  setChatGptConnectionEnabled: vi.fn(),
  openChatGptSetupGuide: vi.fn(),
  openChatGpt: vi.fn(),
}));
vi.mock('../../src/api/chatgptConnection', () => api);
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
let root: Root | undefined;
const originalIpc = window.ipcRenderer;
const render = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const currentRoot = createRoot(container);
  root = currentRoot;
  await act(async () => currentRoot.render(<ChatGptConnectionSettings />));
  return container;
};
const button = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  )!;
beforeEach(() => {
  vi.resetAllMocks();
  api.getChatGptConnectionStatus.mockResolvedValue(snapshot());
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: originalIpc,
  });
  document.body.innerHTML = '';
});

describe('ChatGptConnectionSettings', () => {
  it('requires explicit informed consent before starting the service', async () => {
    const container = await render();
    expect(container.textContent).toContain('all your meeting notes');
    expect(container.textContent).toContain('sent to OpenAI');
    expect(container.textContent).toContain(
      'Raw transcripts and audio are not shared',
    );
    expect(container.textContent).toContain('ChatGPT desktop app');
    const enable = button(container, 'Connect to ChatGPT');
    expect(enable.disabled).toBe(true);
    expect(api.setChatGptConnectionEnabled).not.toHaveBeenCalled();
    api.setChatGptConnectionEnabled.mockResolvedValue(
      snapshot({ enabled: true, running: true, pluginReady: true }),
    );
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    expect(enable.disabled).toBe(false);
    await act(async () => enable.click());
    expect(api.setChatGptConnectionEnabled).toHaveBeenCalledWith(true);
    expect(api.openChatGpt).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Local setup complete');
    expect(container.textContent).not.toMatch(/ChatGPT connected/i);
  });

  it('shows the complete handoff before consent or connection', async () => {
    const container = await render();
    const guide = container.querySelector('ol')!;
    expect(guide.querySelectorAll('li')).toHaveLength(3);
    expect(guide.textContent).toContain('Restart ChatGPT once');
    expect(guide.textContent).toContain('Start a new Work chat');
    expect(guide.textContent).toContain('Type @ and select Pluto');
    expect(guide.textContent).toContain(
      'What did we decide in my latest meeting?',
    );
    expect(
      guide.compareDocumentPosition(button(container, 'Connect to ChatGPT')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(api.setChatGptConnectionEnabled).not.toHaveBeenCalled();
    expect(api.openChatGpt).not.toHaveBeenCalled();
  });

  it('uses the installed development plugin name in the guide', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({
        enabled: true,
        running: true,
        pluginReady: true,
        pluginName: 'pluto-notes-development',
      }),
    );
    const container = await render();
    expect(container.textContent).toContain(
      'Type @ and select Pluto (Development)',
    );
    expect(container.querySelector('figure')?.textContent).toContain(
      '@Pluto (Development)',
    );
    expect(container.textContent).toContain('Your next steps in ChatGPT');
  });

  it('locks the control while enabling and recovers after a failure', async () => {
    let reject!: (error: Error) => void;
    api.setChatGptConnectionEnabled.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    const container = await render();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to ChatGPT').click());
    expect(button(container, 'Preparing…').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(
      true,
    );
    await act(async () => reject(new Error('private error details')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be enabled',
    );
    expect(container.textContent).not.toContain('private error details');
    expect(api.openChatGpt).not.toHaveBeenCalled();
    expect(button(container, 'Connect to ChatGPT').disabled).toBe(false);
  });

  it('disables access and requires fresh consent for re-enabling', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({ enabled: true, running: true, pluginReady: true }),
    );
    api.setChatGptConnectionEnabled.mockResolvedValue(snapshot());
    const container = await render();
    expect(container.textContent).toContain('Disabling revokes future access');
    await act(async () => button(container, 'Disable access').click());
    expect(api.setChatGptConnectionEnabled).toHaveBeenCalledWith(false);
    expect(api.openChatGpt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Access disabled');
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(
      false,
    );
    expect(button(container, 'Connect to ChatGPT').disabled).toBe(true);
  });

  it('keeps disable available after a start failure and explains errors', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({ enabled: true, error: 'internal failure' }),
    );
    const container = await render();
    expect(container.textContent).toContain('Connection needs attention');
    expect(button(container, 'Disable access').disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('handles unavailable desktop IPC calmly', async () => {
    api.getChatGptConnectionStatus.mockRejectedValue(new Error('unsupported'));
    const container = await render();
    expect(container.textContent).toContain('Local service unavailable');
    expect(container.textContent).toContain('Pluto desktop app');
    expect(button(container, 'Connect to ChatGPT').disabled).toBe(true);
  });

  it('explains local Work usage and opens ChatGPT and help', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({
        enabled: true,
        running: true,
        pluginReady: true,
        marketplaceName: 'Personal plugins',
        pluginName: 'Pluto',
      }),
    );
    api.openChatGptSetupGuide.mockResolvedValue(undefined);
    api.openChatGpt.mockResolvedValue(undefined);
    const container = await render();
    expect(container.textContent).toContain('Local setup complete');
    expect(container.textContent).toContain(
      'start a new Work chat and mention Pluto',
    );
    expect(container.textContent).toContain('Type @ and select Pluto');
    expect(container.textContent).toContain('Plugins → Personal');
    expect(container.textContent).toContain(
      'What did we decide in my latest meeting?',
    );
    expect(container.textContent).toContain('fully quit ChatGPT (⌘Q)');
    expect(container.textContent).not.toMatch(
      /tunnel|Node.js|terminal|API key|ChatGPT connected/i,
    );
    expect(container.querySelector('code')).toBeNull();
    await act(async () => button(container, 'Start a ChatGPT chat').click());
    expect(api.openChatGpt).toHaveBeenCalledOnce();
    await act(async () => button(container, 'Connection help').click());
    expect(api.openChatGptSetupGuide).toHaveBeenCalledOnce();
  });

  it('does not claim readiness before the local plugin is prepared', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({ enabled: true, running: true }),
    );
    const container = await render();
    expect(container.textContent).not.toContain('Local setup complete');
    expect(container.textContent).toContain('Connection needs attention');
    expect(button(container, 'Start a ChatGPT chat')).toBeUndefined();
    expect(button(container, 'Disable access').disabled).toBe(false);
  });

  it('explains when the ChatGPT desktop app cannot be opened', async () => {
    api.getChatGptConnectionStatus.mockResolvedValue(
      snapshot({ enabled: true, running: true, pluginReady: true }),
    );
    api.openChatGpt.mockRejectedValue(new Error('app unavailable'));
    const container = await render();
    await act(async () => button(container, 'Start a ChatGPT chat').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Install the ChatGPT desktop app',
    );
  });

  it('retains readiness when automatic ChatGPT launch fails', async () => {
    api.setChatGptConnectionEnabled.mockResolvedValue(
      snapshot({ enabled: true, running: true, pluginReady: true }),
    );
    api.openChatGpt.mockRejectedValue(new Error('app unavailable'));
    const container = await render();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to ChatGPT').click());
    expect(api.openChatGpt).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Local setup complete');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Local setup is complete. Open ChatGPT desktop to start a Work chat on this computer.',
    );
    expect(button(container, 'Disable access').disabled).toBe(false);
    expect(button(container, 'Start a ChatGPT chat')).toBeDefined();
  });

  it('does not launch ChatGPT when plugin preparation is incomplete', async () => {
    api.setChatGptConnectionEnabled.mockResolvedValue(
      snapshot({ enabled: true, running: true, pluginReady: false }),
    );
    const container = await render();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input')!.click(),
    );
    await act(async () => button(container, 'Connect to ChatGPT').click());
    expect(api.openChatGpt).not.toHaveBeenCalled();
  });
});

describe('ChatGPT connection API snapshot validation', () => {
  it.each([
    null,
    true,
    {},
    { ...snapshot(), enabled: 'false' },
    { ...snapshot(), running: 1 },
    { ...snapshot(), pluginReady: undefined },
    { ...snapshot(), pluginName: 42 },
    { ...snapshot(), marketplaceName: [] },
    { ...snapshot(), error: {} },
  ])('rejects malformed desktop responses: %j', async (response) => {
    const actual = await vi.importActual<
      typeof import('../../src/api/chatgptConnection')
    >('../../src/api/chatgptConnection');
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke: vi.fn().mockResolvedValue(response) },
    });
    await expect(actual.getChatGptConnectionStatus()).rejects.toThrow(
      'unavailable',
    );
    await expect(actual.setChatGptConnectionEnabled(true)).rejects.toThrow(
      'unavailable',
    );
  });

  it('accepts complete disabled and running snapshots', async () => {
    const actual = await vi.importActual<
      typeof import('../../src/api/chatgptConnection')
    >('../../src/api/chatgptConnection');
    const running = snapshot({
      enabled: true,
      running: true,
      pluginReady: true,
      pluginName: 'Pluto',
      marketplaceName: 'Personal plugins',
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi
          .fn()
          .mockResolvedValueOnce(snapshot())
          .mockResolvedValueOnce(running),
      },
    });
    await expect(actual.getChatGptConnectionStatus()).resolves.toEqual(
      snapshot(),
    );
    await expect(actual.setChatGptConnectionEnabled(true)).resolves.toEqual(
      running,
    );
  });
});
