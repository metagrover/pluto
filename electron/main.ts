import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  shell,
  systemPreferences,
} from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { createActiveCallDetector } from './activeCall/detector';
import { createActiveCallAlertController } from './windows/activeCallAlertWindow';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Note: We intentionally avoid Chromium loopback/screen-capture APIs to keep
// permissions limited to microphone + system audio recording only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

let win: BrowserWindow | null;
let tray: Tray | null = null;

const getPreloadPath = () => {
  const preloadPathMjs = path.join(__dirname, 'preload.mjs');
  const preloadPathJs = path.join(__dirname, 'preload.js');
  return fs.existsSync(preloadPathMjs) ? preloadPathMjs : preloadPathJs;
};

function createWindow() {
  win = new BrowserWindow({
    title: 'Pluto',
    icon: path.join(process.env.VITE_PUBLIC, 'dock-icon.png'),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: getPreloadPath(),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Module imports
import * as db from './db';
import {
  extractAndProcessEntities,
  processExtractedEntities,
} from './entityPipeline';
import {
  initializeKnowledgeDocs,
  queueAllKnowledgeDocsRefresh,
  queueKnowledgeDocsRefreshForMeeting,
  refreshKnowledgeDocNow,
  synthesizeEntitySummary,
} from './knowledgeSynthesis';
import { getAllSettings, getProvider } from './llm/factory';
import type { AnalysisArtifacts, InternalSignalDocument } from './llm/provider';
import {
  type TranscriptCleanupStats,
  cleanTranscriptSegments,
} from './transcriptCleanup';
import { mapValueSignalsToPriorityHints } from './valueSignalMapping';
import { whisperX } from './whisperx';
import { generateMid } from './intelligence/midGenerator';
import { renderMidToMarkdown } from './intelligence/midRenderer';
import { parseQuery, retrieveContext } from './intelligence/queryEngine';
import { getAskPlutoPrompt } from './intelligence/queryPrompts';
import { buildCitationChain, auditCitations } from './intelligence/citationEngine';

// Cleanup on quit
app.on('before-quit', async () => {
  console.log('[Pluto] Shutting down...');
  await whisperX.stop();
});

app.whenReady().then(async () => {
  // No desktop capture handlers: keep permissions to mic + system audio only.

  // Do not set DisplayMediaRequestHandler to avoid Screen Recording permission prompts.

  // WhisperX handlers
  ipcMain.handle('WHISPERX_CHECK_PYTHON', async () => {
    return await whisperX.checkPython();
  });

  ipcMain.handle('WHISPERX_START', async () => {
    await whisperX.start();
    return { success: true };
  });

  ipcMain.handle('WHISPERX_STOP', async () => {
    await whisperX.stop();
    return { success: true };
  });

  ipcMain.handle('WHISPERX_HEALTH', async () => {
    return await whisperX.health();
  });

  ipcMain.handle(
    'WHISPERX_TRANSCRIBE',
    async (_event, { audioPath, options }) => {
      return await whisperX.transcribe(audioPath, options);
    },
  );

  ipcMain.handle('WHISPERX_LIST_MODELS', async () => {
    return await whisperX.listModels();
  });

  ipcMain.handle(
    'WHISPER_TRANSCRIBE',
    async (_event, audioPath, options = {}) => {
      console.log(
        '[Pluto] Transcribing file:',
        audioPath,
        options.diarize ? '(with diarization)' : '',
      );
      const start = Date.now();
      const result = await whisperX.transcribe(audioPath, options);
      const durationMs = Date.now() - start;
      console.log(`[Pluto] Transcription completed in ${durationMs}ms`);
      return result;
    },
  );

  // Audio recording handlers
  let recorderProcess: ChildProcess | null = null;

  ipcMain.handle('AUDIO_RECORDER_START', async (_event) => {
    console.log('[Pluto] Request to start native recorder...');

    if (recorderProcess) {
      console.log('[Pluto] Recorder already running, killing old instance.');
      recorderProcess.kill();
      recorderProcess = null;
    }

    const recorderPath = app.isPackaged
      ? path.join(process.resourcesPath, 'bin', 'recorder')
      : path.join(__dirname, '..', 'resources', 'bin', 'recorder');

    if (!fs.existsSync(recorderPath)) {
      console.error('[Pluto] Recorder binary not found at:', recorderPath);
      throw new Error('Recorder binary not found');
    }

    console.log('[Pluto] Spawning recorder:', recorderPath);

    // Spawn without arguments to stream to stdout (default)
    // Pass exclude bundle ID to prevent echo
    recorderProcess = spawn(recorderPath, ['stdout', 'com.github.electron']); // Assuming arg 1 is output (optional) and 2 is exclude

    recorderProcess.stdout?.on('data', (chunk: Buffer) => {
      // Check for JSON status messages
      const text = chunk.toString('utf-8');
      if (text.startsWith('{')) {
        try {
          const json = JSON.parse(text);
          if (json.status === 'started') {
            console.log('[Pluto] Native recorder started successfully.');
          } else if (json.error) {
            console.error('[Pluto] Native recorder error:', json.error);
          }
          return; // Don't forward JSON as audio
        } catch (e) {
          // Not JSON, probably audio data
        }
      }

      // Forward raw audio chunk to renderer
      // We convert Buffer to Uint8Array for IPC
      if (win) {
        win.webContents.send('AUDIO_RECORDER_DATA', chunk);
      }
    });

    recorderProcess.stderr?.on('data', (data: Buffer | string) => {
      console.error(`[Pluto] Recorder stderr: ${data}`);
    });

    recorderProcess.on('close', (code: number | null) => {
      console.log(`[Pluto] Recorder exited with code ${code}`);
      recorderProcess = null;
    });

    return true;
  });

  ipcMain.handle('AUDIO_RECORDER_STOP', async () => {
    console.log('[Pluto] Request to stop native recorder...');
    if (recorderProcess) {
      recorderProcess.kill();
      recorderProcess = null;
    }
    return true;
  });

  // --- NATIVE AUDIO CAPTURE (AUDIOCAP) ---
  let nativeAudioProcess: ChildProcess | null = null;
  let bootProbeDone = false;
  const activeCallAlertController = createActiveCallAlertController({
    preloadPath: getPreloadPath(),
    devServerUrl: VITE_DEV_SERVER_URL,
    rendererDist: RENDERER_DIST,
  });

  const getAudioCapExecPath = () => {
    const isDev = !app.isPackaged;
    return isDev
      ? path.join(app.getAppPath(), 'resources/bin/audiocap')
      : path.join(process.resourcesPath, 'bin', 'audiocap');
  };

  const runAudioProbe = async ({
    durationMs = 1500,
    allowSilent = false,
    includeSelf = true,
    targetPids,
    silentProbe = false,
  }: {
    durationMs?: number;
    allowSilent?: boolean;
    includeSelf?: boolean;
    targetPids?: number[];
    silentProbe?: boolean;
  } = {}) => {
    if (nativeAudioProcess) return true;

    const execPath = getAudioCapExecPath();
    if (!fs.existsSync(execPath)) {
      console.error('[Pluto] AudioCap binary not found at:', execPath);
      return false;
    }

    const probeArgs = ['--probe'];
    if (includeSelf) probeArgs.push('--probe-include-self');
    if (silentProbe) probeArgs.push('--probe-silent');
    const uniqueTargetPids = Array.from(
      new Set(
        (targetPids || []).filter((pid) => Number.isInteger(pid) && pid > 0),
      ),
    );
    for (const pid of uniqueTargetPids) {
      probeArgs.push('--pid', String(pid));
    }
    if (
      typeof durationMs === 'number' &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    ) {
      probeArgs.push('--probe-ms', String(Math.floor(durationMs)));
    }

    return await new Promise<boolean>((resolve) => {
      const probe = spawn(execPath, probeArgs);
      let stderr = '';
      const timeout = setTimeout(
        () => {
          probe.kill('SIGKILL');
          resolve(false);
        },
        Math.max(3000, Math.floor(durationMs + 1500)),
      );

      probe.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      probe.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) return resolve(true);
        if (code === 2) {
          if (!allowSilent) return resolve(false);
          const foundMatch = stderr.match(
            /\[AudioCap\] Found (\d+) processes/i,
          );
          const foundCount = foundMatch
            ? Number.parseInt(foundMatch[1], 10)
            : 0;
          return resolve(foundCount > 0);
        }
        resolve(false);
      });

      probe.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  };

  const detectActiveCall = createActiveCallDetector({ runAudioProbe });

  ipcMain.handle(
    'SYSTEM_AUDIO_PROBE',
    async (_event, { durationMs, allowSilent } = {}) => {
      return await runAudioProbe({
        durationMs,
        allowSilent: Boolean(allowSilent),
        includeSelf: true,
        silentProbe: true,
      });
    },
  );

  ipcMain.handle('DETECT_ACTIVE_CALL', async () => {
    return await detectActiveCall();
  });

  ipcMain.handle('SHOW_ACTIVE_CALL_ALERT', async (_event, { appName } = {}) => {
    if (typeof appName !== 'string') return false;
    const normalized = appName.trim();
    if (!normalized) return false;
    const anchorBounds =
      win && !win.isDestroyed() ? win.getBounds() : undefined;
    activeCallAlertController.show(normalized, anchorBounds);
    return true;
  });

  ipcMain.handle('HIDE_ACTIVE_CALL_ALERT', async () => {
    activeCallAlertController.close();
    return true;
  });

  ipcMain.on(
    'ACTIVE_CALL_ALERT_ACTION',
    (_event, payload?: { action?: string; appName?: string }) => {
      if (payload?.action === 'take-notes') {
        if (win) {
          if (!win.isVisible()) win.show();
          win.focus();
          win.webContents.send('ACTIVE_CALL_TAKE_NOTES', {
            appName: payload?.appName || null,
          });
        }
      }
      activeCallAlertController.close();
    },
  );

  ipcMain.handle('BOOT_PROBE_STATUS', () => bootProbeDone);
  ipcMain.handle('BOOT_PROBE_MARK', () => {
    bootProbeDone = true;
    return true;
  });

  ipcMain.handle('NATIVE_AUDIO_START', async (_event) => {
    if (nativeAudioProcess) return true;

    // Locate binary: In dev 'resources/bin/audiocap', in prod 'process.resourcesPath/bin/audiocap'
    const execPath = getAudioCapExecPath();

    console.log('[Pluto] Spawning AudioCap:', execPath);

    try {
      if (!fs.existsSync(execPath)) {
        console.error('[Pluto] AudioCap binary not found at:', execPath);
        return false;
      }

      nativeAudioProcess = spawn(execPath);

      nativeAudioProcess.stdout?.on('data', (chunk) => {
        // chunk is Buffer (PCM data)
        if (win) {
          win.webContents.send('NATIVE_AUDIO_CHUNK', chunk);
        }
      });

      nativeAudioProcess.stderr?.on('data', (data) => {
        console.error('[Pluto-AudioCap]', data.toString());
      });

      nativeAudioProcess.on('close', (code) => {
        console.log('[Pluto] AudioCap exited with code', code);
        nativeAudioProcess = null;
      });

      return true;
    } catch (e) {
      console.error('[Pluto] Failed to spawn audiocap:', e);
      return false;
    }
  });

  ipcMain.handle('NATIVE_AUDIO_STOP', async () => {
    if (nativeAudioProcess) {
      console.log('[Pluto] Stopping AudioCap...');
      nativeAudioProcess.kill('SIGINT'); // Graceful stop
      nativeAudioProcess = null;
    }
    return true;
  });

  ipcMain.handle(
    'AUDIO_SAVE_AND_CONVERT',
    async (
      _event,
      arrayBuffer,
      format?: 'pcm' | 'webm' | 'ogg' | 'wav',
      sourceHint?: string,
    ) => {
      const start = Date.now();
      const buffer = Buffer.from(arrayBuffer ?? []);
      if (!buffer.length) {
        console.warn('[Pluto] Skipping conversion: empty audio buffer');
        return null;
      }
      const sourceTag =
        (typeof sourceHint === 'string' ? sourceHint : 'audio')
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 24) || 'audio';
      const tempId = `${Date.now()}_${randomUUID()}`;
      // If format is wav, we still save as .wav (temporarily as raw input) or .audio?
      // Actually, if it's a WAV blob, it HAS a header. So we can just save it as .wav.
      // ffmpeg will detect it.
      // If 'pcm', we use .pcm extension.
      // If 'webm', we use .webm extension.

      let ext = 'webm';
      if (format === 'pcm') ext = 'pcm';
      if (format === 'ogg') ext = 'ogg';
      if (format === 'wav') ext = 'wav';

      const rawPath = path.join(
        app.getPath('temp'),
        `raw_${sourceTag}_${tempId}.${ext}`,
      );
      const wavPath = path.join(
        app.getPath('userData'),
        'meetings',
        `${sourceTag}_${tempId}.wav`,
      );

      // ... (rest of logging and checks)

      console.log(
        `[Pluto] Saving ${sourceTag} raw audio to ${rawPath} (format: ${format || 'auto'})`,
      );
      fs.writeFileSync(rawPath, buffer);

      const meetingsDir = path.join(app.getPath('userData'), 'meetings');
      fs.mkdirSync(meetingsDir, { recursive: true });

      return new Promise<string | null>((resolve) => {
        if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size === 0) {
          console.warn(
            '[Pluto] Conversion skipped: temp file missing or empty',
          );
          try {
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
          } catch (_) {}
          return resolve(null);
        }
        console.log(`[Pluto] Converting ${sourceTag} to WAV: ${wavPath}`);
        let command = ffmpeg(rawPath);

        if (format === 'pcm') {
          // Explicit input options for Raw PCM 16-bit 16kHz Mono
          command = command.inputOptions(['-f s16le', '-ar 16000', '-ac 1']);
        } else if (format === 'wav') {
          // It's already a WAV file (with header). No explicit input options needed usually.
          // But ffmpeg is robust.
        }

        command
          .toFormat('wav')
          .audioChannels(1)
          .audioFrequency(16000)
          .on('end', () => {
            console.log(
              `[Pluto] Conversion complete (${Date.now() - start}ms)`,
            );
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            resolve(wavPath);
          })
          .on('error', (err) => {
            console.warn(
              '[Pluto] Conversion failed, skipping chunk:',
              err instanceof Error ? err.message : err,
            );
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            resolve(null);
          })
          .save(wavPath);
      });
    },
  );

  ipcMain.handle(
    'AUDIO_SLICE_WAV',
    async (_event, { inputPath, segments, outputTag } = {}) => {
      if (
        typeof inputPath !== 'string' ||
        inputPath.length === 0 ||
        !fs.existsSync(inputPath)
      ) {
        return null;
      }
      if (!Array.isArray(segments) || segments.length === 0) return [];

      const tag =
        (typeof outputTag === 'string' ? outputTag : 'slice')
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 24) || 'slice';
      const outputDir = app.getPath('temp');
      const outputPaths: Array<string | null> = [];

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i] as
          | { startSec?: number; endSec?: number }
          | undefined;
        const rawStart =
          typeof segment?.startSec === 'number' ? segment.startSec : 0;
        const rawEnd =
          typeof segment?.endSec === 'number' ? segment.endSec : rawStart;
        const startSec = Math.max(0, rawStart);
        const endSec = Math.max(startSec, rawEnd);
        const durationSec = Math.max(0, endSec - startSec);

        if (!Number.isFinite(durationSec) || durationSec < 0.05) {
          outputPaths.push(null);
          continue;
        }

        const outputPath = path.join(
          outputDir,
          `slice_${tag}_${i}_${Date.now()}_${randomUUID()}.wav`,
        );

        const ok = await new Promise<boolean>((resolve) => {
          ffmpeg(inputPath)
            .setStartTime(startSec)
            .setDuration(durationSec)
            .audioChannels(1)
            .audioFrequency(16000)
            .toFormat('wav')
            .on('end', () => {
              resolve(true);
            })
            .on('error', (err) => {
              console.warn(
                '[Pluto] Slice failed:',
                err instanceof Error ? err.message : err,
              );
              resolve(false);
            })
            .save(outputPath);
        });

        if (!ok) {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          outputPaths.push(null);
        } else {
          outputPaths.push(outputPath);
        }
      }

      return outputPaths;
    },
  );

  ipcMain.handle(
    'AUDIO_MIX_WAV',
    async (_event, { inputPaths, outputTag } = {}) => {
      if (!Array.isArray(inputPaths) || inputPaths.length < 2) return null;
      const validPaths = inputPaths.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0 && fs.existsSync(value),
      );
      if (validPaths.length < 2) return null;

      const tag =
        (typeof outputTag === 'string' ? outputTag : 'mix')
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 24) || 'mix';
      const outputDir = path.join(app.getPath('userData'), 'meetings');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputPath = path.join(
        outputDir,
        `mix_${tag}_${Date.now()}_${randomUUID()}.wav`,
      );

      return await new Promise<string | null>((resolve) => {
        const command = ffmpeg();
        for (const inputPath of validPaths) {
          command.input(inputPath);
        }
        command
          .complexFilter(
            `amix=inputs=${validPaths.length}:duration=longest:normalize=0`,
          )
          .audioChannels(1)
          .audioFrequency(16000)
          .toFormat('wav')
          .on('end', () => {
            console.log(`[Pluto] Mixed audio created: ${outputPath}`);
            resolve(outputPath);
          })
          .on('error', (err) => {
            console.warn(
              '[Pluto] Mixed audio failed:',
              err instanceof Error ? err.message : err,
            );
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            resolve(null);
          })
          .save(outputPath);
      });
    },
  );

  // Database handlers
  const cleanupTranscriptJson = (
    transcriptJson: unknown,
  ): {
    cleanedTranscriptJson: string;
    changed: boolean;
    stats: TranscriptCleanupStats;
  } | null => {
    if (typeof transcriptJson !== 'string' || !transcriptJson.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(transcriptJson) as unknown;
      const segmentArray = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { segments?: unknown }).segments)
          ? ((parsed as { segments: unknown[] }).segments as Array<{
              text: string;
            }>)
          : null;
      if (!segmentArray) {
        return null;
      }

      const result = cleanTranscriptSegments(segmentArray);
      const meta =
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        (parsed as { schemaVersion?: number }).schemaVersion === 2
          ? (parsed as Record<string, unknown>)
          : null;
      const cleanedTranscriptJson = meta
        ? JSON.stringify({
            ...meta,
            segments: result.segments,
          })
        : JSON.stringify(result.segments);
      return {
        cleanedTranscriptJson,
        changed: cleanedTranscriptJson !== transcriptJson,
        stats: result.stats,
      };
    } catch (e) {
      console.warn('[Pluto] Failed to parse transcript_json for cleanup:', e);
      return null;
    }
  };

  ipcMain.handle('SAVE_MEETING', (_event, meeting) => {
    try {
      const shouldRunTranscriptCleanup =
        meeting?.run_transcript_cleanup === true;
      if (shouldRunTranscriptCleanup) {
        const cleanup = cleanupTranscriptJson(meeting?.transcript_json);
        if (cleanup) {
          meeting.transcript_json = cleanup.cleanedTranscriptJson;
          if (
            cleanup.stats.dropped_duplicates > 0 ||
            cleanup.stats.merged_pairs > 0
          ) {
            console.log(
              `[Pluto] Transcript cleanup on save: dropped=${cleanup.stats.dropped_duplicates}, merged=${cleanup.stats.merged_pairs}`,
            );
          }
        }
      }
      if (
        meeting &&
        typeof meeting === 'object' &&
        'run_transcript_cleanup' in meeting
      ) {
        meeting.run_transcript_cleanup = undefined;
      }

      console.log(`[Pluto] Saving meeting: ${meeting.id} - ${meeting.title}`);
      const result = db.saveMeeting(meeting);

      // Process manual participants as entities (Sprint 2 enhancement)
      if (meeting.participants && Array.isArray(meeting.participants)) {
        console.log(
          `[Pluto] Processing ${meeting.participants.length} manual participants...`,
        );
        for (const name of meeting.participants) {
          if (!name || !name.trim()) continue;

          try {
            // 1. Create/Get Person Entity
            const entity = db.upsertEntity({
              type: 'person',
              name: name.trim(),
              status: 'active',
            });

            // 2. Link to Meeting
            db.addMeetingEntity({
              meeting_id: String(meeting.id),
              entity_id: entity.id,
              mention_count: 1, // Default weight for manual addition
              context: 'Manual participant',
            });
          } catch (err) {
            console.error(
              `[Pluto] Failed to process participant: ${name}`,
              err,
            );
          }
        }
      }

      return result;
    } catch (e) {
      console.error('[Pluto] SAVE_MEETING failed:', e);
      throw e;
    }
  });

  ipcMain.handle('GET_MEETINGS', () => db.getMeetings());
  ipcMain.handle('GET_MEETING', (_event, id) => db.getMeeting(id));
  ipcMain.handle('SEARCH_MEETINGS', (_event, query) =>
    db.searchMeetings(query),
  );
  ipcMain.handle('GET_ANALYSIS_QUALITY_STATS', () =>
    db.getAnalysisQualityStats(),
  );
  ipcMain.handle('DELETE_MEETING', (_event, id) => {
    try {
      const result = db.deleteMeeting(id);
      queueAllKnowledgeDocsRefresh();
      return result;
    } catch (e) {
      console.error('[Pluto] DELETE_MEETING failed:', e);
      throw e;
    }
  });

  // =============================================
  // KNOWLEDGE GRAPH IPC HANDLERS (Sprint 2)
  // =============================================

  // Entity operations
  ipcMain.handle('UPSERT_ENTITY', (_event, entity) => {
    try {
      const saved = db.upsertEntity(entity);
      queueAllKnowledgeDocsRefresh();
      return saved;
    } catch (e) {
      console.error('[Pluto] UPSERT_ENTITY failed:', e);
      throw e;
    }
  });

  ipcMain.handle('GET_ENTITY', (_event, id) => db.getEntity(id));
  ipcMain.handle('GET_ENTITIES_BY_TYPE', (_event, type) =>
    db.getEntitiesByType(type),
  );
  ipcMain.handle('GET_ALL_ENTITIES', () => db.getAllEntities());
  ipcMain.handle('SEARCH_ENTITIES', (_event, query) =>
    db.searchEntities(query),
  );
  ipcMain.handle('FIND_ENTITY', (_event, { type, name }) =>
    db.findEntity(type, name),
  );
  ipcMain.handle('UPDATE_ENTITY_STATUS', (_event, { id, status }) =>
    db.updateEntityStatus(id, status),
  );
  ipcMain.handle('DELETE_ENTITY', (_event, id) => {
    db.deleteEntity(id);
    queueAllKnowledgeDocsRefresh();
  });

  // Entity relationship operations
  ipcMain.handle('LINK_ENTITIES', (_event, link) => {
    try {
      const saved = db.linkEntities({
        ...link,
        source: link?.source || 'user',
        state: link?.state || 'confirmed',
      });
      queueAllKnowledgeDocsRefresh();
      return saved;
    } catch (e) {
      console.error('[Pluto] LINK_ENTITIES failed:', e);
      throw e;
    }
  });

  ipcMain.handle('GET_ENTITY_LINKS', (_event, payload) => {
    const { entityId, includeRejected } = (payload || {}) as {
      entityId?: string;
      includeRejected?: boolean;
    };
    if (!entityId) return [];
    return db.getEntityLinks(entityId, { includeRejected });
  });
  ipcMain.handle('GET_RELATED_ENTITIES', (_event, payload) => {
    const { entityId, includeRejected } = (payload || {}) as {
      entityId?: string;
      includeRejected?: boolean;
    };
    if (!entityId) return [];
    return db.getRelatedEntities(entityId, { includeRejected });
  });

  // Meeting-entity associations
  ipcMain.handle('ADD_MEETING_ENTITY', (_event, meetingEntity) => {
    try {
      return db.addMeetingEntity(meetingEntity);
    } catch (e) {
      console.error('[Pluto] ADD_MEETING_ENTITY failed:', e);
      throw e;
    }
  });

  ipcMain.handle('GET_MEETING_ENTITIES', (_event, meetingId) =>
    db.getMeetingEntities(meetingId),
  );
  ipcMain.handle('GET_ENTITY_MEETINGS', (_event, entityId) =>
    db.getEntityMeetings(entityId),
  );
  ipcMain.handle('GET_KNOWLEDGE_FEED_SUMMARY', (_event, params) =>
    db.getKnowledgeFeedSummary(params),
  );
  ipcMain.handle('GET_KNOWLEDGE_DOCS', (_event, filters) =>
    db.getKnowledgeDocs(filters),
  );
  ipcMain.handle('GET_KNOWLEDGE_DOC', (_event, id) => db.getKnowledgeDoc(id));
  ipcMain.handle('GET_KNOWLEDGE_DOC_VERSIONS', (_event, { docId, limit }) =>
    db.getKnowledgeDocVersions(docId, limit),
  );
  ipcMain.handle('GET_KNOWLEDGE_DOC_SOURCES', (_event, docId) =>
    db.getKnowledgeDocSourceDetails(docId),
  );
  ipcMain.handle('SAVE_KNOWLEDGE_DOC_EDIT', (_event, { docId, content }) =>
    db.saveKnowledgeDocUserEdit(docId, content),
  );
  ipcMain.handle('REFRESH_KNOWLEDGE_DOC', async (_event, docId) => {
    return refreshKnowledgeDocNow(docId);
  });
  ipcMain.handle('GET_ENTITY_SUMMARY', async (_event, entityId) => {
    return synthesizeEntitySummary(entityId);
  });
  ipcMain.handle('GET_KNOWLEDGE_DOC_NOTES', (_event, docId) =>
    db.getKnowledgeDocNotes(docId),
  );
  ipcMain.handle('SAVE_KNOWLEDGE_DOC_NOTES', (_event, { docId, markdown }) =>
    db.saveKnowledgeDocNotes(docId, markdown),
  );
  ipcMain.handle('GET_KNOWLEDGE_BACKLINKS', (_event, { docId, options }) =>
    db.getKnowledgeBacklinks(docId, options),
  );
  ipcMain.handle('GET_KNOWLEDGE_GRAPH', (_event, { docId, options }) =>
    db.getKnowledgeGraph(docId, options),
  );
  ipcMain.handle('GET_KNOWLEDGE_TIMELINE', (_event, { docId, limit }) =>
    db.getKnowledgeTimeline(docId, limit),
  );
  ipcMain.handle('GET_KNOWLEDGE_WORKSPACE', (_event, params) =>
    db.getKnowledgeWorkspace(params),
  );
  ipcMain.handle('SET_ENTITY_LINK_STATE', (_event, { id, state }) => {
    const updated = db.setEntityLinkState(id, state);
    queueAllKnowledgeDocsRefresh();
    return updated;
  });
  ipcMain.handle('RESOLVE_CONFLICT', (_event, { winnerId, loserId }) => {
    const result = db.resolveConflictLinks(winnerId, loserId);
    queueAllKnowledgeDocsRefresh();
    return result;
  });

  // Team tracker & person context
  ipcMain.handle(
    'CREATE_TEAM_TRACKER',
    (_event, params: { title: string; memberEntityIds: string[] }) => {
      const doc = db.createTeamTrackerDoc(params);
      queueKnowledgeDocsRefreshForMeeting('');
      return doc;
    },
  );
  ipcMain.handle(
    'UPDATE_TEAM_TRACKER_MEMBERS',
    (_event, { docId, memberEntityIds }) => {
      const doc = db.updateTeamTrackerMembers(docId, memberEntityIds);
      if (doc) queueAllKnowledgeDocsRefresh();
      return doc;
    },
  );
  ipcMain.handle('GET_PERSON_CONTEXT_CANDIDATES', () =>
    db.getKnowledgeDocPersonCandidates(),
  );

  // Action item queries
  ipcMain.handle('GET_ACTION_ITEMS_BY_STATUS', (_event, status) =>
    db.getActionItemsByStatus(status),
  );
  ipcMain.handle('GET_OVERDUE_ACTION_ITEMS', () => db.getOverdueActionItems());
  ipcMain.handle('GET_STALE_ACTION_ITEMS', (_event, staleDays) =>
    db.getStaleActionItems(staleDays),
  );

  // Knowledge graph stats
  ipcMain.handle('GET_KNOWLEDGE_GRAPH_STATS', () =>
    db.getKnowledgeGraphStats(),
  );

  ipcMain.handle('RESET_KNOWLEDGE', async () => {
    try {
      return db.resetKnowledge();
    } catch (e) {
      console.error('[Pluto] RESET_KNOWLEDGE failed:', e);
      throw e;
    }
  });

  // Auto-end logging
  ipcMain.handle('LOG_AUTO_END_EVENT', (_event, event) => {
    try {
      return db.logAutoEndEvent(event);
    } catch (e) {
      console.error('[AutoEnd] LOG_AUTO_END_EVENT failed:', e);
      throw e;
    }
  });

  // Settings handlers
  ipcMain.handle('GET_SETTING', (_event, key) => db.getSetting(key));
  ipcMain.handle('SET_SETTING', (_event, { key, value }) =>
    db.setSetting(key, value),
  );

  // LLM handlers
  const emptyValueSignals = (): InternalSignalDocument => ({
    analysis_schema_version: 2,
    continuity: [],
    accountability_risks: [],
    decision_impacts: [],
    extra_tags: [],
  });

  const normalizeValueSignals = (value: unknown): InternalSignalDocument => {
    if (!value || typeof value !== 'object') {
      return emptyValueSignals();
    }
    const record = value as Record<string, unknown>;
    const normalizeSignalList = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3);
    };
    const normalizeTags = (
      raw: unknown,
    ): InternalSignalDocument['extra_tags'] => {
      if (!Array.isArray(raw)) return [];
      const tags = raw
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const item = entry as Record<string, unknown>;
          const tag =
            typeof item.tag === 'string' ? item.tag.trim().toLowerCase() : '';
          const confidence =
            typeof item.confidence === 'number' ? item.confidence : 0.5;
          if (!tag) return null;
          return {
            tag,
            confidence: Math.max(0, Math.min(1, confidence)),
          };
        })
        .filter(
          (entry): entry is { tag: string; confidence: number } => !!entry,
        );

      const dedupe = new Map<string, number>();
      for (const tag of tags) {
        const prev = dedupe.get(tag.tag);
        if (prev === undefined || tag.confidence > prev) {
          dedupe.set(tag.tag, tag.confidence);
        }
      }

      return Array.from(dedupe.entries())
        .map(([tag, confidence]) => ({ tag, confidence }))
        .slice(0, 8);
    };

    return {
      analysis_schema_version: 2,
      continuity: normalizeSignalList(record.continuity),
      accountability_risks: normalizeSignalList(record.accountability_risks),
      decision_impacts: normalizeSignalList(record.decision_impacts),
      extra_tags: normalizeTags(record.extra_tags),
    };
  };

  const mergePriorityHints = (
    mapped: ReturnType<typeof mapValueSignalsToPriorityHints>,
    incoming?: unknown,
  ) => {
    if (!incoming || typeof incoming !== 'object') {
      return mapped;
    }
    const record = incoming as Record<string, unknown>;
    const incomingTerms = Array.isArray(record.prioritized_terms)
      ? record.prioritized_terms.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
      : [];
    const incomingBiasRecord =
      record.relationship_bias && typeof record.relationship_bias === 'object'
        ? (record.relationship_bias as Record<string, unknown>)
        : {};
    const incomingBias: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(incomingBiasRecord)) {
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        incomingBias[key] = rawValue;
      }
    }

    return {
      prioritized_terms: Array.from(
        new Set([...mapped.prioritized_terms, ...incomingTerms]),
      ).slice(0, 20),
      relationship_bias: {
        ...mapped.relationship_bias,
        ...incomingBias,
      },
    };
  };

  const fallbackAnalysisArtifacts = (): AnalysisArtifacts => ({
    markdown: [
      '## Summary',
      'Conversation captured. Key themes and follow-ups are summarized below.',
      '',
      '## Key Points',
      '- Review transcript details for nuance where precise phrasing matters.',
      '',
      '## Action Items',
      '- [ ] No concrete action items were explicitly committed.',
      '',
      '## Decisions',
      '- No explicit decisions were made.',
    ].join('\n'),
    analysis: {
      analysis_schema_version: 2,
      summary: [
        'Conversation captured. Key themes and follow-ups are summarized below.',
      ],
      key_points: [
        'Review transcript details for nuance where precise phrasing matters.',
      ],
      action_items: [],
      decisions: [],
      quality: {
        format_pass: false,
        retry_count: 1,
        fallback_used: true,
        issues: ['Analysis generation failed in main-process fallback.'],
      },
    },
    signals: emptyValueSignals(),
  });

  ipcMain.handle(
    'GENERATE_ANALYSIS_V2',
    async (_event, { transcript, userNotes }) => {
      try {
        if (!transcript || !transcript.trim()) {
          return fallbackAnalysisArtifacts();
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        console.log(
          `[LLM] Generating V2 analysis with provider: ${provider.name}`,
        );
        const artifacts = await provider.generateAnalysisArtifacts(
          transcript,
          userNotes,
        );
        return {
          ...artifacts,
          signals: normalizeValueSignals(artifacts.signals),
        };
      } catch (error) {
        console.error('[LLM] V2 analysis generation failed:', error);
        return fallbackAnalysisArtifacts();
      }
    },
  );

  ipcMain.handle(
    'GENERATE_SUMMARY',
    async (_event, { transcript, userNotes }) => {
      try {
        if (!transcript || !transcript.trim()) {
          console.log('[LLM] Skipping summary generation for empty transcript');
          return '';
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        console.log(`[LLM] Using provider: ${provider.name}`);
        return await provider.generateSummary(transcript, userNotes);
      } catch (error) {
        console.error('[LLM] Summary generation failed:', error);
        throw error;
      }
    },
  );

  ipcMain.handle('EXTRACT_SPEAKER_IDENTITY', async (_event, { transcript }) => {
    try {
      if (!transcript || !transcript.trim()) return null;
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      console.log(`[LLM] Using provider: ${provider.name}`);
      return await provider.extractSpeakerIdentity(transcript);
    } catch (error) {
      console.error('[LLM] Speaker extraction failed:', error);
      return null; // Graceful fallback
    }
  });

  ipcMain.handle('GENERATE_TITLE', async (_event, { transcript }) => {
    try {
      if (!transcript || !transcript.trim()) return 'New Meeting';
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      console.log(`[LLM] Generating title with provider: ${provider.name}`);
      return await provider.generateTitle(transcript);
    } catch (error) {
      console.error('[LLM] Title generation failed:', error);
      return 'Meeting'; // Graceful fallback
    }
  });

  ipcMain.handle(
    'EXTRACT_VALUE_SIGNALS',
    async (_event, { transcript, summary }) => {
      try {
        if (!transcript || !transcript.trim()) {
          return emptyValueSignals();
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        console.log(
          `[LLM] Extracting value signals with provider: ${provider.name}`,
        );
        const signals = await provider.extractValueSignals(transcript, summary);
        return normalizeValueSignals(signals);
      } catch (error) {
        console.error('[LLM] Value signal extraction failed:', error);
        return emptyValueSignals();
      }
    },
  );

  // =============================================
  // ENTITY EXTRACTION HANDLERS (Sprint 2)
  // =============================================

  // Extract entities from transcript (returns raw extraction result)
  ipcMain.handle(
    'EXTRACT_ENTITIES',
    async (_event, { transcript, summary, valueSignals, priorityHints }) => {
      try {
        if (!transcript || !transcript.trim()) {
          return {
            people: [],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [],
            relationships: [],
          };
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        const normalizedSignals = normalizeValueSignals(valueSignals);
        const mergedPriorityHints = mergePriorityHints(
          mapValueSignalsToPriorityHints(normalizedSignals),
          priorityHints,
        );
        console.log(
          `[LLM] Extracting entities with provider: ${provider.name}`,
        );
        return await provider.extractEntities(transcript, {
          summary,
          valueSignals: normalizedSignals,
          priorityHints: mergedPriorityHints,
        });
      } catch (error) {
        console.error('[LLM] Entity extraction failed:', error);
        return {
          people: [],
          topics: [],
          action_items: [],
          decisions: [],
          projects: [],
          relationships: [],
        };
      }
    },
  );

  // Extract entities AND save them to the knowledge graph
  ipcMain.handle(
    'EXTRACT_AND_PROCESS_ENTITIES',
    async (
      _event,
      { transcript, meetingId, summary, valueSignals, priorityHints },
    ) => {
      try {
        if (!transcript || !transcript.trim()) {
          console.log('[LLM] Skipping entity extraction for empty transcript');
          return { created: 0, linked: 0 };
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        const normalizedSignals = normalizeValueSignals(valueSignals);
        const mergedPriorityHints = mergePriorityHints(
          mapValueSignalsToPriorityHints(normalizedSignals),
          priorityHints,
        );
        console.log(
          `[LLM] Extracting and processing entities for meeting ${meetingId}`,
        );
        const result = await extractAndProcessEntities(
          provider,
          transcript,
          meetingId,
          {
            summary,
            valueSignals: normalizedSignals,
            priorityHints: mergedPriorityHints,
          },
        );

        // Generate MID after entity extraction
        try {
          const meeting = db.getMeeting(String(meetingId)) as db.PersistedMeeting | undefined;
          if (meeting) {
            const meetingEntities = db.getMeetingEntities(String(meetingId));
            // Parse analysis from the meeting's stored data
            let analysisDoc = fallbackAnalysisArtifacts().analysis;
            if (meeting.analysis_json) {
              try {
                analysisDoc = JSON.parse(meeting.analysis_json);
              } catch {
                // Use fallback
              }
            }
            let signals = emptyValueSignals();
            if (meeting.value_signals_json) {
              try {
                signals = normalizeValueSignals(JSON.parse(meeting.value_signals_json));
              } catch {
                // Use empty signals
              }
            }
            // Parse transcript segments for evidence spans
            let transcriptSegments: Array<{ text: string }> = [];
            if (meeting.transcript_json) {
              try {
                const parsed = JSON.parse(meeting.transcript_json);
                transcriptSegments = Array.isArray(parsed)
                  ? parsed
                  : Array.isArray(parsed?.segments)
                    ? parsed.segments
                    : [];
              } catch {
                // No transcript segments available
              }
            }

            const mid = generateMid({
              meeting_id: String(meetingId),
              title: meeting.title,
              occurred_at: meeting.started_at || meeting.created_at || null,
              duration_seconds: meeting.duration_seconds || 0,
              analysis: analysisDoc,
              signals,
              meeting_entities: meetingEntities,
              transcript_segments: transcriptSegments,
            });

            db.saveMeetingMid(String(meetingId), mid);
            console.log(`[Intelligence] MID generated for meeting ${meetingId}`);
          }
        } catch (midError) {
          console.warn('[Intelligence] MID generation failed (non-blocking):', midError);
        }

        queueKnowledgeDocsRefreshForMeeting(String(meetingId));
        return result;
      } catch (error) {
        console.error('[LLM] Entity extraction and processing failed:', error);
        throw error;
      }
    },
  );

  // Process pre-extracted entities (save to knowledge graph)
  ipcMain.handle(
    'PROCESS_EXTRACTED_ENTITIES',
    async (_event, { entities, meetingId }) => {
      try {
        console.log(
          `[EntityPipeline] Processing pre-extracted entities for meeting ${meetingId}`,
        );
        const result = await processExtractedEntities(entities, meetingId);
        queueKnowledgeDocsRefreshForMeeting(String(meetingId));
        return result;
      } catch (error) {
        console.error('[EntityPipeline] Processing failed:', error);
        throw error;
      }
    },
  );

  // =============================================
  // MID (Meeting Intelligence Document) HANDLERS
  // =============================================

  ipcMain.handle('GET_MEETING_MID', (_event, meetingId: string) => {
    return db.getMeetingMid(meetingId);
  });

  ipcMain.handle('GET_MEETING_MID_MARKDOWN', (_event, meetingId: string) => {
    const mid = db.getMeetingMid(meetingId);
    if (!mid) return null;
    return renderMidToMarkdown(mid);
  });

  // =============================================
  // INTELLIGENCE QUERY HANDLERS (Phase 2)
  // =============================================
  ipcMain.handle('intelligence:query', async (_event, queryText: string) => {
    try {
      if (!queryText || !queryText.trim()) return { answer: '', citations: [] };
      
      const parsed = await parseQuery(queryText);
      const context = await retrieveContext(parsed);
      
      if (context.length === 0) {
        return { answer: "I couldn't find any relevant information in your meeting history.", citations: [] };
      }
      
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      
      const prompt = getAskPlutoPrompt(queryText, context, "Use exact quotes wherever possible.");
      const answerHtml = await provider.synthesizeKnowledgeDocument(prompt);
      
      const rawCitations = buildCitationChain(answerHtml, context);
      const auditedCitations = auditCitations(rawCitations);
      
      return {
        answer: answerHtml,
        citations: auditedCitations,
      };
    } catch (e) {
      console.error('[Pluto] intelligence:query failed:', e);
      throw e;
    }
  });

  ipcMain.handle('intelligence:query:debug', async (_event, queryText: string) => {
    try {
      const parsed = await parseQuery(queryText);
      const context = await retrieveContext(parsed);
      return {
        parsed,
        context,
      };
    } catch (e) {
      console.error('[Pluto] intelligence:query:debug failed:', e);
      throw e;
    }
  });

  // Permissions handlers
  ipcMain.handle('CHECK_MICROPHONE_PERMISSION', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted'; // Assume granted on other platforms if app is running
  });

  ipcMain.handle('OPEN_SYSTEM_SETTINGS_PRIVACY', async (_event, pane) => {
    if (process.platform !== 'darwin') return false;
    try {
      const target =
        pane === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'; // System Audio Recording Only lives here on macOS
      const url = `x-apple.systempreferences:com.apple.preference.security?${target}`;
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('Failed to open System Settings:', error);
      return false;
    }
  });

  ipcMain.handle('APP_RELAUNCH', () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  // Start WhisperX server in background (don't block app startup)
  whisperX.start().catch((err) => {
    console.warn('[Pluto] WhisperX failed to start:', err.message);
    console.log('[Pluto] WhisperX will start on first transcription request');
  });

  initializeKnowledgeDocs().catch((error) => {
    console.error(
      '[KnowledgeDoc] Failed to initialize synthesis pipeline:',
      error,
    );
  });

  // macOS: Proactively request microphone access
  if (process.platform === 'darwin') {
    console.log('[Pluto] Requesting microphone access from OS...');
    systemPreferences
      .askForMediaAccess('microphone')
      .then((granted) => {
        console.log(`[Pluto] Microphone access granted: ${granted}`);
      })
      .catch((err) => {
        console.error('[Pluto] Failed to request microphone access:', err);
      });
  }

  // Create Tray Icon
  const dockIconPath = path.join(process.env.VITE_PUBLIC, 'dock-icon.png');
  const iconPath = dockIconPath;

  const icon = nativeImage.createFromPath(iconPath);

  // Set Dock Icon for macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon);
  }

  const resizedIcon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(resizedIcon);
  tray.setToolTip('Pluto');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Pluto',
      click: () => {
        if (win) {
          if (win.isVisible()) {
            win.focus();
          } else {
            win.show();
          }
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);

  // Toggle window on click (macOS behavior often expects this)
  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        if (win.isFocused()) {
          win.hide();
        } else {
          win.focus();
        }
      } else {
        win.show();
      }
    } else {
      createWindow();
    }
  });

  createWindow();
});
