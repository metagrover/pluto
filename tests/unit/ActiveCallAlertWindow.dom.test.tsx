// @vitest-environment happy-dom

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveCallAlertWindow } from '../../src/components/alerts/ActiveCallAlertWindow';

describe('ActiveCallAlertWindow component', () => {
  let container: HTMLDivElement;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sendMock = vi.fn();
    window.ipcRenderer = {
      send: sendMock,
      on: vi.fn(),
      off: vi.fn(),
      invoke: vi.fn(),
    } as unknown as typeof window.ipcRenderer;
    window.close = vi.fn();
  });

  afterEach(() => {
    container.remove();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders active call alert with call details and sends take-notes action', async () => {
    window.history.replaceState({}, '', '/?type=call&appName=Zoom&theme=dark');

    const root = createRoot(container);
    await act(async () => {
      root.render(<ActiveCallAlertWindow />);
    });

    expect(container.textContent).toContain('Call detected');
    expect(container.textContent).toContain('Zoom');
    expect(container.textContent).toContain('Take notes');
    expect(container.querySelector('.active-call-alert--call')).not.toBeNull();
    expect(container.querySelector('.alert-theme--dark')).not.toBeNull();
    expect(container.querySelector('.app')?.getAttribute('title')).toBe('Zoom');
    const logo = container.querySelector('.pluto-status-logo');
    expect(logo?.tagName).toBe('IMG');
    expect(logo?.getAttribute('alt')).toBe('');

    const button = container.querySelector('.take-notes') as HTMLButtonElement;
    expect(button).not.toBeNull();

    await act(async () => {
      button.click();
    });

    expect(sendMock).toHaveBeenCalledWith('ACTIVE_CALL_ALERT_ACTION', {
      action: 'take-notes',
      appName: 'Zoom',
    });
    expect(window.close).toHaveBeenCalled();
  });

  it('renders calendar prompt notification with meeting details and sends record action', async () => {
    const startIso = new Date(Date.now() + 120_000).toISOString(); // 2m from now
    window.history.replaceState(
      {},
      '',
      `/?type=calendar&occurrenceKey=meet-1&title=Sprint+Sync&start=${encodeURIComponent(startIso)}&hasLink=true&attendees=3`,
    );

    const root = createRoot(container);
    await act(async () => {
      root.render(<ActiveCallAlertWindow />);
    });

    expect(container.textContent).toContain('Sprint Sync');
    expect(container.textContent).toContain('Starts in 2m');
    expect(container.textContent).toContain('3 attendees');
    expect(container.textContent).toContain('Record');

    // Should render a video icon when hasLink is true
    const iconContainer = container.querySelector('.status-icon');
    expect(iconContainer).not.toBeNull();

    const recordButton = container.querySelector(
      '.take-notes',
    ) as HTMLButtonElement;
    expect(recordButton).not.toBeNull();

    await act(async () => {
      recordButton.click();
    });

    expect(sendMock).toHaveBeenCalledWith('CALENDAR_PROMPT_ALERT_ACTION', {
      action: 'record',
      occurrenceKey: 'meet-1',
    });
    expect(window.close).toHaveBeenCalled();
  });

  it.each(['call', 'calendar'])(
    'applies all selected theme palettes to %s alerts',
    async (type) => {
      for (const [selected, expected] of [
        ['light', 'light'],
        ['dark', 'dark'],
        ['terracotta', 'terracotta'],
        ['pluto-site', 'pluto-site'],
        ['aubergine', 'aubergine'],
        ['coral', 'pluto-site'],
        ['airbnb', 'pluto-site'],
        ['slack', 'aubergine'],
        ['claude', 'terracotta'],
        ['celestial', 'terracotta'],
        ['botanical', 'terracotta'],
      ]) {
        window.history.replaceState({}, '', `/?type=${type}&theme=${selected}`);
        const root = createRoot(container);
        await act(async () => root.render(<ActiveCallAlertWindow />));
        expect(document.documentElement.className).toBe(expected);
        expect(
          container.querySelector(`.alert-theme--${expected}`),
        ).not.toBeNull();
        await act(async () => root.unmount());
      }
    },
  );

  it('follows system appearance changes for system-themed alerts', async () => {
    let change: (() => void) | undefined;
    const media = {
      matches: true,
      addEventListener: vi.fn((_event, callback) => {
        change = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    window.history.replaceState({}, '', '/?type=calendar&theme=system');
    const root = createRoot(container);
    await act(async () => root.render(<ActiveCallAlertWindow />));
    expect(document.documentElement.className).toBe('dark');
    media.matches = false;
    await act(async () => change?.());
    expect(document.documentElement.className).toBe('light');
    await act(async () => root.unmount());
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it('sends dismiss action when close button is clicked on calendar prompt', async () => {
    window.history.replaceState(
      {},
      '',
      '/?type=calendar&occurrenceKey=meet-2&title=All+Hands&hasLink=false',
    );

    const root = createRoot(container);
    await act(async () => {
      root.render(<ActiveCallAlertWindow />);
    });

    const closeButton = container.querySelector(
      '.close-alert',
    ) as HTMLButtonElement;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton.click();
    });

    expect(sendMock).toHaveBeenCalledWith('CALENDAR_PROMPT_ALERT_ACTION', {
      action: 'dismiss',
      occurrenceKey: 'meet-2',
    });
    expect(window.close).toHaveBeenCalled();
  });
});
