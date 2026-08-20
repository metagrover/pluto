// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchOverlay } from '../../src/components/overlays/SearchOverlay';
import type { SearchPlutoResult } from '../../src/components/overlays/searchPlutoModel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const results: SearchPlutoResult[] = [
  {
    kind: 'project',
    id: 'project-1',
    title: 'Launch Project',
    subtitle: 'Project',
    updatedAt: '2026-08-01T10:00:00.000Z',
  },
  {
    kind: 'person',
    id: 'person-1',
    title: 'Priya Shah',
    subtitle: 'Person',
    updatedAt: '2026-08-02T10:00:00.000Z',
  },
  {
    kind: 'meeting',
    id: 'meeting-1',
    title: 'Launch Review',
    subtitle: 'Meeting',
    updatedAt: '2026-08-03T10:00:00.000Z',
  },
];

describe('SearchOverlay', () => {
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

  it('focuses Search Pluto input and groups project, person, and meeting results', () => {
    act(() =>
      root.render(
        <SearchOverlay
          searchVisible
          setSearchVisible={vi.fn()}
          searchQuery="launch"
          setSearchQuery={vi.fn()}
          results={results}
          onOpenMeeting={vi.fn()}
          onOpenProjects={vi.fn()}
          onOpenPeople={vi.fn()}
        />,
      ),
    );

    expect(document.activeElement).toBe(
      container.querySelector('input[placeholder="Search Pluto"]'),
    );
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('People');
    expect(container.textContent).toContain('Meetings');
    expect(container.textContent).toContain('Launch Project');
    expect(container.textContent).toContain('Priya Shah');
    expect(container.textContent).toContain('Launch Review');
  });

  it('uses a compact Spotlight-style shell with readable search typography', () => {
    act(() =>
      root.render(
        <SearchOverlay
          searchVisible
          setSearchVisible={vi.fn()}
          searchQuery="launch"
          setSearchQuery={vi.fn()}
          results={results}
          onOpenMeeting={vi.fn()}
          onOpenProjects={vi.fn()}
          onOpenPeople={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-search-panel]')?.className).toContain(
      'max-w-2xl',
    );
    expect(container.firstElementChild?.className).toContain(
      'pt-[calc(12vh+64px)]',
    );
    expect(
      container.querySelector('input[placeholder="Search Pluto"]')?.className,
    ).toContain('text-lg');
    expect(
      container.querySelector('[data-search-results]')?.className,
    ).toContain('p-2');
    expect(
      container.querySelector('[data-search-result-kind]')?.className,
    ).toContain('hover:bg-pro-surface');
  });

  it('does not pre-highlight a result before the user hovers or focuses it', () => {
    act(() =>
      root.render(
        <SearchOverlay
          searchVisible
          setSearchVisible={vi.fn()}
          searchQuery="launch"
          setSearchQuery={vi.fn()}
          results={results}
          onOpenMeeting={vi.fn()}
          onOpenProjects={vi.fn()}
          onOpenPeople={vi.fn()}
        />,
      ),
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '[data-search-result-kind]',
    );

    expect(buttons[0]?.hasAttribute('aria-selected')).toBe(false);
    expect(buttons[0]?.className).toContain('hover:bg-pro-surface');
    expect(buttons[0]?.className).not.toContain('shadow-premium');
  });

  it('routes selected result types to their navigation callbacks', () => {
    const onOpenProjects = vi.fn();
    const onOpenPeople = vi.fn();
    const onOpenMeeting = vi.fn();
    const setSearchVisible = vi.fn();

    act(() =>
      root.render(
        <SearchOverlay
          searchVisible
          setSearchVisible={setSearchVisible}
          searchQuery="launch"
          setSearchQuery={vi.fn()}
          results={results}
          onOpenMeeting={onOpenMeeting}
          onOpenProjects={onOpenProjects}
          onOpenPeople={onOpenPeople}
        />,
      ),
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '[data-search-result-kind]',
    );
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    act(() => buttons[2]?.click());

    expect(onOpenProjects).toHaveBeenCalledWith('project-1');
    expect(onOpenPeople).toHaveBeenCalledWith('person-1');
    expect(onOpenMeeting).toHaveBeenCalledWith('meeting-1');
    expect(setSearchVisible).toHaveBeenCalledWith(false);
  });
});
