import { app, BrowserWindow, ipcMain, desktopCapturer, systemPreferences } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

// Initialize audio loopback support (must be before app.whenReady)
import { initMain } from 'electron-audio-loopback'
console.log('[Pluto] Initializing electron-audio-loopback...')
initMain()
console.log('[Pluto] Audio loopback initialized')

// Enable native audio capture on macOS (keep for fallback)
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    title: 'Pluto',
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Module imports
import * as db from './db'
import { whisperX } from './whisperx'
import { getProvider, getAllSettings } from './llm/factory'
import { extractAndProcessEntities, processExtractedEntities } from './entityPipeline'


// Cleanup on quit
app.on('before-quit', async () => {
  console.log('[Pluto] Shutting down...')
  await whisperX.stop()
})

app.whenReady().then(async () => {
  // Desktop capturer for audio sources
  ipcMain.handle('DESKTOP_CAPTURER_GET_SOURCES', (_event, opts) => desktopCapturer.getSources(opts))

  // WhisperX handlers
  ipcMain.handle('WHISPERX_CHECK_PYTHON', async () => {
    return await whisperX.checkPython()
  })

  ipcMain.handle('WHISPERX_START', async () => {
    await whisperX.start()
    return { success: true }
  })

  ipcMain.handle('WHISPERX_STOP', async () => {
    await whisperX.stop()
    return { success: true }
  })

  ipcMain.handle('WHISPERX_HEALTH', async () => {
    return await whisperX.health()
  })

  ipcMain.handle('WHISPERX_TRANSCRIBE', async (_event, { audioPath, options }) => {
    return await whisperX.transcribe(audioPath, options)
  })

  ipcMain.handle('WHISPERX_LIST_MODELS', async () => {
    return await whisperX.listModels()
  })
  ipcMain.handle('WHISPER_TRANSCRIBE', async (_event, audioPath, options = {}) => {
    console.log('[Pluto] Transcribing file:', audioPath, options.diarize ? '(with diarization)' : '')
    return await whisperX.transcribe(audioPath, options)
  })

  // Audio recording handlers
  ipcMain.handle('AUDIO_SAVE_AND_CONVERT', async (_event, arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer)
    const tempId = Date.now().toString()
    const rawPath = path.join(app.getPath('temp'), `raw_${tempId}.webm`)
    const wavPath = path.join(app.getPath('userData'), 'meetings', `${tempId}.wav`)

    console.log(`[Pluto] Received buffer of ${buffer.length} bytes`)

    // Ensure directory exists
    const meetingsDir = path.join(app.getPath('userData'), 'meetings')
    if (!fs.existsSync(meetingsDir)) fs.mkdirSync(meetingsDir, { recursive: true })

    console.log(`[Pluto] Saving raw audio to ${rawPath}`)
    fs.writeFileSync(rawPath, buffer)

    return new Promise((resolve, reject) => {
      console.log(`[Pluto] Converting to WAV: ${wavPath}`)
      ffmpeg(rawPath)
        .toFormat('wav')
        .audioChannels(1)
        .audioFrequency(16000)
        .on('end', () => {
          console.log('[Pluto] Conversion complete.')
          if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
          resolve(wavPath)
        })
        .on('error', (err) => {
          console.error('[Pluto] Conversion failed:', err)
          if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
          reject(err)
        })
        .save(wavPath)
    })
  })

  // Database handlers
  ipcMain.handle('SAVE_MEETING', (_event, meeting) => {
    try {
      console.log(`[Pluto] Saving meeting: ${meeting.id} - ${meeting.title}`)
      return db.saveMeeting(meeting)
    } catch (e) {
      console.error('[Pluto] SAVE_MEETING failed:', e)
      throw e
    }
  })

  ipcMain.handle('GET_MEETINGS', () => db.getMeetings())
  ipcMain.handle('GET_MEETING', (_event, id) => db.getMeeting(id))
  ipcMain.handle('SEARCH_MEETINGS', (_event, query) => db.searchMeetings(query))
  ipcMain.handle('DELETE_MEETING', (_event, id) => {
    try {
      return db.deleteMeeting(id)
    } catch (e) {
      console.error('[Pluto] DELETE_MEETING failed:', e)
      throw e
    }
  })

  // =============================================
  // KNOWLEDGE GRAPH IPC HANDLERS (Sprint 2)
  // =============================================

  // Entity operations
  ipcMain.handle('UPSERT_ENTITY', (_event, entity) => {
    try {
      return db.upsertEntity(entity)
    } catch (e) {
      console.error('[Pluto] UPSERT_ENTITY failed:', e)
      throw e
    }
  })

  ipcMain.handle('GET_ENTITY', (_event, id) => db.getEntity(id))
  ipcMain.handle('GET_ENTITIES_BY_TYPE', (_event, type) => db.getEntitiesByType(type))
  ipcMain.handle('GET_ALL_ENTITIES', () => db.getAllEntities())
  ipcMain.handle('SEARCH_ENTITIES', (_event, query) => db.searchEntities(query))
  ipcMain.handle('FIND_ENTITY', (_event, { type, name }) => db.findEntity(type, name))
  ipcMain.handle('UPDATE_ENTITY_STATUS', (_event, { id, status }) => db.updateEntityStatus(id, status))
  ipcMain.handle('DELETE_ENTITY', (_event, id) => db.deleteEntity(id))

  // Entity relationship operations
  ipcMain.handle('LINK_ENTITIES', (_event, link) => {
    try {
      return db.linkEntities(link)
    } catch (e) {
      console.error('[Pluto] LINK_ENTITIES failed:', e)
      throw e
    }
  })

  ipcMain.handle('GET_ENTITY_LINKS', (_event, entityId) => db.getEntityLinks(entityId))
  ipcMain.handle('GET_RELATED_ENTITIES', (_event, entityId) => db.getRelatedEntities(entityId))

  // Meeting-entity associations
  ipcMain.handle('ADD_MEETING_ENTITY', (_event, meetingEntity) => {
    try {
      return db.addMeetingEntity(meetingEntity)
    } catch (e) {
      console.error('[Pluto] ADD_MEETING_ENTITY failed:', e)
      throw e
    }
  })

  ipcMain.handle('GET_MEETING_ENTITIES', (_event, meetingId) => db.getMeetingEntities(meetingId))
  ipcMain.handle('GET_ENTITY_MEETINGS', (_event, entityId) => db.getEntityMeetings(entityId))

  // Action item queries
  ipcMain.handle('GET_ACTION_ITEMS_BY_STATUS', (_event, status) => db.getActionItemsByStatus(status))
  ipcMain.handle('GET_OVERDUE_ACTION_ITEMS', () => db.getOverdueActionItems())
  ipcMain.handle('GET_STALE_ACTION_ITEMS', (_event, staleDays) => db.getStaleActionItems(staleDays))

  // Knowledge graph stats
  ipcMain.handle('GET_KNOWLEDGE_GRAPH_STATS', () => db.getKnowledgeGraphStats())

  ipcMain.handle('RESET_KNOWLEDGE', async () => {
    try {
      return db.resetKnowledge()
    } catch (e) {
      console.error('[Pluto] RESET_KNOWLEDGE failed:', e)
      throw e
    }
  })

  // Settings handlers
  ipcMain.handle('GET_SETTING', (_event, key) => db.getSetting(key))
  ipcMain.handle('SET_SETTING', (_event, { key, value }) => db.setSetting(key, value))

  // LLM handlers
  ipcMain.handle('GENERATE_SUMMARY', async (_event, { transcript, userNotes }) => {
    try {
      const settings = await getAllSettings(db)
      const provider = await getProvider(settings)
      console.log(`[LLM] Using provider: ${provider.name}`)
      return await provider.generateSummary(transcript, userNotes)
    } catch (error) {
      console.error('[LLM] Summary generation failed:', error)
      throw error
    }
  })

  ipcMain.handle('EXTRACT_SPEAKER_IDENTITY', async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db)
      const provider = await getProvider(settings)
      console.log(`[LLM] Using provider: ${provider.name}`)
      return await provider.extractSpeakerIdentity(transcript)
    } catch (error) {
      console.error('[LLM] Speaker extraction failed:', error)
      return null // Graceful fallback
    }
  })

  ipcMain.handle('GENERATE_TITLE', async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db)
      const provider = await getProvider(settings)
      console.log(`[LLM] Generating title with provider: ${provider.name}`)
      return await provider.generateTitle(transcript)
    } catch (error) {
      console.error('[LLM] Title generation failed:', error)
      return 'Meeting' // Graceful fallback
    }
  })

  // =============================================
  // ENTITY EXTRACTION HANDLERS (Sprint 2)
  // =============================================

  // Extract entities from transcript (returns raw extraction result)
  ipcMain.handle('EXTRACT_ENTITIES', async (_event, { transcript }) => {
    try {
      const settings = await getAllSettings(db)
      const provider = await getProvider(settings)
      console.log(`[LLM] Extracting entities with provider: ${provider.name}`)
      return await provider.extractEntities(transcript)
    } catch (error) {
      console.error('[LLM] Entity extraction failed:', error)
      return {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: []
      }
    }
  })

  // Extract entities AND save them to the knowledge graph
  ipcMain.handle('EXTRACT_AND_PROCESS_ENTITIES', async (_event, { transcript, meetingId }) => {
    try {
      const settings = await getAllSettings(db)
      const provider = await getProvider(settings)
      console.log(`[LLM] Extracting and processing entities for meeting ${meetingId}`)
      return await extractAndProcessEntities(provider, transcript, meetingId)
    } catch (error) {
      console.error('[LLM] Entity extraction and processing failed:', error)
      throw error
    }
  })

  // Process pre-extracted entities (save to knowledge graph)
  ipcMain.handle('PROCESS_EXTRACTED_ENTITIES', async (_event, { entities, meetingId }) => {
    try {
      console.log(`[EntityPipeline] Processing pre-extracted entities for meeting ${meetingId}`)
      return await processExtractedEntities(entities, meetingId)
    } catch (error) {
      console.error('[EntityPipeline] Processing failed:', error)
      throw error
    }
  })

  // Permissions handlers
  ipcMain.handle('CHECK_MICROPHONE_PERMISSION', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone')
    }
    return 'granted' // Assume granted on other platforms if app is running
  })

  // Screen Recording Permissions (via node-mac-permissions)
  ipcMain.handle('CHECK_SCREEN_PERMISSION', () => {
    if (process.platform !== 'darwin') return 'authorized'
    try {
      const { getAuthStatus } = require('node-mac-permissions')
      return getAuthStatus('screen')
    } catch (error) {
      console.error('Failed to check screen permission:', error)
      return 'undetermined'
    }
  })

  ipcMain.handle('REQUEST_SCREEN_PERMISSION', () => {
    if (process.platform !== 'darwin') return true
    try {
      const { askForScreenCaptureAccess } = require('node-mac-permissions')
      askForScreenCaptureAccess()
      return true
    } catch (error) {
      console.error('Failed to request screen permission:', error)
      return false
    }
  })

  ipcMain.handle('GET_DESKTOP_SOURCES', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      // Simplify for renderer: return array of { id, name }
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }))
    } catch (error) {
      console.error('Failed to get desktop sources:', error)
      return []
    }
  })

  // Start WhisperX server in background (don't block app startup)
  whisperX.start().catch(err => {
    console.warn('[Pluto] WhisperX failed to start:', err.message)
    console.log('[Pluto] WhisperX will start on first transcription request')
  })

  // macOS: Proactively request microphone access
  if (process.platform === 'darwin') {
    console.log('[Pluto] Requesting microphone access from OS...')
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      console.log(`[Pluto] Microphone access granted: ${granted}`)
    }).catch(err => {
      console.error('[Pluto] Failed to request microphone access:', err)
    })
  }

  createWindow()
})
