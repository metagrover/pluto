import { BrowserWindow, screen } from 'electron'

const ALERT_WIDTH = 320
const ALERT_HEIGHT = 80
const ALERT_MARGIN = 14

const escapeHtml = (value: string) => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
)

const buildActiveCallAlertHtml = (appName: string) => {
  const safeAppName = escapeHtml(appName)
  const encodedAppName = JSON.stringify(appName)

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      color-scheme: light;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      --alert-surface: #f8f9fc;
      --alert-border: #d7dbe6;
      --alert-text-main: #1b2548;
      --alert-text-muted: #616b88;
      --alert-right-start: #1c2542;
      --alert-right-end: #22335f;
      --alert-right-text: #e7ecfb;
      --alert-progress-bg: #D4B483;
      --alert-progress: #8793b9;
      --pro-text-main: #1A2340;
      --pro-accent: #D4B483;
    }
    html, body {
      width: 100%;
      height: 100%;
    }
    body {
      margin: 0;
      background: transparent;
      overflow: hidden;
    }
    .alert {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      border-radius: 12px;
      background: var(--alert-surface);
      box-shadow:
        0 2px 8px rgba(16, 26, 56, 0.1),
        0 14px 28px rgba(12, 22, 48, 0.14);
      position: relative;
      display: flex;
      align-items: stretch;
      overflow: hidden;
      min-height: 100%;
      padding: 0 24px;
    }
    .close-alert {
      position: absolute;
      top: 6px;
      left: 6px;
      transform: scale(0.92);
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 1px solid rgba(160, 171, 198, 0.8);
      background: rgba(245, 247, 252, 0.98);
      color: var(--alert-text-muted);
      font-size: 13px;
      font-weight: 500;
      line-height: 1;
      padding: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(20, 30, 58, 0.12);
      z-index: 3;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease, transform 0.16s ease;
    }
    .alert:hover .close-alert {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1);
    }
    .close-alert:hover {
      color: var(--alert-text-main);
      background: #ffffff;
    }
    .left-block {
      min-width: 0;
      display: flex;
      align-items: center;
      flex: 1;
      padding: 14px 0 12px;
    }
    .meta {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .title {
      font-size: 14px;
      line-height: 1.08;
      font-weight: 700;
      letter-spacing: 0;
      color: var(--alert-text-main);
      margin: 0;
    }
    .app-row {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .app {
      font-size: 12px;
      line-height: 1.1;
      color: var(--alert-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin: 0;
    }
    .actions {
      width: 112px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .take-notes {
      border: 0;
      background: var(--pro-text-main);
      color: #ffffff;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      font-size: 10px;
      line-height: 1;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.2);
      transition:
        background-color 0.18s ease,
        transform 0.18s ease,
        box-shadow 0.18s ease;
      cursor: pointer;
    }
    .take-notes:hover {
      background: var(--pro-accent);
      transform: translateY(-1px);
      box-shadow: 0 15px 30px -8px rgba(0, 0, 0, 0.28);
    }
    .take-notes:active {
      transform: scale(0.98);
    }
    .progress-track {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      background: var(--alert-progress-bg);
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
      overflow: hidden;
      pointer-events: none;
    }
    .progress-bar {
      width: 100%;
      height: 100%;
      transform-origin: left center;
      background: var(--alert-progress);
      transform: scaleX(1);
    }
  </style>
</head>
<body>
    <div class="alert">
      <button id="closeAlert" class="close-alert" aria-label="Close alert">×</button>
      <div class="left-block">
        <div class="meta">
          <p class="title">Call detected</p>
          <div class="app-row">
            <p class="app">${safeAppName}</p>
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="alertTakeNotes" class="take-notes">Take Notes</button>
      </div>
      <div class="progress-track"><div class="progress-bar"></div></div>
    </div>
  <script>
    const LIFETIME_MS = 15000;
    const progressBar = document.querySelector('.progress-bar');
    const alertEl = document.querySelector('.alert');
    const closeAlert = () => window.close();
    let raf = 0;
    let isPaused = false;
    let pausedAt = 0;
    let deadlineTs = Date.now() + LIFETIME_MS;

    const updateProgress = () => {
      const now = Date.now();
      const remainingMs = Math.max(0, deadlineTs - now);
      const ratio = Math.max(0, Math.min(1, remainingMs / LIFETIME_MS));
      if (progressBar) progressBar.style.transform = 'scaleX(' + ratio + ')';
      if (remainingMs <= 0) {
        closeAlert();
        return;
      }
      if (isPaused) return;
      raf = requestAnimationFrame(updateProgress);
    };

    const pauseCountdown = () => {
      if (isPaused) return;
      isPaused = true;
      pausedAt = Date.now();
      cancelAnimationFrame(raf);
      updateProgress();
    };

    const resumeCountdown = () => {
      if (!isPaused) return;
      isPaused = false;
      const pausedDuration = Date.now() - pausedAt;
      deadlineTs += pausedDuration;
      pausedAt = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateProgress);
    };

    alertEl?.addEventListener('mouseenter', pauseCountdown);
    alertEl?.addEventListener('mouseleave', resumeCountdown);
    window.addEventListener('beforeunload', () => {
      cancelAnimationFrame(raf);
    });

    raf = requestAnimationFrame(updateProgress);
    const takeNotesButton = document.getElementById('alertTakeNotes');
    takeNotesButton?.addEventListener('click', () => {
      cancelAnimationFrame(raf);
      window.ipcRenderer.send('ACTIVE_CALL_ALERT_ACTION', { action: 'take-notes', appName: ${encodedAppName} });
      window.close();
    });
    const closeAlertButton = document.getElementById('closeAlert');
    closeAlertButton?.addEventListener('click', () => {
      cancelAnimationFrame(raf);
      window.close();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancelAnimationFrame(raf);
        window.close();
      }
    });
  </script>
</body>
</html>`
}

export const createActiveCallAlertController = ({ preloadPath }: { preloadPath: string }) => {
  let activeCallAlertWin: BrowserWindow | null = null

  const close = () => {
    if (!activeCallAlertWin || activeCallAlertWin.isDestroyed()) {
      activeCallAlertWin = null
      return
    }
    activeCallAlertWin.close()
    activeCallAlertWin = null
  }

  const show = (appName: string) => {
    close()

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea
    const x = Math.round(workArea.x + workArea.width - ALERT_WIDTH - ALERT_MARGIN)
    const y = Math.round(workArea.y + ALERT_MARGIN)

    const alertWin = new BrowserWindow({
      width: ALERT_WIDTH,
      height: ALERT_HEIGHT,
      x,
      y,
      minWidth: ALERT_WIDTH,
      maxWidth: ALERT_WIDTH,
      minHeight: ALERT_HEIGHT,
      maxHeight: ALERT_HEIGHT,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: true,
      hasShadow: true,
      webPreferences: {
        preload: preloadPath
      }
    })

    activeCallAlertWin = alertWin
    alertWin.setAlwaysOnTop(true, 'status')
    alertWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    alertWin.on('closed', () => {
      if (activeCallAlertWin === alertWin) {
        activeCallAlertWin = null
      }
    })

    const html = buildActiveCallAlertHtml(appName)
    void alertWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    alertWin.once('ready-to-show', () => {
      if (!alertWin.isDestroyed()) {
        alertWin.showInactive()
      }
    })
  }

  return { show, close }
}
