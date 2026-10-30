// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyMeetingNotesTemplateSettingsUpdate,
  createMeetingNotesTemplateSettingsSnapshot,
} from '../../electron/llm/meetingNotesTemplates';
import { SettingsTab } from '../../src/components/features/SettingsTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/features/IdentitySettings', () => ({
  IdentitySettings: () => <div>Identity settings content</div>,
}));

vi.mock('../../src/components/features/CalendarSettings', () => ({
  CalendarSettings: () => <div>Calendar settings content</div>,
}));

const defaultProps = {
  llmProvider: 'ollama' as const,
  setLlmProvider: vi.fn(),
  ollamaModel: '',
  setOllamaModel: vi.fn(),
  autoEndEnabled: true,
  setAutoEndEnabled: vi.fn(),
  fetchMeetings: vi.fn(),
  setSelectedMeetingId: vi.fn(),
  theme: 'system' as const,
  setTheme: vi.fn(),
};

const renderSettings = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<SettingsTab {...defaultProps} />));

  return { container, root };
};

const getTabs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

beforeEach(() => {
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'GET_SETTING') return '';
        return null;
      }),
      on: vi.fn(() => () => {}),
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('SettingsTab', () => {
  it.each([true, false])(
    'refreshes readiness only after model persistence succeeds (%s)',
    async (saved) => {
      let finishSave!: () => void;
      const invoke = vi.fn(async (channel: string, input?: { key: string }) => {
        if (channel === 'GET_SETTING') return '';
        if (channel === 'OLLAMA_READINESS')
          return {
            status: 'ready',
            models: ['custom:local'],
            missingModels: [],
          };
        if (channel === 'SET_SETTING' && input?.key === 'ollama_fast_model') {
          await new Promise<void>((resolve) => {
            finishSave = resolve;
          });
          if (!saved) throw new Error('save failed');
        }
        return null;
      });
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: { invoke, on: vi.fn(() => () => {}) },
      });
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(
          <SettingsTab {...defaultProps} initialTab="intelligence" />,
        ),
      );
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'OLLAMA_READINESS'),
      ).toHaveLength(1);
      const input =
        container.querySelector<HTMLInputElement>('#ollama-fast-model')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, 'custom:quick');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(container.textContent).toContain('Finish editing your model');
      await act(async () =>
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
      );
      expect(container.textContent).toContain('Saving your local model');
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'OLLAMA_READINESS'),
      ).toHaveLength(1);
      await act(async () => finishSave());
      if (saved) {
        expect(
          invoke.mock.calls.filter(
            ([channel]) => channel === 'OLLAMA_READINESS',
          ),
        ).toHaveLength(2);
        expect(container.textContent).toContain(
          'Your local models are installed',
        );
      } else {
        expect(
          invoke.mock.calls.filter(
            ([channel]) => channel === 'OLLAMA_READINESS',
          ),
        ).toHaveLength(1);
        expect(container.textContent).toContain(
          'Could not save your local model',
        );
      }
      act(() => root.unmount());
    },
  );

  it.each(['standard', 'encrypted'] as const)(
    'displays the %s database setup without a toggle',
    async (mode) => {
      const invoke = vi.fn(async (channel: string) =>
        channel === 'DATABASE_STORAGE_MODE'
          ? mode
          : channel === 'GET_SETTING'
            ? ''
            : null,
      );
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: { invoke, on: vi.fn(() => () => {}) },
      });
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(<SettingsTab {...defaultProps} initialTab="advanced" />),
      );
      const status = container.querySelector(
        '[aria-label="Database encryption status"]',
      )!;
      expect(status.textContent).toBe(mode === 'encrypted' ? 'On' : 'Off');
      expect(status.closest('button')).toBeNull();
      expect(container.textContent).toContain('fixed for this profile');
      expect(
        invoke.mock.calls.some(([channel]) => channel === 'SET_SETTING'),
      ).toBe(false);
      act(() => root.unmount());
    },
  );
  it('shows current recording usage and applies the selected storage budget', async () => {
    const invoke = vi.fn(async (channel: string, value?: string) => {
      if (channel === 'AUDIO_RETENTION_GET_STATUS') {
        return {
          budgetGb: 10,
          retainedBytes: 3 * 1024 ** 3,
          measurementComplete: true,
          overBudget: false,
        };
      }
      if (channel === 'AUDIO_RETENTION_SET_BUDGET') {
        return {
          budgetGb: Number(value),
          retainedBytes: 0,
          measurementComplete: true,
          overBudget: false,
        };
      }
      if (channel === 'GET_SETTING') return '';
      return null;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}) },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
    );

    expect(container.textContent).toContain('3.0 GB currently used');
    const selector = container.querySelector<HTMLButtonElement>(
      '[aria-label="Recording storage limit"]',
    )!;
    await act(async () => selector.click());
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.dataset.value === '2')!;
    await act(async () => option.click());

    expect(invoke).toHaveBeenCalledWith('AUDIO_RETENTION_SET_BUDGET', '2');
    act(() => root.unmount());
  });

  it('explains that quiet breaks do not stop recording and removes the silence setting', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
    );
    expect(container.textContent).toContain(
      'Ad-hoc calls and quiet breaks before the calendar end keep recording.',
    );
    expect(container.textContent).not.toContain(
      'Auto-stop on prolonged silence',
    );
    act(() => root.unmount());
  });
  it('shows one focused category at a time', () => {
    const { container, root } = renderSettings();
    const tablist = container.querySelector('[role="tablist"]');
    const navigation = tablist?.parentElement;
    const tabs = getTabs(container);

    expect(tablist?.getAttribute('aria-label')).toBe('Settings categories');
    expect(navigation?.className).not.toContain('sticky');
    expect(navigation?.className).not.toContain('bg-pro-bg');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Personal',
      'Meetings',
      'Intelligence',
      'Advanced',
      'Help',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs.slice(1).every((tab) => tab.tabIndex === -1)).toBe(true);
    expect(container.textContent).toContain('Identity settings content');
    expect(container.textContent).toContain('Appearance');
    expect(container.textContent).not.toContain('Calendar settings content');
    expect(container.textContent).not.toContain('AI Provider');
    expect(container.textContent).not.toContain('Reset knowledge base');

    act(() => tabs[1].click());

    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Calendar settings content');
    expect(container.textContent).toContain('Recording');
    expect(container.textContent).not.toContain('Identity settings content');

    act(() => root.unmount());
  });

  it('uses arrow, Home, and End keys to select and focus tabs', () => {
    const { container, root } = renderSettings();
    const tabs = getTabs(container);

    act(() => {
      tabs[0].focus();
      tabs[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Calendar settings content');

    act(() => {
      tabs[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[4]);
    expect(tabs[4].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Report a problem');

    act(() => {
      tabs[4].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    act(() => {
      tabs[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[4]);
    expect(tabs[4].getAttribute('aria-selected')).toBe('true');

    act(() => root.unmount());
  });

  it('opens directly on the specified initialTab', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() =>
      root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
    );

    const tabs = getTabs(container);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Calendar settings content');
    expect(container.textContent).not.toContain('Identity settings content');

    act(() => root.unmount());
  });

  it.each(['ollama', 'openai', 'gemini', 'claude'] as const)(
    'offers only supported setup controls with %s previously selected',
    async (provider) => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(
          <SettingsTab
            {...defaultProps}
            llmProvider={provider}
            initialTab="intelligence"
          />,
        ),
      );
      const labels = Array.from(container.querySelectorAll('button')).map(
        (button) => button.textContent?.trim(),
      );
      expect(labels).toContain('Ollama');
      expect(labels).toContain('OpenRouter');
      for (const hidden of ['OpenAI', 'Gemini', 'Claude'])
        expect(labels).not.toContain(hidden);
      expect(container.querySelector('#api-key')).toBeNull();
      expect(container.querySelector('#cloud-model')).toBeNull();
      for (const hidden of ['openai', 'gemini', 'claude']) {
        expect(window.ipcRenderer.invoke).not.toHaveBeenCalledWith(
          'PROVIDER_CREDENTIAL_STATUS',
          hidden,
        );
      }
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalled();
      if (provider !== 'ollama')
        expect(container.textContent).toContain('temporarily hidden');
      act(() => root.unmount());
    },
  );

  describe('ChatGPT connection preview', () => {
    async function preview() {
      let connected = false;
      const saved: Record<string, string> = {
        chatgpt_plan_welcome_seen: 'true',
      };
      const invoke = vi.fn(async (channel: string, input?: any) => {
        if (channel === 'GET_SETTING') return saved[input] ?? '';
        if (channel === 'SET_SETTING') {
          saved[input.key] = input.value;
          return;
        }
        if (channel === 'CHATGPT_STATUS')
          return { connected, planEnabled: connected };
        if (channel === 'CHATGPT_SIGN_IN') {
          connected = true;
          saved.chatgpt_model = 'test-terra';
          return { connected, planEnabled: connected };
        }
        if (channel === 'CHATGPT_MODELS')
          return [{ id: 'test-terra', name: 'Terra' }];
        return null;
      });
      Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: { invoke, on: vi.fn(() => () => {}) },
      });
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(
          <SettingsTab {...defaultProps} initialTab="intelligence" />,
        ),
      );
      const click = async (label: string) => {
        const button = [...container.querySelectorAll('button')].find(
          (candidate) => candidate.textContent?.trim() === label,
        )!;
        expect(button).toBeDefined();
        await act(async () => button.click());
      };
      await click('ChatGPT');
      return { container, root, invoke, saved, click };
    }

    it('previews ChatGPT while keeping Ollama active until explicitly connected', async () => {
      const f = await preview();
      expect(f.container.textContent).toContain('Continue with ChatGPT');
      expect(f.invoke).not.toHaveBeenCalledWith('CHATGPT_SIGN_IN');
      expect(f.saved.llm_provider).toBeUndefined();
      expect(f.saved.cloud_consent_chatgpt).toBeUndefined();
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalled();
      await f.click('Ollama');
      expect(f.container.querySelector('#ollama-model')).not.toBeNull();
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalledWith('chatgpt');
      act(() => f.root.unmount());
    });

    it('saves consent before activation and waits for persistence before changing provider', async () => {
      const f = await preview();
      const original = f.invoke.getMockImplementation()!;
      let finishProviderSave!: () => void;
      f.invoke.mockImplementation(async (channel, input) => {
        if (channel === 'SET_SETTING' && input.key === 'llm_provider')
          await new Promise<void>((resolve) => {
            finishProviderSave = resolve;
          });
        return original(channel, input);
      });
      await f.click('Continue with ChatGPT');
      expect(f.invoke).toHaveBeenCalledWith('CHATGPT_SIGN_IN');
      expect(f.invoke).toHaveBeenCalledWith('CHATGPT_MODELS');
      expect(f.saved.cloud_consent_chatgpt).toBe('1');
      expect(f.saved.llm_provider).toBeUndefined();
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalled();
      await act(async () => finishProviderSave());
      expect(f.saved.llm_provider).toBe('chatgpt');
      expect(f.saved.intelligence_setup_complete).toBe('true');
      expect(defaultProps.setLlmProvider).toHaveBeenCalledWith('chatgpt');
      const writes = f.invoke.mock.calls
        .filter(([channel]) => channel === 'SET_SETTING')
        .map(([, input]) => input.key);
      expect(writes).toEqual([
        'cloud_consent_chatgpt',
        'llm_provider',
        'intelligence_setup_complete',
      ]);
      expect(
        defaultProps.setLlmProvider.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        f.invoke.mock.invocationCallOrder[
          f.invoke.mock.calls.findIndex(
            ([channel, input]) =>
              channel === 'SET_SETTING' &&
              input.key === 'intelligence_setup_complete',
          )
        ],
      );
      act(() => f.root.unmount());
    });

    it('keeps a newer Ollama choice when the consent save finishes late', async () => {
      const f = await preview();
      const original = f.invoke.getMockImplementation()!;
      let finishConsent!: () => void;
      f.invoke.mockImplementation(async (channel, input) => {
        if (channel === 'SET_SETTING' && input.key === 'cloud_consent_chatgpt')
          await new Promise<void>((resolve) => {
            finishConsent = resolve;
          });
        return original(channel, input);
      });
      await f.click('Continue with ChatGPT');
      expect(finishConsent).toBeDefined();
      await f.click('Ollama');
      await act(async () => finishConsent());
      expect(f.saved.llm_provider).toBe('ollama');
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalledWith('chatgpt');
      expect(f.invoke).not.toHaveBeenCalledWith('SET_SETTING', {
        key: 'llm_provider',
        value: 'chatgpt',
      });
      act(() => f.root.unmount());
    });

    it('leaves Ollama active when ChatGPT consent cannot be saved', async () => {
      const f = await preview();
      const original = f.invoke.getMockImplementation()!;
      f.invoke.mockImplementation(async (channel, input) => {
        if (channel === 'SET_SETTING' && input.key === 'cloud_consent_chatgpt')
          throw new Error('Could not save consent');
        return original(channel, input);
      });
      await f.click('Continue with ChatGPT');
      expect(f.saved.llm_provider).toBeUndefined();
      expect(f.saved.cloud_consent_chatgpt).toBeUndefined();
      expect(f.saved.intelligence_setup_complete).toBeUndefined();
      expect(defaultProps.setLlmProvider).not.toHaveBeenCalled();
      expect(
        f.container.querySelector('[role="alert"]')?.textContent,
      ).toContain('Could not save consent');
      expect(f.invoke).not.toHaveBeenCalledWith('SET_SETTING', {
        key: 'llm_provider',
        value: 'chatgpt',
      });
      act(() => f.root.unmount());
    });
  });

  it('places cloud consent above the Settings animation and cancels without activating the provider', async () => {
    const container = document.createElement('div');
    container.style.transform = 'translateY(0)';
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<SettingsTab {...defaultProps} initialTab="intelligence" />),
    );
    const providerButton = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'OpenRouter');
    expect(providerButton).toBeDefined();
    await act(async () => providerButton!.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog!.parentElement!.parentElement).toBe(document.body);
    expect(dialog!.parentElement!.classList.contains('fixed')).toBe(true);
    expect(dialog!.parentElement!.classList.contains('inset-0')).toBe(true);
    const cancel = Array.from(dialog!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    );
    await act(async () => cancel!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(defaultProps.setLlmProvider).not.toHaveBeenCalled();
    expect(window.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      'SET_SETTING',
      'cloud_consent_openrouter',
      expect.anything(),
    );
    act(() => root.unmount());
  });

  it('shows configured credentials as a non-copyable masked hint', async () => {
    const invoke = vi.fn(async (channel: string, provider?: string) => {
      if (channel === 'GET_SETTING') return '';
      if (channel === 'PROVIDER_CREDENTIAL_STATUS') {
        return provider === 'openrouter'
          ? {
              provider,
              configured: true,
              available: true,
              maskedHint: 'sk-or-********1234',
            }
          : { provider, configured: false, available: true };
      }
      return null;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}) },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          llmProvider="openrouter"
          initialTab="intelligence"
        />,
      ),
    );

    const maskedHint = container.querySelector<HTMLElement>(
      '[aria-label="Configured openrouter API key"]',
    );
    expect(maskedHint?.textContent).toBe('sk-or-********1234');
    expect(maskedHint?.className).toContain('select-none');
    expect(
      container.querySelector('input[placeholder*="openrouter API key"]'),
    ).toBeNull();

    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    maskedHint?.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(true);

    const replaceButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === 'Replace key');
    await act(async () => replaceButton?.click());

    expect(
      container.querySelector('input[placeholder*="openrouter API key"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('Save replacement');
    expect(container.textContent).toContain('Cancel');

    act(() => root.unmount());
  });

  it('renders and toggles Generate notes during meetings under the Meetings tab', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const setFasterNotesEnabled = vi.fn();

    act(() =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="meetings"
          fasterNotesEnabled={true}
          setFasterNotesEnabled={setFasterNotesEnabled}
        />,
      ),
    );

    expect(container.textContent).toContain('Generate notes during meetings');
    expect(container.textContent).toContain(
      'Precomputes notes in the background while recording',
    );

    const recordingSection = Array.from(
      container.querySelectorAll('section'),
    ).find((sec) => sec.textContent?.includes('Recording'));
    expect(recordingSection).toBeDefined();

    const labels = Array.from(
      recordingSection?.querySelectorAll('label') ?? [],
    );
    const fasterNotesLabel = labels.find((l) =>
      l.textContent?.includes('Generate notes during meetings'),
    );
    expect(fasterNotesLabel).toBeDefined();

    const row = fasterNotesLabel?.closest('.flex');
    const toggle = row?.querySelector<HTMLButtonElement>(
      'button[role="switch"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-checked')).toBe('true');

    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setFasterNotesEnabled).toHaveBeenCalledWith(false);
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'faster_notes_enabled',
      value: 'false',
    });

    act(() => root.unmount());
  });

  it('defaults transcription language to English and persists Auto-detect under the Meetings tab', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const setTranscriptionLanguage = vi.fn();

    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="meetings"
          setTranscriptionLanguage={setTranscriptionLanguage}
        />,
      ),
    );

    const selector = container.querySelector<HTMLButtonElement>(
      '[aria-label="Transcription language"]',
    )!;
    expect(selector).not.toBeNull();
    expect(selector.textContent).toContain('English (Default)');

    await act(async () => selector.click());
    const autoOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.dataset.value === 'auto')!;
    expect(autoOption).toBeDefined();
    await act(async () => autoOption.click());

    expect(setTranscriptionLanguage).toHaveBeenCalledWith('auto');
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'transcription_language',
      value: 'auto',
    });

    act(() => root.unmount());
  });

  it('selects a default template and saves customized guidance', async () => {
    const initial = createMeetingNotesTemplateSettingsSnapshot('auto', {});
    const onChange = vi.fn();
    const invoke = vi.fn(async (channel: string, update?: unknown) => {
      if (channel === 'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS') {
        return applyMeetingNotesTemplateSettingsUpdate(initial, update);
      }
      if (channel === 'GET_SETTING') return '';
      return null;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}) },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="meetings"
          meetingNotesTemplateSettings={initial}
          onMeetingNotesTemplateSettingsChange={onChange}
        />,
      ),
    );

    const defaultSelector = container.querySelector<HTMLElement>(
      '[aria-label="Default note template"]',
    )!;
    await act(async () => defaultSelector.click());
    const managerOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.dataset.value === 'manager_one_on_one')!;
    await act(async () => managerOption.click());
    expect(invoke).toHaveBeenCalledWith(
      'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS',
      {
        operation: 'set_default',
        templateId: 'manager_one_on_one',
      },
    );

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '#meeting-notes-template-guidance',
    )!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter!.call(textarea, 'Focus on decisions that change priorities.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === 'Save guidance')!;
    await act(async () => save.click());
    expect(invoke).toHaveBeenCalledWith(
      'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS',
      {
        operation: 'save_override',
        templateId: 'auto',
        guidance: 'Focus on decisions that change priorities.',
      },
    );
    expect(onChange).toHaveBeenCalled();
    expect(container.textContent).toContain('Template guidance saved.');

    act(() => root.unmount());
  });

  it('resets customized template guidance to the built-in version', async () => {
    const customized = createMeetingNotesTemplateSettingsSnapshot(
      'auto',
      JSON.stringify({ auto: 'Custom general guidance.' }),
    );
    const invoke = vi.fn(async (channel: string, update?: unknown) => {
      if (channel === 'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS') {
        return applyMeetingNotesTemplateSettingsUpdate(customized, update);
      }
      if (channel === 'GET_SETTING') return '';
      return null;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}) },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="meetings"
          meetingNotesTemplateSettings={customized}
        />,
      ),
    );

    const reset = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === 'Reset to built-in')!;
    await act(async () => reset.click());
    expect(invoke).toHaveBeenCalledWith(
      'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS',
      { operation: 'reset_override', templateId: 'auto' },
    );
    expect(container.textContent).toContain('Built-in guidance restored.');

    act(() => root.unmount());
  });

  it('renders theme options including Pluto and handles theme changes', async () => {
    const setTheme = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="personal"
          theme="light"
          setTheme={setTheme}
        />,
      ),
    );

    const themeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    );
    const themeNames = [
      'Light',
      'Dark',
      'Terracotta',
      'Pluto',
      'Aubergine',
      'System',
    ];
    for (const name of themeNames) {
      const btn = themeButtons.find((b) => b.textContent?.includes(name));
      expect(btn).toBeDefined();
    }

    const terracottaBtn = themeButtons.find((b) =>
      b.textContent?.includes('Terracotta'),
    )!;
    await act(async () => terracottaBtn.click());
    expect(setTheme).toHaveBeenCalledWith('terracotta');

    const plutoSiteBtn = themeButtons.find((b) =>
      b.textContent?.trim().startsWith('Pluto'),
    )!;
    await act(async () => plutoSiteBtn.click());
    expect(setTheme).toHaveBeenCalledWith('pluto-site');

    act(() => root.unmount());
  });
});

