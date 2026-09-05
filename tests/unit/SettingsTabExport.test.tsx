// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTab } from '../../src/components/features/SettingsTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/features/IdentitySettings', () => ({
  IdentitySettings: () => <div>Identity settings content</div>,
}));

vi.mock('../../src/components/features/CalendarSettings', () => ({
  CalendarSettings: () => <div>Calendar settings content</div>,
}));

describe('SettingsTab Export settings', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    invokeMock = vi.fn(async () => null);
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: invokeMock,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders "Include transcript in exports" toggle under Meetings tab and updates setting on change', async () => {
    const setExportIncludeTranscript = vi.fn();

    await act(async () => {
      root.render(
        <SettingsTab
          llmProvider="ollama"
          setLlmProvider={vi.fn()}
          geminiApiKey=""
          setGeminiApiKey={vi.fn()}
          openaiApiKey=""
          setOpenaiApiKey={vi.fn()}
          claudeApiKey=""
          setClaudeApiKey={vi.fn()}
          ollamaModel=""
          setOllamaModel={vi.fn()}
          autoEndEnabled={true}
          setAutoEndEnabled={vi.fn()}
          fetchMeetings={vi.fn()}
          setSelectedMeetingId={vi.fn()}
          theme="system"
          setTheme={vi.fn()}
          initialTab="meetings"
          exportIncludeTranscript={false}
          setExportIncludeTranscript={setExportIncludeTranscript}
        />,
      );
    });

    expect(container.textContent).toContain('Export');
    expect(container.textContent).toContain('Include transcript in exports');
    expect(container.textContent).toContain(
      'Append the speaker-attributed transcript to exported Markdown notes.',
    );

    // Find the toggle button in the Export section
    const exportSection = Array.from(
      container.querySelectorAll('section'),
    ).find((sec) => sec.textContent?.includes('Export'));
    expect(exportSection).toBeDefined();

    const toggle = exportSection?.querySelector('button[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setExportIncludeTranscript).toHaveBeenCalledWith(true);
    expect(invokeMock).toHaveBeenCalledWith('SET_SETTING', {
      key: 'export_include_transcript',
      value: 'true',
    });
  });
});
