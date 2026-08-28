// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../../src/components/layout/Sidebar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Sidebar navigation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not render the Knowledge tab in the navigation list', () => {
    act(() =>
      root.render(
        <Sidebar
          sidebarVisible
          activeTab="hub"
          setActiveTab={vi.fn()}
          selectedMeetingId={null}
          setSelectedMeetingId={vi.fn()}
          safeMeetings={[]}
          onStartRecording={vi.fn()}
          onOpenSearch={vi.fn()}
          handleDeleteMeeting={vi.fn()}
          theme="dark"
          setTheme={vi.fn()}
        />,
      ),
    );

    const buttons = [...container.querySelectorAll('button')];
    const buttonTexts = buttons.map((b) => b.textContent?.trim() || '');

    // Knowledge tab should not be present
    expect(buttonTexts.some((text) => text.includes('Knowledge'))).toBe(false);

    // Other core tabs should be present
    expect(buttonTexts.some((text) => text.includes('Dashboard'))).toBe(true);
    expect(buttonTexts.some((text) => text.includes('Projects'))).toBe(true);
    expect(buttonTexts.some((text) => text.includes('Chat with Pluto'))).toBe(
      true,
    );
    expect(buttonTexts.some((text) => text.includes('People'))).toBe(true);
    expect(buttonTexts.some((text) => text.includes('All meetings'))).toBe(true);
    expect(buttonTexts.some((text) => text.includes('Settings'))).toBe(true);
  });
});
