import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  Tray,
  type WebContents,
  app,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell,
  systemPreferences,
} from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import { parseMacMemoryPressureFreePercent } from '../src/services/finalTranscription/finalTranscriptionAdmission';
import type {
  AskPlutoConversationTurn,
  AskPlutoCurrentMeeting,
  AskPlutoQueryRequest,
  AskPlutoQueryStatus,
  AskPlutoRetrievalSummary,
  ResolvedAskPlutoScope,
} from '../src/types/askPlutoQuery';
import { parseTranscriptSegments } from '../src/utils/transcript';
import { createActiveCallDetector } from './activeCall/detector';
import {
  appendCaptureJournalChunk,
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  deleteCaptureJournal,
  persistCaptureJournalRawChunk,
  promoteCaptureTranscriptCheckpoint,
  readCaptureJournalManifest,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from './captureJournal';
import {
  recoverInterruptedCaptureJournals,
  stitchSealedCaptureJournalSource,
  verifySealedCaptureJournalTranscriptEvidence,
} from './captureJournalRecovery';
import { createCaptureSessionLeaseRegistry } from './captureSessionLease';
import { runConditionalMeetingUpdateForIpc } from './conditionalMeetingUpdateIpc';
import type { AttentionItemStatus } from './intelligence/intelligenceTypes';
import {
  canReuseRunningCaptureForProbe,
  waitForNativeAudioSpawn,
} from './nativeAudioCapture';
import { createPostMeetingBackgroundActivity } from './postMeetingBackgroundActivity';
import {
  type ProjectInitiativeDiscoveryState,
  discoverProjectInitiative,
} from './projectInitiativeDiscovery';
import {
  isProjectScopeReviewBusy,
  reviewProjectScopeBatch,
} from './projectScopeReview';
import {
  normalizeCheckpointWords,
  transcribeJournalAlignedAudio,
} from './recoveryTranscriptionAudio';
import { saveMeetingWithParticipantSideEffects } from './saveMeetingIpc';
import { prepareFinalTranscriptionBeforeRecovery } from './transcription/finalTranscriptionStartup';
import { ParakeetEouClient } from './transcription/parakeetEouClient';
import { ParakeetEouMeetingCoordinator } from './transcription/parakeetEouMeetingCoordinator';
import { ParakeetFinalClient } from './transcription/parakeetFinalClient';
import {
  type ParakeetRuntimeHost,
  makeRuntimeHost,
} from './transcription/parakeetRuntimeHost';
import { createActiveCallAlertController } from './windows/activeCallAlertWindow';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const probeAudioDuration = async (inputPath: string) =>
  await new Promise<number | null>((resolve) => {
    const probe = spawn(ffprobeStatic.path, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    let stdout = '';
    probe.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    probe.on('error', (error: NodeJS.ErrnoException) => {
      console.warn('[Pluto] Audio duration probe failed to start:', error.code);
      resolve(null);
    });
    probe.on('close', (code) => {
      if (code !== 0) {
        console.warn('[Pluto] Audio duration probe exited:', code);
        return resolve(null);
      }
      const duration = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(duration) && duration >= 0 ? duration : null);
    });
  });

const probeMacMemoryPressureFreePercent = async (): Promise<number | null> =>
  await new Promise<number | null>((resolve) => {
    const probe = spawn('/usr/bin/memory_pressure', ['-Q']);
    let stdout = '';
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      probe.kill('SIGTERM');
      finish(null);
    }, 2_000);
    probe.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    probe.on('error', () => finish(null));
    probe.on('close', (code) => {
      finish(code === 0 ? parseMacMemoryPressureFreePercent(stdout) : null);
    });
  });

const probeAvailableMemory = async () => {
  const percentage = await probeMacMemoryPressureFreePercent();
  return percentage === null
    ? { availableMemoryBytes: os.freemem() }
    : {
        availableMemoryBytes: Math.floor((os.totalmem() * percentage) / 100),
        memoryPressureFreePercent: percentage,
      };
};

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

// Guard against broken-pipe errors (EPIPE / EIO) on stdout/stderr.
// In packaged Electron the process is not attached to a TTY so any
// console.log / console.error call can throw "write EIO". Without this
// handler those errors become uncaught exceptions that kill the process
// and halt background tasks like knowledge synthesis.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') {
    // Harmless broken-pipe on detached stdout — swallow silently.
    return;
  }
  // Re-throw everything else so legitimate crashes are not hidden.
  throw err;
});

let win: BrowserWindow | null;
let tray: Tray | null = null;
const postMeetingBackgroundActivity = createPostMeetingBackgroundActivity(
  (allowed) => {
    if (win && !win.isDestroyed()) {
      win.webContents.setBackgroundThrottling(allowed);
    }
  },
);

const readDownstreamActivity = (value: unknown) => {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '{}') as {
      runId?: unknown;
      state?: unknown;
    };
    return {
      runId: typeof parsed.runId === 'string' ? parsed.runId : null,
      state: typeof parsed.state === 'string' ? parsed.state : null,
    };
  } catch {
    return { runId: null, state: null };
  }
};

const isDownstreamRunCurrent = (meetingId: string, runId: string): boolean => {
  const meeting = db.getMeeting(meetingId) as db.PersistedMeeting | undefined;
  const activity = readDownstreamActivity(meeting?.downstream_processing_json);
  return activity.state === 'processing' && activity.runId === runId;
};

const getAudioCapExecPath = () => {
  const isDev = !app.isPackaged;
  const downloadedPath = path.join(app.getPath('userData'), 'bin', 'audiocap');
  if (fs.existsSync(downloadedPath)) return downloadedPath;

  if (!isDev) return path.join(process.resourcesPath, 'bin', 'audiocap');
  const appPath = app.getAppPath();
  const directPath = path.join(appPath, 'resources/bin/audiocap');
  if (fs.existsSync(directPath)) return directPath;
  const parentPath = path.join(appPath, '..', 'resources/bin/audiocap');
  if (fs.existsSync(parentPath)) return parentPath;
  return path.join(process.cwd(), 'resources/bin/audiocap');
};

const getParakeetRuntimePath = () => {
  const isDev = !app.isPackaged;
  const downloadedPath = path.join(
    app.getPath('userData'),
    'bin',
    'parakeet-runtime',
  );
  if (fs.existsSync(downloadedPath)) return downloadedPath;

  if (!isDev)
    return path.join(process.resourcesPath, 'bin', 'parakeet-runtime');
  const appRoot = process.env.APP_ROOT || process.cwd();
  return path.join(appRoot, 'resources', 'bin', 'parakeet-runtime');
};

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
    postMeetingBackgroundActivity.reset();
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });
  win.webContents.on('will-prevent-unload', () => {
    console.warn('[CaptureLease] navigation prevented: capture_active');
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win?.webContents.getURL()) return;
    event.preventDefault();
    console.warn('[Security] Blocked renderer navigation', { url });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(url);
      }
    } catch {
      console.warn('[Security] Blocked malformed renderer URL');
    }
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

const getMeetingArtifactsRootDir = () => {
  const meetingsDir = path.join(app.getPath('userData'), 'meetings');
  if (!fs.existsSync(meetingsDir)) {
    fs.mkdirSync(meetingsDir, { recursive: true });
  }
  return meetingsDir;
};

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

import { describeMeetingAskPlutoRequest } from '../src/utils/askPlutoDiagnostics';
import { parseMeetingAskPlutoRequest } from '../src/utils/meetingAskPlutoRequest';
import { isNoOpMeetingNotesEdit } from '../src/utils/meetingNotesEditRebase';
import { selectTranscriptionVocabulary } from '../src/utils/transcriptionVocabulary';
// Module imports
import { handleActionCommitmentReview } from './actionCommitmentReviewIpc';
import { handleAudioCaptureJournalStart } from './captureJournalStart';
import * as db from './db';
import {
  extractAndProcessEntities,
  processExtractedEntities,
} from './entityPipeline';
import { IDENTITY_CHANNELS, handleIdentityRequest } from './identityHandlers';
import { startIdentityReconciliation } from './identityReconciliation';
import {
  describePreviousConversationFailure,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
  latestAssistantTurn,
} from './intelligence/askPlutoConversation';
import {
  detectExplicitAskPlutoCorrection,
  formatAskPlutoCorrectionsForPrompt,
  parseAskPlutoCorrectionRecords,
  selectRelevantAskPlutoCorrections,
} from './intelligence/askPlutoCorrections';
import {
  type AskPlutoReasoningMode,
  getCrossMeetingCandidateLimit,
  queryReferencesPriorTurn,
  resolveAskPlutoReasoningMode,
  shouldIncludePriorConversation,
  shouldRestrictToCurrentMeetingEvidence,
  shouldRestrictToPinnedCurrentComparison,
  shouldRestrictToPriorConversationEvidence,
} from './intelligence/askPlutoReasoning';
import { syncActionTrackerAttentionQueue } from './intelligence/attentionSync';
import { createValidatedAnswerStream } from './intelligence/citationEngine';
import {
  queryReferencesCurrentMeeting,
  resolveCurrentMeeting,
  resolvePersistedMeetingEvidenceState,
} from './intelligence/currentMeetingResolver';
import {
  buildLiveMeetingAskPlutoContext,
  buildLiveMeetingFallbackResponse,
  buildMeetingAskPlutoContext,
  buildMeetingAskPlutoPrompt,
  buildMeetingAskPlutoProviderUnavailableResponse,
  buildMeetingAskPlutoResponseFromAnswer,
  buildUnavailableMeetingAskPlutoResponse,
  normalizeMeetingAskPlutoTurns,
} from './intelligence/meetingAskPluto';
import { routeMeetingAskPlutoAssistance } from './intelligence/meetingAskPlutoAssistance';
import { createMeetingAskPlutoVisibleStream } from './intelligence/meetingAskPlutoStream';
import { createMeetingContextProducer } from './intelligence/meetingContextProducer';
import { generateMid } from './intelligence/midGenerator';
import { renderMidToMarkdown } from './intelligence/midRenderer';
import {
  clearAlertsForMeeting,
  getAlerts,
  runPostMeetingTriggers,
  updateAlertStatus,
} from './intelligence/proactiveEngine';
import {
  buildExtractiveTemporalSummary,
  buildLiveMeetingRetrievalResult,
  buildMeetingRetrievalResult,
  mergeRetrievalResultsByMeeting,
  parseQuery,
  resolveExplicitMeetingScope,
  retrieveContext,
  shouldUsePreparedExtractiveAnswer,
} from './intelligence/queryEngine';
import { getAskPlutoPrompt } from './intelligence/queryPrompts';
import { generateSuggestedQueries } from './intelligence/suggestedQueries';
import {
  initializeKnowledgeDocs,
  queueAllKnowledgeDocsRefresh,
  queueKnowledgeDocRefresh,
  queueKnowledgeDocsRefreshForMeeting,
  refreshKnowledgeDocNow,
  refreshKnowledgeDocsForMeetingNow,
  setKnowledgeDocSynthesisPaused,
  synthesizeEntitySummary,
} from './knowledgeSynthesis';
import {
  configureKnowledgeSynthesisPause,
  knowledgeSynthesisPause,
} from './knowledgeSynthesisPause';
import type { AnalysisDocumentV3 } from './llm/analysisTypes';
import { getAllSettings, getProvider } from './llm/factory';
import type {
  AnalysisArtifacts,
  AnalysisDocument,
  InternalSignalDocument,
} from './llm/provider';
import {
  type MeetingAnalysisRunCoordinatorDb,
  createMeetingAnalysisRunCoordinator,
} from './meetingAnalysisRuns';
import {
  getRecordingReadinessStatus,
  prepareRecordingReadiness,
} from './recordingReadiness';
import {
  type TranscriptCleanupStats,
  cleanTranscriptSegments,
  shouldCleanupTranscriptOnSave,
} from './transcriptCleanup';
import { mapValueSignalsToPriorityHints } from './valueSignalMapping';

