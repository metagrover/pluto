import { beforeEach, describe, expect, it, vi } from 'vitest';

const setVisibleOnAllWorkspaces = vi.fn();
const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    this.on = vi.fn();
    this.once = vi.fn();
    this.setAlwaysOnTop = vi.fn();
    this.setVisibleOnAllWorkspaces = setVisibleOnAllWorkspaces;
    this.setBounds = vi.fn();
    this.isDestroyed = vi.fn(() => false);
    this.isVisible = vi.fn(() => false);
    this.isFullScreen = vi.fn(() => false);
    this.isMaximized = vi.fn(() => false);
    this.setFullScreen = vi.fn();
    this.unmaximize = vi.fn();
    this.showInactive = vi.fn();
    this.webContents = { once: vi.fn() };
    this.loadURL = vi.fn();
    this.loadFile = vi.fn();
    return this;
  }),
  screen: {
    getDisplayMatching: vi.fn(() => ({ workArea })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea })),
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  },
}));

describe('activeCallAlertWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call setVisibleOnAllWorkspaces on the alert window (macOS dock icon regression)', async () => {
    const { createActiveCallAlertController } = await import(
      '../../electron/windows/activeCallAlertWindow'
    );
    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });
    controller.show('Chrome', 'light');
    expect(setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  it('shows calendar prompt outside the app at top-right corner with macOS banner dimensions', async () => {
    const { BrowserWindow } = await import('electron');
    const {
      createActiveCallAlertController,
      ALERT_WIDTH,
      ALERT_HEIGHT,
      ALERT_MARGIN,
    } = await import('../../electron/windows/activeCallAlertWindow');

    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });

    controller.showCalendarPrompt({
      occurrenceKey: 'meeting-123',
      title: 'Design Review',
      start: '2026-09-12T21:00:00.000Z',
      hasConferenceLink: true,
      attendeeCount: 4,
    });

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: ALERT_WIDTH,
        height: ALERT_HEIGHT,
        x: workArea.width - ALERT_WIDTH - ALERT_MARGIN,
        y: workArea.y + ALERT_MARGIN,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
      }),
    );

    const mockInstance = vi.mocked(BrowserWindow).mock.results[0]?.value;
    expect(mockInstance.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('active-call-alert.html'),
      {
        query: {
          type: 'calendar',
          occurrenceKey: 'meeting-123',
          title: 'Design Review',
          start: '2026-09-12T21:00:00.000Z',
          hasLink: 'true',
          attendees: '4',
        },
      },
    );
  });

  it('loads calendar prompt with devServerUrl when configured', async () => {
    const { BrowserWindow } = await import('electron');
    const { createActiveCallAlertController } = await import(
      '../../electron/windows/activeCallAlertWindow'
    );

    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      devServerUrl: 'http://localhost:5173',
      rendererDist: '/dist',
    });

    controller.showCalendarPrompt({
      occurrenceKey: 'meeting-456',
      title: 'Architecture Sync',
      start: '2026-09-12T21:30:00.000Z',
    });

    const mockInstance = vi.mocked(BrowserWindow).mock.results[0]?.value;
    expect(mockInstance.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:5173/active-call-alert.html'),
    );
    expect(mockInstance.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('type=calendar'),
    );
    expect(mockInstance.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('occurrenceKey=meeting-456'),
    );
  });

  it('closes calendar prompt alert when closeCalendarPrompt is called', async () => {
    const { BrowserWindow } = await import('electron');
    const { createActiveCallAlertController } = await import(
      '../../electron/windows/activeCallAlertWindow'
    );

    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });

    controller.showCalendarPrompt({
      occurrenceKey: 'meeting-789',
      title: '1:1 Sync',
      start: '2026-09-12T22:00:00.000Z',
    });

    const mockInstance = vi.mocked(BrowserWindow).mock.results[0]?.value;
    mockInstance.close = vi.fn();

    controller.closeCalendarPrompt();
    expect(mockInstance.close).toHaveBeenCalled();
  });

  it('positions call alerts using the current toast offsets and forwards theme', async () => {
    const { BrowserWindow } = await import('electron');
    const {
      createActiveCallAlertController,
      ALERT_WIDTH,
      CALL_ALERT_MARGIN_RIGHT,
      CALL_ALERT_MARGIN_TOP,
    } = await import('../../electron/windows/activeCallAlertWindow');
    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });

    expect(controller.show('Google Meet', 'dark')).toBe(true);

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        x: workArea.width - ALERT_WIDTH - CALL_ALERT_MARGIN_RIGHT,
        y: workArea.y + CALL_ALERT_MARGIN_TOP,
      }),
    );
    const mockInstance = vi.mocked(BrowserWindow).mock.results[0]?.value;
    expect(mockInstance.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('active-call-alert.html'),
      { query: { type: 'call', appName: 'Google Meet', theme: 'dark' } },
    );
  });

  it('does not let call show or hide operations replace a calendar prompt', async () => {
    const { BrowserWindow } = await import('electron');
    const { createActiveCallAlertController } = await import(
      '../../electron/windows/activeCallAlertWindow'
    );
    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });
    controller.showCalendarPrompt({
      occurrenceKey: 'protected-calendar',
      title: 'Planning',
      start: '2026-09-12T22:00:00.000Z',
    });
    const calendarWindow = vi.mocked(BrowserWindow).mock.results[0]?.value;
    calendarWindow.close = vi.fn();

    expect(controller.show('Google Meet', 'light')).toBe(false);
    controller.closeCallAlert();

    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(calendarWindow.close).not.toHaveBeenCalled();
  });

  it('closes a call alert through the call-only close operation', async () => {
    const { BrowserWindow } = await import('electron');
    const { createActiveCallAlertController } = await import(
      '../../electron/windows/activeCallAlertWindow'
    );
    const controller = createActiveCallAlertController({
      preloadPath: '/preload.js',
      rendererDist: '/dist',
    });
    controller.show('Zoom', 'light');
    const callWindow = vi.mocked(BrowserWindow).mock.results[0]?.value;
    callWindow.close = vi.fn();

    controller.closeCallAlert();

    expect(callWindow.close).toHaveBeenCalled();
  });
});
