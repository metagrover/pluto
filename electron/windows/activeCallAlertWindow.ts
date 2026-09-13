import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { Rectangle } from 'electron';

export const ALERT_WIDTH = 380;
export const ALERT_HEIGHT = 80;
export const ALERT_MARGIN = 14;

export type CalendarPromptAlertPayload = {
  occurrenceKey: string;
  title: string;
  start: string;
  hasConferenceLink?: boolean;
  attendeeCount?: number;
};

type ActiveCallAlertControllerOptions = {
  preloadPath: string;
  devServerUrl?: string;
  rendererDist: string;
};

export const createActiveCallAlertController = ({
  preloadPath,
  devServerUrl,
  rendererDist,
}: ActiveCallAlertControllerOptions) => {
  let activeCallAlertWin: BrowserWindow | null = null;
  let currentAlertType: 'call' | 'calendar' | null = null;

  const enforceAlertBounds = (win: BrowserWindow, x: number, y: number) => {
    if (win.isDestroyed()) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({
      x,
      y,
      width: ALERT_WIDTH,
      height: ALERT_HEIGHT,
    });
  };

  const close = () => {
    currentAlertType = null;
    if (!activeCallAlertWin || activeCallAlertWin.isDestroyed()) {
      activeCallAlertWin = null;
      return;
    }
    activeCallAlertWin.close();
    activeCallAlertWin = null;
  };

  const closeCalendarPrompt = () => {
    if (currentAlertType === 'calendar') {
      close();
    }
  };

  const createAlertWindow = (
    anchorBounds?: Rectangle,
  ): { win: BrowserWindow; x: number; y: number } => {
    close();

    const display = anchorBounds
      ? screen.getDisplayMatching(anchorBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    const x = Math.round(
      workArea.x + workArea.width - ALERT_WIDTH - ALERT_MARGIN,
    );
    const y = Math.round(workArea.y + ALERT_MARGIN);

    const alertWin = new BrowserWindow({
      width: ALERT_WIDTH,
      height: ALERT_HEIGHT,
      x,
      y,
      useContentSize: true,
      minWidth: ALERT_WIDTH,
      maxWidth: ALERT_WIDTH,
      minHeight: ALERT_HEIGHT,
      maxHeight: ALERT_HEIGHT,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
      },
    });

    activeCallAlertWin = alertWin;
    enforceAlertBounds(alertWin, x, y);
    alertWin.on('maximize', () => {
      enforceAlertBounds(alertWin, x, y);
    });
    alertWin.on('enter-full-screen', () => {
      enforceAlertBounds(alertWin, x, y);
    });
    alertWin.setAlwaysOnTop(true, 'status');
    // Avoid setVisibleOnAllWorkspaces: on macOS it implicitly hides the dock and resets the app icon to Electron default (electron/electron#37487)
    const reveal = () => {
      if (alertWin.isDestroyed() || alertWin.isVisible()) return;
      enforceAlertBounds(alertWin, x, y);
      alertWin.showInactive();
    };
    const revealFallbackTimer = setTimeout(reveal, 700);
    alertWin.on('closed', () => {
      clearTimeout(revealFallbackTimer);
      if (activeCallAlertWin === alertWin) {
        activeCallAlertWin = null;
        currentAlertType = null;
      }
    });
    alertWin.webContents.once('did-finish-load', () => {
      reveal();
    });

    alertWin.once('ready-to-show', () => {
      reveal();
    });

    return { win: alertWin, x, y };
  };

  const show = (appName: string, anchorBounds?: Rectangle) => {
    const { win: alertWin } = createAlertWindow(anchorBounds);
    currentAlertType = 'call';

    if (devServerUrl) {
      const base = new URL('active-call-alert.html', devServerUrl).toString();
      void alertWin.loadURL(
        `${base}?type=call&appName=${encodeURIComponent(appName)}`,
      );
    } else {
      void alertWin.loadFile(
        path.join(rendererDist, 'active-call-alert.html'),
        {
          query: { type: 'call', appName },
        },
      );
    }
  };

  const showCalendarPrompt = (
    payload: CalendarPromptAlertPayload,
    anchorBounds?: Rectangle,
  ) => {
    const { win: alertWin } = createAlertWindow(anchorBounds);
    currentAlertType = 'calendar';

    const queryParams: Record<string, string> = {
      type: 'calendar',
      occurrenceKey: payload.occurrenceKey,
      title: payload.title,
      start: payload.start,
    };
    if (payload.hasConferenceLink) {
      queryParams.hasLink = 'true';
    }
    if (typeof payload.attendeeCount === 'number') {
      queryParams.attendees = String(payload.attendeeCount);
    }

    if (devServerUrl) {
      const url = new URL('active-call-alert.html', devServerUrl);
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v);
      }
      void alertWin.loadURL(url.toString());
    } else {
      void alertWin.loadFile(
        path.join(rendererDist, 'active-call-alert.html'),
        {
          query: queryParams,
        },
      );
    }
  };

  return { show, showCalendarPrompt, close, closeCalendarPrompt };
};
