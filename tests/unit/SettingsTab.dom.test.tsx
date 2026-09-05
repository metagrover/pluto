// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTab } from '../../src/components/features/SettingsTab';

vi.mock('../../src/components/features/IdentitySettings', () => ({
  IdentitySettings: () => <div>Identity settings content</div>,
}));

vi.mock('../../src/components/features/CalendarSettings', () => ({
  CalendarSettings: () => <div>Calendar settings content</div>,
}));

const defaultProps = {
  llmProvider: 'ollama' as const,
  setLlmProvider: vi.fn(),
  geminiApiKey: '',
  setGeminiApiKey: vi.fn(),
  openaiApiKey: '',
  setOpenaiApiKey: vi.fn(),
  claudeApiKey: '',
  setClaudeApiKey: vi.fn(),
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
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('SettingsTab', () => {
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
});
