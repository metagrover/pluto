/**
 * Pin userData to a stable path so dev and packaged app share the same data.
 * Must run before any module that uses app.getPath('userData') (e.g. db.ts).
 */
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const appData = app.getPath('appData')
const plutoUserData = path.join(appData, 'pluto')
app.setPath('userData', plutoUserData)
if (!fs.existsSync(plutoUserData)) {
  fs.mkdirSync(plutoUserData, { recursive: true })
}
console.log('[Pluto] User data directory:', plutoUserData)
