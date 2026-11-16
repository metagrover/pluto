// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTIntelligenceSettings } from '../../src/components/features/ChatGPTIntelligenceSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ChatGPT intelligence settings', () => {
  it('shows measured usage separately from protection limits and saves only an explicit policy change', async () => {
    const summary = {
      day: '2026-10-15',
      requests: 4,
      failed: 1,
      inputTokens: 4000,
      outputTokens: 1000,
      estimatedTokens: 8192,
      unmeasuredRequests: 1,
      duplicatesAvoided: 2,
      backgroundRequests: 0,
      tasks: {
        'entities (test-model)': {
          requests: 1,
          failed: 0,
          inputTokens: 1000,
          outputTokens: 100,
        },
      },
      policy: {
        dailyRequests: 50,
        dailyTokens: 200000,
        backgroundEnabled: false,
      },
      paused: false,
    };
    const invoke = vi.fn(async (channel: string, policy?: unknown) => {
      if (channel === 'CHATGPT_STATUS')
        return { connected: true, planEnabled: true };
      if (channel === 'CHATGPT_USAGE') return summary;
      if (channel === 'CHATGPT_MODELS')
        return [{ id: 'test-model', name: 'Test model' }];
      if (channel === 'GET_SETTING') return 'test-model';
      if (channel === 'CHATGPT_SET_USAGE_POLICY') return { ...summary, policy };
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <StrictMode>
          <ChatGPTIntelligenceSettings />
        </StrictMode>,
      ),
    );
    expect(container.textContent).toContain(
      '4 requests · 5,000 reported tokens · 2 duplicate requests avoided',
    );
    expect(container.textContent).toContain('not a hard token cap');
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .checked,
    ).toBe(false);
    expect(
      invoke.mock.calls.some(
        ([channel]) => channel === 'CHATGPT_SET_USAGE_POLICY',
      ),
    ).toBe(false);
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Save usage protection')!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith('CHATGPT_SET_USAGE_POLICY', {
      dailyRequests: 50,
      dailyTokens: 200000,
      backgroundEnabled: true,
    });
    expect(container.textContent).toContain('Usage protection saved');
    act(() => root.unmount());
  });

  it('connects without an API key, loads account models, saves selection, and signs out', async () => {
    let connected = false;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'CHATGPT_SIGN_IN') connected = true;
      if (channel === 'CHATGPT_SIGN_OUT') {
        connected = false;
        return { remoteRevoked: false };
      }
      if (channel === 'CHATGPT_STATUS')
        return {
          connected,
          planEnabled: connected,
          email: connected ? 'test@example.test' : undefined,
        };
      if (channel === 'CHATGPT_MODELS')
        return [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' },
        ];
      if (channel === 'GET_SETTING') return 'model-a';
      if (channel === 'CHATGPT_USAGE')
        return {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedTokens: 0,
          unmeasuredRequests: 0,
          duplicatesAvoided: 0,
          backgroundRequests: 0,
          backgroundTokens: 0,
          tasks: {},
          paused: false,
          policy: {
            dailyRequests: 50,
            dailyTokens: 200000,
            backgroundEnabled: true,
          },
        };
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <StrictMode>
          <ChatGPTIntelligenceSettings />
        </StrictMode>,
      ),
    );
    const button = (text: string) =>
      [...container.querySelectorAll('button')].find(
        (element) => element.textContent === text,
      )!;
    expect(container.textContent).toContain(
      'Recording and transcription stay on this Mac',
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await act(async () => button('Sign in with ChatGPT').click());
    expect(container.textContent).toContain('test@example.test');
    const select = container.querySelector('select')!;
    expect([...select.options].map((option) => option.text)).toEqual([
      'Model A',
      'Model B',
    ]);
    await act(async () => {
      select.value = 'model-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'chatgpt_model',
      value: 'model-b',
    });
    await act(async () => button('Manage usage').click());
    expect(invoke).toHaveBeenCalledWith('CHATGPT_MANAGE_USAGE');
    await act(async () => button('Sign out').click());
    expect(container.textContent).toContain(
      'Remote revocation could not be confirmed',
    );
    expect(container.textContent).toContain('Use your ChatGPT plan in Pluto');
    act(() => root.unmount());
  });

  it.each(['browser', 'final status'])(
    'does not activate ChatGPT after leaving settings while waiting for %s',
    async (stage) => {
      let connected = false;
      let statusRequests = 0;
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const invoke = vi.fn(async (channel: string) => {
        if (channel === 'CHATGPT_SIGN_IN') {
          if (stage === 'browser') await pending;
          connected = true;
        }
        if (channel === 'CHATGPT_STATUS') {
          statusRequests++;
          if (stage === 'final status' && statusRequests === 3) await pending;
          return { connected, planEnabled: connected };
        }
        if (channel === 'CHATGPT_MODELS')
          return [{ id: 'model-a', name: 'Model A' }];
        if (channel === 'GET_SETTING') return 'model-a';
      });
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: { invoke },
      });
      const onConnected = vi.fn(async () => {});
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(
          <ChatGPTIntelligenceSettings
            activationPending
            onConnected={onConnected}
          />,
        ),
      );
      await act(async () =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'Sign in with ChatGPT')!
          .click(),
      );
      if (stage === 'final status') expect(statusRequests).toBe(3);
      act(() => root.unmount());
      await act(async () => finish());
      expect(onConnected).not.toHaveBeenCalled();
      expect(
        invoke.mock.calls.some(([channel]) => channel === 'SET_SETTING'),
      ).toBe(false);
    },
  );

  it('offers cancellation while browser sign-in is pending', async () => {
    let rejectSignIn!: (error: Error) => void;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'CHATGPT_STATUS')
        return { connected: false, planEnabled: false };
      if (channel === 'CHATGPT_SIGN_IN')
        return new Promise((_, reject) => {
          rejectSignIn = reject;
        });
      if (channel === 'CHATGPT_CANCEL_SIGN_IN')
        rejectSignIn(new Error('ChatGPT sign-in was cancelled.'));
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ChatGPTIntelligenceSettings />));
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Sign in with ChatGPT')!
        .click(),
    );
    expect(container.textContent).toContain('Waiting for browser');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Cancel sign-in')!
        .click(),
    );
    expect(container.textContent).toContain(
      'Sign-in cancelled. Your current provider is unchanged.',
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });
});
