import { app, BrowserWindow, ipcMain, systemPreferences, Tray, Menu, nativeImage, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, ChildProcess } from 'node:child_process'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

// Note: We intentionally avoid Chromium loopback/screen-capture APIs to keep
// permissions limited to microphone + system audio recording only.

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let tray: Tray | null = null

function createWindow() {
  const preloadPathMjs = path.join(__dirname, 'preload.mjs')
  const preloadPathJs = path.join(__dirname, 'preload.js')
  const preloadPath = fs.existsSync(preloadPathMjs) ? preloadPathMjs : preloadPathJs

  win = new BrowserWindow({
    title: 'Pluto',
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
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
  // No desktop capture handlers: keep permissions to mic + system audio only.

  // Do not set DisplayMediaRequestHandler to avoid Screen Recording permission prompts.

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
    const start = Date.now()
    const result = await whisperX.transcribe(audioPath, options)
    const durationMs = Date.now() - start
    console.log(`[Pluto] Transcription completed in ${durationMs}ms`)
    return result
  })

  // Audio recording handlers
  let recorderProcess: ChildProcess | null = null

  ipcMain.handle('AUDIO_RECORDER_START', async (_event) => {
    console.log('[Pluto] Request to start native recorder...')

    if (recorderProcess) {
      console.log('[Pluto] Recorder already running, killing old instance.')
      recorderProcess.kill()
      recorderProcess = null
    }

    const recorderPath = app.isPackaged
      ? path.join(process.resourcesPath, 'bin', 'recorder')
      : path.join(__dirname, '..', 'resources', 'bin', 'recorder')

    if (!fs.existsSync(recorderPath)) {
      console.error('[Pluto] Recorder binary not found at:', recorderPath)
      throw new Error('Recorder binary not found')
    }

    console.log('[Pluto] Spawning recorder:', recorderPath)

    // Spawn without arguments to stream to stdout (default)
    // Pass exclude bundle ID to prevent echo
    recorderProcess = spawn(recorderPath, ['stdout', 'com.github.electron']) // Assuming arg 1 is output (optional) and 2 is exclude

    recorderProcess.stdout?.on('data', (chunk: Buffer) => {
      // Check for JSON status messages
      const text = chunk.toString('utf-8')
      if (text.startsWith('{')) {
        try {
          const json = JSON.parse(text)
          if (json.status === 'started') {
            console.log('[Pluto] Native recorder started successfully.')
          } else if (json.error) {
            console.error('[Pluto] Native recorder error:', json.error)
          }
          return // Don't forward JSON as audio
        } catch (e) {
          // Not JSON, probably audio data 
        }
      }

      // Forward raw audio chunk to renderer
      // We convert Buffer to Uint8Array for IPC
      if (win) {
        win.webContents.send('AUDIO_RECORDER_DATA', chunk)
      }
    })

    recorderProcess.stderr?.on('data', (data: any) => {
      console.error(`[Pluto] Recorder stderr: ${data}`)
    })

    recorderProcess.on('close', (code: any) => {
      console.log(`[Pluto] Recorder exited with code ${code}`)
      recorderProcess = null
    })

    return true
  })

  ipcMain.handle('AUDIO_RECORDER_STOP', async () => {
    console.log('[Pluto] Request to stop native recorder...')
    if (recorderProcess) {
      recorderProcess.kill()
      recorderProcess = null
    }
    return true
  })

  // --- NATIVE AUDIO CAPTURE (AUDIOCAP) ---
  let nativeAudioProcess: ChildProcess | null = null
  let bootProbeDone = false

  ipcMain.handle('SYSTEM_AUDIO_PROBE', async (_event, { durationMs, allowSilent } = {}) => {
    if (nativeAudioProcess) return true
    const isDev = !app.isPackaged
    const execPath = isDev
      ? path.join(app.getAppPath(), 'resources/bin/audiocap')
      : path.join(process.resourcesPath, 'bin', 'audiocap')

    if (!fs.existsSync(execPath)) {
      console.error('[Pluto] AudioCap binary not found at:', execPath)
      return false
    }

    const probeArgs = ['--probe', '--probe-include-self']
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
      probeArgs.push('--probe-ms', String(Math.floor(durationMs)))
    }

    return await new Promise<boolean>((resolve) => {
      const probe = spawn(execPath, probeArgs)
      const timeout = setTimeout(() => {
        probe.kill('SIGKILL')
        resolve(false)
      }, 3000)

      probe.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) return resolve(true)
        if (code === 2) return resolve(Boolean(allowSilent))
        resolve(false)
      })

      probe.on('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  })

  ipcMain.handle('BOOT_PROBE_STATUS', () => bootProbeDone)
  ipcMain.handle('BOOT_PROBE_MARK', () => {
    bootProbeDone = true
    return true
  })

  ipcMain.handle('NATIVE_AUDIO_START', async (_event) => {
    if (nativeAudioProcess) return true

    // Locate binary: In dev 'resources/bin/audiocap', in prod 'process.resourcesPath/bin/audiocap'
    const isDev = !app.isPackaged
    // Note: absolute path is safest
    const execPath = isDev
      ? path.join(app.getAppPath(), 'resources/bin/audiocap')
      : path.join(process.resourcesPath, 'bin', 'audiocap')

    console.log('[Pluto] Spawning AudioCap:', execPath)

    try {
      if (!fs.existsSync(execPath)) {
        console.error('[Pluto] AudioCap binary not found at:', execPath)
        return false
      }

      nativeAudioProcess = spawn(execPath)

      nativeAudioProcess.stdout?.on('data', (chunk) => {
        // chunk is Buffer (PCM data)
        if (win) {
          win.webContents.send('NATIVE_AUDIO_CHUNK', chunk)
        }
      })

      nativeAudioProcess.stderr?.on('data', (data) => {
        console.error('[Pluto-AudioCap]', data.toString())
      })

      nativeAudioProcess.on('close', (code) => {
        console.log('[Pluto] AudioCap exited with code', code)
        nativeAudioProcess = null
      })

      return true
    } catch (e) {
      console.error('[Pluto] Failed to spawn audiocap:', e)
      return false
    }
  })

  ipcMain.handle('NATIVE_AUDIO_STOP', async () => {
    if (nativeAudioProcess) {
      console.log('[Pluto] Stopping AudioCap...')
      nativeAudioProcess.kill('SIGINT') // Graceful stop
      nativeAudioProcess = null
    }
    return true
  })

  ipcMain.handle('AUDIO_SAVE_AND_CONVERT', async (_event, arrayBuffer, format?: 'pcm' | 'webm' | 'wav') => {
    const start = Date.now()
    const buffer = Buffer.from(arrayBuffer ?? [])
    const tempId = Date.now().toString()
    // If format is wav, we still save as .wav (temporarily as raw input) or .audio? 
    // Actually, if it's a WAV blob, it HAS a header. So we can just save it as .wav.
    // ffmpeg will detect it.
    // If 'pcm', we use .pcm extension.
    // If 'webm', we use .webm extension.

    let ext = 'webm'
    if (format === 'pcm') ext = 'pcm'
    if (format === 'wav') ext = 'wav'

    const rawPath = path.join(app.getPath('temp'), `raw_${tempId}.${ext}`)
    const wavPath = path.join(app.getPath('userData'), 'meetings', `${tempId}.wav`)

    // ... (rest of logging and checks)

    console.log(`[Pluto] Saving raw audio to ${rawPath} (format: ${format || 'auto'})`)
    fs.writeFileSync(rawPath, buffer)

    return new Promise((resolve, reject) => {
      console.log(`[Pluto] Converting to WAV: ${wavPath}`)
      let command = ffmpeg(rawPath)

      if (format === 'pcm') {
        // Explicit input options for Raw PCM 16-bit 16kHz Mono
        command = command.inputOptions([
          '-f s16le',
          '-ar 16000',
          '-ac 1'
        ])
      } else if (format === 'wav') {
        // It's already a WAV file (with header). No explicit input options needed usually.
        // But ffmpeg is robust.
      }

      command
        .toFormat('wav')
        .audioChannels(1)
        .audioFrequency(16000)
        .on('end', () => {
          console.log(`[Pluto] Conversion complete (${Date.now() - start}ms)`)
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
      const result = db.saveMeeting(meeting)

      // Process manual participants as entities (Sprint 2 enhancement)
      if (meeting.participants && Array.isArray(meeting.participants)) {
        console.log(`[Pluto] Processing ${meeting.participants.length} manual participants...`)
        for (const name of meeting.participants) {
          if (!name || !name.trim()) continue

          try {
            // 1. Create/Get Person Entity
            const entity = db.upsertEntity({
              type: 'person',
              name: name.trim(),
              status: 'active'
            })

            // 2. Link to Meeting
            db.addMeetingEntity({
              meeting_id: String(meeting.id),
              entity_id: entity.id,
              mention_count: 1, // Default weight for manual addition
              context: 'Manual participant'
            })
          } catch (err) {
            console.error(`[Pluto] Failed to process participant: ${name}`, err)
          }
        }
      }

      return result
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
      if (!transcript || !transcript.trim()) {
        console.log('[LLM] Skipping summary generation for empty transcript')
        return ''
      }
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
      if (!transcript || !transcript.trim()) return null
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
      if (!transcript || !transcript.trim()) return 'New Meeting'
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
      if (!transcript || !transcript.trim()) {
        return {
          people: [],
          topics: [],
          action_items: [],
          decisions: [],
          projects: []
        }
      }
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
      if (!transcript || !transcript.trim()) {
        console.log('[LLM] Skipping entity extraction for empty transcript')
        return { created: 0, linked: 0 }
      }
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

  ipcMain.handle('OPEN_SYSTEM_SETTINGS_PRIVACY', async (_event, pane) => {
    if (process.platform !== 'darwin') return false
    try {
      const target = pane === 'microphone'
        ? 'Privacy_Microphone'
        : 'Privacy_ScreenCapture' // System Audio Recording Only lives here on macOS
      const url = `x-apple.systempreferences:com.apple.preference.security?${target}`
      await shell.openExternal(url)
      return true
    } catch (error) {
      console.error('Failed to open System Settings:', error)
      return false
    }
  })

  ipcMain.handle('APP_RELAUNCH', () => {
    app.relaunch()
    app.exit(0)
    return true
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

  // Create Tray Icon
  const iconPath = path.join(process.env.VITE_PUBLIC, 'logo.png')
  const dockIconPath = path.join(process.env.VITE_PUBLIC, 'dock-icon.png')

  const icon = nativeImage.createFromPath(iconPath)

  // Set Dock Icon for macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(dockIconPath)
    app.dock.setIcon(dockIcon)
  }

  const resizedIcon = icon.resize({ width: 16, height: 16 })

  tray = new Tray(resizedIcon)
  tray.setToolTip('Pluto')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Pluto',
      click: () => {
        if (win) {
          if (win.isVisible()) {
            win.focus()
          } else {
            win.show()
          }
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)

  // Toggle window on click (macOS behavior often expects this)
  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        if (win.isFocused()) {
          win.hide()
        } else {
          win.focus()
        }
      } else {
        win.show()
      }
    } else {
      createWindow()
    }
  })

  createWindow()
})
