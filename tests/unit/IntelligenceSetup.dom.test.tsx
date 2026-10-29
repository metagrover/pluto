// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntelligenceSetup } from '../../src/components/Setup/IntelligenceSetup';

vi.mock('../../src/components/features/ChatGPTPlanWelcome', () => ({
  ChatGPTPlanWelcome: ({
    enabled,
    onContinue,
  }: { enabled: boolean; onContinue: () => void }) =>
    enabled ? (
      <button data-welcome onClick={onContinue}>
        Got it
      </button>
    ) : null,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function renderSetup(
  saved: Record<string, string> = {},
  connection = false,
  readiness: unknown = {
    status: 'ready',
    models: ['custom:local'],
    missingModels: [],
  },
  credentialConfigured = false,
) {
  const complete = vi.fn();
  let connected = connection;
  const invoke = vi.fn(async (channel: string, input?: any) => {
    if (channel === 'GET_SETTING') return saved[input] ?? null;
    if (channel === 'SET_SETTING') {
      saved[input.key] = input.value;
      return;
    }
    if (channel === 'OLLAMA_READINESS') return readiness;
    if (channel === 'PROVIDER_CREDENTIAL_STATUS')
      return { configured: credentialConfigured, maskedHint: 'qa-masked' };
    if (channel === 'PROVIDER_CREDENTIAL_SET') return { configured: true };
    if (channel === 'CHATGPT_STATUS')
      return { connected, planEnabled: connected };
    if (channel === 'CHATGPT_SIGN_IN') {
      connected = true;
      saved.chatgpt_model = 'account-model';
      return { connected, planEnabled: connected };
    }
  });
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<IntelligenceSetup onComplete={complete} />),
  );
  const choose = async (provider: string) =>
    act(async () =>
      container
        .querySelector<HTMLInputElement>(`input[value="${provider}"]`)!
        .click(),
    );
  const submit = async () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>('#intelligence-continue')!
        .click(),
    );
  const welcome = async () =>
    act(async () =>
      container.querySelector<HTMLButtonElement>('[data-welcome]')!.click(),
    );
  return { container, root, complete, invoke, saved, choose, submit, welcome };
}