const meetingNotesRunCoordinator = createMeetingAnalysisRunCoordinator({
  db: db as unknown as MeetingAnalysisRunCoordinatorDb,
  getSettings: () => getAllSettings(db),
  getProvider,
  onUpdated: (meetingId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed())
        win.webContents.send('MEETING_NOTES_UPDATED', meetingId);
    }
  },
  runSecondary: async (input) => {
    if (
      !input.provider.extractValueSignals ||
      !input.provider.extractEntities ||
      !input.provider.synthesizeKnowledgeDocument
    ) {
      throw new Error('value_signals_failed');
    }
    const signals = await input.provider.extractValueSignals(
      input.transcript,
      input.analysis.overview,
      { signal: input.signal },
    );
    if (!input.canCommit()) return;
    if (
      !db.saveMeetingAnalysisSecondaryFieldsIfCurrent({
        meetingId: input.meetingId,
        runId: input.runId,
        inputRevision: input.inputRevision,
        sourceRevision: input.sourceRevision,
        eligibilityRevision: input.eligibilityRevision,
        userNotesHash: input.userNotesHash,
        valueSignalsJson: JSON.stringify(signals),
      })
    ) {
      return;
    }
    db.updateMeetingAnalysisRunStatusIfCurrent({
      meetingId: input.meetingId,
      runId: input.runId,
      inputRevision: input.inputRevision,
      sourceRevision: input.sourceRevision,
      eligibilityRevision: input.eligibilityRevision,
      userNotesHash: input.userNotesHash,
      notesStatus: 'published',
      secondaryStatus: 'running',
      stage: 'entities',
    });

    const auditedEntities = await input.provider.extractEntities(
      input.transcript,
      {
        summary: input.analysis.overview,
        valueSignals: signals,
      },
      { signal: input.signal },
    );
    if (!input.canCommit()) return;
    await extractAndProcessEntities(
      {
        synthesizeKnowledgeDocument:
          input.provider.synthesizeKnowledgeDocument?.bind(input.provider),
        extractEntities: async () => ({
          ...auditedEntities,
          action_items: input.analysis.all_action_items.map((item) => ({
            description: item.text,
            assignee: item.assignee,
            due_date: item.due,
            evidence: item.evidence,
          })),
          decisions: input.analysis.all_decisions.map((decision) => ({
            description: decision.text,
            rationale: decision.rationale,
          })),
        }),
      },
      input.transcript,
      input.meetingId,
      {
        summary: input.analysis.overview,
        valueSignals: signals,
      },
      { canCommit: input.canCommit, signal: input.signal },
    );
    if (!input.canCommit()) return;
    db.updateMeetingAnalysisRunStatusIfCurrent({
      meetingId: input.meetingId,
      runId: input.runId,
      inputRevision: input.inputRevision,
      sourceRevision: input.sourceRevision,
      eligibilityRevision: input.eligibilityRevision,
      userNotesHash: input.userNotesHash,
      notesStatus: 'published',
      secondaryStatus: 'running',
      stage: 'mid',
    });
    const meeting = db.getMeeting(input.meetingId) as
      | db.PersistedMeeting
      | undefined;
    if (!meeting || !input.canCommit()) return;
    const mid = generateMid({
      meeting_id: input.meetingId,
      title: meeting.title,
      occurred_at: meeting.started_at || meeting.created_at || null,
      duration_seconds: meeting.duration_seconds || 0,
      analysis: input.analysis,
      signals,
      meeting_entities: db.getMeetingEntities(input.meetingId),
      transcript_segments: input.transcript
        .split('\n')
        .filter(Boolean)
        .map((text) => ({ text })),
    });
    if (
      !db.saveMeetingAnalysisSecondaryFieldsIfCurrent({
        meetingId: input.meetingId,
        runId: input.runId,
        inputRevision: input.inputRevision,
        sourceRevision: input.sourceRevision,
        eligibilityRevision: input.eligibilityRevision,
        userNotesHash: input.userNotesHash,
        midJson: JSON.stringify(mid),
      })
    ) {
      return;
    }
    if (input.canCommit()) {
      try {
        await refreshKnowledgeDocsForMeetingNow(input.meetingId, {
          canCommit: input.canCommit,
        });
      } catch {
        throw new Error('knowledge_synthesis_failed');
      }
    }
  },
});

// Background task management for cancellation
const activeMeetingTasks = new Map<string, AbortController>();
const activeAnalysisGenerations = new Map<
  string,
  { controller: AbortController; settled: Promise<void> }
>();
const activeAskPlutoQueries = new Map<
  string,
  { controller: AbortController; settled: Promise<void> }
>();
const activeMeetingAskPlutoQueries = new Map<
  string,
  { controller: AbortController; ownerId: number; settled: Promise<void> }
>();
const activeAskPlutoSessionOwners = new Set<number>();
let activeTranscriptionCount = 0;
const activeTranscriptionMeetings = new Map<string, number>();
let parakeetFinalClient: ParakeetFinalClient | null = null;
let parakeetRuntimeHost: ParakeetRuntimeHost | null = null;
let parakeetEouCoordinator: ParakeetEouMeetingCoordinator | null = null;
let parakeetEouOwner: WebContents | null = null;
let parakeetEouGeneration: number | null = null;

configureKnowledgeSynthesisPause(setKnowledgeDocSynthesisPaused);

const startParakeetLiveRecording = async (
  _sender: WebContents,
  _meetingId: string,
) => undefined;

const appendParakeetLiveReceipt = async (
  _sender: WebContents,
  _receipt: {
    durable?: true;
    meetingId: string;
    generation: string;
    manifestRevision: number;
    source: 'mic' | 'system';
    sequence: number;
    checksumSha256: string;
    chunkStartSec: number;
    chunkEndSec: number;
    repairAudioRelativePath: string | null;
  },
) => undefined;

const stopParakeetLiveRecording = async (meetingId: string) => {
  void meetingId;
};

function beginTranscriptionWork() {
  activeTranscriptionCount += 1;
  knowledgeSynthesisPause.acquire('transcription');
  if (activeTranscriptionCount === 1) {
    console.log(
      '[Pluto] Pausing queued knowledge-doc synthesis during transcription',
    );
  }
}

function endTranscriptionWork() {
  const hadActiveTranscription = activeTranscriptionCount > 0;
  activeTranscriptionCount = Math.max(0, activeTranscriptionCount - 1);
  if (hadActiveTranscription) {
    knowledgeSynthesisPause.release('transcription');
  }
  if (activeTranscriptionCount === 0) {
    console.log(
      '[Pluto] Resuming queued knowledge-doc synthesis after transcription',
    );
  }
}

function beginMeetingTranscription(meetingId: string | null) {
  if (!meetingId) return;
  activeTranscriptionMeetings.set(
    meetingId,
    (activeTranscriptionMeetings.get(meetingId) || 0) + 1,
  );
}

function endMeetingTranscription(meetingId: string | null) {
  if (!meetingId) return;
  const next = (activeTranscriptionMeetings.get(meetingId) || 1) - 1;
  if (next <= 0) activeTranscriptionMeetings.delete(meetingId);
  else activeTranscriptionMeetings.set(meetingId, next);
}

function getAbortSignalForMeeting(meetingId: string): AbortSignal {
  let controller = activeMeetingTasks.get(meetingId);
  if (!controller) {
    controller = new AbortController();
    activeMeetingTasks.set(meetingId, controller);
  }
  return controller.signal;
}

function clearAbortControllerForMeeting(meetingId: string) {
  activeMeetingTasks.delete(meetingId);
}

function abortMeetingTasks(meetingId: string) {
  const controller = activeMeetingTasks.get(meetingId);
  if (controller) {
    console.log(`[Pluto] Aborting background tasks for meeting: ${meetingId}`);
    controller.abort();
    activeMeetingTasks.delete(meetingId);
  }
}

let stopIdentityReconciliation: (() => void) | undefined;
// Cleanup on quit
app.on('before-quit', async () => {
  stopIdentityReconciliation?.();
  console.log('[Pluto] Shutting down...');
  // Abort all active tasks
  for (const controller of activeMeetingTasks.values()) {
    controller.abort();
  }
  activeMeetingTasks.clear();
  parakeetFinalClient?.close();
  parakeetFinalClient = null;
  await parakeetEouCoordinator?.fail('parakeet_app_quit');
  parakeetEouCoordinator = null;
  parakeetEouOwner = null;
  parakeetEouGeneration = null;
  parakeetRuntimeHost?.shutdown();
  parakeetRuntimeHost = null;
});