it('defaults to automatic reminders with details visible and persists the global switches', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
  );
  const enabled = container.querySelector<HTMLButtonElement>(
    '[aria-label="Automatic commitment reminders"]',
  )!;
  const previews = container.querySelector<HTMLButtonElement>(
    '[aria-label="Show commitment details in notifications"]',
  )!;
  expect(enabled.getAttribute('aria-checked')).toBe('true');
  expect(previews.getAttribute('aria-checked')).toBe('true');
  expect(container.textContent).toContain('Pluto must remain running');
  await act(async () => enabled.click());
  expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('SET_SETTING', {
    key: 'automaticCommitmentReminders',
    value: 'false',
  });
  await act(async () => previews.click());
  expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('SET_SETTING', {
    key: 'commitmentReminderPreviews',
    value: 'false',
  });
  act(() => root.unmount());
});
it('preserves an explicit private reminder preview preference', async () => {
  vi.mocked(window.ipcRenderer.invoke).mockImplementation(
    async (channel, key) => {
      if (channel === 'GET_SETTING' && key === 'commitmentReminderPreviews')
        return 'false';
      return '';
    },
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
  );
  const previews = container.querySelector<HTMLButtonElement>(
    '[aria-label="Show commitment details in notifications"]',
  )!;
  expect(previews.getAttribute('aria-checked')).toBe('false');
  act(() => root.unmount());
});
it('retains the previous reminder setting when persistence fails', async () => {
  vi.mocked(window.ipcRenderer.invoke).mockImplementation(async (channel) => {
    if (channel === 'SET_SETTING') throw new Error('locked');
    return '';
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<SettingsTab {...defaultProps} initialTab="meetings" />),
  );
  const enabled = container.querySelector<HTMLButtonElement>(
    '[aria-label="Automatic commitment reminders"]',
  )!;
  await act(async () => enabled.click());
  expect(enabled.getAttribute('aria-checked')).toBe('true');
  expect(container.textContent).toContain('Couldn’t save reminder settings');
  act(() => root.unmount());
});
