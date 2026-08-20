// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../../src/components/layout/Sidebar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Sidebar search launcher', () => {
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

  it('renders the Search Pluto launcher directly above Start recording and opens search on click', () => {
    const onOpenSearch = vi.fn();

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
          onOpenSearch={onOpenSearch}
          handleDeleteMeeting={vi.fn()}
          setSettingsVisible={vi.fn()}
          theme="dark"
          setTheme={vi.fn()}
        />,
      ),
    );

    const search = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Search'),
    );
    const start = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('New meeting'),
    );

    expect(search?.textContent).toContain('Search');
    expect(search?.textContent).toContain('⌘P');
    expect(start).not.toBeUndefined();
    expect(
      Number(search?.compareDocumentPosition(start as Node)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);

    act(() => search?.click());

    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
});
