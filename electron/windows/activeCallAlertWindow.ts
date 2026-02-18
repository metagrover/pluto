import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import type { Rectangle } from 'electron'

const ALERT_WIDTH = 320
const ALERT_HEIGHT = 80
const ALERT_MARGIN = 14

type ActiveCallAlertControllerOptions = {
  preloadPath: string
  devServerUrl?: string
  rendererDist: string
}

export const createActiveCallAlertController = ({
  preloadPath,
  devServerUrl,
  rendererDist
}: ActiveCallAlertControllerOptions) => {
  let activeCallAlertWin: BrowserWindow | null = null

  const close = () => {
    if (!activeCallAlertWin || activeCallAlertWin.isDestroyed()) {
      activeCallAlertWin = null
      return
    }
    activeCallAlertWin.close()
    activeCallAlertWin = null
  }

  const show = (appName: string, anchorBounds?: Rectangle) => {
    close()

    const display = anchorBounds
      ? screen.getDisplayMatching(anchorBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
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
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath
      }
    })

    activeCallAlertWin = alertWin
    alertWin.setAlwaysOnTop(true, 'status')
    alertWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    const reveal = () => {
      if (alertWin.isDestroyed() || alertWin.isVisible()) return
      alertWin.showInactive()
    }
    const revealFallbackTimer = setTimeout(reveal, 700)
    alertWin.on('closed', () => {
      clearTimeout(revealFallbackTimer)
      if (activeCallAlertWin === alertWin) {
        activeCallAlertWin = null
      }
    })
    alertWin.webContents.once('did-finish-load', () => {
      reveal()
    })

    if (devServerUrl) {
      const base = new URL('active-call-alert.html', devServerUrl).toString()
      void alertWin.loadURL(`${base}?appName=${encodeURIComponent(appName)}`)
    } else {
      void alertWin.loadFile(path.join(rendererDist, 'active-call-alert.html'), {
        query: { appName }
      })
    }

    alertWin.once('ready-to-show', () => {
      reveal()
    })
  }

  return { show, close }
}
