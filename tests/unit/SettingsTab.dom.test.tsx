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

  it('persists the silence duration selected from the themed menu', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const setDuration = vi.fn();
    await act(async () =>
      root.render(
        <SettingsTab
          {...defaultProps}
          initialTab="meetings"
          silenceAutoStopDuration="5"
          setSilenceAutoStopDuration={setDuration}
        />,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Auto-stop on prolonged silence duration"]',
        )!
        .click(),
    );
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent === '10 minutes')!;
    await act(async () => option.click());
    expect(setDuration).toHaveBeenCalledWith('10');
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'silence_auto_stop_duration',
      value: '10',
    });
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
    expect(document.activeElement).toBe(tabs[3]);
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Reset knowledge base');

    act(() => {
      tabs[3].dispatchEvent(
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
    expect(document.activeElement).toBe(tabs[3]);
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');

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
