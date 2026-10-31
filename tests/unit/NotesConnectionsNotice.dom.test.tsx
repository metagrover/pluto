// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesConnectionsNotice } from '../../src/components/features/NotesConnectionsNotice';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
});

async function renderNotice(
  saved: Record<string, string>,
  enabled: 'chatgpt' | 'claude' | null = null,
) {
  const open = vi.fn();
  const invoke = vi.fn(async (channel, input) => {
    if (
      channel === 'PLUTO_MCP_GET_STATUS' ||
      channel === 'PLUTO_CLAUDE_GET_STATUS'
    )
      return {
        enabled:
          channel ===
          (enabled === 'chatgpt'
            ? 'PLUTO_MCP_GET_STATUS'
            : enabled === 'claude'
              ? 'PLUTO_CLAUDE_GET_STATUS'
              : ''),
        running: false,
        pluginReady: false,
        pluginName: null,
        marketplaceName: null,
        error: null,
      };
    if (channel === 'GET_SETTING') return saved[input];
    if (channel === 'SET_SETTING') saved[input.key] = input.value;
  });
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<NotesConnectionsNotice onOpenSettings={open} />),
  );
  return { container, root, invoke, open };
}

describe('Meeting-note connection invitation', () => {
  it('offers both apps without granting access or changing the provider', async () => {
    const f = await renderNotice({
      setup_complete: 'true',
      llm_provider: 'ollama',
    });
    expect(f.container.textContent).toContain('ChatGPT or Claude');
    expect(
      f.invoke.mock.calls.some(
        ([channel]) =>
          channel === 'SET_SETTING' || channel.endsWith('SET_ENABLED'),
      ),
    ).toBe(false);
    act(() => f.root.unmount());
  });
  it.each(['Not now', 'Review connections'])(
    'persists %s without repeating or enabling sharing',
    async (action) => {
      const saved = { setup_complete: 'true', llm_provider: 'ollama' };
      const f = await renderNotice(saved);
      await act(async () =>
        [...f.container.querySelectorAll('button')]
          .find((button) => button.textContent === action)!
          .click(),
      );
      expect(f.container.textContent).toBe('');
      expect(f.open).toHaveBeenCalledTimes(
        action === 'Review connections' ? 1 : 0,
      );
      expect(saved.llm_provider).toBe('ollama');
      expect(
        f.invoke.mock.calls.filter(([channel]) => channel === 'SET_SETTING'),
      ).toEqual([
        [
          'SET_SETTING',
          { key: 'notes_connections_notice_seen', value: 'true' },
        ],
      ]);
      act(() => f.root.unmount());
      const next = await renderNotice(saved);
      expect(next.container.textContent).toBe('');
      act(() => next.root.unmount());
    },
  );
  it.each([
    { setup_complete: 'false' },
    { setup_complete: 'true', notes_connections_notice_seen: 'true' },
  ])('respects setup and dismissal: %j', async (saved) => {
    const f = await renderNotice(saved);
    expect(f.container.textContent).toBe('');
    act(() => f.root.unmount());
  });
  it.each(['chatgpt', 'claude'] as const)(
    'does not prompt when %s access is already enabled',
    async (client) => {
      const f = await renderNotice({ setup_complete: 'true' }, client);
      expect(f.container.textContent).toBe('');
      act(() => f.root.unmount());
    },
  );
  it('offers connections even when ChatGPT already powers Pluto', async () => {
    const f = await renderNotice({
      setup_complete: 'true',
      llm_provider: 'chatgpt',
      intelligence_setup_complete: 'true',
    });
    expect(f.container.textContent).toContain('ChatGPT or Claude');
    act(() => f.root.unmount());
  });
});