app.whenReady().then(async () => {
  db.recoverInterruptedMeetingAnalysisRuns();
  for (const channel of IDENTITY_CHANNELS) {
    ipcMain.handle(channel, (_event, payload) =>
      handleIdentityRequest(channel, payload),
    );
  }
  stopIdentityReconciliation = startIdentityReconciliation({
    pauseReasons: () => knowledgeSynthesisPause.snapshot(),
    onChange: () => {
      if (win && !win.isDestroyed())
        win.webContents.send('MEETING_NOTES_UPDATED');
    },
    generate: async (prompt, responseSchema, signal) => {
      const provider = await getProvider(await getAllSettings(db));
      signal?.throwIfAborted();
      return provider.synthesizeKnowledgeDocument(prompt, {
        purpose: 'commitmentReconciliation',
        responseSchema,
        signal,
      });
    },
  });
  // No desktop capture handlers: keep permissions to mic + system audio only.

  // Do not set DisplayMediaRequestHandler to avoid Screen Recording permission prompts.

  const parakeetModelRoot = path.join(
    app.getPath('userData'),
    'models',
    'transcription',
    'parakeet',
  );
  fs.mkdirSync(parakeetModelRoot, { recursive: true });
  const parakeetPaths = {
    executablePath: getParakeetRuntimePath,
    modelRoot: parakeetModelRoot,
    audioRoot: getMeetingArtifactsRootDir(),
  };
  parakeetRuntimeHost = makeRuntimeHost({
    paths: parakeetPaths,
    diagnostic: (code) => console.warn(`[Pluto] ${code}`),
    persistInterruptedFinalization: async () => {
      db.expireInterruptedFinalTranscription();
    },
  });
  parakeetFinalClient = new ParakeetFinalClient({
    paths: parakeetPaths,
    runtimeHost: parakeetRuntimeHost,
    diagnostic: (code) => console.warn(`[Pluto] ${code}`),
  });
  ipcMain.handle('GET_CAPTURE_COMPUTE_POLICY', async () => ({
    onBattery: powerMonitor.isOnBatteryPower(),
    thermalState: powerMonitor.getCurrentThermalState(),
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    ...(await probeAvailableMemory()),
  }));

  ipcMain.handle('TRANSCRIPTION_PREPARE_FINAL', async () => {
    if (!parakeetFinalClient) throw new Error('parakeet_runtime_unavailable');
    return await parakeetFinalClient.prepare();
  });

  ipcMain.handle('TRANSCRIPTION_FINAL_STATUS', async () => {
    if (!parakeetFinalClient) {
      return { ready: false, engine: 'parakeet_coreml' };
    }
    try {
      return await parakeetFinalClient.prepare();
    } catch {
      return {
        ready: false,
        engine: 'parakeet_coreml',
        reason: 'parakeet_prepare_failed',
      };
    }
  });

  ipcMain.handle('TRANSCRIPTION_TRANSCRIBE_FINAL', async (_event, request) => {
    if (!parakeetFinalClient) throw new Error('parakeet_runtime_unavailable');
    const meetingId = String(request?.meetingId || '');
    const signal = meetingId ? getAbortSignalForMeeting(meetingId) : undefined;
    beginTranscriptionWork();
    beginMeetingTranscription(meetingId || null);
    try {
      return await parakeetFinalClient.transcribe({ ...request, signal });
    } finally {
      endMeetingTranscription(meetingId || null);
      endTranscriptionWork();
    }
  });

  ipcMain.handle('TRANSCRIPTION_CANCEL_FINAL', (_event, meetingId) => {
    abortMeetingTasks(String(meetingId));
    return { cancelled: true };
  });

  ipcMain.handle(
    'TRANSCRIPTION_CANCEL_AND_UNLOAD_FINAL',
    (_event, meetingId) => {
      abortMeetingTasks(String(meetingId));
      parakeetFinalClient?.close();
      return { cancelled: true, unloaded: true };
    },
  );

  ipcMain.handle(
    'GET_TRANSCRIPTION_VOCABULARY',
    (_event, { participants } = {}) =>
      selectTranscriptionVocabulary({
        participants: Array.isArray(participants)
          ? participants.filter(
              (participant): participant is string =>
                typeof participant === 'string',
            )
          : [],
        candidates: db.getTranscriptionPersonCandidates(),
      }),
  );

  ipcMain.handle('CANCEL_MEETING_TRANSCRIPTION', (_event, meetingId) => {
    abortMeetingTasks(String(meetingId));
    return { cancelled: true };
  });

  // Audio recording handlers
  let recorderProcess: ChildProcess | null = null;
  let nativeAudioProcess: ChildProcess | null = null;
  let nativeAudioOwner: WebContents | null = null;
  const captureSessionLease = createCaptureSessionLeaseRegistry();
  const watchedCaptureOwners = new Set<number>();

  const stopNativeAudioCapture = () => {
    const processToStop = nativeAudioProcess;
    nativeAudioProcess = null;
    nativeAudioOwner = null;
    processToStop?.kill('SIGINT');
  };

  const watchCaptureOwner = (owner: WebContents) => {
    if (watchedCaptureOwners.has(owner.id)) return;
    watchedCaptureOwners.add(owner.id);
    owner.once('destroyed', () => {
      watchedCaptureOwners.delete(owner.id);
      const ownsNativeAudio = nativeAudioOwner?.id === owner.id;
      const ownsParakeetEou = parakeetEouOwner?.id === owner.id;
      const released = captureSessionLease.releaseOwner(owner.id);
      if (ownsNativeAudio) stopNativeAudioCapture();
      if (ownsParakeetEou) {
        void parakeetEouCoordinator?.fail('parakeet_owner_destroyed');
        parakeetEouOwner = null;
        parakeetEouGeneration = null;
      }
      if (released) {
        knowledgeSynthesisPause.release('capture');
        console.warn('[CaptureLease] released: owner_destroyed');
      }
    });
  };

  const eouCoordinator = new ParakeetEouMeetingCoordinator({
    createClient: async () => {
      if (!parakeetRuntimeHost) throw new Error('parakeet_runtime_unavailable');
      const before = parakeetRuntimeHost.diagnostics();
      console.warn(
        `[ParakeetEOU] requesting live lease state=${before.state} queued=${before.queuedLeaseCount}`,
      );
      const lease = await parakeetRuntimeHost.startRecordingLive();
      const after = parakeetRuntimeHost.diagnostics();
      console.warn(
        `[ParakeetEOU] acquired live lease state=${after.state} queued=${after.queuedLeaseCount}`,
      );
      return new ParakeetEouClient({
        runtimeHost: parakeetRuntimeHost,
        runtimeLease: lease,
        maxOutstandingPerSource: 4,
      });
    },
    onUpdate: ({ meetingId, owner: ownerId, event }) => {
      const owner = parakeetEouOwner;
      if (
        !owner ||
        owner.isDestroyed() ||
        String(owner.id) !== ownerId ||
        parakeetEouGeneration !== event.generation
      )
        return;
      owner.send('PARAKEET_EOU_UPDATE', {
        meetingId,
        generation: event.generation,
        event,
      });
    },
    onUnavailable: ({ meetingId, owner: ownerId, code }) => {
      console.warn(`[ParakeetEOU] unavailable code=${code}`);
      const owner = parakeetEouOwner;
      if (!owner || owner.isDestroyed() || String(owner.id) !== ownerId) return;
      owner.send('PARAKEET_EOU_UNAVAILABLE', {
        meetingId,
        generation: parakeetEouGeneration,
        code,
      });
    },
  });
  parakeetEouCoordinator = eouCoordinator;

  const requireParakeetEouOwner = (sender: WebContents, meetingId: string) => {
    captureSessionLease.requireRecordingOwner(meetingId, sender.id);
    if (parakeetEouOwner?.id !== sender.id) {
      throw new Error('capture_session_not_owned');
    }
  };

  const meetingContextProducer = createMeetingContextProducer({
    getEventByKey: db.getMeetingContextEventByKey,
    appendEvent: db.appendMeetingContextEvent,
    listEvents: db.listMeetingContextEvents,
    getLatestSnapshot: db.getLatestMeetingContextSnapshot,
    saveSnapshot: db.saveMeetingContextSnapshot,
  });

  ipcMain.handle('PARAKEET_EOU_START', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    const generation = Number(request.generation);
    captureSessionLease.requireRecordingOwner(meetingId, event.sender.id);
    if (
      parakeetEouOwner &&
      (parakeetEouOwner.id !== event.sender.id ||
        parakeetEouGeneration !== generation)
    ) {
      throw new Error('capture_session_not_owned');
    }
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw new Error('parakeet_request_invalid');
    }
    parakeetEouOwner = event.sender;
    parakeetEouGeneration = generation;
    try {
      await eouCoordinator.start({
        meetingId,
        generation,
        owner: String(event.sender.id),
      });
      return {};
    } catch (error) {
      if (parakeetEouOwner?.id === event.sender.id) {
        parakeetEouOwner = null;
        parakeetEouGeneration = null;
      }
      throw error;
    }
  });

  ipcMain.handle('PARAKEET_EOU_APPEND', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    requireParakeetEouOwner(event.sender, meetingId);
    if (!(request.samples instanceof Float32Array)) {
      throw new Error('parakeet_request_invalid');
    }
    await eouCoordinator.append({
      meetingId,
      source: request.source,
      sampleRate: request.sampleRate,
      samples: request.samples,
      audioStartSeconds: request.audioStartSeconds,
      audioEndSeconds: request.audioEndSeconds,
    });
    return {};
  });

  ipcMain.handle(
    'MEETING_CONTEXT_INGEST_CONFIRMED',
    async (event, request = {}) => {
      const meetingId = String(request.meetingId || '');
      captureSessionLease.requireRecordingOwner(meetingId, event.sender.id);
      return await meetingContextProducer.ingest(request);
    },
  );

  ipcMain.handle('PARAKEET_EOU_FINISH', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    requireParakeetEouOwner(event.sender, meetingId);
    await eouCoordinator.finish(meetingId);
    parakeetEouOwner = null;
    parakeetEouGeneration = null;
    return {};
  });

  ipcMain.handle('PARAKEET_EOU_CANCEL', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    requireParakeetEouOwner(event.sender, meetingId);
    await eouCoordinator.fail('parakeet_cancelled');
    parakeetEouOwner = null;
    parakeetEouGeneration = null;
    return {};
  });

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

  ipcMain.handle('RECORDING_READINESS_STATUS', async () => {
    return await getRecordingReadinessStatus({
      parakeetFinalClient,
      parakeetModelRoot,
      audiocapPath: getAudioCapExecPath(),
    });
  });

  ipcMain.handle('RECORDING_READINESS_PREPARE', async (event) => {
    return await prepareRecordingReadiness(
      {
        parakeetFinalClient,
        parakeetModelRoot,
        audiocapPath: getAudioCapExecPath(),
      },
      (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('RECORDING_READINESS_PROGRESS', progress);
        }
      },
    );
  });

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_START',
    async (
      event,
      { meetingId, startedAtMs, expectedSources, sourceAvailability } = {},
    ) => {
      return handleAudioCaptureJournalStart({
        meetingId,
        startedAtMs,
        expectedSources,
        sourceAvailability,
        sender: event.sender,
        captureSessionLease,
        readinessParams: {
          parakeetFinalClient,
          parakeetModelRoot,
          audiocapPath: getAudioCapExecPath(),
        },
        watchCaptureOwner,
        knowledgeSynthesisPause,
        getMeetingArtifactsRootDir,
        startParakeetLiveRecording,
        prepareCaptureIdentity: (id: string) => {
          const self = db.identityStore.getSelfPersonId();
          return () => db.identityStore.recordCapture(id, 'local', self);
        },
      });
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_ABORT_START',
    async (event, { meetingId } = {}) => {
      const normalizedMeetingId = String(meetingId || '');
      captureSessionLease.requireRecordingOwner(
        normalizedMeetingId,
        event.sender.id,
      );
      if (nativeAudioOwner?.id === event.sender.id) {
        stopNativeAudioCapture();
      }
      try {
        await deleteCaptureJournal(
          getMeetingArtifactsRootDir(),
          normalizedMeetingId,
        );
      } finally {
        if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
          knowledgeSynthesisPause.release('capture');
          console.warn('[CaptureLease] released: capture_start_aborted');
        }
      }
      return true;
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_READ',
    async (_event, { meetingId } = {}) =>
      await readCaptureJournalManifest(
        getMeetingArtifactsRootDir(),
        String(meetingId || ''),
      ),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT',
    async (_event, { meetingId, expectedConfigKey, expectedConfigKeys } = {}) =>
      await verifySealedCaptureJournalTranscriptEvidence(
        getMeetingArtifactsRootDir(),
        String(meetingId || ''),
        Array.isArray(expectedConfigKeys)
          ? expectedConfigKeys.filter(
              (key): key is string => typeof key === 'string',
            )
          : typeof expectedConfigKey === 'string'
            ? expectedConfigKey
            : undefined,
      ),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_INTERVAL_AUTHORIZE',
    async (_event, request = {}) =>
      await authorizeCaptureJournalInterval(getMeetingArtifactsRootDir(), {
        ...request,
        meetingId: String(request.meetingId || ''),
      }),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_RAW_APPEND',
    async (_event, request = {}) =>
      await persistCaptureJournalRawChunk(getMeetingArtifactsRootDir(), {
        ...request,
        meetingId: String(request.meetingId || ''),
        data: Buffer.from(request.data ?? []),
      }),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE',
    async (event, request = {}) => {
      const completed = await completeCaptureJournalCapturedChunk(
        getMeetingArtifactsRootDir(),
        {
          ...request,
          meetingId: String(request.meetingId || ''),
          ...(request.repairData
            ? { repairData: Buffer.from(request.repairData) }
            : {}),
        },
      );
      await appendParakeetLiveReceipt(event.sender, completed.receipt).catch(
        () => console.warn('[Pluto] parakeet_shadow_append_failed'),
      );
      return completed;
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_CHECKPOINT_APPEND',
    async (_event, request = {}) =>
      await appendCaptureTranscriptCheckpoint(
        getMeetingArtifactsRootDir(),
        request,
      ),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_CHECKPOINT_PROMOTE',
    async (_event, request = {}) =>
      await promoteCaptureTranscriptCheckpoint(
        getMeetingArtifactsRootDir(),
        request,
      ),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_ACCEPTANCE_APPEND',
    async (_event, request = {}) =>
      await appendCaptureTranscriptAcceptanceFrame(
        getMeetingArtifactsRootDir(),
        request,
      ),
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_APPEND',
    async (
      _event,
      {
        meetingId,
        source,
        sequence,
        chunkStartSec,
        chunkEndSec,
        format,
        data,
      } = {},
    ) => {
      return await appendCaptureJournalChunk(getMeetingArtifactsRootDir(), {
        meetingId: String(meetingId || ''),
        source: source === 'system' ? 'system' : 'mic',
        sequence:
          typeof sequence === 'number' ? sequence : Number(sequence || 0),
        chunkStartSec: typeof chunkStartSec === 'number' ? chunkStartSec : 0,
        chunkEndSec: typeof chunkEndSec === 'number' ? chunkEndSec : 0,
        format: typeof format === 'string' ? format : 'bin',
        data: Buffer.from(data ?? []),
      });
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE',
    async (_event, { meetingId, activityEvidence } = {}) => {
      return await updateCaptureJournalActivityEvidence(
        getMeetingArtifactsRootDir(),
        { meetingId, activityEvidence },
      );
    },
  );

  ipcMain.handle('AUDIO_CAPTURE_JOURNAL_STOP', async (event, request = {}) => {
    const normalizedMeetingId = String(request.meetingId || '');
    captureSessionLease.requireRecordingOwner(
      normalizedMeetingId,
      event.sender.id,
    );
    const manifest = await stopCaptureJournal(getMeetingArtifactsRootDir(), {
      ...request,
      meetingId: normalizedMeetingId,
    });
    await stopParakeetLiveRecording(normalizedMeetingId);
    captureSessionLease.markStopped(normalizedMeetingId, event.sender.id);
    console.log('[CaptureLease] transitioned: capture_stopped');
    return manifest;
  });

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_SEAL',
    async (event, { meetingId, endedAtMs } = {}) => {
      const normalizedMeetingId = String(meetingId || '');
      captureSessionLease.requireStoppedOwner(
        normalizedMeetingId,
        event.sender.id,
      );
      let manifest: Awaited<ReturnType<typeof sealCaptureJournal>>;
      try {
        await stopParakeetLiveRecording(normalizedMeetingId);
        manifest = await sealCaptureJournal(getMeetingArtifactsRootDir(), {
          meetingId: normalizedMeetingId,
          endedAtMs: typeof endedAtMs === 'number' ? endedAtMs : Date.now(),
        });
      } catch (error) {
        if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
          knowledgeSynthesisPause.release('capture');
          console.warn('[CaptureLease] released: seal_failed_after_stop');
        }
        throw error;
      }
      if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
        knowledgeSynthesisPause.release('capture');
        console.log('[CaptureLease] released: capture_sealed');
      }
      return manifest;
    },
  );

  // --- NATIVE AUDIO CAPTURE (AUDIOCAP) ---
  let bootProbeDone = false;
  const activeCallAlertController = createActiveCallAlertController({
    preloadPath: getPreloadPath(),
    devServerUrl: VITE_DEV_SERVER_URL,
    rendererDist: RENDERER_DIST,
  });

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
    if (
      canReuseRunningCaptureForProbe(Boolean(nativeAudioProcess), targetPids)
    ) {
      return true;
    }

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
    async (_event, { durationMs, allowSilent, silentProbe } = {}) => {
      return await runAudioProbe({
        durationMs,
        allowSilent: Boolean(allowSilent),
        includeSelf: true,
        silentProbe: Boolean(silentProbe),
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

  ipcMain.handle('NATIVE_AUDIO_START', async (event) => {
    if (!captureSessionLease.recordingForOwner(event.sender.id)) {
      console.warn('[CaptureLease] native audio rejected: owner_missing');
      throw new Error('capture_session_not_owned');
    }
    if (nativeAudioProcess) {
      return nativeAudioOwner?.id === event.sender.id;
    }

    // Locate binary: In dev 'resources/bin/audiocap', in prod 'process.resourcesPath/bin/audiocap'
    const execPath = getAudioCapExecPath();

    console.log('[Pluto] Spawning AudioCap:', execPath);

    try {
      if (!fs.existsSync(execPath)) {
        console.error('[Pluto] AudioCap binary not found at:', execPath);
        return false;
      }

      const spawnedProcess = spawn(execPath);
      const captureOwner = event.sender;
      nativeAudioProcess = spawnedProcess;
      nativeAudioOwner = captureOwner;

      spawnedProcess.stdout?.on('data', (chunk) => {
        // chunk is Buffer (PCM data)
        if (
          nativeAudioProcess === spawnedProcess &&
          !captureOwner.isDestroyed()
        ) {
          captureOwner.send('NATIVE_AUDIO_CHUNK', chunk);
        }
      });

      spawnedProcess.stderr?.on('data', (data) => {
        console.error('[Pluto-AudioCap]', data.toString());
      });

      spawnedProcess.on('close', (code) => {
        console.log('[Pluto] AudioCap exited with code', code);
        if (nativeAudioProcess === spawnedProcess) {
          nativeAudioProcess = null;
          nativeAudioOwner = null;
        }
      });

      const nativeStarted = await waitForNativeAudioSpawn(spawnedProcess);
      if (!nativeStarted) {
        console.error('[Pluto] AudioCap failed to spawn');
        if (nativeAudioProcess === spawnedProcess) {
          nativeAudioProcess = null;
          nativeAudioOwner = null;
        }
        return false;
      }

      return true;
    } catch (e) {
      console.error('[Pluto] Failed to spawn audiocap:', e);
      nativeAudioProcess = null;
      nativeAudioOwner = null;
      return false;
    }
  });

  ipcMain.handle('NATIVE_AUDIO_STOP', async (event) => {
    if (
      nativeAudioProcess &&
      nativeAudioOwner &&
      nativeAudioOwner.id !== event.sender.id
    ) {
      console.warn('[CaptureLease] native audio stop rejected: owner_mismatch');
      return false;
    }
    if (nativeAudioProcess) console.log('[Pluto] Stopping AudioCap...');
    stopNativeAudioCapture();
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

  const stitchWavSegments = async ({
    segments,
    outputTag,
  }: {
    segments?: Array<{
      path?: string;
      startSec?: number;
      endSec?: number;
      chunkIndex?: number;
    }>;
    outputTag?: string;
  }) => {
    if (!Array.isArray(segments) || segments.length === 0) return null;

    const validSegments = segments
      .filter(
        (
          value,
        ): value is {
          path: string;
          startSec: number;
          endSec: number;
          chunkIndex?: number;
        } =>
          value &&
          typeof value === 'object' &&
          typeof value.path === 'string' &&
          value.path.length > 0 &&
          fs.existsSync(value.path) &&
          typeof value.startSec === 'number' &&
          Number.isFinite(value.startSec) &&
          value.startSec >= 0 &&
          typeof value.endSec === 'number' &&
          Number.isFinite(value.endSec) &&
          value.endSec > value.startSec,
      )
      .sort((left, right) => left.startSec - right.startSec);

    if (validSegments.length === 0) return null;

    const tag =
      (typeof outputTag === 'string' ? outputTag : 'stitched')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 24) || 'stitched';
    const outputDir = path.join(app.getPath('userData'), 'meetings');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(
      outputDir,
      `${tag}_${Date.now()}_${randomUUID()}.wav`,
    );

    return await new Promise<string | null>((resolve) => {
      const command = ffmpeg();
      const filterParts: string[] = [];
      const mixInputs: string[] = [];

      for (let i = 0; i < validSegments.length; i++) {
        const segment = validSegments[i];
        command.input(segment.path);
        const delayMs = Math.max(0, Math.round(segment.startSec * 1000));
        filterParts.push(
          `[${i}:a]adelay=${delayMs}|${delayMs},volume=1[a${i}]`,
        );
        mixInputs.push(`[a${i}]`);
      }

      command
        .complexFilter([
          ...filterParts,
          `${mixInputs.join('')}amix=inputs=${validSegments.length}:duration=longest:normalize=0`,
        ])
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat('wav')
        .on('end', () => {
          console.log(
            `[Pluto] Reconstructed WAV from ${validSegments.length} timed segments: ${outputPath}`,
          );
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.warn(
            '[Pluto] Timed WAV reconstruction failed:',
            err instanceof Error ? err.message : err,
          );
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          resolve(null);
        })
        .save(outputPath);
    });
  };

  ipcMain.handle(
    'AUDIO_STITCH_WAV_SEGMENTS',
    async (_event, { segments, outputTag } = {}) => {
      return await stitchWavSegments({ segments, outputTag });
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE',
    async (_event, { meetingId, source, outputTag } = {}) => {
      if (source !== 'mic' && source !== 'system') return null;
      return await stitchSealedCaptureJournalSource(
        getMeetingArtifactsRootDir(),
        String(meetingId || ''),
        source,
        async (segments, tag) =>
          await stitchWavSegments({ segments, outputTag: tag }),
        String(outputTag || `session-${source}`),
      );
    },
  );

  ipcMain.handle('AUDIO_DELETE_FILES', async (_event, pathsToDelete = []) => {
    if (!Array.isArray(pathsToDelete) || pathsToDelete.length === 0) {
      return { deleted: 0 };
    }

    const allowedRoots = [
      path.join(app.getPath('userData'), 'meetings'),
      app.getPath('temp'),
    ].map((root) => path.resolve(root));

    let deleted = 0;
    for (const rawPath of pathsToDelete) {
      if (typeof rawPath !== 'string' || rawPath.length === 0) continue;

      const resolvedPath = path.resolve(rawPath);
      const allowed = allowedRoots.some(
        (root) =>
          resolvedPath === root ||
          resolvedPath.startsWith(`${root}${path.sep}`),
      );
      if (!allowed || !fs.existsSync(resolvedPath)) continue;

      try {
        fs.unlinkSync(resolvedPath);
        deleted += 1;
      } catch (error) {
        console.warn(
          `[Pluto] Failed to delete recording artifact ${resolvedPath}:`,
          error,
        );
      }
    }

    return { deleted };
  });

  ipcMain.handle('AUDIO_PROBE_DURATION', async (_event, rawPath) => {
    if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
    const resolvedPath = path.resolve(rawPath);
    const meetingsRoot = path.resolve(app.getPath('userData'), 'meetings');
    if (!resolvedPath.startsWith(`${meetingsRoot}${path.sep}`)) return null;
    if (!fs.existsSync(resolvedPath)) return null;

    return await probeAudioDuration(resolvedPath);
  });

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

  ipcMain.handle('SAVE_MEETING', (_event, meeting, options) => {
    try {
      const persisted =
        meeting &&
        (typeof meeting.id === 'string' || typeof meeting.id === 'number')
          ? (db.getMeeting(String(meeting.id)) as
              | db.PersistedMeeting
              | undefined)
          : undefined;
      if (
        persisted?.analysis_json !== meeting?.analysis_json &&
        typeof persisted?.user_edits_json === 'string'
      ) {
        try {
          const edits = JSON.parse(persisted.user_edits_json) as Record<
            string,
            unknown
          >;
          if (edits.__previous_generated_notes__) {
            meetingNotesRunCoordinator.supersedeMeetingNotes(meeting.id);
          }
        } catch {
          // A malformed historical overlay cannot be treated as a restore.
        }
      }
      if (shouldCleanupTranscriptOnSave(meeting)) {
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

      console.log(
        `[Pluto] Saving meeting [has_id=${Boolean(meeting?.id)}, title_length=${typeof meeting?.title === 'string' ? meeting.title.length : 0}]`,
      );
      const expectedValidationRunId =
        options && typeof options.expectedValidationRunId === 'string'
          ? options.expectedValidationRunId
          : null;
      const expectedDownstreamRunId =
        options && typeof options.expectedDownstreamRunId === 'string'
          ? options.expectedDownstreamRunId
          : null;
      const claimValidationLease = options?.claimValidationLease;
      const transcriptOwnedFieldsOnly = options?.transcriptOwnedFieldsOnly;
      const result = saveMeetingWithParticipantSideEffects({
        meeting,
        saveMeeting: () =>
          expectedDownstreamRunId
            ? db.saveMeetingIfDownstreamRunCurrent(
                meeting,
                expectedDownstreamRunId,
                typeof options.expectedTitle === 'string'
                  ? options.expectedTitle
                  : undefined,
              )
            : claimValidationLease
              ? db.claimMeetingTranscriptValidationRetry(
                  meeting.id,
                  claimValidationLease,
                )
              : transcriptOwnedFieldsOnly && expectedValidationRunId
                ? db.saveTranscriptValidationResultIfRunCurrent(
                    meeting.id,
                    expectedValidationRunId,
                    meeting,
                    typeof options.expectedTitle === 'string'
                      ? options.expectedTitle
                      : undefined,
                  )
                : expectedValidationRunId
                  ? db.saveMeetingIfTranscriptRunCurrent(
                      meeting,
                      expectedValidationRunId,
                    )
                  : db.saveMeeting(meeting),
        upsertEntity: db.upsertEntity,
        addMeetingEntity: db.addMeetingEntity,
      });
      if (expectedDownstreamRunId && result !== false) {
        let downstreamState: unknown = null;
        try {
          downstreamState = JSON.parse(
            meeting.downstream_processing_json || '{}',
          ).state;
        } catch {
          downstreamState = null;
        }
        if (downstreamState !== 'processing') {
          knowledgeSynthesisPause.release('downstream');
          postMeetingBackgroundActivity.setActive(
            expectedDownstreamRunId,
            false,
          );
        }
      }
      return result;
    } catch (e) {
      console.error('[Pluto] SAVE_MEETING failed:', e);
      throw e;
    }
  });

  ipcMain.handle('CLAIM_DOWNSTREAM_PROCESSING', (_event, meetingId, lease) => {
    const claimed = db.claimMeetingDownstreamProcessing(meetingId, lease);
    if (claimed) {
      knowledgeSynthesisPause.acquire('downstream');
      postMeetingBackgroundActivity.setActive(String(lease?.runId || ''), true);
    }
    return claimed;
  });
  ipcMain.handle('UPDATE_MEETING_TITLE_IF_CURRENT', (_event, input) =>
    db.updateMeetingTitleIfCurrent(input),
  );
  ipcMain.handle(
    'CLAIM_TRANSCRIPT_VALIDATION_RETRY',
    (_event, meetingId, lease) =>
      db.claimMeetingTranscriptValidationRetry(meetingId, lease),
  );
  ipcMain.handle('CLAIM_FINAL_TRANSCRIPTION', (_event, meetingId, lease) =>
    db.claimMeetingFinalTranscription(meetingId, lease),
  );
  ipcMain.handle(
    'UPDATE_FINAL_TRANSCRIPTION_STAGE',
    (_event, meetingId, runId, stage) =>
      db.updateMeetingFinalTranscriptionStage(meetingId, runId, stage),
  );
  ipcMain.handle('COMMIT_FINAL_TRANSCRIPTION', (_event, input) =>
    db.commitMeetingFinalTranscription(input),
  );
  ipcMain.handle(
    'FAIL_FINAL_TRANSCRIPTION',
    (_event, meetingId, runId, failure) =>
      db.failMeetingFinalTranscription(meetingId, runId, failure),
  );
  ipcMain.handle(
    'UPDATE_TRANSCRIPT_VALIDATION_RETRY_STAGE',
    (_event, meetingId, runId, stage) =>
      db.updateMeetingTranscriptValidationRetryStage(meetingId, runId, stage),
  );
  ipcMain.handle('FINALIZE_CHECKPOINT_TRANSCRIPT', (_event, input) => {
    const outcome = db.finalizeCheckpointTranscript(input);
    if (
      outcome === 'committed_and_claimed' ||
      outcome === 'already_committed'
    ) {
      knowledgeSynthesisPause.acquire('downstream');
      postMeetingBackgroundActivity.setActive(
        String(input?.downstreamRunId || ''),
        true,
      );
    }
    return outcome;
  });
  ipcMain.handle('PATCH_STOP_TO_VALIDATED_LATENCY', (_event, input) =>
    runConditionalMeetingUpdateForIpc(() =>
      db.patchStopToValidatedLatency(input),
    ),
  );
  ipcMain.handle(
    'SAVE_DERIVED_MEETING_FIELDS_IF_TRANSCRIPT_CURRENT',
    (_event, input) =>
      runConditionalMeetingUpdateForIpc(() =>
        db.saveDerivedMeetingFieldsIfTranscriptCurrent(input),
      ),
  );
  ipcMain.handle(
    'FAIL_TRANSCRIPT_VALIDATION_RETRY',
    (_event, meetingId, runId, failure) =>
      db.failMeetingTranscriptValidationRetry(meetingId, runId, failure),
  );

  ipcMain.handle(
    'SAVE_USER_EDIT',
    async (_event, { meetingId, path, original, edited }) => {
      try {
        const meeting = db.getMeeting(String(meetingId)) as
          | db.PersistedMeeting
          | undefined;
        if (!meeting) {
          throw new Error(`Meeting ${meetingId} not found`);
        }
        if (
          typeof path !== 'string' ||
          typeof original !== 'string' ||
          typeof edited !== 'string'
        ) {
          throw new Error('invalid_user_edit');
        }
        if (isNoOpMeetingNotesEdit(original, edited)) {
          return { success: true };
        }
        let editsMap: Record<
          string,
          { original: string; edited: string; edited_at: string }
        > = {};
        if (meeting.user_edits_json) {
          try {
            editsMap = JSON.parse(meeting.user_edits_json);
          } catch {
            editsMap = {};
          }
        }
        editsMap[path] = {
          original,
          edited,
          edited_at: new Date().toISOString(),
        };
        db.saveMeeting({
          ...meeting,
          user_edits_json: JSON.stringify(editsMap),
        });
        return { success: true };
      } catch (e) {
        console.error('[Pluto] SAVE_USER_EDIT failed:', e);
        throw e;
      }
    },
  );

  ipcMain.handle('REVERT_USER_EDIT', async (_event, { meetingId, path }) => {
    try {
      const meeting = db.getMeeting(String(meetingId)) as
        | db.PersistedMeeting
        | undefined;
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }
      let editsMap: Record<string, unknown> = {};
      if (meeting.user_edits_json) {
        try {
          editsMap = JSON.parse(meeting.user_edits_json);
        } catch {
          editsMap = {};
        }
      }
      delete editsMap[path];
      db.saveMeeting({
        ...meeting,
        user_edits_json: JSON.stringify(editsMap),
      });
      return { success: true };
    } catch (e) {
      console.error('[Pluto] REVERT_USER_EDIT failed:', e);
      throw e;
    }
  });

  const withNotesRun = (value: unknown) => {
    const meeting = value as db.PersistedMeeting | undefined;
    return meeting
      ? {
          ...meeting,
          analysis_run_json: JSON.stringify(
            db.getMeetingAnalysisRun(meeting.id),
          ),
        }
      : meeting;
  };
  ipcMain.handle('GET_MEETINGS', () => db.getMeetings().map(withNotesRun));
  ipcMain.handle('GET_MEETING', (_event, id) =>
    withNotesRun(db.getMeeting(id)),
  );
  ipcMain.handle('RESTORE_MEETING_NOTES', (_event, input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      (typeof input.meetingId !== 'string' &&
        typeof input.meetingId !== 'number')
    ) {
      throw new Error('invalid_meeting_notes_restore_request');
    }
    meetingNotesRunCoordinator.supersedeMeetingNotes(input.meetingId);
    if (!db.restoreMeetingNotesSnapshot(input.meetingId)) {
      throw new Error('meeting_notes_restore_unavailable');
    }
    return { meetingId: String(input.meetingId), status: 'restored' };
  });
  ipcMain.handle('SEARCH_MEETINGS', (_event, query) =>
    db.searchMeetings(query),
  );
  ipcMain.handle('GET_ANALYSIS_QUALITY_STATS', () =>
    db.getAnalysisQualityStats(),
  );
  ipcMain.handle('DELETE_MEETING', async (_event, id) => {
    try {
      const meetingId = String(id);
      const meeting = db.getMeeting(meetingId) as
        | db.PersistedMeeting
        | undefined;
      const downstreamActivity = readDownstreamActivity(
        meeting?.downstream_processing_json,
      );

      // Abort any active background tasks for this meeting
      abortMeetingTasks(meetingId);
      meetingNotesRunCoordinator.supersedeMeetingNotes(meetingId);
      await meetingContextProducer.cancel(meetingId);

      const result = db.deleteMeeting(id);
      if (downstreamActivity.runId) {
        knowledgeSynthesisPause.release('downstream');
        postMeetingBackgroundActivity.setActive(
          downstreamActivity.runId,
          false,
        );
      }
      await deleteCaptureJournal(getMeetingArtifactsRootDir(), meetingId).catch(
        (error) => {
          console.warn('[Pluto] Failed to delete capture journal:', error);
        },
      );

      // Broadcast to renderer that a meeting has been deleted
      if (win && !win.isDestroyed()) {
        win.webContents.send('MEETING_DELETED', meetingId);
      }

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
      const saved = db.withCommitmentTransaction(() => {
        const previous = entity.id ? db.getEntity(entity.id) : undefined;
        const result = db.upsertEntity(entity);
        return result.type === 'action_item' &&
          Object.hasOwn(entity, 'assigned_to') &&
          entity.assigned_to !== previous?.assigned_to
          ? db.correctActionOwner(result.id, entity.assigned_to)
          : result;
      });
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
  ipcMain.handle('GET_PROJECT_PORTFOLIO', () => db.getProjectPortfolio());
  const projectInitiativeDiscoveryStateKey =
    'project_initiative_discovery_state_v12';
  const readProjectInitiativeDiscoveryStates = (): Record<
    string,
    ProjectInitiativeDiscoveryState
  > => {
    try {
      const parsed = JSON.parse(
        db.getSetting(projectInitiativeDiscoveryStateKey) || '{}',
      );
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  };
  let projectInitiativeDiscovery: Promise<
    Awaited<ReturnType<typeof discoverProjectInitiative>>
  > | null = null;
  ipcMain.handle(
    'DISCOVER_PROJECT_INITIATIVE',
    (_event, options?: { retryFailed?: unknown }) => {
      if (projectInitiativeDiscovery) return projectInitiativeDiscovery;
      projectInitiativeDiscovery = discoverProjectInitiative(
        {
          listSources: () =>
            db.getProjectInitiativeDiscoverySources().map((meeting) => {
              const fullText = parseTranscriptSegments(meeting.transcript_json)
                .map((segment) =>
                  typeof segment.text === 'string' ? segment.text : '',
                )
                .join(' ');
              return {
                id: String(meeting.id),
                title: meeting.title,
                text: fullText,
                fullText,
                projectCount: meeting.project_count,
                projectNames: db
                  .getMeetingEntities(String(meeting.id))
                  .filter((entity) => entity.type === 'project')
                  .map((entity) => entity.name),
                startedAt: meeting.started_at || meeting.created_at,
              };
            }),
          getSource: (id) => {
            const meeting = db.getMeeting(id) as
              | db.PersistedMeeting
              | undefined;
            if (!meeting || meeting.transcript_status !== 'validated')
              return null;
            const projectCount = db
              .getMeetingEntities(id)
              .filter((entity) => entity.type === 'project').length;
            if (!projectCount) return null;
            const fullText = parseTranscriptSegments(meeting.transcript_json)
              .map((segment) =>
                typeof segment.text === 'string' ? segment.text : '',
              )
              .join(' ');
            return {
              id: String(meeting.id),
              title: meeting.title,
              text: fullText,
              fullText,
              projectCount,
              projectNames: db
                .getMeetingEntities(id)
                .filter((entity) => entity.type === 'project')
                .map((entity) => entity.name),
              startedAt: meeting.started_at || meeting.created_at,
            };
          },
          getState: (id) => readProjectInitiativeDiscoveryStates()[id],
          saveState: (id, state) => {
            const states = readProjectInitiativeDiscoveryStates();
            states[id] = state;
            db.setSetting(
              projectInitiativeDiscoveryStateKey,
              JSON.stringify(states),
            );
          },
          getInitiative: db.getEntity,
          saveInitiative: (initiative) => {
            if (!db.getEntity(initiative.id))
              db.upsertEntity({
                id: initiative.id,
                type: 'project',
                name: initiative.name,
                status: 'active',
                metadata: initiative.metadata,
                dedupe_by_name: false,
              });
            db.ensureMeetingEntity({
              meeting_id: initiative.sourceMeetingId,
              entity_id: initiative.id,
              context: initiative.context,
            });
          },
          generate: async (prompt, responseSchema) => {
            const provider = await getProvider(await getAllSettings(db));
            return provider.synthesizeKnowledgeDocument(prompt, {
              purpose: 'projectScope',
              responseSchema,
              signal: AbortSignal.timeout(300_000),
            });
          },
          isBusy: () =>
            isProjectScopeReviewBusy(knowledgeSynthesisPause.snapshot()),
        },
        { retryFailed: options?.retryFailed === true },
      ).finally(() => {
        projectInitiativeDiscovery = null;
      });
      return projectInitiativeDiscovery;
    },
  );
  let projectScopeReview: Promise<
    Awaited<ReturnType<typeof reviewProjectScopeBatch>>
  > | null = null;
  ipcMain.handle(
    'REVIEW_PROJECT_SCOPE',
    (_event, options?: { excludeProjectIds?: unknown }) => {
      const excludeProjectIds = Array.isArray(options?.excludeProjectIds)
        ? options.excludeProjectIds
            .filter((id): id is string => typeof id === 'string')
            .slice(0, 1000)
        : [];
      if (projectScopeReview) return projectScopeReview;
      projectScopeReview = reviewProjectScopeBatch(
        {
          listProjects: () =>
            db
              .getProjectPortfolio()
              .sort((a, b) => b.meeting_count - a.meeting_count),
          getProject: db.getEntity,
          getSources: (id) => {
            return db
              .getEntityMeetings(id)
              .filter((meeting) => meeting.transcript_status === 'validated')
              .sort(
                (a, b) =>
                  Date.parse(b.started_at || b.created_at || '') -
                  Date.parse(a.started_at || a.created_at || ''),
              )
              .map((meeting) => {
                const fullText = parseTranscriptSegments(
                  meeting.transcript_json,
                )
                  .map((segment) =>
                    typeof segment.text === 'string' ? segment.text : '',
                  )
                  .join(' ');
                return {
                  id: String(meeting.id),
                  fullText,
                  text: fullText,
                };
              });
          },
          generate: async (prompt, responseSchema) => {
            const provider = await getProvider(await getAllSettings(db));
            return provider.synthesizeKnowledgeDocument(prompt, {
              purpose: 'projectScope',
              responseSchema,
              signal: AbortSignal.timeout(300_000),
            });
          },
          save: (id, metadata) => {
            const entity = db.getEntity(id);
            if (entity) db.upsertEntity({ ...entity, metadata });
          },
          saveAttempt: (id, attempt) => {
            const entity = db.getEntity(id);
            if (!entity) return;
            let metadata: Record<string, unknown> = {};
            try {
              const parsed = JSON.parse(entity.metadata || '{}');
              if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
              )
                metadata = parsed;
            } catch {
              // Keep a malformed legacy metadata value from blocking retry state.
            }
            db.upsertEntity({
              ...entity,
              metadata: { ...metadata, projectScopeReviewAttempt: attempt },
            });
          },
          isBusy: () =>
            isProjectScopeReviewBusy(knowledgeSynthesisPause.snapshot()),
        },
        { excludeProjectIds },
      ).finally(() => {
        projectScopeReview = null;
      });
      return projectScopeReview;
    },
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
  ipcMain.handle('UPDATE_ACTION_COMMITMENT_STATE', (_event, payload) =>
    handleActionCommitmentReview(payload, {
      updateActionCommitmentState: db.updateActionCommitmentState,
      queueKnowledgeRefresh: queueAllKnowledgeDocsRefresh,
    }),
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

  ipcMain.handle(
    'REFRESH_KNOWLEDGE_FOR_MEETING_NOW',
    async (
      _event,
      meetingId,
      options?: { expectedDownstreamRunId?: unknown },
    ) => {
      const normalizedMeetingId = String(meetingId);
      const expectedRunId =
        typeof options?.expectedDownstreamRunId === 'string'
          ? options.expectedDownstreamRunId
          : null;
      return await refreshKnowledgeDocsForMeetingNow(normalizedMeetingId, {
        canCommit: expectedRunId
          ? () => isDownstreamRunCurrent(normalizedMeetingId, expectedRunId)
          : undefined,
      });
    },
  );
  ipcMain.handle(
    'GET_WORKING_MEMORY_SNAPSHOT',
    (_event, { scopeType, scopeKey }) =>
      db.getWorkingMemorySnapshot(scopeType, scopeKey),
  );
  ipcMain.handle('LIST_WORKING_MEMORY_SNAPSHOTS', () =>
    db.listWorkingMemorySnapshots(),
  );
  ipcMain.handle('GET_KNOWLEDGE_DOC_VERSIONS', (_event, { docId, limit }) =>
    db.getKnowledgeDocVersions(docId, limit),
  );
  ipcMain.handle('GET_KNOWLEDGE_DOC_SOURCES', (_event, docId) =>
    db.getKnowledgeDocSourceDetails(docId),
  );
  ipcMain.handle('GET_KNOWLEDGE_CORRECTIONS', (_event, docId) =>
    db.getKnowledgeCorrections(docId),
  );
  ipcMain.handle(
    'SAVE_KNOWLEDGE_CORRECTION',
    (_event, { docId, targetKind, targetId, action, payload }) =>
      db.saveKnowledgeCorrection({
        doc_id: docId,
        target_kind: targetKind,
        target_id: targetId,
        action,
        payload,
      }),
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

  ipcMain.handle('GENERATE_MEETING_NOTES', async (_event, input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      (typeof input.meetingId !== 'string' &&
        typeof input.meetingId !== 'number') ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      (input.reason !== 'automatic' &&
        input.reason !== 'manual' &&
        input.reason !== 'secondary')
    ) {
      throw new Error('invalid_meeting_notes_request');
    }
    return await meetingNotesRunCoordinator.generateAndPublishMeetingNotes({
      meetingId: input.meetingId,
      requestId: input.requestId,
      template: input.template === undefined ? 'auto' : input.template,
      reason: input.reason,
    });
  });

  ipcMain.handle('CANCEL_MEETING_NOTES', async (_event, input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      (typeof input.meetingId !== 'string' &&
        typeof input.meetingId !== 'number') ||
      typeof input.requestId !== 'string'
    ) {
      return { cancelled: false };
    }
    return await meetingNotesRunCoordinator.cancelMeetingNotes({
      meetingId: input.meetingId,
      requestId: input.requestId,
    });
  });

  ipcMain.handle(
    'GENERATE_ANALYSIS_V2',
    async (_event, { transcript, userNotes, template, requestId }) => {
      const normalizedRequestId =
        typeof requestId === 'string' && requestId.trim()
          ? requestId.trim()
          : null;
      const controller = new AbortController();
      const generation = (async () => {
        if (!transcript || !transcript.trim()) {
          throw new Error('meeting_notes_source_missing');
        }
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        console.log(
          `[LLM] Generating v3 structured analysis with provider: ${provider.name}`,
        );
        const analysis = await provider.generateStructuredAnalysis(
          transcript,
          userNotes,
          template,
          {
            signal: controller.signal,
            knownTerms: db
              .getAllEntities()
              .filter(
                (entity) =>
                  entity.type === 'person' || entity.type === 'project',
              )
              .map((entity) => entity.name)
              .filter(Boolean)
              .slice(0, 24),
          },
        );
        if (normalizedRequestId && analysis.quality.fallback_used) {
          throw new Error('analysis_generation_failed');
        }
        return { analysis };
      })();
      const settled = generation.then(
        () => undefined,
        () => undefined,
      );
      if (normalizedRequestId) {
        activeAnalysisGenerations.set(normalizedRequestId, {
          controller,
          settled,
        });
      }
      try {
        return await generation;
      } finally {
        if (
          normalizedRequestId &&
          activeAnalysisGenerations.get(normalizedRequestId)?.controller ===
            controller
        ) {
          activeAnalysisGenerations.delete(normalizedRequestId);
        }
      }
    },
  );

  ipcMain.handle('CANCEL_ANALYSIS_GENERATION', async (_event, requestId) => {
    if (typeof requestId !== 'string') return { cancelled: false };
    const active = activeAnalysisGenerations.get(requestId);
    if (!active) return { cancelled: false };
    active.controller.abort(
      new DOMException('Analysis generation cancelled', 'AbortError'),
    );
    await active.settled;
    return { cancelled: true };
  });

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
        throw error;
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
        throw error;
      }
    },
  );

  // Extract entities AND save them to the knowledge graph
  ipcMain.handle(
    'EXTRACT_AND_PROCESS_ENTITIES',
    async (
      _event,
      {
        transcript,
        meetingId,
        summary,
        valueSignals,
        priorityHints,
        awaitKnowledgeSynthesis,
        expectedDownstreamRunId,
      },
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
        const signal = getAbortSignalForMeeting(String(meetingId));
        const canCommit =
          typeof expectedDownstreamRunId === 'string'
            ? () =>
                isDownstreamRunCurrent(
                  String(meetingId),
                  expectedDownstreamRunId,
                )
            : undefined;
        if (signal.aborted) {
          console.log(
            `[LLM] Skipping entity extraction for meeting ${meetingId} (aborted)`,
          );
          return { created: 0, linked: 0 };
        }

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
          { canCommit, signal },
        );

        if (signal.aborted) {
          console.log(
            `[LLM] Aborting MID generation for meeting ${meetingId} (meeting deleted)`,
          );
          return result;
        }

        // Generate MID after entity extraction
        try {
          const meeting = db.getMeeting(String(meetingId)) as
            | db.PersistedMeeting
            | undefined;
          if (meeting) {
            const meetingEntities = db.getMeetingEntities(String(meetingId));
            // Parse analysis from the meeting's stored data
            let analysisDoc: AnalysisDocument | AnalysisDocumentV3 =
              fallbackAnalysisArtifacts().analysis;
            if (meeting.analysis_json) {
              try {
                const parsed = JSON.parse(meeting.analysis_json);
                analysisDoc = parsed;
              } catch {
                // Use fallback
              }
            }
            let signals = emptyValueSignals();
            if (meeting.value_signals_json) {
              try {
                signals = normalizeValueSignals(
                  JSON.parse(meeting.value_signals_json),
                );
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
            console.log(
              `[Intelligence] MID generated for meeting ${meetingId}`,
            );

            // Phase 4: Run proactive triggers (non-blocking, fire-and-forget)
            runPostMeetingTriggers(String(meetingId), mid)
              .then((alerts) => {
                try {
                  syncActionTrackerAttentionQueue();
                } catch (error) {
                  console.warn(
                    '[AttentionSync] Failed to refresh action-tracker signals:',
                    error,
                  );
                }
                if (
                  alerts.length > 0 &&
                  win &&
                  !win.isDestroyed() &&
                  !signal.aborted
                ) {
                  win.webContents.send('intelligence:alerts:new', alerts);
                }
              })
              .catch((err) => {
                console.warn(
                  '[ProactiveEngine] Trigger run failed (non-blocking):',
                  err,
                );
              });
          }
        } catch (midError) {
          console.warn(
            '[Intelligence] MID generation failed (non-blocking):',
            midError,
          );
        }

        if (awaitKnowledgeSynthesis !== true) {
          queueKnowledgeDocsRefreshForMeeting(String(meetingId));
        }
        clearAbortControllerForMeeting(String(meetingId));
        return result;
      } catch (error) {
        console.error('[LLM] Entity extraction and processing failed:', error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    'PROCESS_EXTRACTED_ENTITIES',
    async (_event, { entities, meetingId }) => {
      try {
        console.log(
          `[EntityPipeline] Processing pre-extracted entities for meeting ${meetingId}`,
        );
        const provider = await getProvider(await getAllSettings(db));
        const result = await processExtractedEntities(
          entities,
          meetingId,
          undefined,
          undefined,
          {
            signal: getAbortSignalForMeeting(String(meetingId)),
            generate: (prompt, responseSchema, signal) =>
              provider.synthesizeKnowledgeDocument(prompt, {
                purpose: 'commitmentReconciliation',
                responseSchema,
                signal,
              }),
          },
        );
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
  ipcMain.handle(
    'intelligence:query:session-active',
    (event, active: boolean) => {
      const ownerId = event.sender.id;
      if (active === true && !activeAskPlutoSessionOwners.has(ownerId)) {
        activeAskPlutoSessionOwners.add(ownerId);
        knowledgeSynthesisPause.acquire('ask_pluto_session');
        event.sender.once('destroyed', () => {
          if (activeAskPlutoSessionOwners.delete(ownerId)) {
            knowledgeSynthesisPause.release('ask_pluto_session');
          }
        });
      } else if (
        active !== true &&
        activeAskPlutoSessionOwners.delete(ownerId)
      ) {
        knowledgeSynthesisPause.release('ask_pluto_session');
      }
      return { active: activeAskPlutoSessionOwners.has(ownerId) };
    },
  );

  ipcMain.handle(
    'intelligence:query',
    async (event, input: string | AskPlutoQueryRequest) => {
      const startTime = Date.now();
      const queryText = typeof input === 'string' ? input : input?.query;
      const requestId =
        typeof input === 'string' || !input?.requestId
          ? `ask-pluto-${randomUUID()}`
          : input.requestId;
      const controller = new AbortController();
      const persistedMeetings = db.getMeetings() as db.PersistedMeeting[];
      const activeRecording = captureSessionLease.recordingForOwner(
        event.sender.id,
      );
      const currentMeeting = resolveCurrentMeeting({
        activeRecordingMeetingId: activeRecording?.meetingId,
        meetings: persistedMeetings.map((meeting) => ({
          id: meeting.id,
          started_at: meeting.started_at,
          created_at: meeting.created_at,
        })),
      });
      const currentMeetingRow = currentMeeting.meetingId
        ? (db.getMeeting(currentMeeting.meetingId) as
            | db.PersistedMeeting
            | undefined)
        : undefined;
      const currentMeetingStatus: AskPlutoCurrentMeeting =
        currentMeeting.kind === 'active_recording'
          ? {
              ...currentMeeting,
              evidenceState: 'provisional',
              ...(currentMeetingRow?.title
                ? { title: currentMeetingRow.title }
                : {}),
            }
          : currentMeeting.kind === 'persisted'
            ? {
                ...currentMeeting,
                evidenceState: resolvePersistedMeetingEvidenceState({
                  finalizationStatus: currentMeetingRow?.finalization_status,
                  downstreamProcessingJson:
                    currentMeetingRow?.downstream_processing_json,
                }),
                ...(currentMeetingRow?.title
                  ? { title: currentMeetingRow.title }
                  : {}),
              }
            : currentMeeting;
      let reasoningMode: AskPlutoReasoningMode | undefined;
      let comparisonMeetingCount = 0;
      let scopeLabel: string | undefined;
      let scopeMeetingCount = 0;
      let retrievalStartedAt: number | undefined;
      let retrievalCompletedAt: number | undefined;
      let providerRequestedAt: number | undefined;
      let providerStartedAt: number | undefined;
      let firstTokenAt: number | undefined;
      let generationCompletedAt: number | undefined;
      const sendStatus = (phase: AskPlutoQueryStatus['phase']) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send('intelligence:query:status', {
          requestId,
          phase,
          currentMeeting: currentMeetingStatus,
          ...(reasoningMode ? { reasoningMode } : {}),
          ...(comparisonMeetingCount > 0 ? { comparisonMeetingCount } : {}),
          ...(scopeLabel ? { scopeLabel } : {}),
          ...(scopeMeetingCount > 0 ? { scopeMeetingCount } : {}),
        });
      };

      const generation = (async () => {
        if (!queryText || !queryText.trim()) {
          return {
            status: 'answered' as const,
            answer: '',
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }

        console.log(
          `[Pluto] intelligence:query start [request_id=${requestId}, query_length=${queryText.trim().length}]`,
        );
        sendStatus('scope_resolved');
        sendStatus('retrieving');

        const parsed = await parseQuery(queryText, {
          signal: controller.signal,
          useModelClassification: false,
        });
        const explicitMeetingScope = resolveExplicitMeetingScope(
          queryText,
          persistedMeetings,
        );
        const requestedMode =
          typeof input !== 'string' &&
          (input.modeOverride === 'fast' || input.modeOverride === 'deep')
            ? input.modeOverride
            : 'auto';
        reasoningMode = resolveAskPlutoReasoningMode({
          query: queryText,
          intent: parsed.intent,
          override: requestedMode,
        });

        if (parsed.cannedResponse) {
          console.log('[Pluto] intelligence:query canned response');
          return {
            status: 'answered' as const,
            answer: parsed.cannedResponse,
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }

        const currentMeetingRequested =
          queryReferencesCurrentMeeting(queryText);
        const priorTurns: AskPlutoConversationTurn[] =
          typeof input === 'string' || !Array.isArray(input.priorTurns)
            ? []
            : input.priorTurns
                .filter(
                  (turn) =>
                    (turn.role === 'user' || turn.role === 'assistant') &&
                    typeof turn.content === 'string' &&
                    turn.content.trim(),
                )
                .slice(-6)
                .map((turn) => ({
                  role: turn.role,
                  content: turn.content.trim().slice(0, 1200),
                  meetingIds: Array.isArray(turn.meetingIds)
                    ? turn.meetingIds
                        .filter((id): id is string => typeof id === 'string')
                        .slice(0, 8)
                    : [],
                  ...(turn.outcome ? { outcome: turn.outcome } : {}),
                  ...(turn.resolvedScope
                    ? { resolvedScope: turn.resolvedScope }
                    : {}),
                  ...(turn.retrievalSummary
                    ? { retrievalSummary: turn.retrievalSummary }
                    : {}),
                }));
        const inheritedScope = parsed.temporal_range
          ? undefined
          : inheritConversationScope(queryText, priorTurns);
        const previousAssistantTurn = latestAssistantTurn(priorTurns);
        if (
          isDiagnosticConversationFollowUp(queryText) &&
          previousAssistantTurn
        ) {
          const resolvedScope: ResolvedAskPlutoScope = inheritedScope || {
            kind: 'global',
            meetingIds: [],
            resolvedAt: new Date().toISOString(),
            source: 'inherited',
          };
          return {
            status: 'answered' as const,
            answer: describePreviousConversationFailure(previousAssistantTurn),
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'answered' as const,
            resolvedScope,
            retrievalSummary: previousAssistantTurn.retrievalSummary,
          };
        }
        const globalKnowledgeDoc = db.ensureGlobalKnowledgeDoc();
        const storedCorrections = parseAskPlutoCorrectionRecords(
          db.getKnowledgeCorrections(globalKnowledgeDoc.id),
        );
        const explicitCorrection = detectExplicitAskPlutoCorrection(
          queryText,
          priorTurns,
        );
        if (
          explicitCorrection &&
          !storedCorrections.some(
            (correction) =>
              correction.originalClaim === explicitCorrection.originalClaim &&
              correction.correctedText === explicitCorrection.correctedText,
          )
        ) {
          const targetId = `ask-pluto:${createHash('sha256')
            .update(explicitCorrection.originalClaim)
            .digest('hex')
            .slice(0, 20)}`;
          db.saveKnowledgeCorrection({
            doc_id: globalKnowledgeDoc.id,
            target_kind: 'claim',
            target_id: targetId,
            action: 'correct_claim',
            payload: {
              source: 'ask_pluto',
              original_claim: explicitCorrection.originalClaim,
              corrected_text: explicitCorrection.correctedText,
              meeting_ids: explicitCorrection.meetingIds,
            },
          });
          storedCorrections.unshift(explicitCorrection);
          queueKnowledgeDocRefresh(globalKnowledgeDoc.id);
        }
        const correctionContext = [
          queryText,
          ...priorTurns.map((turn) => turn.content),
        ].join('\n');
        const relevantCorrections = selectRelevantAskPlutoCorrections(
          correctionContext,
          storedCorrections,
        );
        if (
          explicitCorrection &&
          !relevantCorrections.some(
            (correction) =>
              correction.originalClaim === explicitCorrection.originalClaim &&
              correction.correctedText === explicitCorrection.correctedText,
          )
        ) {
          relevantCorrections.unshift(explicitCorrection);
        }
        const activeSnapshot =
          typeof input !== 'string' &&
          activeRecording?.meetingId === input.activeMeetingSnapshot?.meetingId
            ? input.activeMeetingSnapshot
            : undefined;
        const explicitTemporalRange =
          parsed.temporal_range?.from && parsed.temporal_range.to
            ? {
                fromInclusive: parsed.temporal_range.from,
                toExclusive: parsed.temporal_range.to,
                label: parsed.temporal_range.label || 'the selected period',
                timeZone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
              }
            : undefined;
        const temporalRange = explicitMeetingScope
          ? undefined
          : explicitTemporalRange || inheritedScope?.temporalRange;
        const inheritedMeetingIds = inheritedScope?.meetingIds || [];
        const temporalMeetings = temporalRange
          ? inheritedScope?.kind === 'temporal' &&
            !explicitTemporalRange &&
            inheritedMeetingIds.length > 0
            ? inheritedMeetingIds
                .map(
                  (meetingId) =>
                    db.getMeeting(meetingId) as db.PersistedMeeting | undefined,
                )
                .filter((meeting): meeting is db.PersistedMeeting =>
                  Boolean(meeting),
                )
            : (db.getTemporalMeetings({
                from: temporalRange.fromInclusive,
                to: temporalRange.toExclusive,
              }) as db.PersistedMeeting[])
          : [];
        const temporalMeetingLimit = 24;
        const includedTemporalMeetings = temporalMeetings.slice(
          0,
          temporalMeetingLimit,
        );
        const temporalRetrievalSummary: AskPlutoRetrievalSummary | undefined =
          temporalRange
            ? {
                matchedMeetingCount: temporalMeetings.length,
                includedMeetingCount: includedTemporalMeetings.length,
                preparedEvidenceCount: includedTemporalMeetings.filter(
                  (meeting) =>
                    Boolean(
                      meeting.analysis_json ||
                        meeting.enhanced_notes ||
                        meeting.user_notes ||
                        meeting.mid_json,
                    ),
                ).length,
                transcriptOnlyCount: includedTemporalMeetings.filter(
                  (meeting) =>
                    Boolean(meeting.transcript_json) &&
                    !meeting.analysis_json &&
                    !meeting.enhanced_notes &&
                    !meeting.user_notes &&
                    !meeting.mid_json,
                ).length,
                omittedMeetingCount:
                  temporalMeetings.length - includedTemporalMeetings.length,
              }
            : undefined;
        const temporalResolvedScope: ResolvedAskPlutoScope | undefined =
          temporalRange
            ? {
                kind: 'temporal',
                meetingIds: temporalMeetings.map((meeting) =>
                  String(meeting.id),
                ),
                temporalRange,
                resolvedAt: new Date().toISOString(),
                source: explicitTemporalRange ? 'explicit' : 'inherited',
              }
            : undefined;
        const explicitlyScopedMeetings = explicitMeetingScope?.meetings || [];
        const explicitRetrievalSummary: AskPlutoRetrievalSummary | undefined =
          explicitMeetingScope
            ? {
                matchedMeetingCount: explicitlyScopedMeetings.length,
                includedMeetingCount: explicitlyScopedMeetings.length,
                preparedEvidenceCount: explicitlyScopedMeetings.filter(
                  (meeting) =>
                    Boolean(
                      meeting.analysis_json ||
                        meeting.enhanced_notes ||
                        meeting.user_notes ||
                        meeting.mid_json,
                    ),
                ).length,
                transcriptOnlyCount: explicitlyScopedMeetings.filter(
                  (meeting) =>
                    Boolean(meeting.transcript_json) &&
                    !meeting.analysis_json &&
                    !meeting.enhanced_notes &&
                    !meeting.user_notes &&
                    !meeting.mid_json,
                ).length,
                omittedMeetingCount: 0,
              }
            : undefined;
        const explicitResolvedScope: ResolvedAskPlutoScope | undefined =
          explicitMeetingScope
            ? {
                kind: 'meeting_ids',
                meetingIds: explicitlyScopedMeetings.map((meeting) =>
                  String(meeting.id),
                ),
                resolvedAt: new Date().toISOString(),
                source: 'explicit',
              }
            : undefined;
        if (explicitMeetingScope) {
          scopeLabel = explicitMeetingScope.label;
          scopeMeetingCount = explicitlyScopedMeetings.length;
          sendStatus('retrieving');
        }
        if (temporalRange) {
          scopeLabel = temporalRange.label;
          scopeMeetingCount = temporalMeetings.length;
          sendStatus('retrieving');
        }
        if (temporalRange && temporalMeetings.length === 0) {
          return {
            status: 'answered' as const,
            answer: `I couldn't find any meetings from ${temporalRange.label}.`,
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'no_evidence' as const,
            resolvedScope: temporalResolvedScope,
            retrievalSummary: temporalRetrievalSummary,
          };
        }
        if (explicitMeetingScope && explicitlyScopedMeetings.length === 0) {
          return {
            status: 'answered' as const,
            answer: "I couldn't find any recent meetings.",
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'no_evidence' as const,
            resolvedScope: explicitResolvedScope,
            retrievalSummary: explicitRetrievalSummary,
          };
        }
        if (currentMeetingRequested && currentMeeting.kind === 'none') {
          return {
            status: 'unavailable' as const,
            answer:
              "There isn't a current meeting yet. Start or record a meeting, then ask me again.",
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        if (
          currentMeetingRequested &&
          currentMeeting.kind === 'active_recording' &&
          (!activeSnapshot ||
            (!activeSnapshot.notes.trim() &&
              !activeSnapshot.interimText.trim() &&
              activeSnapshot.transcript.length === 0))
        ) {
          return {
            status: 'unavailable' as const,
            answer:
              'The current recording has not produced enough transcript or notes to answer that yet.',
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        if (
          currentMeetingRequested &&
          currentMeeting.kind === 'persisted' &&
          currentMeetingRow &&
          !currentMeetingRow.transcript_json &&
          !currentMeetingRow.analysis_json &&
          !currentMeetingRow.enhanced_notes &&
          !currentMeetingRow.user_notes
        ) {
          return {
            status: 'unavailable' as const,
            answer: `${currentMeetingRow.title || 'The latest meeting'} is still being prepared and does not have usable transcript or notes yet.`,
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        const currentPinnedResult = currentMeetingRequested
          ? currentMeeting.kind === 'active_recording' && activeSnapshot
            ? buildLiveMeetingRetrievalResult(activeSnapshot)
            : currentMeeting.kind === 'persisted' && currentMeetingRow
              ? buildMeetingRetrievalResult(currentMeetingRow)
              : undefined
          : undefined;
        const temporalPinnedResults = includedTemporalMeetings.map((meeting) =>
          buildMeetingRetrievalResult(
            meeting,
            `Meeting from ${temporalRange?.label || 'selected period'}`,
          ),
        );
        const explicitlyScopedPinnedResults = explicitlyScopedMeetings.map(
          (meeting) =>
            buildMeetingRetrievalResult(
              meeting,
              explicitMeetingScope?.kind === 'recent'
                ? 'Recent meeting'
                : 'Named meeting',
            ),
        );
        const priorMeetingIds = [
          ...new Set([
            ...(inheritedScope?.meetingIds || []),
            ...(queryReferencesPriorTurn(queryText)
              ? priorTurns
                  .filter((turn) => turn.role === 'assistant')
                  .flatMap((turn) => turn.meetingIds || [])
              : []),
          ]),
        ];
        const priorPinnedResults =
          priorMeetingIds.length > 0
            ? [...priorMeetingIds]
                .map(
                  (meetingId) =>
                    db.getMeeting(meetingId) as db.PersistedMeeting | undefined,
                )
                .filter((meeting): meeting is db.PersistedMeeting =>
                  Boolean(meeting),
                )
                .map((meeting) =>
                  buildMeetingRetrievalResult(meeting, 'Prior cited meeting'),
                )
            : [];
        const historicalCandidateLimit = currentMeetingRequested
          ? getCrossMeetingCandidateLimit(queryText, parsed.intent)
          : 0;
        const historicalPinnedResults = persistedMeetings
          .filter((meeting) => String(meeting.id) !== currentMeeting.meetingId)
          .slice(0, historicalCandidateLimit)
          .map((meeting) =>
            buildMeetingRetrievalResult(meeting, 'Earlier meeting'),
          );
        comparisonMeetingCount = historicalPinnedResults.length;
        const pinnedResults = mergeRetrievalResultsByMeeting(
          currentPinnedResult ? [currentPinnedResult] : [],
          temporalPinnedResults,
          explicitlyScopedPinnedResults,
          historicalPinnedResults,
          priorPinnedResults,
        );
        retrievalStartedAt = Date.now();
        const restrictToCurrentMeeting = shouldRestrictToCurrentMeetingEvidence(
          {
            currentMeetingRequested,
            historicalCandidateLimit,
            priorPinnedCount: priorPinnedResults.length,
          },
        );
        const restrictToPriorConversation =
          shouldRestrictToPriorConversationEvidence({
            currentMeetingRequested,
            intent: parsed.intent,
            priorPinnedCount: priorPinnedResults.length,
          });
        const restrictToPinnedCurrentComparison =
          shouldRestrictToPinnedCurrentComparison({
            currentMeetingRequested,
            historicalCandidateLimit,
          });
        const context = explicitResolvedScope
          ? explicitlyScopedPinnedResults
          : temporalResolvedScope
            ? pinnedResults
            : restrictToCurrentMeeting && currentPinnedResult
              ? [currentPinnedResult]
              : restrictToPinnedCurrentComparison
                ? pinnedResults
                : restrictToPriorConversation
                  ? priorPinnedResults
                  : await retrieveContext(parsed, { pinnedResults });
        retrievalCompletedAt = Date.now();
        controller.signal.throwIfAborted();

        const resolvedScope: ResolvedAskPlutoScope =
          explicitResolvedScope ||
          temporalResolvedScope ||
          (currentMeetingRequested && currentMeeting.meetingId
            ? {
                kind: 'current',
                meetingIds: [currentMeeting.meetingId],
                resolvedAt: new Date().toISOString(),
                source: 'explicit',
              }
            : inheritedScope || {
                kind: context.length > 0 ? 'meeting_ids' : 'global',
                meetingIds: context.map((result) => result.meeting_id),
                resolvedAt: new Date().toISOString(),
                source: 'explicit',
              });
        const retrievalSummary: AskPlutoRetrievalSummary =
          explicitRetrievalSummary ||
            temporalRetrievalSummary || {
              matchedMeetingCount: context.length,
              includedMeetingCount: context.length,
              preparedEvidenceCount: context.length,
              transcriptOnlyCount: 0,
              omittedMeetingCount: 0,
            };
        if (context.length === 0) {
          return {
            status: 'answered' as const,
            answer: "I couldn't find information about that in your meetings.",
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'no_evidence' as const,
            resolvedScope,
            retrievalSummary,
          };
        }

        console.log(
          `[Pluto] Retrieval complete (${Date.now() - startTime}ms), context items: ${context.length}`,
        );

        sendStatus('generating');
        const validatedAnswerStream = createValidatedAnswerStream(
          context,
          (delta) => {
            if (controller.signal.aborted || event.sender.isDestroyed()) return;
            firstTokenAt ??= Date.now();
            event.sender.send('intelligence:query:delta', {
              requestId,
              delta,
            });
          },
        );
        const extractiveAnswer = buildExtractiveTemporalSummary(
          queryText,
          context,
        );
        let answerRaw: string;
        if (
          extractiveAnswer &&
          shouldUsePreparedExtractiveAnswer({
            mode: reasoningMode,
            contextCount: context.length,
          })
        ) {
          answerRaw = extractiveAnswer;
          validatedAnswerStream.push(answerRaw);
        } else {
          const settings = await getAllSettings(db);
          const provider = await getProvider(settings);
          const prompt = getAskPlutoPrompt(
            queryText,
            context,
            parsed.intent,
            shouldIncludePriorConversation(
              queryText,
              Boolean(explicitMeetingScope),
            )
              ? priorTurns
              : [],
            formatAskPlutoCorrectionsForPrompt(relevantCorrections),
          );
          console.log(
            `[Pluto] Generating answer via provider: ${provider.name} ...`,
          );
          providerRequestedAt = Date.now();
          answerRaw = await provider.answerAskPluto(prompt, {
            signal: controller.signal,
            mode: reasoningMode,
            onStart: () => {
              providerStartedAt ??= Date.now();
            },
            onToken: (delta) => {
              if (controller.signal.aborted) return;
              validatedAnswerStream.push(delta);
            },
          });
        }
        generationCompletedAt = Date.now();

        const presentation = validatedAnswerStream.finalize(answerRaw);
        const coverageLimited = retrievalSummary.omittedMeetingCount > 0;
        const answer = coverageLimited
          ? `I found ${retrievalSummary.matchedMeetingCount} meetings, but this answer covers ${retrievalSummary.includedMeetingCount}. Narrow the time period for complete coverage.\n\n${presentation.answer}`
          : presentation.answer;

        console.log(
          `[Pluto] Query complete. Total duration: ${Date.now() - startTime}ms`,
        );

        return {
          status: 'answered' as const,
          answer,
          citations: presentation.citations,
          currentMeeting: currentMeetingStatus,
          outcome: coverageLimited
            ? ('partial' as const)
            : presentation.outcome,
          resolvedScope,
          retrievalSummary,
          trustStatus: presentation.trustStatus,
          unsupportedClaimCount: presentation.unsupportedClaimCount,
        };
      })();
      const settled = generation.then(
        () => undefined,
        () => undefined,
      );
      activeAskPlutoQueries.set(requestId, { controller, settled });

      try {
        const response = await generation;
        if (response.status === 'answered') {
          sendStatus('citations_ready');
          sendStatus('completed');
        } else if (response.status === 'unavailable') {
          sendStatus('unavailable');
        }
        return response;
      } catch (error) {
        if (controller.signal.aborted) {
          console.log(
            `[Pluto] intelligence:query cancelled after ${Date.now() - startTime}ms [request_id=${requestId}]`,
          );
          sendStatus('cancelled');
          return {
            status: 'cancelled' as const,
            answer: '',
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' ||
            /timed?\s*out|operation was aborted/i.test(error.message));
        console.error(
          `[Pluto] intelligence:query failed after ${Date.now() - startTime}ms:`,
          error,
        );
        sendStatus('failed');
        return {
          status: 'unavailable' as const,
          answer: timedOut
            ? 'Local analysis took too long. Your question is still here, so you can retry or use Fast mode.'
            : "Pluto couldn't reach the configured answer model. Your meeting evidence is unchanged, and you can retry when the model is available.",
          citations: [],
          currentMeeting: currentMeetingStatus,
          failureReason: timedOut
            ? ('timeout' as const)
            : ('provider_unavailable' as const),
        };
      } finally {
        const finishedAt = Date.now();
        console.log(
          '[Pluto] intelligence:query timings',
          JSON.stringify({
            request_id: requestId,
            queue_ms:
              providerRequestedAt && providerStartedAt
                ? providerStartedAt - providerRequestedAt
                : null,
            retrieval_ms:
              retrievalStartedAt && retrievalCompletedAt
                ? retrievalCompletedAt - retrievalStartedAt
                : null,
            first_token_ms: firstTokenAt ? firstTokenAt - startTime : null,
            generation_ms:
              providerStartedAt && generationCompletedAt
                ? generationCompletedAt - providerStartedAt
                : null,
            total_ms: finishedAt - startTime,
          }),
        );
        if (activeAskPlutoQueries.get(requestId)?.controller === controller) {
          activeAskPlutoQueries.delete(requestId);
        }
      }
    },
  );

  ipcMain.handle('intelligence:query:cancel', async (_event, requestId) => {
    if (typeof requestId !== 'string') return { cancelled: false };
    const active = activeAskPlutoQueries.get(requestId);
    if (!active) return { cancelled: false };
    const cancellationStartedAt = Date.now();
    active.controller.abort(
      new DOMException('Ask Pluto request cancelled', 'AbortError'),
    );
    await active.settled;
    console.log(
      `[Pluto] intelligence:query cancellation settled in ${Date.now() - cancellationStartedAt}ms [request_id=${requestId}]`,
    );
    return { cancelled: true };
  });

  ipcMain.handle(
    'intelligence:meeting-chat',
    async (event, rawRequest: unknown) => {
      const startTime = Date.now();
      const parsedRequest = parseMeetingAskPlutoRequest(rawRequest);
      if (!parsedRequest.ok) {
        console.warn('[Pluto][Ask Pluto][main] invalid request', {
          reason: parsedRequest.reason,
          receivedAt: new Date(startTime).toISOString(),
        });
        return {
          status: 'unavailable' as const,
          answer: '',
          scope: {
            type: 'meeting' as const,
            meetingId: '',
          },
          trustStatus: 'needs_review' as const,
          claims: [],
          citations: [],
          rationale: 'The meeting question request was invalid.',
        };
      }
      const request = parsedRequest.request;
      const query = request.query.trim();
      const requestId = request.requestId;

      if (
        request.scope.type === 'live_meeting' &&
        !captureSessionLease.recordingForOwner(event.sender.id)
      ) {
        console.warn('[Pluto][Ask Pluto][main] rejected unowned live request', {
          requestId,
          senderId: event.sender.id,
        });
        return {
          status: 'unavailable' as const,
          answer: '',
          scope: {
            type: 'live_meeting' as const,
            meetingId: '',
            title: request.scope.title,
          },
          trustStatus: 'needs_review' as const,
          claims: [],
          citations: [],
          rationale: 'The live recording is no longer active for this window.',
        };
      }

      const replacedRequests: Promise<void>[] = [];
      for (const active of activeMeetingAskPlutoQueries.values()) {
        if (active.ownerId === event.sender.id) {
          active.controller.abort(
            new DOMException('Meeting chat request replaced', 'AbortError'),
          );
          replacedRequests.push(active.settled);
        }
      }
      await Promise.all(replacedRequests);
      const controller = new AbortController();
      let markSettled: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        markSettled = resolve;
      });
      const activeRequestKey = `${event.sender.id}:${requestId}`;
      activeMeetingAskPlutoQueries.set(activeRequestKey, {
        controller,
        ownerId: event.sender.id,
        settled,
      });
      const abortForDestroyedOwner = () =>
        controller.abort(
          new DOMException('Meeting chat owner destroyed', 'AbortError'),
        );
      event.sender.once('destroyed', abortForDestroyedOwner);

      console.info('[Pluto][Ask Pluto][main] received', {
        ...describeMeetingAskPlutoRequest({ ...request, requestId }),
        receivedAt: new Date(startTime).toISOString(),
      });

      try {
        const context =
          request.scope.type === 'live_meeting'
            ? buildLiveMeetingAskPlutoContext(request.scope)
            : (() => {
                const meetingId = request.scope.meetingId.trim();
                const meeting = db.getMeeting(meetingId) as
                  | db.PersistedMeeting
                  | undefined;
                if (!meeting) {
                  throw new Error(`Meeting ${meetingId} was not found`);
                }

                const entities = db.getMeetingEntities(meetingId);
                const attentionItems = db.listAttentionItems({
                  meetingId,
                  status: ['active', 'snoozed'],
                  limit: 6,
                });
                return buildMeetingAskPlutoContext({
                  meeting,
                  entities,
                  attentionItems,
                });
              })();

        console.info('[Pluto][Ask Pluto][main] context-ready', {
          requestId,
          status: context.status,
          trustStatus: context.trustStatus,
          evidenceItems: context.evidenceItems.length,
          elapsedMs: Date.now() - startTime,
        });

        if (context.status === 'unavailable') {
          return buildUnavailableMeetingAskPlutoResponse(
            {
              id: context.scope.meetingId,
              title: context.scope.title || 'Meeting',
            },
            query,
          );
        }

        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        const turns = normalizeMeetingAskPlutoTurns(request.turns);
        const assistanceRoute = routeMeetingAskPlutoAssistance(query);
        const prompt = buildMeetingAskPlutoPrompt({
          query,
          context,
          turns,
          assistanceRoute,
        });
        console.info('[Pluto][Ask Pluto][main] provider-request', {
          requestId,
          assistanceRoute,
          provider: settings.llm_provider,
          configuredModel:
            settings.llm_model ||
            (settings.llm_provider === 'ollama'
              ? settings.ollama_model
              : settings.llm_provider === 'gemini'
                ? settings.gemini_model
                : settings.llm_provider === 'openai'
                  ? settings.openai_model
                  : settings.claude_model) ||
            'default',
          promptChars: prompt.length,
          elapsedMs: Date.now() - startTime,
        });
        let answerRaw = '';
        const visibleStream = createMeetingAskPlutoVisibleStream((delta) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('intelligence:meeting-chat:delta', {
            requestId,
            delta,
          });
        });
        try {
          answerRaw = await provider.answerAskPluto(prompt, {
            signal: controller.signal,
            live: context.scope.type === 'live_meeting',
            onToken: (delta) => visibleStream.push(delta),
          });
        } catch (providerError) {
          if (controller.signal.aborted) throw providerError;
          console.warn(
            `[Pluto][Ask Pluto][main] provider unavailable (${requestId}) after ${Date.now() - startTime}ms:`,
            providerError,
          );
          const liveFallback = buildLiveMeetingFallbackResponse({ context });
          if (liveFallback) {
            console.info('[Pluto][Ask Pluto][main] live-snapshot-fallback', {
              requestId,
              citationCount: liveFallback.citations.length,
              elapsedMs: Date.now() - startTime,
            });
            return liveFallback;
          }
          return buildMeetingAskPlutoProviderUnavailableResponse({
            scope: context.scope,
            query,
            error: providerError,
          });
        } finally {
          visibleStream.flush();
        }

        console.info('[Pluto][Ask Pluto][main] provider-response', {
          requestId,
          answerChars: answerRaw.length,
          elapsedMs: Date.now() - startTime,
        });

        return buildMeetingAskPlutoResponseFromAnswer({
          answerRaw,
          context,
        });
      } catch (e) {
        if (controller.signal.aborted) {
          return {
            status: 'unavailable' as const,
            answer: '',
            scope:
              request.scope.type === 'live_meeting'
                ? {
                    type: 'live_meeting' as const,
                    meetingId: '',
                    title: request.scope.title,
                  }
                : {
                    type: 'meeting' as const,
                    meetingId: request.scope.meetingId,
                  },
            trustStatus: 'needs_review' as const,
            claims: [],
            citations: [],
            rationale: 'The meeting question was cancelled.',
          };
        }
        console.error(
          `[Pluto][Ask Pluto][main] failed (${requestId}) after ${Date.now() - startTime}ms:`,
          e,
        );
        throw e;
      } finally {
        event.sender.removeListener('destroyed', abortForDestroyedOwner);
        if (
          activeMeetingAskPlutoQueries.get(activeRequestKey)?.controller ===
          controller
        ) {
          activeMeetingAskPlutoQueries.delete(activeRequestKey);
        }
        markSettled();
      }
    },
  );

  ipcMain.handle(
    'intelligence:meeting-chat:cancel',
    async (event, requestId: unknown) => {
      if (typeof requestId !== 'string') return { cancelled: false };
      const active = activeMeetingAskPlutoQueries.get(
        `${event.sender.id}:${requestId}`,
      );
      if (!active) {
        return { cancelled: false };
      }
      active.controller.abort(
        new DOMException('Meeting chat request cancelled', 'AbortError'),
      );
      await active.settled;
      return { cancelled: true };
    },
  );

  ipcMain.handle(
    'intelligence:query:debug',
    async (_event, queryText: string) => {
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
    },
  );

  ipcMain.handle('intelligence:suggested-queries', async () => {
    try {
      return generateSuggestedQueries();
    } catch (e) {
      console.error('[Pluto] intelligence:suggested-queries failed:', e);
      return [];
    }
  });

  // =============================================
  // PROACTIVE INTELLIGENCE HANDLERS (Phase 4)
  // =============================================

  ipcMain.handle(
    'intelligence:alerts',
    (_event, options?: { meetingId?: string; limit?: number }) => {
      return getAlerts(options);
    },
  );

  ipcMain.handle('intelligence:alerts:clear', (_event, meetingId: string) => {
    clearAlertsForMeeting(meetingId);
    return true;
  });

  ipcMain.handle(
    'intelligence:alerts:update-status',
    (_event, id: string, status: AttentionItemStatus) => {
      return updateAlertStatus(id, status);
    },
  );

  // Permissions handlers
  ipcMain.handle('CHECK_MICROPHONE_PERMISSION', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted'; // Assume granted on other platforms if app is running
  });

  ipcMain.handle('REQUEST_MICROPHONE_PERMISSION', async () => {
    if (process.platform !== 'darwin') return true;
    return await systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('CHECK_SYSTEM_AUDIO_PERMISSION', () => {
    if (process.platform !== 'darwin') return 'granted';
    return systemPreferences.getMediaAccessStatus('screen');
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

  const interruptedDownstreamRuns = db.expireInterruptedDownstreamProcessing();
  if (interruptedDownstreamRuns > 0) {
    console.log(
      `[Pluto] Released ${interruptedDownstreamRuns} interrupted downstream processing lease(s)`,
    );
  }
  const interruptedFinalTranscriptions =
    db.expireInterruptedFinalTranscription();
  if (interruptedFinalTranscriptions > 0) {
    console.log(
      `[Pluto] Released ${interruptedFinalTranscriptions} interrupted final transcription lease(s)`,
    );
  }
  initializeKnowledgeDocs().catch((error) => {
    console.error(
      '[KnowledgeDoc] Failed to initialize synthesis pipeline:',
      error,
    );
  });
  createWindow();
  await prepareFinalTranscriptionBeforeRecovery({
    shouldPrepare: db.getSetting('setup_complete') === 'true',
    prepare: async () => {
      if (!parakeetFinalClient) throw new Error('parakeet_runtime_unavailable');
      await parakeetFinalClient.prepare();
    },
    recover: async () => undefined,
  });

  try {
    syncActionTrackerAttentionQueue();
  } catch (error) {
    console.warn(
      '[AttentionSync] Failed to bootstrap action-tracker signals:',
      error,
    );
  }

  try {
    const recovery = await recoverInterruptedCaptureJournals(
      getMeetingArtifactsRootDir(),
      {
        getMeeting: (meetingId) =>
          (db.getMeeting(meetingId) as db.PersistedMeeting | null) ?? null,
        saveMeeting: (meeting) => db.saveMeeting(meeting),
        stitchWavSegments: async (segments, outputTag) =>
          await stitchWavSegments({ segments, outputTag }),
        repairRawChunk: async (inputPath) => {
          const outputPath = path.join(
            app.getPath('temp'),
            `capture-repair-${randomUUID()}.wav`,
          );
          const converted = await new Promise<boolean>((resolve) => {
            ffmpeg(inputPath)
              .audioChannels(1)
              .audioFrequency(16000)
              .toFormat('wav')
              .on('end', () => resolve(true))
              .on('error', () => resolve(false))
              .save(outputPath);
          });
          if (!converted || !fs.existsSync(outputPath)) {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            return null;
          }
          try {
            return fs.readFileSync(outputPath);
          } finally {
            fs.unlinkSync(outputPath);
          }
        },
        transcribeChunk: async (inputPath, _config, journalDurationSeconds) => {
          if (!parakeetFinalClient) {
            throw new Error('parakeet_runtime_unavailable');
          }
          const recoveryFinalClient = parakeetFinalClient;
          const result = await transcribeJournalAlignedAudio(
            inputPath,
            journalDurationSeconds,
            {
              probeDuration: probeAudioDuration,
              createTemporaryPath: () =>
                path.join(
                  getMeetingArtifactsRootDir(),
                  `capture-transcript-${randomUUID()}.wav`,
                ),
              trimLeadingOverflow: async ({
                inputPath: trimInputPath,
                outputPath,
                startSec,
                durationSec,
              }) =>
                await new Promise<boolean>((resolve) => {
                  ffmpeg(trimInputPath)
                    .seekInput(startSec)
                    .duration(durationSec)
                    .audioChannels(1)
                    .audioFrequency(16000)
                    .toFormat('wav')
                    .on('end', () => resolve(true))
                    .on('error', () => resolve(false))
                    .save(outputPath);
                }),
              removeTemporaryFile: (temporaryPath) => {
                if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
              },
            },
            async (alignedPath) =>
              await recoveryFinalClient.transcribe({
                meetingId: 'capture-journal-recovery',
                role: 'final_validation',
                source: 'mix',
                audioPath: alignedPath,
                language: 'en',
              }),
          );
          return {
            detectedLanguage: result.language ?? null,
            providerLabel: 'Parakeet (FluidAudio)',
            segments: Array.isArray(result.segments)
              ? normalizeCheckpointWords(
                  result.segments.map((segment) => ({
                    start: segment.start,
                    end: segment.end,
                    text: segment.text,
                    ...(segment.words ? { words: segment.words } : {}),
                  })),
                  journalDurationSeconds,
                )
              : [],
          };
        },
        transcriptionConfig: {
          backend: 'parakeet',
          preset: 'balanced',
          model: 'parakeet-tdt-0.6b-v3',
          device: 'coreml',
          computeType: 'float16',
          languageMode: 'fixed',
          requestedLanguage: 'en',
          pipelineVersion: 'live_chunk_v1',
        },
      },
    );
    if (
      recovery.recoveredCount > 0 ||
      recovery.failedRecoveryCount > 0 ||
      recovery.skippedInvalidManifestCount > 0
    ) {
      console.log('[Pluto] Capture-journal recovery summary:', recovery);
    }
  } catch (error) {
    console.warn(
      '[Pluto] Failed to recover interrupted capture journals:',
      error,
    );
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
});
