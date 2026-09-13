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
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders active call alert with call details and sends take-notes action', async () => {
    window.history.replaceState({}, '', '/?type=call&appName=Zoom');

    const root = createRoot(container);
    await act(async () => {
      root.render(<ActiveCallAlertWindow />);
    });

    expect(container.textContent).toContain('Call detected');
    expect(container.textContent).toContain('Zoom');
    expect(container.textContent).toContain('Take notes');

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

    const recordButton = container.querySelector('.take-notes') as HTMLButtonElement;
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

    const closeButton = container.querySelector('.close-alert') as HTMLButtonElement;
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
