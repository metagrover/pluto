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
    controller.show('Chrome');
    expect(setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
});