describe('First-run intelligence choice', () => {
  it('offers OpenRouter and keeps its saved key out of the renderer', async () => {
    const f = await renderSetup(
      { llm_provider: 'openrouter', openrouter_model: 'example/model' },
      false,
      undefined,
      true,
    );
    expect(f.container.textContent).toContain('OpenRouter');
    expect(f.container.textContent).toContain('selected model provider');
    expect(
      f.container.querySelector<HTMLInputElement>('#openrouter-key')!.value,
    ).toBe('');
    expect(
      f.container.querySelector<HTMLInputElement>('#openrouter-model')!.value,
    ).toBe('example/model');
    expect(f.container.textContent).not.toContain('qa-masked');
    await f.submit();
    expect(f.saved).toMatchObject({
      llm_provider: 'openrouter',
      cloud_consent_openrouter: '1',
      intelligence_setup_complete: 'true',
    });
    expect(
      f.invoke.mock.calls.some(
        ([channel]) => channel === 'PROVIDER_CREDENTIAL_SET',
      ),
    ).toBe(false);
    expect(f.complete).toHaveBeenCalledOnce();
    act(() => f.root.unmount());
  });

  it('requires a fresh key when rechecking saved credentials fails', async () => {
    const f = await renderSetup(
      { llm_provider: 'openrouter' },
      false,
      undefined,
      true,
    );
    await f.choose('ollama');
    const originalInvoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, value) => {
      if (channel === 'PROVIDER_CREDENTIAL_STATUS')
        throw Error('key status unavailable');
      return originalInvoke(channel, value);
    });
    await f.choose('openrouter');
    expect(f.container.textContent).toContain('Enter a key to continue');
    expect(
      f.container.querySelector<HTMLButtonElement>('#intelligence-continue')!
        .disabled,
    ).toBe(true);
    await f.submit();
    expect(f.complete).not.toHaveBeenCalled();
    expect(
      f.invoke.mock.calls.some(
        ([channel, value]) =>
          channel === 'SET_SETTING' &&
          value.key === 'intelligence_setup_complete',
      ),
    ).toBe(false);
    act(() => f.root.unmount());
  });

  it('stores a new OpenRouter key securely before consent and provider activation', async () => {
    const f = await renderSetup();
    await f.choose('openrouter');
    const input =
      f.container.querySelector<HTMLInputElement>('#openrouter-key')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'fictional-qa-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await f.submit();
    expect(f.invoke).toHaveBeenCalledWith('PROVIDER_CREDENTIAL_SET', {
      provider: 'openrouter',
      value: 'fictional-qa-key',
    });
    expect(Object.values(f.saved)).not.toContain('fictional-qa-key');
    expect(f.saved).toMatchObject({
      llm_provider: 'openrouter',
      cloud_consent_openrouter: '1',
      openrouter_model: 'openai/gpt-4o-mini',
    });
    const calls = f.invoke.mock.calls;
    const stored = calls.findIndex(
      ([channel]) => channel === 'PROVIDER_CREDENTIAL_SET',
    );
    const consent = calls.findIndex(
      ([channel, value]) =>
        channel === 'SET_SETTING' && value.key === 'cloud_consent_openrouter',
    );
    const activated = calls.findIndex(
      ([channel, value]) =>
        channel === 'SET_SETTING' && value.key === 'llm_provider',
    );
    expect(stored).toBeLessThan(consent);
    expect(consent).toBeLessThan(activated);
    expect(f.complete).toHaveBeenCalledOnce();
    act(() => f.root.unmount());
  });

  it('requires an OpenRouter key and refuses activation when secure storage fails', async () => {
    const f = await renderSetup();
    await f.choose('openrouter');
    expect(
      f.container.querySelector<HTMLButtonElement>('#intelligence-continue')!
        .disabled,
    ).toBe(true);
    const input =
      f.container.querySelector<HTMLInputElement>('#openrouter-key')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'fictional-qa-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const originalInvoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, value) => {
      if (channel === 'PROVIDER_CREDENTIAL_SET')
        throw Error('secure storage unavailable');
      return originalInvoke(channel, value);
    });
    await f.submit();
    expect(f.container.textContent).toContain('Could not save');
    expect(f.saved.cloud_consent_openrouter).toBeUndefined();
    expect(f.saved.llm_provider).toBeUndefined();
    expect(f.complete).not.toHaveBeenCalled();
    act(() => f.root.unmount());
  });

  it.each([
    null,
    {},
    { status: 'ready' },
    { status: 'ready', models: [], missingModels: [] },
    {
      status: 'ready',
      models: ['custom:local'],
      missingModels: ['custom:local'],
    },
    { status: 'model_missing', models: [], missingModels: [null] },
  ])(
    'handles malformed local readiness %j without claiming a working model',
    async (readiness) => {
      const f = await renderSetup({}, false, readiness);
      await f.choose('ollama');
      expect(f.container.textContent).toContain(
        'Could not verify your local models',
      );
      expect(f.container.textContent).not.toContain(
        'Your local models are installed',
      );
      expect(
        f.container.querySelector<HTMLButtonElement>('#intelligence-continue')!
          .disabled,
      ).toBe(true);
      expect(f.container.textContent).toContain('Continue with recording');
      expect(f.complete).not.toHaveBeenCalled();
      act(() => f.root.unmount());
    },
  );

  it('requires a choice and remembers Ollama without requesting cloud access', async () => {
    const f = await renderSetup();
    expect(
      f.container.querySelector<HTMLButtonElement>('button')!.disabled,
    ).toBe(true);
    await f.choose('ollama');
    await f.submit();
    expect(f.saved).toMatchObject({
      llm_provider: 'ollama',
      intelligence_setup_complete: 'true',
      setup_step: '3',
    });
    expect(f.saved.cloud_consent_chatgpt).toBeUndefined();
    expect(f.invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
    expect(f.complete).toHaveBeenCalledOnce();
    act(() => f.root.unmount());
  });

  it('explains text sharing, connects ChatGPT once, and persists consent and selection', async () => {
    const f = await renderSetup();
    await f.choose('chatgpt');
    expect(f.container.textContent).toContain(
      'including for automatic People and Project updates',
    );
    expect(f.container.textContent).toContain('transcription stay on this Mac');
    expect(f.container.textContent).toContain('Continue with ChatGPT');
    await f.submit();
    expect(f.invoke).toHaveBeenCalledWith('CHATGPT_SIGN_IN');
    expect(f.saved.llm_provider).toBeUndefined();
    expect(f.complete).not.toHaveBeenCalled();
    await f.welcome();
    expect(f.saved).toMatchObject({
      llm_provider: 'chatgpt',
      cloud_consent_chatgpt: '1',
      chatgpt_model: 'account-model',
      intelligence_setup_complete: 'true',
      setup_step: '3',
    });
    expect(f.complete).toHaveBeenCalledOnce();
    act(() => f.root.unmount());
  });

  it('reuses an existing ChatGPT connection without asking for sign-in again', async () => {
    const f = await renderSetup(
      { llm_provider: 'chatgpt', chatgpt_model: 'account-model' },
      true,
    );
    expect(f.container.textContent).toContain('Use ChatGPT');
    await f.submit();
    expect(f.invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
    await f.welcome();
    expect(f.complete).toHaveBeenCalledOnce();
    act(() => f.root.unmount());
  });

  it('keeps setup open on denied plan access and allows choosing Ollama', async () => {
    const f = await renderSetup();
    f.invoke.mockImplementationOnce(async () => ({
      connected: true,
      planEnabled: false,
    }));
    await f.choose('chatgpt');
    await f.submit();
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Allow ChatGPT plan usage',
    );
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.saved.llm_provider).toBeUndefined();
    await f.choose('ollama');
    await f.submit();
    expect(f.saved.llm_provider).toBe('ollama');
    act(() => f.root.unmount());
  });

  it('explains the browser step and ignores a late success after cancellation', async () => {
    const f = await renderSetup();
    let finishSignIn!: (status: unknown) => void;
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, input) => {
      if (channel === 'CHATGPT_SIGN_IN')
        return new Promise((resolve) => {
          finishSignIn = resolve;
        });
      return original(channel, input);
    });
    await f.choose('chatgpt');
    await f.submit();
    expect(f.container.querySelector('[role="status"]')?.textContent).toContain(
      'Finish signing in in your browser',
    );
    const cancel = [...f.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel sign-in',
    )!;
    await act(async () => cancel.click());
    expect(f.invoke).toHaveBeenCalledWith('CHATGPT_CANCEL_SIGN_IN');
    await act(async () => finishSignIn({ connected: true, planEnabled: true }));
    expect(f.container.querySelector('[data-welcome]')).toBeNull();
    expect(f.complete).not.toHaveBeenCalled();
    await f.choose('ollama');
    await f.submit();
    expect(f.saved.llm_provider).toBe('ollama');
    act(() => f.root.unmount());
  });

  it('does not activate ChatGPT when consent cannot be saved', async () => {
    const f = await renderSetup({ chatgpt_model: 'account-model' }, true);
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, input) => {
      if (channel === 'SET_SETTING' && input.key === 'cloud_consent_chatgpt')
        throw new Error('Could not save consent');
      return original(channel, input);
    });
    await f.choose('chatgpt');
    await f.submit();
    await f.welcome();
    expect(f.saved.llm_provider).toBeUndefined();
    expect(f.saved.intelligence_setup_complete).toBeUndefined();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save your choice',
    );
    act(() => f.root.unmount());
  });

  it('lets users keep recording while local intelligence is not installed, and remembers their choice', async () => {
    const f = await renderSetup();
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, input) =>
      channel === 'OLLAMA_READINESS'
        ? {
            status: 'model_missing',
            models: ['custom:local'],
            missingModels: ['custom:local'],
          }
        : original(channel, input),
    );
    await f.choose('ollama');
    expect(f.container.textContent).toContain('not installed');
    expect(
      f.container.querySelector<HTMLButtonElement>('#intelligence-continue')!
        .disabled,
    ).toBe(true);
    const later = [...f.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue with recording',
    )!;
    await act(async () => later.click());
    expect(f.saved).toMatchObject({
      llm_provider: 'ollama',
      intelligence_setup_complete: 'true',
    });
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
    act(() => f.root.unmount());
  });

  it('rechecks without changing an existing local model selection', async () => {
    const f = await renderSetup({
      llm_provider: 'ollama',
      ollama_model: 'my-model:latest',
      ollama_fast_model: 'my-quick:latest',
    });
    expect(f.container.textContent).toContain(
      'Your local models are installed',
    );
    const recheck = [...f.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Check again',
    )!;
    await act(async () => recheck.click());
    expect(
      f.invoke.mock.calls.filter(([channel]) => channel === 'OLLAMA_READINESS'),
    ).toHaveLength(2);
    await f.submit();
    expect(f.saved.ollama_model).toBe('my-model:latest');
    expect(f.saved.ollama_fast_model).toBe('my-quick:latest');
    act(() => f.root.unmount());
  });

  it('does not mark setup complete when persistence fails', async () => {
    const f = await renderSetup();
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, input) => {
      if (channel === 'SET_SETTING' && input.key === 'llm_provider')
        throw new Error('Could not save choice');
      return original(channel, input);
    });
    await f.choose('ollama');
    await f.submit();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.saved.intelligence_setup_complete).toBeUndefined();
    expect(f.container.querySelector('[role="alert"]')).toBeTruthy();
    act(() => f.root.unmount());
  });
});
