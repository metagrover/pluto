// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../../src/components/layout/Sidebar';
import type { Meeting } from '../../src/types';

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
          onOpenPeopleHome={vi.fn()}
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
    expect(buttonTexts.some((text) => text.includes('Sources'))).toBe(false);
    expect(buttonTexts.some((text) => text.includes('All meetings'))).toBe(
      true,
    );
    expect(buttonTexts.some((text) => text.includes('Settings'))).toBe(true);
  });

  it('navigates home when the Pluto brand is clicked from a meeting', () => {
    const setActiveTab = vi.fn();
    const setSelectedMeetingId = vi.fn();
    act(() =>
      root.render(
        <Sidebar
          sidebarVisible
          activeTab="meetings"
          setActiveTab={setActiveTab}
          selectedMeetingId="meeting-1"
          setSelectedMeetingId={setSelectedMeetingId}
          safeMeetings={[]}
          onStartRecording={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenPeopleHome={vi.fn()}
          theme="dark"
          setTheme={vi.fn()}
        />,
      ),
    );

    const brand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Pluto, go to Dashboard"]',
    );
    expect(brand?.textContent).toContain('Pluto');
    act(() => brand?.click());
    expect(setActiveTab).toHaveBeenCalledWith('hub');
    expect(setSelectedMeetingId).toHaveBeenCalledWith(null);
  });

  it('keeps recent meeting rows free of inline delete controls', () => {
    const meeting: Meeting = {
      id: 'meeting-1',
      title: 'Weekly review',
      meeting_type: 'Recording',
      created_at: '2026-09-01T15:01:00.000Z',
      started_at: '2026-09-01T15:01:00.000Z',
      duration_seconds: 120,
      finalization_status: 'finalized',
    };

    act(() =>
      root.render(
        <Sidebar
          sidebarVisible
          activeTab="hub"
          setActiveTab={vi.fn()}
          selectedMeetingId={null}
          setSelectedMeetingId={vi.fn()}
          safeMeetings={[meeting]}
          onStartRecording={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenPeopleHome={vi.fn()}
          theme="dark"
          setTheme={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain('Weekly review');
    expect(container.querySelector('[title="Delete Session"]')).toBeNull();
  });

  it('cycles through theme options when the theme toggle button is clicked', () => {
    const setTheme = vi.fn();
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
          onOpenPeopleHome={vi.fn()}
          theme="claude"
          setTheme={setTheme}
        />,
      ),
    );

    const themeToggle = container.querySelector<HTMLButtonElement>(
      '[title="Theme: claude"]',
    )!;
    expect(themeToggle).not.toBeNull();
    act(() => {
      themeToggle.click();
    });
    expect(setTheme).toHaveBeenCalledWith('pluto-site');
  });
});
