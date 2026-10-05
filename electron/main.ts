import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  type WebContents,
  app,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell,
  systemPreferences,
} from 'electron';
import { assertFeatureEnabled } from '../src/config/featureFlags';
import { parseMacMemoryPressureFreePercent } from '../src/services/finalTranscription/finalTranscriptionAdmission';
import type { ScopedMeetingCapability } from '../src/services/transcription/contracts';
import type {
  AskPlutoConversationTurn,
  AskPlutoCurrentMeeting,
  AskPlutoPerformanceDiagnostics,
  AskPlutoQueryRequest,
  AskPlutoQueryStatus,
  AskPlutoRetrievalSummary,
  ResolvedAskPlutoScope,
} from '../src/types/askPlutoQuery';
import type {
  PersonChatResponse,
  PersonChatSendRequest,
} from '../src/types/personChat';
import type {
  WorkspaceChatMemory,
  WorkspaceChatMessagePayload,
} from '../src/types/workspaceChat';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../src/utils/ollamaModels';
import { readProjectDisplayTitle } from '../src/utils/projectBriefing';
import { parseTranscriptSegments } from '../src/utils/transcript';
import { createActiveCallDetector } from './activeCall/detector';
import {
  AUDIO_STORAGE_BUDGET_SETTING,
  createAudioRetentionManager,
  parseAudioStorageBudgetGb,
} from './audioRetention';
import {
  CalendarHelperClient,
  resolveCalendarHelperPath,
} from './calendar/client';
import { createCalendarService } from './calendar/service';
import { createCaptureDiagnostics } from './captureDiagnostics';
import {
  appendCaptureJournalChunk,
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  deleteCaptureJournal,
  markCaptureJournalSourceFailed,
  persistCaptureJournalRawChunk,
  promoteCaptureTranscriptCheckpoint,
  readCaptureJournalManifest,
  sealCaptureJournal,
  setCaptureJournalAudioKeyProvider,
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
import { getAudioKeyStore } from './crypto/audioKeyStore';
import {
  mixEncryptedAudioArtifacts,
  probeEncryptedAudioDuration,
  sliceEncryptedAudio,
} from './crypto/encryptedAudioPipeline';
import {
  closeApplicationDatabase,
  getApplicationDatabase,
} from './database/applicationDatabase';
import { syncMeetingActionEntitiesFromUserEdits } from './database/meetingActionSync';
import { createBeforeQuitHandler } from './database/shutdown';
import {
  AUDIO_RETENTION_ENFORCEMENT_ENV,
  ENCRYPTION_ROLLOUT_ENV,
  HISTORICAL_AUDIO_MIGRATION_ENV,
  probeSignedMacBuild,
  resolveEncryptionRolloutPolicy,
} from './encryptionRollout';
import { runFfmpeg } from './ffmpegRunner';
import { createHistoricalAudioMigrationManager } from './historicalAudioMigration';
import {
  type IncrementalMeetingNotesOffer,
  createIncrementalMeetingNotesCoordinator,
  evaluateIncrementalMeetingNotesAdmission,
} from './incrementalMeetingNotesCoordinator';
import { shouldUsePersonFocusedEvidence } from './intelligence/askPlutoPersonScope';
import {
  balanceProjectNoteContexts,
  combineProjectFacetContext,
  findExplicitProjectScopes,
  getProjectFacetKeywords,
  restrictEvidenceToMeetingIds,
} from './intelligence/askPlutoProjectScopes';
import type { AttentionItemStatus } from './intelligence/intelligenceTypes';
import { buildMeetingNotesEvidenceDocument } from './intelligence/meetingNotesEvidence';
import {
  createLocalArtifactRecord,
  extractArtifactContent,
} from './localArtifacts';
import { createLogger } from './logger';
import {
  buildMacApplicationMenuTemplate,
  updateResultDialog,
} from './macAppMenu';
import { installInChatGptDesktop } from './mcp/chatgptDesktop';
import {
  PLUTO_MCP_ENABLED_SETTING,
  PLUTO_MCP_SETUP_URL,
  createPlutoMcpConnection,
} from './mcp/connection';
import { installPlutoLocalPlugin } from './mcp/localPlugin';
import { createPlutoMcpDataSource } from './mcp/meetingTools';
import {
  buildMeetingPrepBrief,
  refreshMeetingPrepBrief,
} from './meetingPrepBrief';
import {
  canReuseRunningCaptureForProbe,
  waitForNativeAudioPcm,
} from './nativeAudioCapture';
import { createNativeSettingsNavigation } from './nativeSettingsNavigation';
import { resolveUnpackedExecutablePath } from './packagedExecutablePath';
import { createPostMeetingBackgroundActivity } from './postMeetingBackgroundActivity';
import { validatePreMeetingBriefRequest } from './preMeetingBrief';
import { buildPreMeetingBrief } from './preMeetingBrief';
import { synthesizePreMeetingBrief } from './preMeetingBriefSynthesis';
import {
  type ProjectRoutingState,
  routeProjectCandidate,
} from './projectRouting';
import {
  isProjectScopeReviewBusy,
  reviewProjectScopeBatch,
} from './projectScopeReview';
import { collectProjectSynthesisSources } from './projectSynthesisSources';
import {
  type ProjectThemeSource,
  type ProjectThemeSynthesisState,
  synthesizeProjectThemes,
} from './projectThemeSynthesis';
import {
  normalizeCheckpointWords,
  transcribeJournalAlignedAudio,
} from './recoveryTranscriptionAudio';
import {
  buildSaveMeetingFailureDiagnostic,
  saveMeetingWithParticipantSideEffects,
} from './saveMeetingIpc';
import {
  getSpeakerSampleAvailability,
  loadSpeakerSample,
} from './speakerSample';
import { stitchTimedWavSegments } from './timedWavStitch';
import { prepareFinalTranscriptionBeforeRecovery } from './transcription/finalTranscriptionStartup';
import { readLiveJournalAudio } from './transcription/liveJournalAudio';
import { ParakeetEouClient } from './transcription/parakeetEouClient';
import { ParakeetEouMeetingCoordinator } from './transcription/parakeetEouMeetingCoordinator';
import { ParakeetFinalClient } from './transcription/parakeetFinalClient';
import {
  type ParakeetRuntimeHost,
  makeRuntimeHost,
} from './transcription/parakeetRuntimeHost';
import { UpdateChecker } from './updateChecker';
import { startVoiceCandidateBackfill } from './voiceCandidateBackfill';
import { canRunVoiceWork, createVoiceWorkQueue } from './voiceWorkQueue';
import { createActiveCallAlertController } from './windows/activeCallAlertWindow';

const plutoLog = createLogger('Pluto');
const captureLog = createLogger('Capture');
const audioCapLog = createLogger('AudioCap');
const llmLog = createLogger('LLM');

const ffprobePath = resolveUnpackedExecutablePath(ffprobeStatic.path);

const convertAudioToMonoWav = async (input: {
  inputPath: string;
  outputPath: string;
  startSec?: number;
  durationSec?: number;
  rawPcm?: boolean;
}): Promise<boolean> => {
  try {
    await runFfmpeg([
      ...(input.rawPcm ? ['-f', 's16le', '-ar', '16000', '-ac', '1'] : []),
      ...(input.startSec === undefined ? [] : ['-ss', String(input.startSec)]),
      '-i',
      input.inputPath,
      ...(input.durationSec === undefined
        ? []
        : ['-t', String(input.durationSec)]),
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      input.outputPath,
    ]);
    return true;
  } catch {
    return false;
  }
};

const probeAudioDuration = async (inputPath: string) =>
  await new Promise<number | null>((resolve) => {
    const probe = spawn(ffprobePath, [
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
let updateChecker: UpdateChecker | null = null;
let checkingFromMenu = false;
let isCaptureActive = () => false;
const settingsMenuNavigation = createNativeSettingsNavigation({
  getWindow: () => win,
  createWindow: () => createWindow(),
  focusWindow: () => focusPrimaryWindow(),
});

ipcMain.on('PLUTO_NATIVE_MENU_RENDERER_READY', (event) => {
  settingsMenuNavigation.ready(event.sender);
});

const openSettingsFromMenu = (): void => {
  settingsMenuNavigation.open();
};

const checkForUpdatesFromMenu = async (): Promise<void> => {
  if (checkingFromMenu || !updateChecker) return;
  checkingFromMenu = true;
  try {
    const status = await updateChecker.checkForUpdates();
    const options = updateResultDialog(status);
    const owner = win && !win.isDestroyed() ? win : null;
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (status.hasUpdate && result.response === 0) {
      await updateChecker.applyUpdate();
    }
  } catch (error) {
    plutoLog.warn('Native update check failed:', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Pluto Update Check',
      message: 'Pluto could not check for updates.',
      buttons: ['OK'],
    });
  } finally {
    checkingFromMenu = false;
  }
};

const installMacApplicationMenu = (): void => {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMacApplicationMenuTemplate({
        openSettings: openSettingsFromMenu,
        checkForUpdates: () => void checkForUpdatesFromMenu(),
      }),
    ),
  );
};

export const focusPrimaryWindow = (): void => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};
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
  const createdWindow = win;
  settingsMenuNavigation.loading(createdWindow.webContents);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    postMeetingBackgroundActivity.reset();
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });
  win.webContents.on('did-start-loading', () => {
    settingsMenuNavigation.loading(createdWindow.webContents);
  });
  win.webContents.on('will-prevent-unload', () => {
    captureLog.warn('Navigation prevented: capture_active');
  });
  win.webContents.on('before-input-event', notifyRendererActivity);
  win.on('focus', notifyForegroundActivity);
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

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      console.warn(
        `[Pluto] Main frame navigation failed: ${errorDescription} (${errorCode}) at ${validatedURL}`,
      );
      if (VITE_DEV_SERVER_URL && validatedURL.startsWith(VITE_DEV_SERVER_URL)) {
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            console.info(
              `[Pluto] Retrying navigation to ${VITE_DEV_SERVER_URL}...`,
            );
            win.loadURL(VITE_DEV_SERVER_URL).catch((err) => {
              console.error('[Pluto] Retry loadURL failed:', err);
            });
          }
        }, 1000);
      }
    },
  );

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL).catch((err) => {
      console.warn('[Pluto] Initial loadURL failed:', err);
    });
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  if (!updateChecker) {
    updateChecker = new UpdateChecker(() => win, () => !isCaptureActive());
    updateChecker.start();
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
import { applyMeetingNotesUserEdit } from '../src/utils/meetingNotesEditRebase';
import { selectTranscriptionVocabulary } from '../src/utils/transcriptionVocabulary';
// Module imports
import { handleActionCommitmentReview } from './actionCommitmentReviewIpc';
import {
  BACKGROUND_KNOWLEDGE_QUIET_MS,
  type BackgroundKnowledgeRefreshCoordinator,
  createBackgroundKnowledgeRefreshCoordinator,
} from './backgroundKnowledgeRefresh';
import { handleAudioCaptureJournalStart } from './captureJournalStart';
import { resolveDatabaseStorageMode } from './database/storageSetup';
import * as db from './db';
import {
  type DirtyEntityQueue,
  invalidateDreamingWork,
} from './dreaming/entityQueue';
import {
  DREAMING_ENTITY_DEADLINE_MS,
  DREAMING_RENDERER_QUIET_MS,
  type IdleDreamingResult,
  createDirtyEntityQueue,
  createIdleDreamingCoordinator,
  generateDreamingWithProvider,
} from './dreaming/idleDreamingCoordinator';
import { packageEntityNotes } from './dreaming/packageEntityNotes';
import { DREAMING_MODEL } from './dreaming/prompt';
import {
  assertScopedPendingProposal,
  parseDreamingProposalScope,
} from './dreaming/proposalIpc';
import type {
  DreamingDecisionResult,
  DreamingProposalRecord,
} from './dreaming/proposalStore';
import type { DreamingEntityType } from './dreaming/types';
import {
  extractAndProcessEntities,
  processExtractedEntities,
} from './entityPipeline';
import { IDENTITY_CHANNELS, handleIdentityRequest } from './identityHandlers';
import { startIdentityReconciliation } from './identityReconciliation';
import {
  ensureAskPlutoAttributionAnswer,
  removeRepeatedAskPlutoClaims,
} from './intelligence/askPlutoAnswerText';
import {
  asksForExplicitAttribution,
  asksToVerifyProjectAssociation,
  describePreviousConversationFailure,
  detectAttributionDispute,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
  latestAssistantTurn,
  resolveAskPlutoConversation,
} from './intelligence/askPlutoConversation';
import {
  detectExplicitAskPlutoCorrection,
  formatAskPlutoCorrectionsForPrompt,
  parseAskPlutoCorrectionRecords,
  selectRelevantAskPlutoCorrections,
} from './intelligence/askPlutoCorrections';
import {
  askPlutoTimeoutMs,
  runAskPlutoWithDeadline,
} from './intelligence/askPlutoDeadline';
import { classifyAskPlutoFailure } from './intelligence/askPlutoFailures';
import {
  clearAskPlutoOmissions,
  describeUnverifiedAskPlutoOmissions,
  getAskPlutoOmissionReview,
  rememberAskPlutoOmissions,
  selectAdditionalSupportedClaims,
  selectAskPlutoOmissionContext,
  uniqueAskPlutoEvidenceMeetings,
} from './intelligence/askPlutoOmissionReview';
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
import {
  addressConfirmedSelf,
  resolveAskPlutoSelfReference,
} from './intelligence/askPlutoSelf';
import { syncActionTrackerAttentionQueue } from './intelligence/attentionSync';
import {
  type SafeAnswerPresentation,
  createSynthesizedAnswerStream,
  createValidatedAnswerStream,
} from './intelligence/citationEngine';
import {
  type ConversationRetrievalPolicy,
  type ConversationTurnMode,
  buildConversationBoundaryReply,
  buildConversationalReplyPrompt,
  buildNamedPersonNoEvidenceReply,
  buildNoEvidenceDraftReply,
  buildSocialReply,
  isExplicitInformationRequest,
  parseConversationActionProposal,
} from './intelligence/conversationController';
import {
  queryReferencesCurrentMeeting,
  resolveCurrentMeeting,
  resolvePersistedMeetingEvidenceState,
} from './intelligence/currentMeetingResolver';
import { completeLiveMeetingChatAnswer } from './intelligence/liveMeetingChatAnswer';
import { createLiveMeetingContextCoordinator } from './intelligence/liveMeetingContextCoordinator';
import {
  buildAmbiguousMeetingAskPlutoResponse,
  buildLiveMeetingAskPlutoContext,
  buildMeetingAskPlutoContext,
  buildMeetingAskPlutoPrompt,
  buildMeetingAskPlutoProviderUnavailableResponse,
  buildMeetingAskPlutoResponseFromAnswer,
  buildPreparedMeetingAskPlutoResponse,
  buildUnavailableMeetingAskPlutoResponse,
  normalizeMeetingAskPlutoTurns,
  withMeetingPrepContext,
} from './intelligence/meetingAskPluto';
import { routeMeetingAskPlutoAssistance } from './intelligence/meetingAskPlutoAssistance';
import { resolveMeetingAskPlutoConversation } from './intelligence/meetingAskPlutoConversation';
import { createMeetingAskPlutoVisibleStream } from './intelligence/meetingAskPlutoStream';
import { createMeetingContextProducer } from './intelligence/meetingContextProducer';
import { generateMid } from './intelligence/midGenerator';
import { renderMidToMarkdown } from './intelligence/midRenderer';
import {
  buildPersonChatContext,
  buildPersonChatPrompt,
  getPersonChatQuickReply,
} from './intelligence/personChat';
import {
  clearAlertsForMeeting,
  getAlerts,
  runPostMeetingTriggers,
  updateAlertStatus,
} from './intelligence/proactiveEngine';
import {
  buildAssigneeActionRecall,
  buildExtractiveTemporalSummary,
  buildLiveMeetingRetrievalResult,
  buildMeetingRetrievalResult,
  buildNamedPersonEvidenceQuery,
  buildPersonWorkRecall,
  buildProjectRecall,
  buildWorkingMemoryOverviewRecall,
  buildWorkspaceIntelligenceRecall,
  containsConfidentialAside,
  enforceSynthesizedOnlyContext,
  extractNamedPersonQuestionSubject,
  focusContextOnExplicitNamedSubject,
  mergeRetrievalResultsByMeeting,
  parsePersonWorkQuery,
  parseQuery,
  resolveExplicitMeetingScope,
  resolveWorkspaceIntelligenceMode,
  retrieveContext,
  selectNamedPersonAnswerContext,
  selectRecentPersonNoteContext,
  shouldKeepActivePersonScope,
  shouldKeepActiveProjectScope,
  shouldUsePreparedExtractiveAnswer,
  shouldUseWorkspaceIntelligence,
} from './intelligence/queryEngine';
import { getAskPlutoPrompt } from './intelligence/queryPrompts';
import { generateSuggestedQueries } from './intelligence/suggestedQueries';
import {
  configureKnowledgeDocBackgroundScheduler,
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
import {
  getAllSettings,
  getProvider,
  invalidateProviderCache,
} from './llm/factory';
import type { CloudProviderId } from './llm/inferenceTypes';
import { createNotesSource } from './llm/meetingNotesSource';
import {
  MEETING_NOTES_DEFAULT_TEMPLATE_SETTING,
  MEETING_NOTES_TEMPLATE_OVERRIDES_SETTING,
  applyMeetingNotesTemplateSettingsUpdate,
  createMeetingNotesTemplateSettingsSnapshot,
  isMeetingNotesTemplate,
} from './llm/meetingNotesTemplates';
import type {
  AnalysisArtifacts,
  AnalysisDocument,
  InternalSignalDocument,
} from './llm/provider';
import { inferenceTransportErrorRationale } from './llm/transports/openAICompatible';
import { UnifiedLLMProvider } from './llm/unifiedProvider';
import {
  type MeetingAnalysisRunCoordinatorDb,
  createMeetingAnalysisRunCoordinator,
} from './meetingAnalysisRuns';
import { reconcileSingletonManualParticipantIdentity } from './meetingParticipantIdentity';
import {
  PersonChatThreadArchivedError,
  createPersonChatStore,
} from './personChatStore';
import {
  getRecordingReadinessStatus,
  prepareRecordingReadiness,
} from './recordingReadiness';
import { isSecretSettingKey } from './secureSettings';
import { createSpeakerEnrollmentAudio } from './speakerEnrollmentAudio';
import { buildSpeakerEnrollmentCandidate } from './speakerEnrollmentCandidate';
import {
  SPEAKER_VOICE_CHANNELS,
  type SpeakerVoiceDependencies,
  handleSpeakerVoiceRequest,
  reconcileConfirmedSpeakerVoiceProfiles,
} from './speakerVoiceHandlers';
import { reconcileVoiceMatchSpeakerIdentity } from './speakerVoiceIdentity';
import {
  getCanonicalVoiceProfiles,
  getMeetingSpeakerCandidates,
  getVoiceRejections,
} from './speakerVoiceStore';
import {
  type TranscriptCleanupStats,
  cleanTranscriptSegments,
  shouldCleanupTranscriptOnSave,
} from './transcriptCleanup';
import { mapValueSignalsToPriorityHints } from './valueSignalMapping';
import { createWorkspaceChatStore } from './workspaceChatStore';

let backgroundKnowledgeRefresh: BackgroundKnowledgeRefreshCoordinator | null =
  null;
let idleDreamingCoordinator: ReturnType<
  typeof createIdleDreamingCoordinator
> | null = null;
let dreamingEntityQueue: DirtyEntityQueue | null = null;
let lastRendererActivityAt = Date.now();
let scheduleProjectSynthesis: ((delayMs?: number) => void) | null = null;
let scheduleDreamingRun: ((delayMs?: number) => void) | null = null;
let backgroundVoiceCandidateActive = false;
let voiceWorkQueue: ReturnType<typeof createVoiceWorkQueue> | null = null;

const notifyForegroundActivity = () => {
  lastRendererActivityAt = Date.now();
  backgroundKnowledgeRefresh?.notifyForegroundActivity();
  idleDreamingCoordinator?.notifyForegroundActivity();
};

const notifyRendererActivity = () => {
  if (Date.now() - lastRendererActivityAt < 1_000) return;
  notifyForegroundActivity();
};

const invalidateDreamingCatalog = () => {
  scheduleProjectSynthesis?.();
  if (!dreamingEntityQueue) return;
  invalidateDreamingWork(dreamingEntityQueue, () => scheduleDreamingRun?.());
};

const meetingNotesRunCoordinator = createMeetingAnalysisRunCoordinator({
  db: db as unknown as MeetingAnalysisRunCoordinatorDb,
  getSettings: () => getAllSettings(db),
  getProvider,
  knowledgeSynthesisPause,
  onUpdated: (meetingId) => {
    invalidateDreamingCatalog();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed())
        win.webContents.send('MEETING_NOTES_UPDATED', meetingId);
    }
  },
  onPublished: (meetingId) => {
    try {
      if (Notification.isSupported()) {
        const meeting = db.getMeeting(meetingId) as { title?: string } | null;
        const title = meeting?.title || 'Meeting';
        new Notification({
          title: 'Meeting notes ready',
          body: `Notes for "${title}" are ready.`,
        }).show();
      }
    } catch {
      // Non-fatal notification error
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
      { signal: input.signal, workClass: 'meeting_secondary' },
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
      { signal: input.signal, workClass: 'meeting_secondary' },
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
      backgroundKnowledgeRefresh?.enqueue(`meeting:${input.meetingId}`);
    }
  },
});

const calendarHelperPath = resolveCalendarHelperPath({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  cwd: process.cwd(),
});
const calendarClient = new CalendarHelperClient({
  executablePath: calendarHelperPath,
});
const calendarService = createCalendarService({
  platform: process.platform,
  runtimeAvailable: () => fs.existsSync(calendarHelperPath),
  client: calendarClient,
  store: db.calendarStore,
});
const personChatStore = createPersonChatStore(getApplicationDatabase());
const workspaceChatStore = createWorkspaceChatStore(getApplicationDatabase());

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
const activePersonChatQueries = new Map<
  string,
  { controller: AbortController; ownerId: number; settled: Promise<void> }
>();
const MEETING_ASK_PLUTO_CANCEL_SETTLE_MS = 1_500;
const waitForMeetingAskPlutoCancellation = async (
  pending: Promise<void>[],
): Promise<boolean> => {
  if (pending.length === 0) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  try {
    await Promise.race([
      Promise.all(pending).then(() => {
        settled = true;
      }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, MEETING_ASK_PLUTO_CANCEL_SETTLE_MS);
      }),
    ]);
    return settled;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
const activeAskPlutoSessionOwners = new Set<number>();
let activeTranscriptionCount = 0;
const activeTranscriptionMeetings = new Map<string, number>();
const activeAudioDeletions = new Set<string>();
let parakeetFinalClient: ParakeetFinalClient | null = null;
let parakeetRuntimeHost: ParakeetRuntimeHost | null = null;
let parakeetEouCoordinator: ParakeetEouMeetingCoordinator | null = null;
let parakeetEouOwner: WebContents | null = null;
let parakeetEouGeneration: number | null = null;

configureKnowledgeSynthesisPause((paused) => {
  setKnowledgeDocSynthesisPaused(paused);
  const hasForegroundPause = Object.entries(
    knowledgeSynthesisPause.snapshot(),
  ).some(([reason, count]) => reason !== 'llm_active' && Number(count) > 0);
  if (hasForegroundPause && !backgroundVoiceCandidateActive) {
    notifyForegroundActivity();
  }
});

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

let transcriptionResumeTimer: NodeJS.Timeout | null = null;
let isTranscriptionWorkPaused = false;

function beginTranscriptionWork() {
  if (transcriptionResumeTimer) {
    clearTimeout(transcriptionResumeTimer);
    transcriptionResumeTimer = null;
  }
  activeTranscriptionCount += 1;
  if (!isTranscriptionWorkPaused) {
    isTranscriptionWorkPaused = true;
    knowledgeSynthesisPause.acquire('transcription');
    plutoLog.info(
      'Pausing queued knowledge-doc synthesis during transcription',
    );
  }
}

function endTranscriptionWork(delayMs = 1500) {
  if (activeTranscriptionCount <= 0) return;
  activeTranscriptionCount -= 1;
  if (activeTranscriptionCount === 0) {
    if (transcriptionResumeTimer) {
      clearTimeout(transcriptionResumeTimer);
    }
    const release = () => {
      transcriptionResumeTimer = null;
      if (activeTranscriptionCount === 0 && isTranscriptionWorkPaused) {
        isTranscriptionWorkPaused = false;
        knowledgeSynthesisPause.release('transcription');
        plutoLog.info(
          'Resuming queued knowledge-doc synthesis after transcription',
        );
      }
    };
    if (delayMs > 0) {
      transcriptionResumeTimer = setTimeout(release, delayMs);
    } else {
      release();
    }
  }
}

function beginMeetingTranscription(meetingId: string | null) {
  if (!meetingId) return;
  if (activeAudioDeletions.has(meetingId)) {
    throw new Error('audio_deletion_in_progress');
  }
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
    plutoLog.info(`Aborting background tasks for meeting: ${meetingId}`);
    controller.abort();
    activeMeetingTasks.delete(meetingId);
  }
}

let stopIdentityReconciliation: (() => void) | undefined;
let stopVoiceCandidateBackfill: (() => void) | undefined;
let chatgptConnection: ReturnType<typeof createPlutoMcpConnection> | undefined;
const shutdownMainProcessConsumers = async () => {
  await chatgptConnection?.close();
  for (const controller of activeMeetingTasks.values()) controller.abort();
  activeMeetingTasks.clear();
  for (const task of activeAnalysisGenerations.values())
    task.controller.abort();
  for (const task of activeAskPlutoQueries.values()) task.controller.abort();
  for (const task of activeMeetingAskPlutoQueries.values())
    task.controller.abort();
  for (const task of activePersonChatQueries.values()) task.controller.abort();
  backgroundKnowledgeRefresh?.close();
  backgroundKnowledgeRefresh = null;
  stopVoiceCandidateBackfill?.();
  stopVoiceCandidateBackfill = undefined;
  voiceWorkQueue?.close();
  voiceWorkQueue = null;
  await idleDreamingCoordinator?.close();
  idleDreamingCoordinator = null;
  scheduleDreamingRun = null;
  dreamingEntityQueue = null;
  stopIdentityReconciliation?.();
  calendarService.stop();
  plutoLog.info('Shutting down...');
  parakeetFinalClient?.close();
  parakeetFinalClient = null;
  await parakeetEouCoordinator?.fail('parakeet_app_quit');
  parakeetEouCoordinator = null;
  parakeetEouOwner = null;
  parakeetEouGeneration = null;
  parakeetRuntimeHost?.shutdown();
  parakeetRuntimeHost = null;
};

app.on(
  'before-quit',
  createBeforeQuitHandler({
    shutdownConsumers: shutdownMainProcessConsumers,
    closeDatabase: closeApplicationDatabase,
    quit: () => app.quit(),
    onError: (error) => plutoLog.error('Shutdown failed:', error),
  }),
);

app.whenReady().then(async () => {
  const requestedEncryptionRollout = process.env[ENCRYPTION_ROLLOUT_ENV];
  const encryptionRollout = resolveEncryptionRolloutPolicy({
    isPackaged: app.isPackaged,
    requestedMode: requestedEncryptionRollout,
    historicalMigrationRequested: process.env[HISTORICAL_AUDIO_MIGRATION_ENV],
    retentionEnforcementRequested: process.env[AUDIO_RETENTION_ENFORCEMENT_ENV],
    signedBuild:
      app.isPackaged && requestedEncryptionRollout === 'signed_canary'
        ? probeSignedMacBuild(process.execPath)
        : { valid: false, reason: 'packaged_build_required' },
  });
  plutoLog.info('Encryption rollout:', {
    mode: encryptionRollout.mode,
    encryptedCaptureWrites: encryptionRollout.encryptedCaptureWrites,
    historicalAudioMigration: encryptionRollout.historicalAudioMigration,
    retentionEnforcement: encryptionRollout.retentionEnforcement,
    reason: encryptionRollout.reason,
  });
  setCaptureJournalAudioKeyProvider((meetingId) => {
    const result = getAudioKeyStore()?.getMeetingAudioKey(meetingId);
    return result?.meetingKey ?? null;
  });
  const readEncryptedMeetingSlice = async ({
    meetingId,
    inputPath,
    startSec,
    durationSec,
  }: {
    meetingId: string;
    inputPath: string;
    startSec: number;
    durationSec: number;
  }) => {
    const manifest = await readCaptureJournalManifest(
      getMeetingArtifactsRootDir(),
      meetingId,
    );
    const keyResult = getAudioKeyStore()?.getMeetingAudioKey(meetingId);
    if (
      manifest.schemaVersion !== 4 ||
      !keyResult ||
      keyResult.keyId !== manifest.keyId
    ) {
      return null;
    }
    return await sliceEncryptedAudio({
      filePath: inputPath,
      startSec,
      durationSec,
      signal: getAbortSignalForMeeting(meetingId),
      context: {
        meetingId,
        generation: manifest.generation,
        keyId: manifest.keyId,
        meetingKey: keyResult.meetingKey,
      },
    });
  };
  // db.getMeeting also runs a global retry-recovery sweep. Voice freshness
  // checks must read only their source, without scanning other transcripts.
  const readVoiceMeeting = (id: string): db.PersistedMeeting | null =>
    (getApplicationDatabase()
      .prepare('SELECT * FROM meetings WHERE id = ?')
      .get(id) as db.PersistedMeeting | undefined) ?? null;
  const buildVoiceEnrollmentCandidate: NonNullable<
    SpeakerVoiceDependencies['buildEnrollmentCandidate']
  > = async (input) => {
    if (!parakeetFinalClient) return null;
    const meetingSignal = getAbortSignalForMeeting(input.meetingId);
    const combinedSignal = input.signal
      ? AbortSignal.any([meetingSignal, input.signal])
      : meetingSignal;
    beginMeetingTranscription(input.meetingId);
    beginTranscriptionWork();
    try {
      return await buildSpeakerEnrollmentCandidate(input, {
        getMeeting: readVoiceMeeting,
        fileExists: (inputPath) => fs.existsSync(inputPath),
        createWorkDir: () =>
          fs.mkdtempSync(
            path.join(getMeetingArtifactsRootDir(), '.speaker-profile-'),
          ),
        removeWorkDir: async (workDir) => {
          await fs.promises.rm(workDir, { recursive: true, force: true });
        },
        createAudio: createSpeakerEnrollmentAudio,
        signal: combinedSignal,
        analyze: async (request) => {
          const infStart = performance.now();
          try {
            return await parakeetFinalClient!.speakerEvidence({
              ...request,
              signal: combinedSignal,
            });
          } finally {
            const infDurationMs = Math.round(performance.now() - infStart);
            console.log('[Pluto][SpeakerVoice] parakeet inference completed', {
              meetingId: input.meetingId,
              speaker: input.speaker,
              durationMs: infDurationMs,
            });
          }
        },
      });
    } finally {
      endMeetingTranscription(input.meetingId);
      endTranscriptionWork();
    }
  };
  const speakerVoiceDependencies = (
    allowCandidateBuild = false,
    backgroundSignal?: AbortSignal,
  ): SpeakerVoiceDependencies => ({
    getMeeting: readVoiceMeeting,
    fileExists: (inputPath) => fs.existsSync(inputPath),
    createTemporaryPath: () =>
      path.join(app.getPath('temp'), `speaker-sample-${randomUUID()}.wav`),
    sliceWav: async ({ inputPath, outputPath, startSec, durationSec }) =>
      await convertAudioToMonoWav({
        inputPath,
        outputPath,
        startSec,
        durationSec,
      }),
    readFile: async (outputPath) => await fs.promises.readFile(outputPath),
    removeFile: async (outputPath) => {
      await fs.promises.unlink(outputPath);
    },
    readEncryptedSlice: readEncryptedMeetingSlice,
    buildEnrollmentCandidate: (input) =>
      buildVoiceEnrollmentCandidate({
        ...input,
        signal:
          input.signal && backgroundSignal
            ? AbortSignal.any([input.signal, backgroundSignal])
            : (input.signal ?? backgroundSignal),
      }),
    allowCandidateBuild,
    signal: backgroundSignal,
    awaitCandidateCleanup: true,
    scheduleCandidateBackfill: (meetingId) =>
      voiceWorkQueue?.enqueue(meetingId),
    allowAutoAssign: true,
    onBindingChange: ({ meetingId, personIds }) => {
      const hasPublishedNotes = db.hasPublishedMeetingNotes(meetingId);
      db.refreshMeetingIdentityProjection(meetingId);
      notifyMeetingIdentityUpdated(meetingId);
      queueKnowledgeDocsRefreshForMeeting(meetingId);
      for (const personId of personIds) {
        const doc = db.getKnowledgeDocByScope('person_context', personId);
        if (doc) queueKnowledgeDocRefresh(doc.id);
      }
      invalidateDreamingCatalog();
      if (hasPublishedNotes) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed())
            win.webContents.send('MEETING_NOTES_UPDATED', meetingId);
        }
      }
    },
  });
  db.recoverInterruptedMeetingAnalysisRuns();
  const audioRetention = createAudioRetentionManager({
    rootDir: getMeetingArtifactsRootDir(),
    sqlite: getApplicationDatabase(),
    listMeetings: () => db.getMeetings() as db.PersistedMeeting[],
    getSetting: db.getSetting,
    audioKeyStore: getAudioKeyStore(),
    isMeetingActive: (meetingId) =>
      activeTranscriptionMeetings.has(meetingId) ||
      activeAnalysisGenerations.has(meetingId),
    isHistoricalMigrationBlocked: (meetingId) =>
      Boolean(
        getApplicationDatabase()
          .prepare(
            `SELECT 1 FROM meeting_audio_migrations
             WHERE meeting_id = ? AND status != 'complete'
             LIMIT 1`,
          )
          .get(meetingId),
      ),
    acquireDeletionLease: (meetingId) => {
      if (
        activeAudioDeletions.has(meetingId) ||
        activeTranscriptionMeetings.has(meetingId) ||
        activeAnalysisGenerations.has(meetingId)
      ) {
        return null;
      }
      activeAudioDeletions.add(meetingId);
      return () => activeAudioDeletions.delete(meetingId);
    },
  });
  voiceWorkQueue = createVoiceWorkQueue({
    canRun: (active) =>
      Boolean(parakeetFinalClient) &&
      canRunVoiceWork({
        active,
        runtime: parakeetRuntimeHost?.diagnostics(),
        pauses: knowledgeSynthesisPause.snapshot(),
        transcriptionCount: activeTranscriptionCount,
        onBattery: powerMonitor.isOnBatteryPower(),
        thermalState: powerMonitor.getCurrentThermalState(),
        cpuLoad: os.loadavg()[0],
        cpuCount: os.cpus().length,
      }),
    hasMemoryCapacity: async () => {
      const memory = await probeAvailableMemory();
      return (
        memory.availableMemoryBytes >=
        Math.max(2 * 1024 ** 3, os.totalmem() * 0.1)
      );
    },
    run: async (meetingId, signal) => {
      backgroundVoiceCandidateActive = true;
      idleDreamingCoordinator?.notifyForegroundActivity();
      try {
        await handleSpeakerVoiceRequest(
          'SPEAKER_VOICE_GET_SUGGESTIONS',
          { meetingId },
          speakerVoiceDependencies(true, signal),
        );
        const personIds = new Set(
          (
            getApplicationDatabase()
              .prepare(
                `SELECT json_extract(payload, '$.personId') AS person_id
             FROM identity_bindings WHERE meeting_id = ?
               AND json_valid(payload)
               AND json_extract(payload, '$.source') = 'user'
               AND json_extract(payload, '$.individual') = 1
               AND json_type(payload, '$.personId') = 'text'`,
              )
              .all(meetingId) as Array<{ person_id: string }>
          ).map((row) => row.person_id),
        );
        for (const personId of personIds) {
          signal.throwIfAborted();
          await reconcileConfirmedSpeakerVoiceProfiles(
            speakerVoiceDependencies(true, signal),
            getApplicationDatabase(),
            personId,
          );
        }
        signal.throwIfAborted();
        // Transient native failures already have a durable backoff. Retain the
        // meeting in the queue so it retries without another UI visit.
        const retryable = getApplicationDatabase()
          .prepare(
            `SELECT 1 FROM speaker_voice_candidate_attempts a
           JOIN meetings m ON m.id = a.meeting_id
           WHERE a.meeting_id = ? AND a.source_revision = m.capture_journal_generation
             AND a.extraction_version = 'single-pass-v2'
             AND a.status = 'retryable_failure' LIMIT 1`,
          )
          .get(meetingId);
        if (retryable) throw new Error('voice_retry_pending');
      } finally {
        backgroundVoiceCandidateActive = false;
      }
    },
  });
  stopVoiceCandidateBackfill = startVoiceCandidateBackfill({
    directory: app.getPath('userData'),
    db: getApplicationDatabase(),
    enqueue: (meetingId) => voiceWorkQueue?.enqueue(meetingId),
    pending: () => voiceWorkQueue?.snapshot().pendingMeetingIds ?? [],
    diagnostics: () => ({
      onBattery: powerMonitor.isOnBatteryPower(),
      thermalState: powerMonitor.getCurrentThermalState(),
      queue: voiceWorkQueue?.snapshot(),
      runtime: parakeetRuntimeHost?.diagnostics(),
      pauseReasons: knowledgeSynthesisPause.snapshot(),
      activeTranscriptionCount,
      cpuLoad: os.loadavg()[0],
      cpuCount: os.cpus().length,
    }),
    onError: (error) =>
      console.warn('[Pluto] Voice backfill scan failed', error),
  });
  backgroundKnowledgeRefresh = createBackgroundKnowledgeRefreshCoordinator({
    getPolicy: () => ({
      systemIdleSeconds: powerMonitor.getSystemIdleTime(),
      onBattery: powerMonitor.isOnBatteryPower(),
      thermalState: powerMonitor.getCurrentThermalState(),
      paused: Object.entries(knowledgeSynthesisPause.snapshot()).some(
        ([reason, count]) => reason !== 'llm_active' && Number(count) > 0,
      ),
    }),
    run: async (workId, signal) => {
      if (workId.startsWith('secondary:')) {
        signal.throwIfAborted();
        const meetingId = workId.slice('secondary:'.length);
        const cancel = () =>
          meetingNotesRunCoordinator.supersedeMeetingNotes(meetingId);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          await meetingNotesRunCoordinator.generateAndPublishMeetingNotes({
            meetingId,
            requestId: randomUUID(),
            reason: 'secondary',
          });
        } catch (error) {
          console.warn(
            `[Background] Deferred secondary run failed for ${meetingId}:`,
            error,
          );
        } finally {
          signal.removeEventListener('abort', cancel);
        }
        return;
      }
      if (workId.startsWith('voice:')) {
        voiceWorkQueue?.enqueue(workId.slice('voice:'.length));
        return;
      }
      if (workId.startsWith('doc:')) {
        const refreshed = await refreshKnowledgeDocNow(
          workId.slice('doc:'.length),
          { signal },
        );
        if (!refreshed || refreshed.status !== 'up_to_date') {
          throw new Error('knowledge_document_refresh_incomplete');
        }
        invalidateDreamingCatalog();
        return;
      }
      await refreshKnowledgeDocsForMeetingNow(
        workId.startsWith('meeting:')
          ? workId.slice('meeting:'.length)
          : workId,
        { signal },
      );
      invalidateDreamingCatalog();
    },
    onError: (error, workId) => {
      console.warn(
        `[KnowledgeDoc] Deferred refresh retained for ${workId}:`,
        error,
      );
    },
  });
  configureKnowledgeDocBackgroundScheduler((docId) => {
    backgroundKnowledgeRefresh?.enqueue(`doc:${docId}`);
  });
  dreamingEntityQueue = createDirtyEntityQueue({
    getProjects: () => db.getEntitiesByType('project'),
    getPeople: () => db.getEntitiesByType('person'),
    resolveProjectId: db.resolveProjectIdentityId,
    resolvePersonId: db.resolvePersonIdentityId,
  });

  // A run may outlive a crash, but never the per-entity deadline. Recover stale
  // leases before the first scheduling attempt so their revisions can retry.
  db.dreamingProposalStore.recoverStaleRuns({
    staleBefore: new Date(
      Date.now() - DREAMING_ENTITY_DEADLINE_MS,
    ).toISOString(),
  });

  idleDreamingCoordinator = createIdleDreamingCoordinator({
    getPolicy: () => ({
      systemIdleSeconds: powerMonitor.getSystemIdleTime(),
      onBattery: powerMonitor.isOnBatteryPower(),
      thermalState: powerMonitor.getCurrentThermalState(),
      rendererQuiet:
        Date.now() - lastRendererActivityAt >= DREAMING_RENDERER_QUIET_MS,
      paused: Object.entries(knowledgeSynthesisPause.snapshot()).some(
        ([reason, count]) => reason !== 'llm_active' && Number(count) > 0,
      ),
    }),
    getNextDirtyEntityId: () => dreamingEntityQueue?.getNextCandidate(),
    getEntity: (id: string) => db.getEntity(id),
    packageNotes: (entityId: string) => packageEntityNotes(entityId),
    proposalStore: db.dreamingProposalStore,
    recoverStaleRuns: db.dreamingProposalStore.recoverStaleRuns,
    onRetryable: (candidate, delayMs) => {
      dreamingEntityQueue?.invalidate(candidate);
      scheduleDreamingRun?.(delayMs);
    },
    hasPendingWork: () => dreamingEntityQueue?.hasPendingWork() === true,
    generate: async (
      prompt,
      responseSchema,
      signal,
      model,
      promptVersion,
      workClass,
      onStart,
      onProgress,
    ) => {
      const provider = new UnifiedLLMProvider(
        'ollama',
        await getAllSettings(db),
      );
      signal?.throwIfAborted();
      return generateDreamingWithProvider(
        provider,
        prompt,
        responseSchema,
        signal,
        model,
        promptVersion,
        workClass,
        onStart,
        onProgress,
      );
    },
    unloadModel: async (signal) => {
      const provider = new UnifiedLLMProvider(
        'ollama',
        await getAllSettings(db),
      );
      await provider.unloadModel(DREAMING_MODEL, signal);
    },
  });

  powerMonitor.on('user-did-become-active', notifyForegroundActivity);
  powerMonitor.on('on-battery', notifyForegroundActivity);
  powerMonitor.on('on-ac', notifyForegroundActivity);
  powerMonitor.on('thermal-state-change', notifyForegroundActivity);

  let dreamingTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDreaming = (delayMs = 60_000) => {
    if (dreamingTimer || !dreamingEntityQueue?.hasPendingWork()) return;
    dreamingTimer = setTimeout(async () => {
      dreamingTimer = null;
      const result = await idleDreamingCoordinator?.attemptIdleRun();
      if (
        result?.entityId &&
        (result.status === 'cancelled' ||
          result.status === 'failed' ||
          result.status === 'backoff' ||
          result.status === 'busy')
      ) {
        const entity = db.getEntity(result.entityId);
        if (entity?.type === 'project' || entity?.type === 'person') {
          dreamingEntityQueue?.invalidate({
            entityId: result.entityId,
            type: entity.type,
          });
        }
      }
      scheduleDreaming();
    }, delayMs);
    if (typeof dreamingTimer === 'object' && 'unref' in dreamingTimer) {
      dreamingTimer.unref();
    }
  };
  scheduleDreamingRun = scheduleDreaming;
  scheduleDreaming(0);
  const notifyMeetingIdentityUpdated = (meetingId?: string) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send('MEETING_IDENTITY_UPDATED', meetingId);
    }
  };
  const scheduleMeetingIdentityProjectionRefresh = (personIds: string[]) => {
    const meetingIds = db.listMeetingIdsForPersonIdentity(personIds);
    const refreshNext = () => {
      const meetingId = meetingIds.shift();
      if (!meetingId) return;
      db.refreshMeetingIdentityProjection(meetingId);
      notifyMeetingIdentityUpdated(meetingId);
      setImmediate(refreshNext);
    };
    setImmediate(refreshNext);
  };
  const meetingIdentityProjectionVersion =
    'meeting_notes_identity_projection_v1';
  if (
    db.getSetting('meeting_notes_identity_projection_version') !==
    meetingIdentityProjectionVersion
  ) {
    const pendingMeetingIds = db.listMeetingIdsWithSavedNotes();
    const refreshNextSavedMeeting = () => {
      const meetingId = pendingMeetingIds.shift();
      if (!meetingId) {
        db.setSetting(
          'meeting_notes_identity_projection_version',
          meetingIdentityProjectionVersion,
        );
        return;
      }
      db.refreshMeetingIdentityProjection(meetingId);
      setTimeout(refreshNextSavedMeeting, 25).unref?.();
    };
    setTimeout(refreshNextSavedMeeting, 25).unref?.();
  }

  let secondaryRecoveryRunning = false;
  let secondaryRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const secondaryAttempts = new Map<string, number>();

  const runSecondaryRecovery = async () => {
    if (secondaryRecoveryRunning) return;
    secondaryRecoveryRunning = true;
    try {
      const failedMeetingIds = db.listMeetingIdsWithFailedSecondary();
      for (const meetingId of failedMeetingIds) {
        if (activeTranscriptionCount > 0) {
          scheduleSecondaryRecovery(5_000);
          return;
        }
        const attempts = secondaryAttempts.get(meetingId) ?? 0;
        if (attempts >= 2) continue;
        secondaryAttempts.set(meetingId, attempts + 1);

        try {
          await meetingNotesRunCoordinator.generateAndPublishMeetingNotes({
            meetingId,
            requestId: randomUUID(),
            reason: 'secondary',
          });
        } catch (error) {
          console.warn(
            `[SecondaryRecovery] Secondary run failed for meeting ${meetingId}:`,
            error,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      secondaryRecoveryRunning = false;
    }
  };

  const scheduleSecondaryRecovery = (delayMs = 3_000) => {
    if (secondaryRecoveryTimer) {
      clearTimeout(secondaryRecoveryTimer);
    }
    secondaryRecoveryTimer = setTimeout(() => {
      secondaryRecoveryTimer = null;
      void runSecondaryRecovery();
    }, delayMs);
    if (
      typeof secondaryRecoveryTimer === 'object' &&
      'unref' in secondaryRecoveryTimer
    ) {
      secondaryRecoveryTimer.unref();
    }
  };

  scheduleSecondaryRecovery(3_000);

  for (const channel of IDENTITY_CHANNELS) {
    ipcMain.handle(channel, (_event, payload) => {
      const previousSelfPersonId = db.identityStore.getSelfPersonId();
      const result = handleIdentityRequest(channel, payload, {
        onBindingChange: ({ meetingId, personIds }) => {
          const hasPublishedNotes = db.hasPublishedMeetingNotes(meetingId);
          db.refreshMeetingIdentityProjection(meetingId);
          queueKnowledgeDocsRefreshForMeeting(meetingId);
          for (const personId of personIds) {
            const doc = db.getKnowledgeDocByScope('person_context', personId);
            if (doc) queueKnowledgeDocRefresh(doc.id);
          }
          if (hasPublishedNotes) {
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed())
                win.webContents.send('MEETING_NOTES_UPDATED', meetingId);
            }
          }
          voiceWorkQueue?.enqueue(meetingId);
        },
      });
      if (
        channel !== 'GET_IDENTITY_STATE' &&
        channel !== 'GET_MEETING_IDENTITY'
      ) {
        invalidateDreamingCatalog();
        const meetingId =
          result && typeof result === 'object' && 'meetingId' in result
            ? String(result.meetingId)
            : undefined;
        notifyMeetingIdentityUpdated(meetingId);
        const selfPersonId =
          result && typeof result === 'object' && 'selfPersonId' in result
            ? result.selfPersonId
            : null;
        const affectedSelfPersonIds = [
          previousSelfPersonId,
          selfPersonId,
        ].filter(
          (personId): personId is string => typeof personId === 'string',
        );
        if (
          affectedSelfPersonIds.length > 0 &&
          (channel === 'SET_SELF_IDENTITY' ||
            channel === 'SAVE_IDENTITY_PROFILE')
        ) {
          scheduleMeetingIdentityProjectionRefresh(affectedSelfPersonIds);
        }
      }
      return result;
    });
  }
  for (const channel of SPEAKER_VOICE_CHANNELS) {
    ipcMain.handle(channel, async (_event, payload) => {
      const meetingId =
        payload && typeof payload === 'object' && 'meetingId' in payload
          ? String(payload.meetingId || '')
          : '';
      beginMeetingTranscription(meetingId || null);
      try {
        return await handleSpeakerVoiceRequest(
          channel,
          payload,
          speakerVoiceDependencies(false),
        );
      } finally {
        endMeetingTranscription(meetingId || null);
      }
    });
  }
  stopIdentityReconciliation = startIdentityReconciliation({
    canRun: () =>
      Date.now() - lastRendererActivityAt >= BACKGROUND_KNOWLEDGE_QUIET_MS &&
      powerMonitor.getSystemIdleTime() * 1000 >=
        BACKGROUND_KNOWLEDGE_QUIET_MS &&
      !powerMonitor.isOnBatteryPower() &&
      ['nominal', 'fair'].includes(powerMonitor.getCurrentThermalState()),
    pauseReasons: () => knowledgeSynthesisPause.snapshot(),
    onChange: () => {
      invalidateDreamingCatalog();
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

  ipcMain.handle('CALENDAR_GET_STATE', () => calendarService.getSnapshot());
  ipcMain.handle('CALENDAR_CONNECT', () => calendarService.connect());
  ipcMain.handle('CALENDAR_SELECT', (_event, calendarOrCalendars) =>
    Array.isArray(calendarOrCalendars)
      ? calendarService.selectCalendars(calendarOrCalendars)
      : calendarService.selectCalendar(calendarOrCalendars),
  );
  ipcMain.handle('CALENDAR_REFRESH', async () => {
    await calendarService.refresh();
    return calendarService.getSnapshot();
  });
  ipcMain.handle('CALENDAR_LIST_DAY', (_event, range) =>
    calendarService.listDay(range.start, range.end),
  );
  ipcMain.handle('CALENDAR_DISCONNECT', () => {
    calendarService.disconnect();
    return calendarService.getSnapshot();
  });
  ipcMain.handle('CALENDAR_GET_MEETING_CONTEXT', (_event, meetingId) =>
    db.calendarStore.getMeetingContext(String(meetingId)),
  );
  db.meetingPrepStore.recoverUnstarted(
    (id) =>
      Boolean(db.getMeeting(id)) ||
      fs.existsSync(
        path.join(
          getMeetingArtifactsRootDir(),
          id,
          'capture-journal',
          'manifest.json',
        ),
      ),
  );
  ipcMain.handle('MEETING_PREP_OPEN', (_event, event) =>
    db.meetingPrepStore.open(event),
  );
  ipcMain.handle('MEETING_PREP_GET', (_event, key) =>
    db.meetingPrepStore.get(key),
  );
  ipcMain.handle('MEETING_PREP_FOR_MEETING', (_event, id) => {
    if (typeof id !== 'string' || id.length > 128)
      throw new Error('Invalid meeting ID');
    return db.meetingPrepStore.forMeeting(id);
  });
  const buildCurrentLinkedMeetingBrief = (
    prep: import('./meetingPrep').MeetingPrep,
  ) =>
    buildMeetingPrepBrief(prep, {
      entities: (id) =>
        db.getMeetingEntities(id).flatMap((entity) => {
          if (entity.type !== 'action_item') return [];
          const current = db.resolveCommitmentIdentity(entity.id);
          return current && !db.isRetiredCommitment(entity.id)
            ? [
                {
                  ...current,
                  assigned_to: current.assigned_to
                    ? db.resolvePersonIdentityId(current.assigned_to)
                    : null,
                },
              ]
            : [];
        }),
      blockers: db.getBlockedActionItems,
      selfPersonId: db.identityStore.getSelfPersonId(),
    });
  const prepareLinkedMeetingBrief = (key: unknown) => {
    const prep = db.meetingPrepStore.get(key);
    if (!prep) throw new Error('Preparation is unavailable');
    const brief = buildCurrentLinkedMeetingBrief(prep);
    return prep.briefing
      ? refreshMeetingPrepBrief(prep.briefing, brief)
      : brief;
  };
  ipcMain.handle('MEETING_PREP_BRIEF_BUILD', (_event, key) =>
    prepareLinkedMeetingBrief(key),
  );
  const prepSynthesisRequests = new Map<string, symbol>();
  ipcMain.handle('MEETING_PREP_BRIEF_SYNTHESIZE', async (_event, key) => {
    const prep = db.meetingPrepStore.get(key);
    if (!prep) throw new Error('Preparation is unavailable');
    const token = Symbol();
    prepSynthesisRequests.set(prep.occurrenceKey, token);
    const references = JSON.stringify(prep.meetings || []);
    const brief = buildCurrentLinkedMeetingBrief(prep);
    try {
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      const generated = await synthesizePreMeetingBrief(
        brief,
        (prompt, signal) =>
          provider.answerAskPluto(prompt, {
            signal,
            mode: 'deep',
            jsonMode: true,
          }),
      );
      if (
        generated.synthesisStatus === 'ready' &&
        prepSynthesisRequests.get(prep.occurrenceKey) === token
      )
        db.meetingPrepStore.saveBrief(key, references, generated);
      return generated;
    } catch {
      return brief;
    } finally {
      if (prepSynthesisRequests.get(prep.occurrenceKey) === token)
        prepSynthesisRequests.delete(prep.occurrenceKey);
    }
  });
  ipcMain.handle('MEETING_PREP_MEETINGS', (_event, input) =>
    db.meetingPrepStore.listMeetings(input?.query ?? '', input?.occurrenceKey),
  );
  ipcMain.handle('MEETING_PREP_SAVE', (_event, input) => {
    const prep = db.meetingPrepStore.save(
      input?.occurrenceKey,
      input?.revision,
      input?.patch,
    );
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('meeting-prep:updated', prep);
    return prep;
  });
  const prepareBrief = (value: unknown) =>
    buildPreMeetingBrief(validatePreMeetingBriefRequest(value), {
      listPriorMeetingContexts: db.calendarStore.listPriorMeetingContexts,
      getMeeting: (id) => db.getMeeting(id) as db.PersistedMeeting | undefined,
      getMeetingEntities: (id) =>
        db.getMeetingEntities(id).flatMap((entity) => {
          if (entity.type !== 'action_item') return [entity];
          const current = db.resolveCommitmentIdentity(entity.id);
          return current
            ? [
                {
                  ...entity,
                  status: current.status,
                  due_date: current.due_date,
                  metadata: current.metadata,
                },
              ]
            : [];
        }),
      getBlockedActionItems: db.getBlockedActionItems,
      searchMeetingSummaries: db.searchMeetingSummaries,
      getGlobalWorkingMemory: () =>
        db.getWorkingMemorySnapshot('global', 'global'),
      getPeopleBriefingSummaries: db.getPeopleBriefingSummaries,
      resolveAttendees: db.prepAttendeeStore.resolve,
      listPeople: db.prepAttendeeStore.people,
      getPersonEmails: db.prepAttendeeStore.emails,
      listRelatedMeetingContexts: (event, emails) =>
        db.calendarStore.listPriorMeetingContexts(event.start, 200, {
          event,
          emails,
        }),
      getPersonHistory: (personId) => {
        const detail = db.getPersonBriefing(personId);
        if (!detail) return undefined;
        return {
          ...detail,
          commitments: {
            ...detail.commitments,
            open: detail.commitments.open.filter((commitment) => {
              const current = db.resolveCommitmentIdentity(commitment.id);
              return (
                current &&
                !db.isRetiredCommitment(commitment.id) &&
                (current.status === 'active' || current.status === 'overdue')
              );
            }),
          },
        };
      },
    });
  ipcMain.handle('PRE_MEETING_BRIEF_BUILD', (_event, value: unknown) =>
    prepareBrief(value),
  );
  ipcMain.handle(
    'PRE_MEETING_BRIEF_SYNTHESIZE',
    async (_event, value: unknown) => {
      const brief = prepareBrief(value);
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      return synthesizePreMeetingBrief(brief, (prompt, signal) =>
        provider.answerAskPluto(prompt, {
          signal,
          mode: 'deep',
          jsonMode: true,
        }),
      );
    },
  );
  ipcMain.handle('PRE_MEETING_ATTENDEE_CHANGE', (_event, value: unknown) => {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid attendee change');
    const payload = value as Record<string, unknown>;
    const request = validatePreMeetingBriefRequest(payload.request);
    if (
      request.kind !== 'calendar' ||
      typeof payload.key !== 'string' ||
      payload.key.length > 1500
    )
      throw new Error('Invalid attendee change');
    if (!payload.selection || typeof payload.selection !== 'object')
      throw new Error('Invalid person selection');
    const selection = payload.selection as Record<string, unknown>;
    if (
      Object.keys(selection).some(
        (key) => key !== 'personId' && key !== 'newName',
      ) ||
      (selection.personId !== undefined &&
        selection.personId !== null &&
        (typeof selection.personId !== 'string' ||
          selection.personId.length > 256)) ||
      (selection.newName !== undefined && typeof selection.newName !== 'string')
    )
      throw new Error('Invalid person selection');
    db.prepAttendeeStore.change(
      request.event,
      payload.key,
      selection as { personId?: string | null; newName?: string },
    );
    return prepareBrief(request);
  });
  ipcMain.handle(
    'CALENDAR_MATCH_ACTIVE',
    (_event, payload?: { atTime?: string }) =>
      calendarService.matchActiveEvent(payload?.atTime),
  );
  ipcMain.handle(
    'CALENDAR_ASSOCIATE_START',
    (_event, payload: { meetingId: string; atTime?: string }) =>
      calendarService.associateMeetingAtStart(
        String(payload.meetingId),
        payload?.atTime,
      ),
  );
  ipcMain.handle('OPEN_CALENDAR_SYSTEM_SETTINGS', async (_event, target) => {
    if (process.platform !== 'darwin') return false;
    const url =
      target === 'accounts'
        ? 'x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars';
    await shell.openExternal(url);
    return true;
  });
  calendarService.start();

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
    voiceWork: {
      pendingCount: voiceWorkQueue?.snapshot().pendingMeetingIds.length ?? 0,
      active: Boolean(voiceWorkQueue?.snapshot().activeMeetingId),
      lastError: voiceWorkQueue?.snapshot().lastError ?? null,
      runtime: parakeetRuntimeHost?.diagnostics(),
      pauseReasons: knowledgeSynthesisPause.snapshot(),
      activeTranscriptionCount,
      cpuLoad: os.loadavg()[0],
      cpuCount: os.cpus().length,
    },
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
    let capability: ScopedMeetingCapability | undefined = request?.capability;
    if (!capability && meetingId) {
      const audioKeyStore = getAudioKeyStore();
      const keyResult = audioKeyStore?.getMeetingAudioKey(meetingId);
      if (keyResult) {
        const meeting = db.getMeeting(meetingId) as
          | { capture_journal_generation?: string | null }
          | undefined;
        const generation = meeting?.capture_journal_generation?.trim();
        if (!generation) {
          throw new Error(
            `capture_generation_unavailable: Meeting ${meetingId} has no capture journal generation`,
          );
        }
        capability = {
          version: 1,
          meetingId,
          keyId: keyResult.keyId,
          meetingKeyBase64: keyResult.meetingKey.toString('base64'),
          generation,
          allowedOperations: ['transcribe'],
          expiresAtMs: Date.now() + 5 * 60 * 1000,
        };
      }
    }
    if (
      capability &&
      (!capability.generation ||
        typeof capability.generation !== 'string' ||
        !capability.generation.trim())
    ) {
      throw new Error(
        'invalid_capability: Capability generation must not be empty',
      );
    }
    beginMeetingTranscription(meetingId || null);
    beginTranscriptionWork();
    try {
      return await parakeetFinalClient.transcribe({
        ...request,
        capability,
        signal,
      });
    } finally {
      endMeetingTranscription(meetingId || null);
      endTranscriptionWork();
    }
  });

  ipcMain.handle('TRANSCRIPTION_SPEAKER_EVIDENCE', async (_event, request) => {
    if (!parakeetFinalClient) throw new Error('parakeet_runtime_unavailable');
    const meetingId = String(request?.meetingId || '');
    const signal = meetingId ? getAbortSignalForMeeting(meetingId) : undefined;
    let capability: ScopedMeetingCapability | undefined = request?.capability;
    if (!capability && meetingId) {
      const audioKeyStore = getAudioKeyStore();
      const keyResult = audioKeyStore?.getMeetingAudioKey(meetingId);
      if (keyResult) {
        const meeting = db.getMeeting(meetingId) as
          | { capture_journal_generation?: string | null }
          | undefined;
        const generation = meeting?.capture_journal_generation?.trim();
        if (!generation) {
          throw new Error(
            `capture_generation_unavailable: Meeting ${meetingId} has no capture journal generation`,
          );
        }
        capability = {
          version: 1,
          meetingId,
          keyId: keyResult.keyId,
          meetingKeyBase64: keyResult.meetingKey.toString('base64'),
          generation,
          allowedOperations: ['speakerEvidence'],
          expiresAtMs: Date.now() + 5 * 60 * 1000,
        };
      }
    }
    if (
      capability &&
      (!capability.generation ||
        typeof capability.generation !== 'string' ||
        !capability.generation.trim())
    ) {
      throw new Error(
        'invalid_capability: Capability generation must not be empty',
      );
    }
    beginMeetingTranscription(meetingId || null);
    beginTranscriptionWork();
    try {
      return await parakeetFinalClient.speakerEvidence({
        meetingId,
        mixedAudioPath: String(request?.mixedAudioPath || ''),
        micAudioPath: String(request?.micAudioPath || ''),
        systemAudioPath: String(request?.systemAudioPath || ''),
        capability,
        signal,
      });
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
  let nativeAudioProcess: ChildProcess | null = null;
  let nativeAudioOwner: WebContents | null = null;
  let nativeAudioReadiness: Promise<boolean> | null = null;
  const captureSessionLease = createCaptureSessionLeaseRegistry();
  isCaptureActive = () => captureSessionLease.current() !== null;
  const watchedCaptureOwners = new Set<number>();
  type CaptureIncrementalNotesOffer = IncrementalMeetingNotesOffer & {
    ownerId: number;
    source: ReturnType<typeof createNotesSource>;
    userNotes: string;
    liveTranscriptHealthy: boolean;
  };
  const incrementalNotesCoordinator =
    createIncrementalMeetingNotesCoordinator<CaptureIncrementalNotesOffer>({
      admit: async (input) => {
        const availableMemory = await probeAvailableMemory();
        const active = captureSessionLease.recordingForOwner(input.ownerId);
        const policy = {
          captureOwned: active?.meetingId === input.meetingId,
          liveTranscriptHealthy: input.liveTranscriptHealthy,
          onBattery: powerMonitor.isOnBatteryPower(),
          thermalState: powerMonitor.getCurrentThermalState(),
          freeMemoryBytes: os.freemem(),
          totalMemoryBytes: os.totalmem(),
          fasterNotesEnabled: db.getSetting('faster_notes_enabled') !== 'false',
          ...availableMemory,
        };
        return evaluateIncrementalMeetingNotesAdmission(policy).admitted;
      },
      run: (input, signal) =>
        meetingNotesRunCoordinator.precomputeIncrementalMeetingNotes({
          source: input.source,
          userNotes: input.userNotes,
          signal,
        }),
      onMetric: (metric) => {
        console.log('[Incremental notes]', JSON.stringify(metric));
      },
    });

  // Admission is not a lease to continue through a later power/thermal change.
  powerMonitor.on('on-battery', () => incrementalNotesCoordinator.cancelAll());
  powerMonitor.on('suspend', () => incrementalNotesCoordinator.cancelAll());
  powerMonitor.on('thermal-state-change', () => {
    if (powerMonitor.getCurrentThermalState() !== 'nominal') {
      incrementalNotesCoordinator.cancelAll();
    }
  });

  const liveMeetingContextIndex = createLiveMeetingContextCoordinator({
    loadCheckpoint: db.getLiveMeetingContextCheckpoint,
    saveCheckpoint: db.saveLiveMeetingContextCheckpoint,
    deleteCheckpoint: db.deleteLiveMeetingContextCheckpoint,
    onError: (operation, error) => {
      console.warn(
        `[Pluto][Live context] Checkpoint ${operation} failed:`,
        error,
      );
    },
  });

  let captureDiagnosticSession: {
    meetingId: string;
    generation: string;
    ownerId: number;
    report: ReturnType<typeof createCaptureDiagnostics>;
  } | null = null;
  const diagnosticsFor = (
    ownerId: number,
    request: { meetingId?: unknown; generation?: unknown },
  ) =>
    captureDiagnosticSession?.ownerId === ownerId &&
    captureDiagnosticSession.meetingId === request.meetingId &&
    captureDiagnosticSession.generation === request.generation
      ? captureDiagnosticSession.report
      : null;

  const stopNativeAudioCapture = () => {
    const processToStop = nativeAudioProcess;
    nativeAudioProcess = null;
    nativeAudioOwner = null;
    nativeAudioReadiness = null;
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
        if (captureDiagnosticSession?.ownerId === owner.id) {
          void captureDiagnosticSession.report.stop('owner_destroyed');
          captureDiagnosticSession = null;
        }
        liveMeetingContextIndex.flush(released.meetingId);
        liveMeetingContextIndex.clear(released.meetingId, {
          retainCheckpoint: true,
        });
        incrementalNotesCoordinator.cancel(released.meetingId);
        knowledgeSynthesisPause.release('capture');
        captureLog.warn('Released: owner_destroyed');
      }
    });
  };

  ipcMain.handle(
    'MEETING_NOTES_OFFER_INCREMENTAL',
    (event, { meetingId, segments, userNotes, liveTranscriptHealthy } = {}) => {
      const normalizedMeetingId = String(meetingId || '');
      captureSessionLease.requireRecordingOwner(
        normalizedMeetingId,
        event.sender.id,
      );
      if (
        !Array.isArray(segments) ||
        segments.length < 2 ||
        segments.length > 2_000 ||
        typeof userNotes !== 'string' ||
        userNotes.length > 100_000 ||
        liveTranscriptHealthy !== true
      ) {
        throw new Error('invalid_incremental_meeting_notes_offer');
      }
      const normalizedSegments = segments.map((segment) => {
        if (
          !segment ||
          typeof segment !== 'object' ||
          typeof segment.text !== 'string' ||
          !segment.text.trim() ||
          segment.text.length > 50_000 ||
          (segment.speaker !== null &&
            typeof segment.speaker !== 'string' &&
            typeof segment.speaker !== 'number')
        ) {
          throw new Error('invalid_incremental_meeting_notes_offer');
        }
        return { speaker: segment.speaker, text: segment.text };
      });
      const source = createNotesSource(
        JSON.stringify({ segments: normalizedSegments }),
      );
      const sourceCharacterCount = source.segments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      );
      incrementalNotesCoordinator.offer({
        meetingId: normalizedMeetingId,
        ownerId: event.sender.id,
        source,
        sourceRevision: source.revision,
        sourceSegmentCount: source.segments.length,
        sourceCharacterCount,
        userNotes,
        liveTranscriptHealthy: true,
      });
      return { accepted: true };
    },
  );

  ipcMain.handle(
    'MEETING_NOTES_CANCEL_INCREMENTAL',
    (event, { meetingId } = {}) => {
      const normalizedMeetingId = String(meetingId || '');
      captureSessionLease.requireRecordingOwner(
        normalizedMeetingId,
        event.sender.id,
      );
      incrementalNotesCoordinator.cancel(normalizedMeetingId);
      return { cancelled: true };
    },
  );

  const eouCoordinator = new ParakeetEouMeetingCoordinator({
    createClient: async (signal) => {
      if (!parakeetRuntimeHost) throw new Error('parakeet_runtime_unavailable');
      const before = parakeetRuntimeHost.diagnostics();
      console.warn(
        `[ParakeetEOU] requesting live lease state=${before.state} queued=${before.queuedLeaseCount}`,
      );
      const lease = await parakeetRuntimeHost.startRecordingLive(signal);
      const abortPreparation = () => {
        void lease.invalidateWorker('parakeet_live_start_cancelled');
      };
      signal.addEventListener('abort', abortPreparation, { once: true });
      const after = parakeetRuntimeHost.diagnostics();
      console.warn(
        `[ParakeetEOU] acquired live lease state=${after.state} queued=${after.queuedLeaseCount}`,
      );
      try {
        signal.throwIfAborted();
        if (!parakeetFinalClient)
          throw new Error('parakeet_runtime_unavailable');
        await parakeetFinalClient.prepareForLive(lease);
        signal.throwIfAborted();
        console.warn('[ParakeetEOU] live model prepared');
        return new ParakeetEouClient({
          runtimeHost: parakeetRuntimeHost,
          runtimeLease: lease,
          maxOutstandingPerSource: 48,
        });
      } catch (error) {
        await lease.release();
        throw error;
      } finally {
        signal.removeEventListener('abort', abortPreparation);
      }
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
    listEventsSince: db.listMeetingContextEventsSince,
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
      if (
        parakeetEouOwner?.id === event.sender.id &&
        parakeetEouGeneration === generation
      ) {
        parakeetEouOwner = null;
        parakeetEouGeneration = null;
      }
      if (error instanceof Error && error.message === 'parakeet_cancelled') {
        return { cancelled: true };
      }
      throw error;
    }
  });

  ipcMain.handle('PARAKEET_EOU_APPEND', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    requireParakeetEouOwner(event.sender, meetingId);
    if (request.generation !== parakeetEouGeneration)
      throw new Error('parakeet_session_invalid');
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
      try {
        if (Array.isArray(request.segments)) {
          liveMeetingContextIndex.ingest(meetingId, request.segments);
        }
      } catch (error) {
        console.warn('[Pluto][Live context] Index update failed:', error);
      }
      return await meetingContextProducer.ingest(request);
    },
  );

  ipcMain.handle('PARAKEET_EOU_FINISH', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    requireParakeetEouOwner(event.sender, meetingId);
    if (request.generation !== parakeetEouGeneration)
      throw new Error('parakeet_session_invalid');
    const generation = parakeetEouGeneration;
    await eouCoordinator.finish(meetingId);
    if (
      parakeetEouOwner?.id === event.sender.id &&
      parakeetEouGeneration === generation
    ) {
      parakeetEouOwner = null;
      parakeetEouGeneration = null;
    }
    return {};
  });

  ipcMain.handle('PARAKEET_EOU_CANCEL', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    // Cancellation can race with a pending START rejection. Once START has
    // released the EOU owner there is no native session left to protect or
    // cancel, so repeated cleanup is intentionally idempotent.
    if (!parakeetEouOwner) return { cancelled: false };
    requireParakeetEouOwner(event.sender, meetingId);
    if (request.generation !== parakeetEouGeneration)
      return { cancelled: false };
    const backpressure = request.backpressure;
    if (
      request.code === 'parakeet_backpressure' &&
      (backpressure?.source === 'mic' || backpressure?.source === 'system') &&
      Number.isFinite(backpressure.retainedSeconds) &&
      Number.isFinite(backpressure.incomingSeconds) &&
      Number.isSafeInteger(backpressure.retainedBytes) &&
      typeof backpressure.inFlight === 'boolean'
    ) {
      console.warn('[ParakeetEOU] renderer audio backlog', {
        source: backpressure.source,
        retainedSeconds: backpressure.retainedSeconds,
        incomingSeconds: backpressure.incomingSeconds,
        retainedBytes: backpressure.retainedBytes,
        inFlight: backpressure.inFlight,
      });
    }
    const generation = parakeetEouGeneration;
    const code =
      typeof request.code === 'string' && request.code.trim()
        ? request.code.trim()
        : 'parakeet_cancelled';
    await eouCoordinator.cancel(meetingId, code);
    if (
      parakeetEouOwner?.id === event.sender.id &&
      parakeetEouGeneration === generation
    ) {
      parakeetEouOwner = null;
      parakeetEouGeneration = null;
    }
    return { cancelled: true };
  });

  let systemAudioPermissionVerified = false;

  ipcMain.handle('RECORDING_READINESS_STATUS', async () => {
    return await getRecordingReadinessStatus({
      parakeetFinalClient,
      parakeetModelRoot,
      audiocapPath: getAudioCapExecPath(),
      systemAudioPermission: systemAudioPermissionVerified,
    });
  });

  ipcMain.handle('RECORDING_READINESS_PREPARE', async (event, options = {}) => {
    if (options.verifyPermissions === true) {
      systemAudioPermissionVerified = await runAudioProbe({
        allowSilent: true,
        includeSelf: true,
        silentProbe: true,
        permissionRequest: true,
      });
    }
    return await prepareRecordingReadiness(
      {
        parakeetFinalClient,
        parakeetModelRoot,
        audiocapPath: getAudioCapExecPath(),
        systemAudioPermission: systemAudioPermissionVerified,
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
      {
        meetingId,
        startedAtMs,
        expectedSources,
        sourceAvailability,
        calendarOccurrenceKey,
      } = {},
    ) => {
      if (
        captureSessionLease.current() &&
        captureSessionLease.current()?.meetingId !== meetingId
      )
        throw new Error('capture_session_already_active');
      const prep =
        calendarOccurrenceKey !== undefined
          ? db.meetingPrepStore.claimStart(calendarOccurrenceKey, meetingId)
          : null;
      try {
        const manifest = await handleAudioCaptureJournalStart({
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
            systemAudioPermission: systemAudioPermissionVerified,
          },
          watchCaptureOwner,
          knowledgeSynthesisPause,
          getMeetingArtifactsRootDir,
          startParakeetLiveRecording,
          prepareCaptureIdentity: (id: string) => {
            const self = db.identityStore.getSelfPersonId();
            return () => db.identityStore.recordCapture(id, 'local', self);
          },
          audioKeyStore: encryptionRollout.encryptedCaptureWrites
            ? getAudioKeyStore()
            : null,
          encryptedCaptureRequired: encryptionRollout.encryptedCaptureWrites,
        });
        if (manifest.meetingId !== meetingId)
          throw new Error('capture_session_already_active');
        if (
          'generation' in manifest &&
          'artifactRootRelativePath' in manifest &&
          captureDiagnosticSession?.generation !== manifest.generation
        ) {
          const diagnosticPath = path.join(
            getMeetingArtifactsRootDir(),
            manifest.artifactRootRelativePath,
            'diagnostics.json',
          );
          captureDiagnosticSession = {
            meetingId: manifest.meetingId,
            generation: manifest.generation,
            ownerId: event.sender.id,
            report: createCaptureDiagnostics({
              persist: async (report) => {
                const temporaryPath = `${diagnosticPath}.${randomUUID()}.tmp`;
                try {
                  await fs.promises.writeFile(
                    temporaryPath,
                    JSON.stringify(report),
                    { mode: 0o600, flag: 'wx' },
                  );
                  await fs.promises.rename(temporaryPath, diagnosticPath);
                } catch {
                  captureLog.warn('Capture diagnostics could not be saved');
                } finally {
                  await fs.promises
                    .rm(temporaryPath, { force: true })
                    .catch(() => undefined);
                }
              },
            }),
          };
        }
        return manifest;
      } catch (error) {
        if (prep) db.meetingPrepStore.abortStart(meetingId);
        throw error;
      }
    },
  );

  ipcMain.handle('MEETING_PREP_RECORDING_STARTED', (event, meetingId) => {
    captureSessionLease.requireRecordingOwner(
      String(meetingId),
      event.sender.id,
    );
    db.meetingPrepStore.markStarted(String(meetingId));
    return true;
  });

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
      if (
        captureDiagnosticSession?.ownerId === event.sender.id &&
        captureDiagnosticSession.meetingId === normalizedMeetingId
      ) {
        captureDiagnosticSession = null;
      }
      try {
        await deleteCaptureJournal(
          getMeetingArtifactsRootDir(),
          normalizedMeetingId,
        );
      } finally {
        db.meetingPrepStore.abortStart(normalizedMeetingId);
        liveMeetingContextIndex.clear(normalizedMeetingId);
        if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
          knowledgeSynthesisPause.release('capture');
          captureLog.warn('Released: capture_start_aborted');
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

  ipcMain.handle('PARAKEET_EOU_READ_AUDIO', async (event, request = {}) => {
    const meetingId = String(request.meetingId || '');
    captureSessionLease.requireRecordingOwner(meetingId, event.sender.id);
    return readLiveJournalAudio(getMeetingArtifactsRootDir(), {
      meetingId,
      source: request.source,
      fromSeconds: request.fromSeconds,
    });
  });

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_SOURCE_FAILED',
    async (event, request = {}) => {
      const meetingId = String(request.meetingId || '');
      captureSessionLease.requireRecordingOwner(meetingId, event.sender.id);
      return await markCaptureJournalSourceFailed(
        getMeetingArtifactsRootDir(),
        {
          ...request,
          meetingId,
        },
      );
    },
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
    async (event, request = {}) => {
      const diagnostics = diagnosticsFor(event.sender.id, request);
      if (request.source === 'mic') diagnostics?.renderer(request.diagnostics);
      const started = performance.now();
      const data = Buffer.from(request.data ?? []);
      if (request.source === 'mic' || request.source === 'system')
        diagnostics?.writeStarted(request.source);
      try {
        const result = await persistCaptureJournalRawChunk(
          getMeetingArtifactsRootDir(),
          {
            ...request,
            meetingId: String(request.meetingId || ''),
            data,
          },
        );
        if (request.source === 'mic' || request.source === 'system')
          diagnostics?.written(
            request.source,
            'raw',
            data.length,
            performance.now() - started,
          );
        return result;
      } catch (error) {
        if (request.source === 'mic' || request.source === 'system')
          diagnostics?.writeFailed(request.source, 'raw');
        throw error;
      }
    },
  );

  ipcMain.handle(
    'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE',
    async (event, request = {}) => {
      const diagnostics = diagnosticsFor(event.sender.id, request);
      const started = performance.now();
      if (request.source === 'mic' || request.source === 'system')
        diagnostics?.writeStarted(request.source);
      let completed: Awaited<
        ReturnType<typeof completeCaptureJournalCapturedChunk>
      >;
      try {
        completed = await completeCaptureJournalCapturedChunk(
          getMeetingArtifactsRootDir(),
          {
            ...request,
            meetingId: String(request.meetingId || ''),
            ...(request.repairData
              ? { repairData: Buffer.from(request.repairData) }
              : {}),
          },
        );
        if (request.source === 'mic' || request.source === 'system')
          diagnostics?.written(
            request.source,
            'complete',
            0,
            performance.now() - started,
          );
      } catch (error) {
        if (request.source === 'mic' || request.source === 'system')
          diagnostics?.writeFailed(request.source, 'complete');
        throw error;
      }
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
    incrementalNotesCoordinator.cancel(normalizedMeetingId);
    const manifest = await stopCaptureJournal(getMeetingArtifactsRootDir(), {
      ...request,
      meetingId: normalizedMeetingId,
    });
    liveMeetingContextIndex.flush(normalizedMeetingId);
    await stopParakeetLiveRecording(normalizedMeetingId);
    captureSessionLease.markStopped(normalizedMeetingId, event.sender.id);
    if (
      captureDiagnosticSession?.meetingId === normalizedMeetingId &&
      captureDiagnosticSession.ownerId === event.sender.id
    ) {
      // Diagnostic IO is independent of the audio seal and cannot delay stop.
      void captureDiagnosticSession.report.stop();
      captureDiagnosticSession = null;
    }
    captureLog.info('Transitioned: capture_stopped');
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
        liveMeetingContextIndex.flush(normalizedMeetingId);
        liveMeetingContextIndex.clear(normalizedMeetingId, {
          retainCheckpoint: true,
        });
        if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
          knowledgeSynthesisPause.release('capture');
          captureLog.warn('Released: seal_failed_after_stop');
        }
        throw error;
      }
      if (captureSessionLease.release(normalizedMeetingId, event.sender.id)) {
        liveMeetingContextIndex.clear(normalizedMeetingId);
        knowledgeSynthesisPause.release('capture');
        captureLog.info('Released: capture_sealed');
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
    permissionRequest = false,
  }: {
    durationMs?: number;
    allowSilent?: boolean;
    includeSelf?: boolean;
    targetPids?: number[];
    silentProbe?: boolean;
    permissionRequest?: boolean;
  } = {}) => {
    if (
      canReuseRunningCaptureForProbe(Boolean(nativeAudioProcess), targetPids)
    ) {
      const runningProcess = nativeAudioProcess;
      return (
        (await nativeAudioReadiness) === true &&
        nativeAudioProcess === runningProcess
      );
    }

    const execPath = getAudioCapExecPath();
    if (!fs.existsSync(execPath)) {
      audioCapLog.error('AudioCap binary not found at:', execPath);
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
        permissionRequest
          ? 120_000
          : Math.max(3000, Math.floor(durationMs + 1500)),
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

  const detectActiveCall = createActiveCallDetector({
    runAudioProbe,
    browserInspectionEnabled: () =>
      db.getSetting('browser_call_detection_enabled') === 'true',
  });

  ipcMain.handle(
    'SYSTEM_AUDIO_PROBE',
    async (_event, { durationMs, allowSilent, silentProbe } = {}) => {
      const permitted = await runAudioProbe({
        durationMs,
        allowSilent: Boolean(allowSilent),
        includeSelf: true,
        silentProbe: Boolean(silentProbe),
        permissionRequest: true,
      });
      systemAudioPermissionVerified = permitted;
      return permitted;
    },
  );

  ipcMain.handle('DETECT_ACTIVE_CALL', async () => {
    return await detectActiveCall();
  });

  ipcMain.handle(
    'SHOW_ACTIVE_CALL_ALERT',
    async (_event, { appName, theme } = {}) => {
      if (typeof appName !== 'string') return false;
      const normalized = appName.trim();
      if (!normalized) return false;
      const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
      const anchorBounds =
        win && !win.isDestroyed() ? win.getBounds() : undefined;
      return activeCallAlertController.show(
        normalized,
        resolvedTheme,
        anchorBounds,
      );
    },
  );

  ipcMain.handle('HIDE_ACTIVE_CALL_ALERT', async () => {
    activeCallAlertController.closeCallAlert();
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

  ipcMain.handle(
    'SHOW_CALENDAR_PROMPT_ALERT',
    async (
      _event,
      payload?: {
        event?: {
          occurrenceKey?: string;
          title?: string;
          start?: string;
          hasConferenceLink?: boolean;
          attendeeCount?: number;
        };
      },
    ) => {
      const promptEvent = payload?.event;
      if (!promptEvent || typeof promptEvent.occurrenceKey !== 'string') {
        return false;
      }
      const anchorBounds =
        win && !win.isDestroyed() ? win.getBounds() : undefined;
      activeCallAlertController.showCalendarPrompt(
        {
          occurrenceKey: promptEvent.occurrenceKey,
          title: promptEvent.title?.trim() || 'Upcoming Meeting',
          start: promptEvent.start || new Date().toISOString(),
          hasConferenceLink: Boolean(promptEvent.hasConferenceLink),
          attendeeCount: promptEvent.attendeeCount,
        },
        anchorBounds,
      );
      return true;
    },
  );

  ipcMain.handle('HIDE_CALENDAR_PROMPT_ALERT', async () => {
    activeCallAlertController.closeCalendarPrompt();
    return true;
  });

  ipcMain.on(
    'CALENDAR_PROMPT_ALERT_ACTION',
    (
      _event,
      payload?: {
        action?: 'record' | 'prepare' | 'dismiss';
        occurrenceKey?: string;
      },
    ) => {
      if (payload?.action === 'record') {
        if (win) {
          if (!win.isVisible()) win.show();
          win.focus();
          win.webContents.send('CALENDAR_PROMPT_START_RECORDING', {
            occurrenceKey: payload.occurrenceKey,
          });
        }
      } else if (payload?.action === 'prepare') {
        if (win) {
          if (!win.isVisible()) win.show();
          win.focus();
          win.webContents.send('CALENDAR_PROMPT_PREPARE', {
            occurrenceKey: payload.occurrenceKey,
          });
        }
      } else if (payload?.action === 'dismiss') {
        if (win) {
          win.webContents.send('CALENDAR_PROMPT_DISMISSED', {
            occurrenceKey: payload?.occurrenceKey,
          });
        }
      }
      activeCallAlertController.closeCalendarPrompt();
    },
  );

  ipcMain.handle('BOOT_PROBE_STATUS', () => bootProbeDone);
  ipcMain.handle('BOOT_PROBE_MARK', () => {
    bootProbeDone = true;
    return true;
  });

  ipcMain.handle('NATIVE_AUDIO_START', async (event) => {
    if (!captureSessionLease.recordingForOwner(event.sender.id)) {
      captureLog.warn('Native audio rejected: owner_missing');
      throw new Error('capture_session_not_owned');
    }
    if (nativeAudioProcess) {
      const existingProcess = nativeAudioProcess;
      return (
        nativeAudioOwner?.id === event.sender.id &&
        (await nativeAudioReadiness) === true &&
        nativeAudioProcess === existingProcess
      );
    }

    // Locate binary: In dev 'resources/bin/audiocap', in prod 'process.resourcesPath/bin/audiocap'
    const execPath = getAudioCapExecPath();

    audioCapLog.info('Spawning AudioCap:', execPath);

    try {
      if (!fs.existsSync(execPath)) {
        console.error('[Pluto] AudioCap binary not found at:', execPath);
        return false;
      }

      const spawnedProcess = spawn(execPath);
      const captureOwner = event.sender;
      const diagnostics =
        captureDiagnosticSession?.ownerId === captureOwner.id
          ? captureDiagnosticSession.report
          : null;
      diagnostics?.nativeStarted();
      nativeAudioProcess = spawnedProcess;
      nativeAudioOwner = captureOwner;
      const pcmReady = waitForNativeAudioPcm(spawnedProcess);
      nativeAudioReadiness = pcmReady;

      spawnedProcess.stdout?.on('data', (chunk) => {
        // chunk is Buffer (PCM data)
        if (
          nativeAudioProcess === spawnedProcess &&
          !captureOwner.isDestroyed()
        ) {
          diagnostics?.received(chunk.length);
          captureOwner.send('NATIVE_AUDIO_CHUNK', chunk, Date.now());
          diagnostics?.forwarded(chunk.length);
        }
      });

      spawnedProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        if (nativeAudioProcess === spawnedProcess) diagnostics?.stderr(text);
        const line = text.trim();
        if (line) audioCapLog.debug(line);
      });

      const captureFailed = () => {
        if (nativeAudioProcess !== spawnedProcess) return;
        diagnostics?.event('native_failed');
        if (!captureOwner.isDestroyed()) {
          captureOwner.send('NATIVE_AUDIO_FAILURE');
        }
        nativeAudioProcess = null;
        nativeAudioOwner = null;
        nativeAudioReadiness = null;
      };
      spawnedProcess.on('error', captureFailed);
      spawnedProcess.on('close', (code) => {
        audioCapLog.info('AudioCap exited with code', code);
        captureFailed();
      });

      const nativeStarted = await pcmReady;
      if (!nativeStarted) {
        audioCapLog.error('AudioCap failed to produce PCM');
        if (nativeAudioProcess === spawnedProcess) {
          captureFailed();
          spawnedProcess.kill('SIGINT');
        }
        return false;
      }

      return nativeAudioProcess === spawnedProcess;
    } catch (e) {
      audioCapLog.error('Failed to spawn audiocap:', e);
      nativeAudioProcess = null;
      nativeAudioOwner = null;
      nativeAudioReadiness = null;
      return false;
    }
  });

  ipcMain.handle('NATIVE_AUDIO_STOP', async (event) => {
    if (
      nativeAudioProcess &&
      nativeAudioOwner &&
      nativeAudioOwner.id !== event.sender.id
    ) {
      captureLog.warn('Native audio stop rejected: owner_mismatch');
      return false;
    }
    if (nativeAudioProcess) audioCapLog.info('Stopping AudioCap...');
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
        void convertAudioToMonoWav({
          inputPath: rawPath,
          outputPath: wavPath,
          rawPcm: format === 'pcm',
        }).then((converted) => {
          if (converted) {
            console.log(
              `[Pluto] Conversion complete (${Date.now() - start}ms)`,
            );
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            resolve(wavPath);
          } else {
            console.warn('[Pluto] Conversion failed, skipping chunk');
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            resolve(null);
          }
        });
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

        const ok = await convertAudioToMonoWav({
          inputPath,
          outputPath,
          startSec,
          durationSec,
        });
        if (!ok) console.warn('[Pluto] Slice failed');

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

  ipcMain.handle('GET_MEETING_SPEAKER_SAMPLE', async (_event, request) => {
    const meetingId = String(request?.meetingId || '');
    beginMeetingTranscription(meetingId || null);
    try {
      const result = await loadSpeakerSample(request, {
        getMeeting: db.getMeetingSpeakerSampleSource,
        fileExists: (inputPath) => fs.existsSync(inputPath),
        createTemporaryPath: () =>
          path.join(app.getPath('temp'), `speaker-sample-${randomUUID()}.wav`),
        sliceWav: async ({ inputPath, outputPath, startSec, durationSec }) =>
          await convertAudioToMonoWav({
            inputPath,
            outputPath,
            startSec,
            durationSec,
          }),
        readFile: async (outputPath) => await fs.promises.readFile(outputPath),
        removeFile: async (outputPath) => {
          await fs.promises.unlink(outputPath);
        },
        readEncryptedSlice: async (input) => {
          const bytes = await readEncryptedMeetingSlice(input);
          if (!bytes) throw new Error('encrypted_audio_unavailable');
          return bytes;
        },
      });
      if (result.status === 'unavailable') {
        console.warn('[Pluto][SpeakerSample] excerpt unavailable', {
          meetingId,
          reason: result.reason,
        });
      }
      return result;
    } finally {
      endMeetingTranscription(meetingId || null);
    }
  });

  ipcMain.handle('GET_MEETING_SPEAKER_SAMPLE_AVAILABILITY', (_event, request) =>
    getSpeakerSampleAvailability(request, {
      getMeeting: db.getMeetingSpeakerSampleSource,
      fileExists: (inputPath) => fs.existsSync(inputPath),
    }),
  );

  const mixWavSources = async ({
    inputPaths,
    outputTag,
    meetingId,
  }: {
    inputPaths?: unknown[];
    outputTag?: string;
    meetingId?: string;
  }) => {
    if (!Array.isArray(inputPaths) || inputPaths.length < 2) return null;
    const validPaths = inputPaths.filter(
      (value): value is string =>
        typeof value === 'string' && value.length > 0 && fs.existsSync(value),
    );
    if (validPaths.length < 2) return null;

    const encryptedInputs = validPaths.filter((inputPath) =>
      inputPath.endsWith('.enc'),
    );
    if (encryptedInputs.length > 0) {
      if (encryptedInputs.length !== validPaths.length || !meetingId) {
        throw new Error('encrypted_audio_mix_context_invalid');
      }
      const manifest = await readCaptureJournalManifest(
        getMeetingArtifactsRootDir(),
        meetingId,
      );
      if (manifest.schemaVersion !== 4) {
        throw new Error('encrypted_audio_mix_manifest_invalid');
      }
      const keyResult = getAudioKeyStore()?.getMeetingAudioKey(meetingId);
      if (!keyResult || keyResult.keyId !== manifest.keyId) {
        throw new Error('audio_key_unavailable');
      }
      return await mixEncryptedAudioArtifacts({
        rootDir: getMeetingArtifactsRootDir(),
        inputPaths: [validPaths[0], validPaths[1]],
        context: {
          meetingId,
          generation: manifest.generation,
          keyId: manifest.keyId,
          meetingKey: keyResult.meetingKey,
        },
        signal: getAbortSignalForMeeting(meetingId),
      });
    }

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

    try {
      await runFfmpeg([
        ...validPaths.flatMap((inputPath) => ['-i', inputPath]),
        '-filter_complex',
        `amix=inputs=${validPaths.length}:duration=longest:normalize=0`,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'wav',
        outputPath,
      ]);
      console.log(`[Pluto] Mixed audio created: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.warn(
        '[Pluto] Mixed audio failed:',
        error instanceof Error ? error.message : error,
      );
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      return null;
    }
  };

  ipcMain.handle(
    'AUDIO_MIX_WAV',
    async (_event, { inputPaths, outputTag, meetingId } = {}) =>
      await mixWavSources({ inputPaths, outputTag, meetingId }),
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
  }) =>
    await stitchTimedWavSegments({
      segments,
      outputTag,
      outputDir: path.join(app.getPath('userData'), 'meetings'),
      tempDir: app.getPath('temp'),
      probeAudioDuration,
    });

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
        getAbortSignalForMeeting(String(meetingId || '')),
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

  ipcMain.handle('AUDIO_PROBE_DURATION', async (_event, input) => {
    const rawPath =
      typeof input === 'string' ? input : String(input?.audioPath || '');
    const meetingId =
      typeof input === 'object' && input ? String(input.meetingId || '') : '';
    if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
    const resolvedPath = path.resolve(rawPath);
    const meetingsRoot = path.resolve(app.getPath('userData'), 'meetings');
    if (!resolvedPath.startsWith(`${meetingsRoot}${path.sep}`)) return null;
    if (!fs.existsSync(resolvedPath)) return null;

    if (resolvedPath.endsWith('.enc')) {
      if (!meetingId) return null;
      const manifest = await readCaptureJournalManifest(
        getMeetingArtifactsRootDir(),
        meetingId,
      );
      const keyResult = getAudioKeyStore()?.getMeetingAudioKey(meetingId);
      if (
        manifest.schemaVersion !== 4 ||
        !keyResult ||
        keyResult.keyId !== manifest.keyId
      ) {
        return null;
      }
      return await probeEncryptedAudioDuration(resolvedPath, {
        meetingId,
        generation: manifest.generation,
        keyId: manifest.keyId,
        meetingKey: keyResult.meetingKey,
      });
    }
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
      if (
        result !== false &&
        meeting?.id != null &&
        typeof meeting.started_at === 'string'
      ) {
        const startedAt = new Date(meeting.started_at);
        const explicitEnd =
          typeof meeting.ended_at === 'string'
            ? new Date(meeting.ended_at)
            : null;
        const durationSeconds = Number(meeting.duration_seconds);
        const endedAt =
          explicitEnd && !Number.isNaN(explicitEnd.getTime())
            ? explicitEnd
            : Number.isFinite(durationSeconds) && durationSeconds > 0
              ? new Date(startedAt.getTime() + durationSeconds * 1000)
              : null;
        const prep = db.meetingPrepStore.forMeeting(String(meeting.id));
        if (prep) {
          db.calendarStore.setMeetingContext(
            String(meeting.id),
            prep.occurrenceKey,
            'user',
            prep.event,
          );
        } else if (!Number.isNaN(startedAt.getTime()) && endedAt) {
          db.calendarStore.associateMeeting(
            String(meeting.id),
            startedAt.toISOString(),
            endedAt.toISOString(),
          );
        }
      }
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
      if (result !== false) invalidateDreamingCatalog();
      return result;
    } catch (e) {
      console.error(
        '[Pluto] SAVE_MEETING failed',
        buildSaveMeetingFailureDiagnostic({
          meetingId: meeting?.id,
          expectedValidationRunId,
          expectedDownstreamRunId,
          claimValidationLease,
          transcriptOwnedFieldsOnly,
          error: e,
        }),
      );
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
  ipcMain.handle('UPDATE_MEETING_TITLE_IF_CURRENT', (_event, input) => {
    if (
      input?.source === 'generated' &&
      db.meetingPrepStore
        .forMeeting(String(input?.meetingId))
        ?.event.title.trim()
    )
      return false;
    const result = db.updateMeetingTitleIfCurrent(input);
    if (result) invalidateDreamingCatalog();
    return result;
  });
  ipcMain.handle(
    'CLAIM_TRANSCRIPT_VALIDATION_RETRY',
    (_event, meetingId, lease) =>
      db.claimMeetingTranscriptValidationRetry(meetingId, lease),
  );
  ipcMain.handle(
    'CLAIM_FINAL_TRANSCRIPTION',
    (_event, meetingId, lease, options) =>
      db.claimMeetingFinalTranscription(meetingId, lease, {
        manualRetry: options?.manualRetry === true,
      }),
  );
  ipcMain.handle(
    'UPDATE_FINAL_TRANSCRIPTION_STAGE',
    (_event, meetingId, runId, stage) =>
      db.updateMeetingFinalTranscriptionStage(meetingId, runId, stage),
  );
  ipcMain.handle('COMMIT_FINAL_TRANSCRIPTION', (_event, input) => {
    const committed = db.commitMeetingFinalTranscription(input);
    if (!committed) return committed;
    try {
      const reconciliation = reconcileSingletonManualParticipantIdentity({
        meetingId: String(input.meetingId),
        getMeeting: (meetingId) =>
          db.getMeeting(meetingId) as
            | { transcript_json?: string | null }
            | undefined,
        getMeetingEntities: db.getMeetingEntities,
        getCapture: db.identityStore.getCapture,
        getSelfPersonId: db.identityStore.getSelfPersonId,
        getBindings: db.identityStore.getBindings,
        isAutomaticBindingSuppressed:
          db.identityStore.isAutomaticBindingSuppressed,
        setBinding: db.identityStore.setBinding,
      });
      if (reconciliation.status === 'bind') {
        queueKnowledgeDocsRefreshForMeeting(String(input.meetingId));
        const personDoc = db.getKnowledgeDocByScope(
          'person_context',
          reconciliation.personId,
        );
        if (personDoc) queueKnowledgeDocRefresh(personDoc.id);
        invalidateDreamingCatalog();
      }
    } catch (error) {
      console.warn(
        '[Identity] Singleton participant mapping was skipped',
        error,
      );
    }
    try {
      const voiceReconciliation = reconcileVoiceMatchSpeakerIdentity({
        meetingId: String(input.meetingId),
        getCandidates: (meetingId) =>
          getMeetingSpeakerCandidates(meetingId, getApplicationDatabase()),
        getProfiles: () =>
          getCanonicalVoiceProfiles({
            dbInstance: getApplicationDatabase(),
            activeOnly: true,
          }),
        getRejections: (meetingId) =>
          getVoiceRejections(meetingId, getApplicationDatabase()),
        getBindings: db.identityStore.getBindings,
        isAutomaticBindingSuppressed:
          db.identityStore.isAutomaticBindingSuppressed,
        setBinding: db.identityStore.setBinding,
        ensureMeetingEntity: db.ensureMeetingEntity,
      });
      if (
        voiceReconciliation.status === 'bind' &&
        voiceReconciliation.assignments.length > 0
      ) {
        db.refreshMeetingIdentityProjection(String(input.meetingId));
        notifyMeetingIdentityUpdated(String(input.meetingId));
        queueKnowledgeDocsRefreshForMeeting(String(input.meetingId));
        for (const assignment of voiceReconciliation.assignments) {
          const personDoc = db.getKnowledgeDocByScope(
            'person_context',
            assignment.personId,
          );
          if (personDoc) queueKnowledgeDocRefresh(personDoc.id);
        }
        invalidateDreamingCatalog();
      }
    } catch (error) {
      console.warn(
        '[Identity] Voice match speaker reconciliation was skipped',
        error,
      );
    }
    return committed;
  });
  ipcMain.handle(
    'FAIL_FINAL_TRANSCRIPTION',
    (_event, meetingId, runId, failure, reasons, attributionDiagnostics) =>
      db.failMeetingFinalTranscription(
        meetingId,
        runId,
        failure,
        reasons,
        attributionDiagnostics,
      ),
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
        const updated = applyMeetingNotesUserEdit(
          editsMap,
          path,
          original,
          edited,
          new Date().toISOString(),
        );
        if (!updated.changed) return { success: true };
        db.saveMeeting({
          ...meeting,
          user_edits_json: JSON.stringify(updated.edits),
        });
        syncMeetingActionEntitiesFromUserEdits(
          getApplicationDatabase(),
          String(meetingId),
        );
        invalidateDreamingCatalog();
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
      const completion =
        typeof path === 'string' &&
        path.match(/^completion:(?:all_action_items|v2:action):(\d+)$/);
      if (completion) {
        delete editsMap[`completion:all_action_items:${completion[1]}`];
        delete editsMap[`completion:v2:action:${completion[1]}`];
      }
      db.saveMeeting({
        ...meeting,
        user_edits_json: JSON.stringify(editsMap),
      });
      syncMeetingActionEntitiesFromUserEdits(
        getApplicationDatabase(),
        String(meetingId),
      );
      invalidateDreamingCatalog();
      return { success: true };
    } catch (e) {
      console.error('[Pluto] REVERT_USER_EDIT failed:', e);
      throw e;
    }
  });

  const withNotesRun = (value: unknown) => {
    const meeting = value as db.PersistedMeeting | undefined;
    if (!meeting) return meeting;
    const run = db.getMeetingAnalysisRun(meeting.id);
    let identityState: unknown = null;
    try {
      identityState = handleIdentityRequest('GET_MEETING_IDENTITY', {
        meetingId: String(meeting.id),
      });
    } catch {
      // ignore
    }
    const speakerDisplayNames = db.getMeetingNotesIdentityProjection(
      meeting.id,
    ).speakerDisplayNames;
    const meetingEntities = db.getMeetingEntities(String(meeting.id));
    return {
      ...meeting,
      speaker_display_names: speakerDisplayNames,
      meeting_entities: meetingEntities,
      identity_state: identityState,
      analysis_run_json: JSON.stringify(
        run
          ? {
              ...run,
              automatic_attempts_exhausted:
                db.isMeetingAnalysisAutomaticRetryExhausted(meeting, run),
            }
          : null,
      ),
      notes_preview: meetingNotesRunCoordinator.getMeetingNotesPreview(
        meeting.id,
      ),
    };
  };
  ipcMain.handle('GET_MEETINGS', () => db.getMeetingSummaries());
  ipcMain.handle('GET_MEETING_PROCESSING_STATUSES', () =>
    db.getMeetingProcessingStatuses(),
  );
  ipcMain.handle('GET_MEETING_STATUS', (_event, id) => {
    const summary = db.getMeetingSummary(id);
    return summary
      ? {
          ...summary,
          notes_preview: meetingNotesRunCoordinator.getMeetingNotesPreview(id),
        }
      : summary;
  });
  ipcMain.handle('SEARCH_MEETING_SUMMARIES', (_event, query) =>
    typeof query === 'string' ? db.searchMeetingSummaries(query, 5) : [],
  );
  ipcMain.handle('GET_DASHBOARD_MEETING_PREVIEWS', () =>
    db.getMeetingDashboardPreviews(),
  );
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
    invalidateDreamingCatalog();
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
      liveMeetingContextIndex.clear(meetingId);

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
      invalidateDreamingCatalog();
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
      invalidateDreamingCatalog();
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
  ipcMain.handle('GET_PROJECT_BRIEF', (_event, projectId) =>
    db.getProjectBrief(projectId),
  );
  ipcMain.handle(
    'UPDATE_PROJECT_DISPLAY_TITLE',
    (_event, { projectId, title }) => {
      const result = db.updateProjectDisplayTitle(projectId, title);
      invalidateDreamingCatalog();
      return result;
    },
  );
  ipcMain.handle(
    'SET_PROJECT_PORTFOLIO_DISPOSITION',
    (_event, { projectId, disposition }) => {
      const result = db.setProjectPortfolioDisposition(projectId, disposition);
      invalidateDreamingCatalog();
      return result;
    },
  );
  ipcMain.handle(
    'SAVE_PROJECT_MILESTONE',
    (_event, { projectId, milestone }) => {
      const result = db.saveProjectMilestone(projectId, milestone);
      invalidateDreamingCatalog();
      return result;
    },
  );
  ipcMain.handle(
    'DELETE_PROJECT_MILESTONE',
    (_event, { projectId, milestoneId }) => {
      const result = db.deleteProjectMilestone(projectId, milestoneId);
      invalidateDreamingCatalog();
      return result;
    },
  );
  ipcMain.handle(
    'RESTORE_PROJECT_MILESTONE',
    (_event, { projectId, milestone }) => {
      const result = db.restoreProjectMilestone(projectId, milestone);
      invalidateDreamingCatalog();
      return result;
    },
  );
  ipcMain.handle(
    'MERGE_PROJECT',
    (_event, { projectId, destinationProjectId }) => {
      db.mergeProject(projectId, destinationProjectId);
      queueAllKnowledgeDocsRefresh();
      invalidateDreamingCatalog();
    },
  );
  ipcMain.handle('ADD_PROJECT_ALIAS', (_event, { projectId, aliasName }) => {
    db.addProjectAlias(String(projectId), String(aliasName));
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
  });
  ipcMain.handle('RESTORE_PROJECT_MERGE', (_event, projectId) => {
    db.restoreProjectMerge(projectId);
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
  });
  ipcMain.handle('UPDATE_PERSON_NAME', (_event, { personId, name }) => {
    const person = db.updatePersonName(String(personId), String(name));
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
    notifyMeetingIdentityUpdated();
    scheduleMeetingIdentityProjectionRefresh([String(personId), person.id]);
    return person;
  });
  ipcMain.handle('ADD_PERSON_NAME_ALIAS', (_event, { personId, aliasName }) => {
    db.addPersonNameAlias(String(personId), String(aliasName));
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
  });
  ipcMain.handle(
    'MERGE_PERSON',
    (_event, { personId, destinationPersonId }) => {
      db.mergePerson(String(personId), String(destinationPersonId));
      queueAllKnowledgeDocsRefresh();
      invalidateDreamingCatalog();
      notifyMeetingIdentityUpdated();
      scheduleMeetingIdentityProjectionRefresh([
        String(personId),
        String(destinationPersonId),
      ]);
    },
  );
  ipcMain.handle('RESTORE_PERSON_MERGE', (_event, personId) => {
    db.restorePersonMerge(String(personId));
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
    notifyMeetingIdentityUpdated();
    scheduleMeetingIdentityProjectionRefresh([String(personId)]);
  });
  const projectThemeSynthesisStateKey = 'project_theme_synthesis_state_v3';
  const readProjectThemeSynthesisState =
    (): ProjectThemeSynthesisState | null => {
      try {
        const parsed = JSON.parse(
          db.getSetting(projectThemeSynthesisStateKey) || 'null',
        );
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as ProjectThemeSynthesisState)
          : null;
      } catch {
        return null;
      }
    };
  let projectThemeSynthesis: Promise<
    Awaited<ReturnType<typeof synthesizeProjectThemes>>
  > | null = null;
  const runProjectThemeSynthesis = (options?: {
    retryFailed?: unknown;
    background?: boolean;
  }) => {
    if (projectThemeSynthesis) return projectThemeSynthesis;
    const canCollectSources = () =>
      !options?.background ||
      (Date.now() - lastRendererActivityAt >= DREAMING_RENDERER_QUIET_MS &&
        powerMonitor.getSystemIdleTime() * 1_000 >=
          DREAMING_RENDERER_QUIET_MS &&
        !isProjectScopeReviewBusy(knowledgeSynthesisPause.snapshot()));
    const deferredSynthesis = () => ({
      discovered: 0,
      remaining: 0,
      routingRemaining: 0,
      failed: 0,
      deferred: true,
    });
    // Admission must precede full-history notes/identity projection, not just
    // the later provider call. Background routing retries can run every 5s.
    if (!canCollectSources()) return Promise.resolve(deferredSynthesis());
    const sourceFromMeeting = (meeting: db.PersistedMeeting) => {
      const evidence = buildMeetingNotesEvidenceDocument(
        meeting,
        db.getMeetingNotesIdentityProjection(meeting.id).speakerDisplayNames,
      );
      if (!evidence.hasUsableNotes) return null;
      return {
        id: String(meeting.id),
        title: meeting.title,
        notes: [
          evidence.notesText,
          evidence.decisionsText && `Decisions:\n${evidence.decisionsText}`,
          evidence.actionItemsText && `Actions:\n${evidence.actionItemsText}`,
        ]
          .filter(Boolean)
          .join('\n'),
        startedAt: meeting.started_at || meeting.created_at,
        candidateProjects: db
          .getMeetingEntities(String(meeting.id))
          .filter((entity) => entity.type === 'project')
          .map((entity) => {
            const id = db.resolveProjectIdentityId(entity.id);
            return { id, name: entity.name };
          }),
      };
    };
    const publishProjects = () => {
      queueAllKnowledgeDocsRefresh();
      if (dreamingEntityQueue)
        invalidateDreamingWork(dreamingEntityQueue, () =>
          scheduleDreamingRun?.(),
        );
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send('MEETING_NOTES_UPDATED'),
      );
    };
    let sources: ProjectThemeSource[] = [];
    const synthesisDependencies = {
      listSources: () => sources,
      getSource: (id: string) => {
        const meeting = db.getMeeting(id) as db.PersistedMeeting | undefined;
        return meeting ? sourceFromMeeting(meeting) : null;
      },
      getState: readProjectThemeSynthesisState,
      saveState: (
        state: import('./projectThemeSynthesis').ProjectThemeSynthesisState,
      ) => db.setSetting(projectThemeSynthesisStateKey, JSON.stringify(state)),
      getProject: db.getEntity,
      listProjects: () => db.getProjectPortfolio(),
      saveTheme: db.saveSynthesizedProjectTheme,
      generate: async (
        prompt: string,
        responseSchema: Record<string, unknown>,
      ) => {
        const provider = await getProvider(await getAllSettings(db));
        return provider.synthesizeKnowledgeDocument(prompt, {
          purpose: 'projectScope',
          responseSchema,
          budget: { contextTokens: 32768, outputTokens: 8192 },
          workClass: options?.background ? 'background' : 'project_review',
          signal: AbortSignal.timeout(300_000),
        });
      },
      isBusy: () =>
        isProjectScopeReviewBusy(knowledgeSynthesisPause.snapshot()),
    };
    projectThemeSynthesis = (async () => {
      const collected = await collectProjectSynthesisSources({
        listMeetings: () => db.getMeetings() as db.PersistedMeeting[],
        buildSource: sourceFromMeeting,
        shouldContinue: canCollectSources,
      });
      if (!collected) return deferredSynthesis();
      sources = collected;
      const routing = await routeProjectCandidate(
        {
          ...synthesisDependencies,
          generate: async (
            prompt: string,
            responseSchema: Record<string, unknown>,
          ) => {
            const provider = await getProvider(await getAllSettings(db));
            return provider.synthesizeKnowledgeDocument(prompt, {
              purpose: 'projectScope',
              responseSchema,
              budget: { contextTokens: 32768, outputTokens: 1500 },
              workClass: options?.background ? 'background' : 'project_review',
              signal: AbortSignal.timeout(300_000),
            });
          },
          getState: (): ProjectRoutingState | null => {
            try {
              return JSON.parse(
                db.getSetting('project_routing_state_v1') || 'null',
              );
            } catch {
              return null;
            }
          },
          saveState: (state: ProjectRoutingState) =>
            db.setSetting('project_routing_state_v1', JSON.stringify(state)),
          saveMembership: db.saveProjectRoutingMembership,
        },
        { retryFailed: options?.retryFailed === true },
      );
      if (routing.grouped > 0) {
        publishProjects();
        // Routing changed memberships; theme synthesis needs fresh identities.
        const regrouped = await collectProjectSynthesisSources({
          listMeetings: () => db.getMeetings() as db.PersistedMeeting[],
          buildSource: sourceFromMeeting,
          shouldContinue: canCollectSources,
        });
        if (!regrouped) return deferredSynthesis();
        sources = regrouped;
      }
      if (!canCollectSources()) return deferredSynthesis();
      if (routing.deferred)
        return {
          discovered: routing.grouped,
          remaining: routing.remaining,
          routingRemaining: routing.remaining,
          failed: routing.failed,
          deferred: true,
        };
      const themes = await synthesizeProjectThemes(synthesisDependencies, {
        retryFailed: options?.retryFailed === true,
      });
      if (themes.discovered > 0) publishProjects();
      return {
        ...themes,
        discovered: themes.discovered + routing.grouped,
        remaining: themes.remaining + routing.remaining,
        routingRemaining: routing.remaining,
      };
    })().finally(() => {
      projectThemeSynthesis = null;
    });
    return projectThemeSynthesis;
  };
  ipcMain.handle('DISCOVER_PROJECT_INITIATIVE', (_event, options) =>
    runProjectThemeSynthesis(options),
  );
  let projectSynthesisTimer: ReturnType<typeof setTimeout> | null = null;
  scheduleProjectSynthesis = (delayMs = 60_000) => {
    if (projectSynthesisTimer) return;
    projectSynthesisTimer = setTimeout(async () => {
      projectSynthesisTimer = null;
      try {
        const result = await runProjectThemeSynthesis({ background: true });
        if (
          result.deferred ||
          (result.remaining > 0 &&
            (result.failed === 0 ||
              ('routingRemaining' in result &&
                Number(result.routingRemaining) > 0)))
        )
          scheduleProjectSynthesis?.(
            'routingRemaining' in result && Number(result.routingRemaining) > 0
              ? 5000
              : 60_000,
          );
      } catch {
        console.error(
          '[Projects] Background project synthesis failed; retry is available in Projects.',
        );
      }
    }, delayMs);
    projectSynthesisTimer.unref?.();
  };
  app.once('before-quit', () => {
    scheduleProjectSynthesis = null;
    if (projectSynthesisTimer) clearTimeout(projectSynthesisTimer);
  });
  scheduleProjectSynthesis();
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
  ipcMain.handle('UPDATE_ENTITY_STATUS', (_event, { id, status }) => {
    const result = db.updateEntityStatus(id, status);
    invalidateDreamingCatalog();
    return result;
  });
  ipcMain.handle('UPDATE_ACTION_COMMITMENT_STATE', (_event, payload) =>
    handleActionCommitmentReview(payload, {
      updateActionCommitmentState: db.updateActionCommitmentState,
      queueKnowledgeRefresh: () => {
        queueAllKnowledgeDocsRefresh();
        invalidateDreamingCatalog();
      },
    }),
  );
  ipcMain.handle('DELETE_ENTITY', (_event, id) => {
    const result = db.deleteEntity(id);
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
    if (result.affectedMeetingIds && result.affectedMeetingIds.length > 0) {
      for (const meetingId of result.affectedMeetingIds) {
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('MEETING_IDENTITY_UPDATED', meetingId);
          win.webContents.send('MEETING_NOTES_UPDATED', meetingId);
        });
      }
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('ENTITY_DELETED', id);
    });
    return result;
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
      invalidateDreamingCatalog();
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
      const saved = db.addMeetingEntity(meetingEntity);
      invalidateDreamingCatalog();
      return saved;
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
  ipcMain.handle('GET_PEOPLE_BRIEFING_SUMMARIES', () =>
    db.getPeopleBriefingSummaries(),
  );
  ipcMain.handle('GET_PERSON_BRIEFING', (_event, personId) =>
    db.getPersonBriefing(String(personId), { ensureKnowledgeDoc: true }),
  );
  const personChatEnabled = process.env.PERSON_CHAT_V1 !== 'false';
  const readPersonChatMeeting = getApplicationDatabase().prepare(`
    SELECT id, title, started_at, created_at, user_notes,
           enhanced_notes, transcript_status, transcript_validated_at
    FROM meetings WHERE id = ?
  `);

  ipcMain.handle(
    'intelligence:workspace-chat:list-threads',
    (_event, payload: { includeArchived?: unknown } | undefined) =>
      workspaceChatStore.listThreads(payload?.includeArchived === true),
  );
  ipcMain.handle('intelligence:workspace-chat:create-thread', () =>
    workspaceChatStore.createThread(),
  );
  ipcMain.handle(
    'intelligence:workspace-chat:archive-thread',
    (_event, threadId: unknown) =>
      workspaceChatStore.archiveThread(String(threadId ?? '')),
  );
  ipcMain.handle(
    'intelligence:workspace-chat:resume-thread',
    (_event, threadId: unknown) =>
      workspaceChatStore.resumeThread(String(threadId ?? '')),
  );
  ipcMain.handle(
    'intelligence:workspace-chat:list-messages',
    (_event, threadId: unknown) =>
      workspaceChatStore.listMessages(String(threadId ?? '')),
  );
  ipcMain.handle(
    'intelligence:workspace-chat:append-message',
    (
      _event,
      payload: {
        id?: unknown;
        threadId?: unknown;
        role?: unknown;
        content?: unknown;
        payload?: unknown;
      },
    ) => {
      const role = payload?.role;
      if (role !== 'user' && role !== 'assistant') {
        throw new Error('Workspace chat message role is invalid');
      }
      return workspaceChatStore.appendMessage({
        ...(typeof payload?.id === 'string' && payload.id.trim()
          ? { id: payload.id.trim().slice(0, 200) }
          : {}),
        threadId: String(payload?.threadId ?? ''),
        role,
        content: String(payload?.content ?? '').slice(0, 24_000),
        payload:
          payload?.payload && typeof payload.payload === 'object'
            ? (payload.payload as WorkspaceChatMessagePayload)
            : {},
      });
    },
  );
  ipcMain.handle(
    'intelligence:workspace-chat:update-message-payload',
    (
      _event,
      payload: {
        threadId?: unknown;
        messageId?: unknown;
        payload?: unknown;
      },
    ) =>
      workspaceChatStore.updateMessagePayload({
        threadId: String(payload?.threadId ?? ''),
        messageId: String(payload?.messageId ?? ''),
        payload:
          payload?.payload && typeof payload.payload === 'object'
            ? (payload.payload as WorkspaceChatMessagePayload)
            : {},
      }),
  );
  ipcMain.handle(
    'intelligence:workspace-chat:update-memory',
    (_event, payload: { threadId?: unknown; memory?: WorkspaceChatMemory }) =>
      workspaceChatStore.updateMemory(
        String(payload?.threadId ?? ''),
        payload?.memory ?? { corrections: [], unresolvedQuestions: [] },
      ),
  );

  ipcMain.handle('intelligence:person-chat:capability', () => ({
    enabled: personChatEnabled,
  }));
  ipcMain.handle(
    'intelligence:person-chat:list-threads',
    (_event, payload: { personId?: unknown; includeArchived?: unknown }) =>
      personChatEnabled
        ? personChatStore.listThreads(
            String(payload?.personId ?? ''),
            payload?.includeArchived === true,
          )
        : [],
  );
  ipcMain.handle(
    'intelligence:person-chat:create-thread',
    (_event, personId) => {
      if (!personChatEnabled) throw new Error('Person Chat is disabled');
      return personChatStore.createThread(String(personId));
    },
  );
  ipcMain.handle(
    'intelligence:person-chat:archive-thread',
    (_event, payload: { personId?: unknown; threadId?: unknown }) => {
      if (!personChatEnabled) throw new Error('Person Chat is disabled');
      return personChatStore.archiveThread(
        String(payload?.threadId ?? ''),
        String(payload?.personId ?? ''),
      );
    },
  );
  ipcMain.handle(
    'intelligence:person-chat:resume-thread',
    (_event, payload: { personId?: unknown; threadId?: unknown }) => {
      if (!personChatEnabled) throw new Error('Person Chat is disabled');
      return personChatStore.resumeThread(
        String(payload?.threadId ?? ''),
        String(payload?.personId ?? ''),
      );
    },
  );
  ipcMain.handle(
    'intelligence:person-chat:delete-thread',
    (_event, payload: { personId?: unknown; threadId?: unknown }) => {
      if (!personChatEnabled) throw new Error('Person Chat is disabled');
      personChatStore.deleteThread(
        String(payload?.threadId ?? ''),
        String(payload?.personId ?? ''),
      );
      return { deleted: true };
    },
  );
  ipcMain.handle(
    'intelligence:person-chat:list-messages',
    (_event, payload: { personId?: unknown; threadId?: unknown }) =>
      personChatStore.listMessages(
        String(payload?.threadId ?? ''),
        String(payload?.personId ?? ''),
      ),
  );
  ipcMain.handle(
    'intelligence:person-chat:send',
    async (event, rawRequest: Partial<PersonChatSendRequest>) => {
      const startedAt = Date.now();
      const requestId = String(rawRequest?.requestId ?? '').trim();
      const personId = String(rawRequest?.personId ?? '').trim();
      const threadId = String(rawRequest?.threadId ?? '').trim();
      const query = String(rawRequest?.query ?? '')
        .trim()
        .slice(0, 4_000);
      if (
        !personChatEnabled ||
        !requestId ||
        !personId ||
        !threadId ||
        !query
      ) {
        return {
          status: 'unavailable',
          message: null,
          rationale: 'The person chat request was invalid.',
        } satisfies PersonChatResponse;
      }

      for (const active of activePersonChatQueries.values()) {
        if (active.ownerId === event.sender.id) {
          active.controller.abort(
            new DOMException('Person chat request replaced', 'AbortError'),
          );
        }
      }
      const controller = new AbortController();
      let settle = () => {};
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const activeKey = `${event.sender.id}:${requestId}`;
      activePersonChatQueries.set(activeKey, {
        controller,
        ownerId: event.sender.id,
        settled,
      });
      const sendStatus = (status: 'reading_person' | 'answering') => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('intelligence:person-chat:status', {
            requestId,
            status,
          });
        }
      };
      let streamedAnswer = '';
      let firstTokenAt: number | null = null;
      try {
        const priorPersonMessages = personChatStore.listMessages(
          threadId,
          personId,
        );
        const previousPersonAnswer = [...priorPersonMessages]
          .reverse()
          .find((message) => message.role === 'assistant')?.content;
        personChatStore.appendMessage({
          threadId,
          personId,
          role: 'user',
          content: query,
        });
        const quickReply = getPersonChatQuickReply(query, previousPersonAnswer);
        if (quickReply) {
          const message = personChatStore.appendMessage({
            threadId,
            personId,
            role: 'assistant',
            content: quickReply,
          });
          return {
            status: 'answered',
            message,
          } satisfies PersonChatResponse;
        }
        sendStatus('reading_person');
        const detail = db.getPersonBriefing(personId);
        if (!detail) throw new Error('Person not found');
        const context = buildPersonChatContext({
          detail,
          query,
          getMeeting: (meetingId) =>
            readPersonChatMeeting.get(meetingId) as
              | db.PersistedMeeting
              | undefined,
        });
        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        const messages = personChatStore
          .listMessages(threadId, personId)
          .slice(0, -1);
        const prompt = buildPersonChatPrompt({
          query,
          context,
          messages,
        });
        sendStatus('answering');
        const returnedAnswer = await provider.answerAskPluto(prompt, {
          signal: controller.signal,
          mode: 'fast',
          onToken: (delta) => {
            if (delta && firstTokenAt === null) firstTokenAt = Date.now();
            streamedAnswer += delta;
            if (!event.sender.isDestroyed() && delta) {
              event.sender.send('intelligence:person-chat:delta', {
                requestId,
                delta,
              });
            }
          },
        });
        const content = (returnedAnswer || streamedAnswer).trim();
        if (!content)
          throw new Error('Person Chat provider returned no answer');
        console.info('[Pluto][Person Chat] provider-response', {
          requestId,
          firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
          totalMs: Date.now() - startedAt,
          promptChars: prompt.length,
          evidenceChars: context.evidence.length,
          meetingSourceCount: context.citations.length,
        });
        const message = personChatStore.appendMessage({
          threadId,
          personId,
          role: 'assistant',
          content,
          citations: context.citations,
        });
        return {
          status: 'answered',
          message,
        } satisfies PersonChatResponse;
      } catch (error) {
        if (controller.signal.aborted) {
          const partial = streamedAnswer.trim();
          const message = partial
            ? personChatStore.appendMessage({
                threadId,
                personId,
                role: 'assistant',
                content: partial,
                status: 'interrupted',
              })
            : null;
          return {
            status: 'cancelled',
            message,
          } satisfies PersonChatResponse;
        }
        console.error('[Pluto][Person Chat] failed:', error);
        return {
          status: 'unavailable',
          message: null,
          rationale:
            error instanceof PersonChatThreadArchivedError
              ? 'This conversation is archived. Resume it before asking another question.'
              : inferenceTransportErrorRationale(error),
        } satisfies PersonChatResponse;
      } finally {
        settle();
        if (activePersonChatQueries.get(activeKey)?.controller === controller) {
          activePersonChatQueries.delete(activeKey);
        }
      }
    },
  );
  ipcMain.handle(
    'intelligence:person-chat:cancel',
    async (event, rawRequestId: unknown) => {
      const requestId = String(rawRequestId ?? '');
      const active = activePersonChatQueries.get(
        `${event.sender.id}:${requestId}`,
      );
      if (!active) return { cancelled: false };
      active.controller.abort(
        new DOMException('Person chat request cancelled', 'AbortError'),
      );
      await Promise.race([
        active.settled,
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
      return { cancelled: true };
    },
  );
  ipcMain.handle(
    'RESOLVE_PERSON_COMMITMENT_OWNER',
    (_event, { actionId, personId }) => {
      const action = db.correctActionOwner(
        String(actionId),
        personId === null ? null : String(personId),
      );
      queueAllKnowledgeDocsRefresh();
      invalidateDreamingCatalog();
      return action;
    },
  );
  ipcMain.handle(
    'RECORD_ENTITY_CORRECTION',
    (
      _event,
      input: {
        entityId: string;
        itemType: string;
        fingerprint: string;
        reason?: string;
      },
    ) => {
      const correction = db.recordEntityCorrection(input);
      invalidateDreamingCatalog();
      return correction;
    },
  );
  ipcMain.handle('GET_ENTITY_CORRECTIONS', (_event, entityId: string) => {
    return db.getEntityCorrections(String(entityId));
  });
  ipcMain.handle('GET_ENTITY_ALIAS_SUGGESTIONS', (_event, entityId: string) => {
    return db.getEntityAliasSuggestions(String(entityId));
  });
  ipcMain.handle(
    'UPDATE_ENTITY_ALIAS_SUGGESTION_STATUS',
    (
      _event,
      {
        id,
        status,
      }: { id: string; status: 'pending' | 'merged' | 'dismissed' },
    ) => {
      db.updateEntityAliasSuggestionStatus(id, status);
      return { success: true };
    },
  );
  ipcMain.handle(
    'TRIGGER_DREAMING_NOW',
    async (
      _event,
      options: { entityId: string },
    ): Promise<IdleDreamingResult> => {
      if (
        !options ||
        typeof options.entityId !== 'string' ||
        !options.entityId.trim()
      ) {
        return { status: 'invalid_request', errorCode: 'entity_id_required' };
      }
      return (
        (await idleDreamingCoordinator?.triggerNow(options)) ?? {
          status: 'no_work',
        }
      );
    },
  );
  const getCurrentDreamingSourceRevision = (
    entityId: string,
    entityType: DreamingEntityType,
  ): string | null => {
    const packaged = packageEntityNotes(entityId);
    return packaged?.entityType === entityType ? packaged.sourceRevision : null;
  };

  ipcMain.handle(
    'GET_PENDING_DREAMING_PROPOSALS',
    (_event, input: unknown): DreamingProposalRecord[] => {
      const scope = parseDreamingProposalScope(input, db.getEntity);
      return db.dreamingProposalStore.listPendingProposals(
        scope.entityId,
        scope.entityType,
      );
    },
  );
  ipcMain.handle(
    'ACCEPT_DREAMING_PROPOSAL',
    (_event, input: unknown): DreamingDecisionResult => {
      const decision = assertScopedPendingProposal(
        input,
        db.getEntity,
        db.dreamingProposalStore.listPendingProposals,
      );
      return db.dreamingProposalStore.acceptDreamingProposal({
        proposalId: decision.proposalId,
        getCurrentSourceRevision: getCurrentDreamingSourceRevision,
      });
    },
  );
  ipcMain.handle(
    'REJECT_DREAMING_PROPOSAL',
    (_event, input: unknown): DreamingDecisionResult => {
      const decision = assertScopedPendingProposal(
        input,
        db.getEntity,
        db.dreamingProposalStore.listPendingProposals,
      );
      return db.dreamingProposalStore.rejectDreamingProposal({
        proposalId: decision.proposalId,
        getCurrentSourceRevision: getCurrentDreamingSourceRevision,
      });
    },
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
  const importLocalArtifactFile = async (filePath: string) => {
    assertFeatureEnabled('sources');
    const stat = await fs.promises.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isPagesPackage = ext === '.pages' && stat.isDirectory();
    if (!stat.isFile() && !isPagesPackage) return null;
    const isDocument = ext === '.pdf' || ext === '.docx' || ext === '.pages';
    const maxSize = isDocument ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
    if (stat.isFile() && stat.size > maxSize) {
      throw new Error('artifact_too_large');
    }
    const content = await extractArtifactContent(filePath);
    return db.saveLocalArtifact(
      createLocalArtifactRecord({
        path: filePath,
        content,
        capturedAt: stat.mtime.toISOString(),
      }),
    );
  };

  ipcMain.handle('LOCAL_ARTIFACTS_LIST', () => {
    assertFeatureEnabled('sources');
    return db.listLocalArtifacts();
  });
  ipcMain.handle('LOCAL_ARTIFACTS_IMPORT', async () => {
    assertFeatureEnabled('sources');
    const selection = await dialog.showOpenDialog(win!, {
      title: 'Add local sources',
      buttonLabel: 'Add to Pluto',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All supported sources',
          extensions: ['md', 'markdown', 'txt', 'text', 'pdf', 'docx', 'pages'],
        },
        { name: 'Word documents', extensions: ['docx'] },
        { name: 'Pages documents', extensions: ['pages'] },
        { name: 'PDF documents', extensions: ['pdf'] },
        {
          name: 'Notes & Markdown',
          extensions: ['md', 'markdown', 'txt', 'text'],
        },
      ],
    });
    if (selection.canceled) return [];

    const imported = [];
    for (const filePath of selection.filePaths) {
      const saved = await importLocalArtifactFile(filePath);
      if (saved) imported.push(saved);
    }
    return imported;
  });
  ipcMain.handle(
    'LOCAL_ARTIFACTS_IMPORT_PATHS',
    async (_event, paths: unknown) => {
      assertFeatureEnabled('sources');
      if (!Array.isArray(paths)) return [];
      const imported = [];
      for (const filePath of paths) {
        if (typeof filePath !== 'string') continue;
        const saved = await importLocalArtifactFile(filePath);
        if (saved) imported.push(saved);
      }
      return imported;
    },
  );
  ipcMain.handle(
    'LOCAL_ARTIFACTS_SET_STATUS',
    (_event, input: { id?: unknown; status?: unknown }) => {
      assertFeatureEnabled('sources');
      const id = typeof input?.id === 'string' ? input.id : '';
      const status = input?.status;
      if (
        !id ||
        (status !== 'active' && status !== 'noisy' && status !== 'excluded')
      ) {
        throw new Error('invalid_local_artifact_status');
      }
      const artifact = db.setLocalArtifactStatus(id, status);
      if (!artifact) throw new Error('local_artifact_not_found');
      return artifact;
    },
  );
  ipcMain.handle('LOCAL_ARTIFACTS_DELETE', (_event, id: unknown) => {
    assertFeatureEnabled('sources');
    if (typeof id !== 'string' || !id) return false;
    return db.deleteLocalArtifact(id);
  });
  ipcMain.handle('MEETING_ARTIFACTS_LIST', (_event, meetingId: unknown) => {
    assertFeatureEnabled('sources');
    if (!meetingId) return [];
    return db.listArtifactsForMeeting(String(meetingId));
  });
  ipcMain.handle(
    'MEETING_ARTIFACTS_ATTACH',
    (_event, input: { meetingId?: unknown; artifactId?: unknown }) => {
      assertFeatureEnabled('sources');
      const meetingId = input?.meetingId;
      const artifactId = input?.artifactId;
      if (!meetingId || typeof artifactId !== 'string' || !artifactId) {
        return false;
      }
      return db.attachArtifactToMeeting(String(meetingId), artifactId);
    },
  );
  ipcMain.handle(
    'MEETING_ARTIFACTS_DETACH',
    (_event, input: { meetingId?: unknown; artifactId?: unknown }) => {
      assertFeatureEnabled('sources');
      const meetingId = input?.meetingId;
      const artifactId = input?.artifactId;
      if (!meetingId || typeof artifactId !== 'string' || !artifactId) {
        return false;
      }
      return db.detachArtifactFromMeeting(String(meetingId), artifactId);
    },
  );
  ipcMain.handle(
    'MEETING_ARTIFACTS_IMPORT_AND_ATTACH',
    async (_event, meetingId: unknown) => {
      assertFeatureEnabled('sources');
      if (!meetingId) return [];
      const selection = await dialog.showOpenDialog(win!, {
        title: 'Attach document to meeting',
        buttonLabel: 'Attach to meeting',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'All supported sources',
            extensions: [
              'md',
              'markdown',
              'txt',
              'text',
              'pdf',
              'docx',
              'pages',
            ],
          },
          { name: 'Word documents', extensions: ['docx'] },
          { name: 'Pages documents', extensions: ['pages'] },
          { name: 'PDF documents', extensions: ['pdf'] },
          {
            name: 'Notes & Markdown',
            extensions: ['md', 'markdown', 'txt', 'text'],
          },
        ],
      });
      if (selection.canceled) return [];

      const imported = [];
      for (const filePath of selection.filePaths) {
        const saved = await importLocalArtifactFile(filePath);
        if (saved) {
          db.attachArtifactToMeeting(String(meetingId), saved.id);
          imported.push(saved);
        }
      }
      return imported;
    },
  );
  ipcMain.handle(
    'MEETING_ARTIFACTS_IMPORT_PATHS_AND_ATTACH',
    async (_event, input: { meetingId?: unknown; paths?: unknown }) => {
      assertFeatureEnabled('sources');
      const meetingId = input?.meetingId;
      const paths = input?.paths;
      if (!meetingId || !Array.isArray(paths)) return [];
      const imported = [];
      for (const filePath of paths) {
        if (typeof filePath !== 'string') continue;
        const saved = await importLocalArtifactFile(filePath);
        if (saved) {
          db.attachArtifactToMeeting(String(meetingId), saved.id);
          imported.push(saved);
        }
      }
      return imported;
    },
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
    return refreshKnowledgeDocNow(docId, { userRequested: true });
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
    invalidateDreamingCatalog();
    return updated;
  });
  ipcMain.handle('RESOLVE_CONFLICT', (_event, { winnerId, loserId }) => {
    const result = db.resolveConflictLinks(winnerId, loserId);
    queueAllKnowledgeDocsRefresh();
    invalidateDreamingCatalog();
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
  chatgptConnection = createPlutoMcpConnection({
    dataSource: createPlutoMcpDataSource(getApplicationDatabase()),
    directory: path.join(app.getPath('userData'), 'chatgpt-connection'),
    installPlugin: async (connectionFile) => {
      const installed = installPlutoLocalPlugin({
        homeDirectory: app.getPath('home'),
        executablePath: process.execPath,
        bridgePath: app.isPackaged
          ? path.join(process.resourcesPath, 'mcp', 'pluto-mcp-bridge.mjs')
          : path.join(
              app.getAppPath(),
              'resources',
              'mcp',
              'pluto-mcp-bridge.mjs',
            ),
        connectionFile,
        logoPath: path.join(
          app.getAppPath(),
          app.isPackaged ? 'dist' : 'public',
          'dock-icon.png',
        ),
        pluginName: app.isPackaged ? 'pluto-notes' : 'pluto-notes-development',
      });
      await installInChatGptDesktop({
        homeDirectory: app.getPath('home'),
        ...installed,
      });
      return installed;
    },
    readEnabled: () => db.getSetting(PLUTO_MCP_ENABLED_SETTING) === 'true',
    writeEnabled: (enabled) => {
      db.setSetting(PLUTO_MCP_ENABLED_SETTING, String(enabled));
    },
  });
  await chatgptConnection.initialize();
  ipcMain.handle('PLUTO_MCP_GET_STATUS', () => chatgptConnection?.getStatus());
  ipcMain.handle('PLUTO_MCP_SET_ENABLED', (_event, payload: unknown) => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('enabled' in payload) ||
      typeof payload.enabled !== 'boolean'
    )
      throw new Error('invalid_connection_setting');
    return chatgptConnection?.setEnabled(payload.enabled);
  });
  ipcMain.handle('PLUTO_MCP_OPEN_SETUP_GUIDE', async () => {
    await shell.openExternal(PLUTO_MCP_SETUP_URL);
  });
  ipcMain.handle(
    'PLUTO_MCP_OPEN_CHATGPT',
    () =>
      new Promise<void>((resolve, reject) => {
        if (process.platform !== 'darwin')
          return reject(new Error('chatgpt_desktop_requires_macos'));
        execFile(
          '/usr/bin/open',
          ['-a', 'ChatGPT'],
          { timeout: 10_000 },
          (error) => {
            if (error) reject(new Error('chatgpt_desktop_unavailable'));
            else resolve();
          },
        );
      }),
  );
  ipcMain.handle('GET_SETTING', (_event, key) => {
    if (typeof key !== 'string' || isSecretSettingKey(key)) {
      throw new Error('secret_setting_requires_credential_ipc');
    }
    return db.getSetting(key);
  });
  ipcMain.handle('SET_SETTING', (_event, { key, value }) => {
    if (typeof key !== 'string' || isSecretSettingKey(key)) {
      throw new Error('secret_setting_requires_credential_ipc');
    }
    const result = db.setSetting(key, String(value));
    invalidateProviderCache();
    return result;
  });
  const getMeetingNotesTemplateSettings = () =>
    createMeetingNotesTemplateSettingsSnapshot(
      db.getSetting(MEETING_NOTES_DEFAULT_TEMPLATE_SETTING),
      db.getSetting(MEETING_NOTES_TEMPLATE_OVERRIDES_SETTING),
    );
  ipcMain.handle('GET_MEETING_NOTES_TEMPLATE_SETTINGS', () =>
    getMeetingNotesTemplateSettings(),
  );
  ipcMain.handle('UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS', (_event, update) => {
    const next = applyMeetingNotesTemplateSettingsUpdate(
      getMeetingNotesTemplateSettings(),
      update,
    );
    db.setSetting(
      MEETING_NOTES_DEFAULT_TEMPLATE_SETTING,
      next.defaultTemplateId,
    );
    db.setSetting(
      MEETING_NOTES_TEMPLATE_OVERRIDES_SETTING,
      JSON.stringify(next.overrides),
    );
    return next;
  });
  const parseCloudProvider = (value: unknown): CloudProviderId => {
    if (
      value === 'openai' ||
      value === 'openrouter' ||
      value === 'gemini' ||
      value === 'claude'
    ) {
      return value;
    }
    throw new Error('invalid_cloud_provider');
  };
  ipcMain.handle('PROVIDER_CREDENTIAL_STATUS', (_event, provider) =>
    db.getCredentialStatus(parseCloudProvider(provider)),
  );
  ipcMain.handle(
    'PROVIDER_CREDENTIAL_SET',
    (_event, input: { provider?: unknown; value?: unknown }) => {
      const provider = parseCloudProvider(input?.provider);
      if (typeof input?.value !== 'string' || !input.value.trim()) {
        throw new Error('invalid_provider_credential');
      }
      db.setCredential(provider, input.value.trim());
      invalidateProviderCache();
      return db.getCredentialStatus(provider);
    },
  );
  ipcMain.handle('PROVIDER_CREDENTIAL_DELETE', (_event, provider) => {
    const parsed = parseCloudProvider(provider);
    db.deleteCredential(parsed);
    invalidateProviderCache();
    return db.getCredentialStatus(parsed);
  });
  ipcMain.handle('AUDIO_RETENTION_GET_STATUS', () => audioRetention.inspect());
  ipcMain.handle('DATABASE_STORAGE_MODE', () =>
    resolveDatabaseStorageMode(path.join(app.getPath('userData'), 'pluto.db')),
  );
  ipcMain.handle('AUDIO_RETENTION_SET_BUDGET', async (_event, value) => {
    const parsed = parseAudioStorageBudgetGb(value);
    const normalized = parsed === null ? 'unlimited' : String(parsed);
    if (String(value) !== normalized) {
      throw new Error('invalid_audio_storage_budget');
    }
    db.setSetting(AUDIO_STORAGE_BUDGET_SETTING, normalized);
    return await audioRetention.sweep();
  });
  ipcMain.handle('AUDIO_RETENTION_DELETE_MEETING', async (_event, id) => {
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new Error('invalid_audio_retention_meeting');
    }
    const meeting = db.getMeeting(id) as db.PersistedMeeting | undefined;
    if (!meeting) throw new Error('meeting_not_found');
    return await audioRetention.deleteMeetingAudio(meeting);
  });

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
        input.reason !== 'secondary') ||
      (input.template !== undefined && !isMeetingNotesTemplate(input.template))
    ) {
      throw new Error('invalid_meeting_notes_request');
    }
    return await meetingNotesRunCoordinator.generateAndPublishMeetingNotes({
      meetingId: input.meetingId,
      requestId: input.requestId,
      template: input.template,
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

  ipcMain.handle('RETRY_FAILED_SECONDARY_RUNS', async () => {
    secondaryAttempts.clear();
    const meetingIds = db.listMeetingIdsWithFailedSecondary();
    scheduleSecondaryRecovery(0);
    return { enqueued: meetingIds };
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
            compactWriterContract: true,
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
      llmLog.info(`Using provider: ${provider.name}`);
      return await provider.extractSpeakerIdentity(transcript);
    } catch (error) {
      llmLog.error('Speaker extraction failed:', error);
      return null; // Graceful fallback
    }
  });

  ipcMain.handle('GENERATE_TITLE', async (_event, { transcript }) => {
    try {
      if (!transcript || !transcript.trim()) return 'New Meeting';
      const settings = await getAllSettings(db);
      const provider = await getProvider(settings);
      llmLog.info(`Generating title with provider: ${provider.name}`);
      return await provider.generateTitle(transcript);
    } catch (error) {
      llmLog.error('Title generation failed:', error);
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
        llmLog.error('Value signal extraction failed:', error);
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
        llmLog.error('Entity extraction failed:', error);
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
          llmLog.debug('Skipping entity extraction for empty transcript');
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
          backgroundKnowledgeRefresh?.enqueue(`meeting:${meetingId}`);
        }
        clearAbortControllerForMeeting(String(meetingId));
        return result;
      } catch (error) {
        llmLog.error('Entity extraction and processing failed:', error);
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
        const result = await processExtractedEntities(
          entities,
          meetingId,
          undefined,
          undefined,
          {
            signal: getAbortSignalForMeeting(String(meetingId)),
          },
        );
        backgroundKnowledgeRefresh?.enqueue(`meeting:${meetingId}`);
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
  ipcMain.handle('intelligence:query:new-conversation', (event) => {
    clearAskPlutoOmissions(event.sender.id);
  });
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
      const settingsStartedAt = Date.now();
      const settings = await getAllSettings(db);
      const settingsCompletedAt = Date.now();
      const isLocalProvider =
        !settings.llm_provider || settings.llm_provider === 'ollama';
      const requestTimeoutMs = askPlutoTimeoutMs(
        typeof input === 'string' ? undefined : input.modeOverride,
        { isLocal: isLocalProvider },
      );
      let recordProgress: ((phase?: 'started' | 'token') => void) | undefined;
      const meetingHeaders = db.getAskPlutoMeetingHeaders();
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
                ...(turn.turnMode ? { turnMode: turn.turnMode } : {}),
                ...(turn.retrievalPolicy
                  ? { retrievalPolicy: turn.retrievalPolicy }
                  : {}),
                ...(typeof turn.unsupportedClaimCount === 'number'
                  ? { unsupportedClaimCount: turn.unsupportedClaimCount }
                  : {}),
                ...(typeof turn.omissionRef === 'string'
                  ? { omissionRef: turn.omissionRef }
                  : {}),
                ...(typeof turn.conversationAnchor === 'string'
                  ? {
                      conversationAnchor: turn.conversationAnchor.slice(0, 700),
                    }
                  : {}),
                ...(turn.conversationContext &&
                typeof turn.conversationContext.anchor === 'string'
                  ? {
                      conversationContext: {
                        anchor: turn.conversationContext.anchor.slice(0, 700),
                        meetingIds: Array.isArray(
                          turn.conversationContext.meetingIds,
                        )
                          ? turn.conversationContext.meetingIds
                              .filter(
                                (id): id is string => typeof id === 'string',
                              )
                              .slice(0, 8)
                          : [],
                        ...(turn.conversationContext.topic
                          ? { topic: turn.conversationContext.topic }
                          : {}),
                      },
                    }
                  : {}),
                ...(turn.resolvedScope
                  ? { resolvedScope: turn.resolvedScope }
                  : {}),
                ...(turn.retrievalSummary
                  ? { retrievalSummary: turn.retrievalSummary }
                  : {}),
                ...(turn.retrievalTrace
                  ? { retrievalTrace: turn.retrievalTrace }
                  : {}),
              }));
      if (
        priorTurns.length === 0 &&
        typeof input !== 'string' &&
        typeof input.conversationMemory?.lastAnswerSummary === 'string' &&
        input.conversationMemory.lastAnswerSummary.trim()
      ) {
        const memory = input.conversationMemory;
        const lastAnswerSummary = memory.lastAnswerSummary?.trim() || '';
        priorTurns.push({
          role: 'assistant',
          content: lastAnswerSummary.slice(0, 1200),
          conversationAnchor: memory.currentGoal?.trim().slice(0, 700),
          ...(memory.activeTopic
            ? {
                conversationContext: {
                  anchor:
                    memory.currentGoal?.trim().slice(0, 700) ||
                    lastAnswerSummary.slice(0, 700),
                  meetingIds: [],
                  topic: memory.activeTopic,
                },
              }
            : {}),
        });
      }
      const activeRecording = captureSessionLease.recordingForOwner(
        event.sender.id,
      );
      const currentMeeting = resolveCurrentMeeting({
        activeRecordingMeetingId: activeRecording?.meetingId,
        meetings: meetingHeaders.map((meeting) => ({
          id: meeting.id,
          started_at: meeting.started_at,
          created_at: meeting.created_at,
        })),
      });
      const currentMeetingRow = meetingHeaders.find(
        (meeting) => String(meeting.id) === currentMeeting.meetingId,
      );
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
      const setupCompletedAt = Date.now();
      let reasoningMode: AskPlutoReasoningMode | undefined;
      let turnMode: ConversationTurnMode | undefined;
      let retrievalPolicy: ConversationRetrievalPolicy | undefined;
      let comparisonMeetingCount = 0;
      let scopeLabel: string | undefined;
      let scopeMeetingCount = 0;
      let retrievalStartedAt: number | undefined;
      let retrievalCompletedAt: number | undefined;
      let providerRequestedAt: number | undefined;
      let providerStartedAt: number | undefined;
      let rawFirstTokenAt: number | undefined;
      let firstTokenAt: number | undefined;
      let generationCompletedAt: number | undefined;
      let conversationResolutionStartedAt: number | undefined;
      let conversationResolutionCompletedAt: number | undefined;
      let recallStartedAt: number | undefined;
      let recallCompletedAt: number | undefined;
      let promptStartedAt: number | undefined;
      let promptCompletedAt: number | undefined;
      let providerAcquisitionStartedAt: number | undefined;
      let providerAcquisitionCompletedAt: number | undefined;
      let finalizationStartedAt: number | undefined;
      let finalizationCompletedAt: number | undefined;
      let contextCount = 0;
      let promptCharacters = 0;
      let outputCharacters = 0;
      let providerName: string = settings.llm_provider || 'ollama';
      let configuredModel =
        settings.llm_model ||
        (settings.llm_provider === 'gemini'
          ? settings.gemini_model
          : settings.llm_provider === 'openai'
            ? settings.openai_model
            : settings.llm_provider === 'openrouter'
              ? settings.openrouter_model
              : settings.llm_provider === 'claude'
                ? settings.claude_model
                : settings.ollama_model || OLLAMA_GENERAL_MODEL) ||
        'default';
      let lastValidatedPresentation: SafeAnswerPresentation | undefined;
      let conversationAnchor: string | undefined;
      const elapsed = (from?: number, to?: number): number | null =>
        from !== undefined && to !== undefined ? to - from : null;
      const buildPerformanceDiagnostics = (
        finishedAt = Date.now(),
      ): AskPlutoPerformanceDiagnostics => ({
        provider: providerRequestedAt ? providerName : 'not_used',
        model: providerRequestedAt ? configuredModel : 'not_used',
        ...(reasoningMode ? { reasoningMode } : {}),
        contextCount,
        promptCharacters,
        outputCharacters,
        settingsMs: elapsed(settingsStartedAt, settingsCompletedAt),
        setupMs: elapsed(settingsCompletedAt, setupCompletedAt),
        conversationResolutionMs: elapsed(
          conversationResolutionStartedAt,
          conversationResolutionCompletedAt,
        ),
        recallMs: elapsed(recallStartedAt, recallCompletedAt),
        retrievalMs: elapsed(retrievalStartedAt, retrievalCompletedAt),
        promptConstructionMs: elapsed(promptStartedAt, promptCompletedAt),
        providerAcquisitionMs: elapsed(
          providerAcquisitionStartedAt,
          providerAcquisitionCompletedAt,
        ),
        providerQueueMs: elapsed(providerRequestedAt, providerStartedAt),
        providerRequestToFirstTokenMs: elapsed(
          providerRequestedAt,
          rawFirstTokenAt,
        ),
        rawFirstTokenMs: rawFirstTokenAt ? rawFirstTokenAt - startTime : null,
        visibleFirstTokenMs: firstTokenAt ? firstTokenAt - startTime : null,
        generationMs: elapsed(providerStartedAt, generationCompletedAt),
        finalizationMs: elapsed(finalizationStartedAt, finalizationCompletedAt),
        totalMs: finishedAt - startTime,
      });
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
        conversationResolutionStartedAt = Date.now();
        const conversationResolution = resolveAskPlutoConversation(
          queryText,
          priorTurns,
        );
        turnMode = conversationResolution.turnMode;
        retrievalPolicy = conversationResolution.retrievalPolicy;
        conversationResolutionCompletedAt = Date.now();
        recallStartedAt = Date.now();
        conversationAnchor = conversationResolution.retrievalQuery.slice(
          0,
          700,
        );
        const previousAssistantTurn = latestAssistantTurn(priorTurns);
        const previousConversationContext =
          previousAssistantTurn?.conversationContext;
        const activeConversationContext =
          conversationResolution.relation === 'new_topic'
            ? undefined
            : previousConversationContext;
        const previousConversationAnswer =
          conversationResolution.relation !== 'new_topic'
            ? previousAssistantTurn?.content
            : undefined;
        const previousExpansionAnswer =
          conversationResolution.relation === 'expansion'
            ? priorTurns
                .filter(
                  (turn) =>
                    turn.role === 'assistant' &&
                    turn.conversationAnchor === conversationAnchor,
                )
                .map((turn) => turn.content)
                .join('\n') || previousAssistantTurn?.content
            : undefined;
        const priorConversationContext =
          previousConversationAnswer || previousExpansionAnswer;
        const safePriorConversationContext =
          priorConversationContext &&
          !containsConfidentialAside(priorConversationContext)
            ? priorConversationContext
            : undefined;
        const answerConversationally = async (
          promptOverride?: string,
        ): Promise<string> => {
          const boundaryReply = promptOverride
            ? null
            : buildConversationBoundaryReply(queryText);
          if (boundaryReply) return boundaryReply;
          if (!promptOverride && conversationResolution.turnMode === 'social') {
            return buildSocialReply({
              query: queryText,
              previousAnswer: previousAssistantTurn?.content,
              previousTurnMode: previousAssistantTurn?.turnMode,
            });
          }
          providerAcquisitionStartedAt = Date.now();
          const provider = await getProvider(settings);
          providerAcquisitionCompletedAt = Date.now();
          providerName = provider.name;
          if (isLocalProvider) {
            configuredModel =
              (settings.ollama_fast_model || '').trim() ||
              OLLAMA_QUICK_CHAT_MODEL;
          }
          const prompt =
            promptOverride ||
            buildConversationalReplyPrompt({
              query: queryText,
              turns: priorTurns,
            });
          promptCharacters = prompt.length;
          promptStartedAt = providerAcquisitionCompletedAt;
          promptCompletedAt = Date.now();
          providerRequestedAt = Date.now();
          let streamedAnswer = '';
          try {
            const returnedAnswer = await provider.answerAskPluto(prompt, {
              signal: controller.signal,
              mode: 'fast',
              live: true,
              onStart: () => {
                providerStartedAt ??= Date.now();
                sendStatus('writing');
              },
              onToken: (delta) => {
                if (!delta || controller.signal.aborted) return;
                rawFirstTokenAt ??= Date.now();
                firstTokenAt ??= rawFirstTokenAt;
                streamedAnswer += delta;
                if (!event.sender.isDestroyed()) {
                  event.sender.send('intelligence:query:delta', {
                    requestId,
                    delta,
                  });
                }
              },
            });
            const answer = (returnedAnswer || streamedAnswer).trim();
            if (answer) return answer;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            console.warn(
              '[Pluto][Ask Pluto] conversational response failed; using safe fallback',
              error,
            );
          }
          return promptOverride
            ? "I couldn't finish that response just now. I still don't have confirmed work details to build on; please retry or tell me what you'd like me to use."
            : buildSocialReply({
                query: queryText,
                previousAnswer: previousAssistantTurn?.content,
                previousTurnMode: previousAssistantTurn?.turnMode,
              });
        };
        if (conversationResolution.relation === 'acknowledgment') {
          const answer = await answerConversationally();
          outputCharacters = answer.length;
          generationCompletedAt = Date.now();
          finalizationStartedAt = generationCompletedAt;
          finalizationCompletedAt = generationCompletedAt;
          return {
            status: 'answered' as const,
            answer,
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'answered' as const,
            resolvedScope: previousAssistantTurn?.resolvedScope,
            conversationContext: previousConversationContext,
          };
        }
        if (conversationResolution.turnMode === 'act') {
          const actionProposal = parseConversationActionProposal(queryText);
          const answer = actionProposal
            ? `I can add “${actionProposal.text}” as an open commitment. Confirm it below and I’ll save it locally.`
            : 'I haven’t made that change. Chat can currently prepare a commitment for your confirmation, but this action is not available yet.';
          outputCharacters = answer.length;
          generationCompletedAt = Date.now();
          finalizationStartedAt = generationCompletedAt;
          finalizationCompletedAt = generationCompletedAt;
          return {
            status: 'answered' as const,
            answer,
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'answered' as const,
            resolvedScope: previousAssistantTurn?.resolvedScope,
            conversationContext: previousConversationContext,
            ...(actionProposal ? { actionProposal } : {}),
          };
        }
        if (
          previousAssistantTurn?.outcome === 'no_evidence' &&
          conversationResolution.retrievalPolicy === 'reuse' &&
          conversationResolution.task === 'draft'
        ) {
          const answer = buildNoEvidenceDraftReply(queryText);
          outputCharacters = answer.length;
          generationCompletedAt = Date.now();
          finalizationStartedAt = generationCompletedAt;
          finalizationCompletedAt = generationCompletedAt;
          return {
            status: 'answered' as const,
            answer,
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'no_evidence' as const,
            resolvedScope: previousAssistantTurn.resolvedScope,
            conversationContext: previousConversationContext,
          };
        }
        const persistedMeetings = db.getAskPlutoMeetings();
        sendStatus('scope_resolved');
        sendStatus('retrieving');
        const omissionReview =
          conversationResolution.relation === 'omission_follow_up'
            ? getAskPlutoOmissionReview(
                previousAssistantTurn?.omissionRef,
                event.sender.id,
              )
            : undefined;
        const explicitPersonSubject = parsePersonWorkQuery(queryText);
        const effectiveQueryText = omissionReview
          ? omissionReview.originalQuery
          : explicitPersonSubject
            ? queryText
            : conversationResolution.retrievalQuery;
        const attributionDispute = detectAttributionDispute(effectiveQueryText);
        const disputedEntity = attributionDispute?.disputedEntity || null;
        const planningConversationAnchor = [...priorTurns]
          .reverse()
          .find(
            (turn) =>
              turn.role === 'assistant' && turn.conversationAnchor?.trim(),
          )?.conversationAnchor;
        const isPlanning = shouldUseWorkspaceIntelligence({
          query: queryText,
          relation: conversationResolution.relation,
          priorQuestion: conversationResolution.priorQuestion,
          conversationAnchor: planningConversationAnchor,
        });
        const workspaceIntelligenceMode = resolveWorkspaceIntelligenceMode(
          queryText,
          conversationResolution.relation,
          conversationResolution.priorQuestion || planningConversationAnchor,
        );
        const selfPersonId = db.identityStore.getSelfPersonId();
        const selfProfile = selfPersonId
          ? db.identityStore.getProfile()
          : undefined;
        const confirmedSelfName =
          selfProfile?.preferredName.trim() || undefined;
        const selfReference = resolveAskPlutoSelfReference(
          effectiveQueryText,
          confirmedSelfName,
          selfProfile?.aliases,
        );
        if (selfReference.asksIdentity) {
          return {
            status: 'answered' as const,
            answer: confirmedSelfName
              ? `You're ${confirmedSelfName}.`
              : "I don't know which person is you yet. Confirm your identity in Pluto, then ask me again.",
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        if (selfReference.refersToSelf && !confirmedSelfName) {
          return {
            status: 'answered' as const,
            answer:
              "I don't know which person is you yet. Confirm your identity in Pluto so I can find your contributions in meeting evidence.",
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        const retrievalOptionsQuery =
          conversationResolution.relation === 'omission_follow_up' ||
          conversationResolution.relation === 'expansion'
            ? `${selfReference.retrievalQuery}\ngo deeper`
            : selfReference.retrievalQuery;
        const parsed = await parseQuery(selfReference.retrievalQuery, {
          signal: controller.signal,
          useModelClassification:
            conversationResolution.relation === 'new_topic' &&
            !isExplicitInformationRequest(queryText),
        });
        const assigneeRecall = buildAssigneeActionRecall(
          effectiveQueryText,
          persistedMeetings,
        );
        const overviewRecall = buildWorkingMemoryOverviewRecall(
          effectiveQueryText,
          parsed.entity_mentions,
        );
        const workspaceRecall = isPlanning
          ? buildWorkspaceIntelligenceRecall({
              query: effectiveQueryText,
              persistedMeetings,
              selfPersonId: selfPersonId || undefined,
              mode: workspaceIntelligenceMode,
            })
          : null;
        const explicitProjectScopes = findExplicitProjectScopes(
          queryText,
          db.getEntitiesByType('project').map((project) => ({
            canonicalId: db.resolveProjectIdentityId(project.id),
            name: project.name,
            displayTitle: readProjectDisplayTitle(
              project.metadata,
              project.name,
            ),
          })),
        );
        const hasMultipleProjectScopes = explicitProjectScopes.length > 1;
        const multiProjectContext = hasMultipleProjectScopes
          ? balanceProjectNoteContexts(
              explicitProjectScopes
                .slice(0, 3)
                .map(
                  (project) =>
                    buildProjectRecall(project.name, [project.canonicalId])
                      ?.context || [],
                ),
            )
          : null;
        const candidateProjectRecall =
          hasMultipleProjectScopes ||
          asksToVerifyProjectAssociation(queryText) ||
          asksForExplicitAttribution(queryText)
            ? null
            : buildProjectRecall(queryText, parsed.entity_mentions);
        // A partial theme/term hit is not enough to establish project identity.
        // Otherwise an unknown named initiative can inherit an unrelated brief.
        const projectRecall =
          candidateProjectRecall?.project.matchKind === 'explicit_label'
            ? candidateProjectRecall
            : null;
        const keepActiveProjectScope =
          !hasMultipleProjectScopes &&
          shouldKeepActiveProjectScope({
            relation: conversationResolution.relation,
            hasActiveProject:
              activeConversationContext?.topic?.kind === 'project',
            candidateMatchKind: projectRecall?.project.matchKind,
          });
        const inheritedProjectRecall =
          keepActiveProjectScope &&
          activeConversationContext?.topic?.kind === 'project'
            ? buildProjectRecall(
                `${activeConversationContext.topic.label || activeConversationContext.topic.id || ''} ${queryText}`,
              )
            : null;
        const effectiveProjectRecall = inheritedProjectRecall ?? projectRecall;
        if (effectiveProjectRecall) {
          const projectDoc = db.getKnowledgeDocByScope(
            'project',
            effectiveProjectRecall.project.canonicalId,
          );
          if (projectDoc) {
            backgroundKnowledgeRefresh?.prioritize(`doc:${projectDoc.id}`);
          }
        }
        const personFocusedRequest = shouldUsePersonFocusedEvidence(
          queryText,
          conversationResolution.task,
          activeConversationContext?.topic?.kind === 'person',
        );
        const personWorkRecall = personFocusedRequest
          ? buildPersonWorkRecall(effectiveQueryText)
          : null;
        const personWorkSubject = personFocusedRequest
          ? parsePersonWorkQuery(effectiveQueryText)
          : null;
        const personWorkAssignmentRecall =
          personWorkSubject &&
          !personWorkRecall &&
          !/^\s*(?:tell me about|who is)\b/i.test(queryText)
            ? buildAssigneeActionRecall(
                `What is assigned to ${personWorkSubject}?`,
                persistedMeetings,
              )
            : null;
        const inheritedPersonWorkRecall =
          personFocusedRequest &&
          !personWorkRecall &&
          shouldKeepActivePersonScope({
            relation: conversationResolution.relation,
            hasActivePerson:
              activeConversationContext?.topic?.kind === 'person',
            hasExplicitPersonSubject: Boolean(
              personWorkSubject || extractNamedPersonQuestionSubject(queryText),
            ),
            hasExplicitProject: Boolean(effectiveProjectRecall),
          }) &&
          activeConversationContext?.topic?.kind === 'person'
            ? buildPersonWorkRecall(
                effectiveQueryText,
                activeConversationContext.topic.label ||
                  activeConversationContext.topic.id,
              )
            : null;
        const effectivePersonWorkRecall =
          personWorkRecall ?? inheritedPersonWorkRecall;
        const answerSelfName =
          effectivePersonWorkRecall &&
          effectivePersonWorkRecall.person.id !== selfPersonId
            ? undefined
            : confirmedSelfName;
        if (effectivePersonWorkRecall) {
          const personDoc = db.getKnowledgeDocByScope(
            'person_context',
            effectivePersonWorkRecall.person.id,
          );
          if (personDoc) {
            backgroundKnowledgeRefresh?.prioritize(`doc:${personDoc.id}`);
          }
        }
        const useWorkspaceRecall = Boolean(
          isPlanning &&
            !hasMultipleProjectScopes &&
            workspaceRecall &&
            !effectiveProjectRecall &&
            !effectivePersonWorkRecall,
        );
        const explicitMeetingScope = resolveExplicitMeetingScope(
          effectiveQueryText,
          persistedMeetings,
        );
        const requestedMode =
          typeof input !== 'string' &&
          (input.modeOverride === 'fast' || input.modeOverride === 'deep')
            ? input.modeOverride
            : 'auto';
        reasoningMode = resolveAskPlutoReasoningMode({
          query: effectiveQueryText,
          intent: parsed.intent,
          override: requestedMode,
          task: conversationResolution.task,
          relation: conversationResolution.relation,
        });
        recallCompletedAt = Date.now();
        retrievalStartedAt = recallCompletedAt;

        if (
          conversationResolution.turnMode === 'social' ||
          (conversationResolution.relation === 'new_topic' &&
            (parsed.intent === 'conversational' || parsed.cannedResponse))
        ) {
          console.log('[Pluto] intelligence:query conversational response');
          turnMode = 'social';
          retrievalPolicy = 'none';
          const answer = await answerConversationally();
          outputCharacters = answer.length;
          generationCompletedAt = Date.now();
          finalizationStartedAt = generationCompletedAt;
          finalizationCompletedAt = generationCompletedAt;
          return {
            status: 'answered' as const,
            answer,
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'answered' as const,
          };
        }

        const currentMeetingRequested =
          queryReferencesCurrentMeeting(effectiveQueryText);
        const switchesNamedProject =
          projectRecall?.project.matchKind === 'explicit_label' &&
          projectRecall.project.canonicalId !==
            activeConversationContext?.topic?.id;
        const inheritedScope =
          parsed.temporal_range ||
          switchesNamedProject ||
          hasMultipleProjectScopes
            ? undefined
            : inheritConversationScope(
                queryText,
                priorTurns,
                conversationResolution.relation,
              );
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
            retrievalTrace: previousAssistantTurn.retrievalTrace,
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
                .map((meetingId) => db.getAskPlutoMeeting(meetingId))
                .filter((meeting): meeting is db.PersistedMeeting =>
                  Boolean(meeting),
                )
            : persistedMeetings.filter((meeting) => {
                const occurredAt =
                  meeting.started_at || meeting.created_at || '';
                return (
                  occurredAt >= temporalRange.fromInclusive &&
                  occurredAt < temporalRange.toExclusive
                );
              })
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
        const usePreparedAssigneeRecall = Boolean(
          !explicitResolvedScope &&
            !temporalResolvedScope &&
            !currentMeetingRequested &&
            !isPlanning &&
            assigneeRecall &&
            !assigneeRecall.coverageLimited &&
            conversationResolution.relation === 'new_topic',
        );
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
          (!activeSnapshot || !activeSnapshot.notes.trim())
        ) {
          return {
            status: 'unavailable' as const,
            answer:
              'The current recording does not have synthesized notes to answer that yet.',
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        const currentMeetingEvidenceRow = currentMeeting.meetingId
          ? db.getAskPlutoMeeting(currentMeeting.meetingId)
          : undefined;
        if (
          currentMeetingRequested &&
          currentMeeting.kind === 'persisted' &&
          currentMeetingEvidenceRow &&
          !currentMeetingEvidenceRow.analysis_json &&
          !currentMeetingEvidenceRow.enhanced_notes &&
          !currentMeetingEvidenceRow.user_notes
        ) {
          return {
            status: 'unavailable' as const,
            answer: `${currentMeetingEvidenceRow.title || 'The latest meeting'} is still being prepared and does not have usable synthesized notes yet.`,
            citations: [],
            currentMeeting: currentMeetingStatus,
          };
        }
        const currentPinnedResult = currentMeetingRequested
          ? currentMeeting.kind === 'active_recording' && activeSnapshot
            ? buildLiveMeetingRetrievalResult(activeSnapshot)
            : currentMeeting.kind === 'persisted' && currentMeetingEvidenceRow
              ? buildMeetingRetrievalResult(currentMeetingEvidenceRow)
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
            ...(activeConversationContext?.meetingIds.slice(0, 3) || []),
            ...(conversationResolution.relation !== 'new_topic' ||
            queryReferencesPriorTurn(effectiveQueryText)
              ? priorTurns
                  .filter((turn) => !containsConfidentialAside(turn.content))
                  .filter((turn) => turn.role === 'assistant')
                  .flatMap((turn) => turn.meetingIds || [])
              : []),
          ]),
        ];
        const expansionMeetingIds = (
          [...priorTurns]
            .reverse()
            .find(
              (turn) =>
                turn.role === 'assistant' &&
                turn.conversationAnchor === conversationAnchor &&
                turn.meetingIds?.length,
            )?.meetingIds ||
          (previousAssistantTurn?.meetingIds?.length
            ? previousAssistantTurn.meetingIds
            : undefined) ||
          inheritedScope?.meetingIds ||
          []
        ).slice(0, 3);
        const priorPinnedResults =
          priorMeetingIds.length > 0
            ? [...priorMeetingIds]
                .map((meetingId) => db.getAskPlutoMeeting(meetingId))
                .filter((meeting): meeting is db.PersistedMeeting =>
                  Boolean(meeting),
                )
                .map((meeting) =>
                  buildMeetingRetrievalResult(meeting, 'Prior cited meeting'),
                )
            : [];
        const historicalCandidateLimit = currentMeetingRequested
          ? getCrossMeetingCandidateLimit(effectiveQueryText, parsed.intent)
          : 0;
        const historicalPinnedResults = persistedMeetings
          .filter((meeting) => String(meeting.id) !== currentMeeting.meetingId)
          .slice(0, historicalCandidateLimit)
          .map((meeting) =>
            buildMeetingRetrievalResult(meeting, 'Earlier meeting'),
          );
        comparisonMeetingCount = historicalPinnedResults.length;
        const overviewContextUsed = Boolean(
          !explicitMeetingScope &&
            !temporalRange &&
            !currentMeetingRequested &&
            overviewRecall?.context.length,
        );
        const pinnedResults = mergeRetrievalResultsByMeeting(
          currentPinnedResult ? [currentPinnedResult] : [],
          temporalPinnedResults,
          explicitlyScopedPinnedResults,
          historicalPinnedResults,
          priorPinnedResults,
          overviewContextUsed ? overviewRecall?.context || [] : [],
          workspaceRecall?.context || [],
          effectiveProjectRecall?.context || [],
          effectivePersonWorkRecall?.context || [],
        );
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
            task: conversationResolution.task,
            relation: conversationResolution.relation,
            retrievalPolicy: conversationResolution.retrievalPolicy,
          });
        const restrictToPinnedCurrentComparison =
          shouldRestrictToPinnedCurrentComparison({
            currentMeetingRequested,
            historicalCandidateLimit,
          });
        const boundedMeetingIds =
          explicitResolvedScope?.meetingIds ||
          temporalResolvedScope?.meetingIds ||
          (restrictToCurrentMeeting && currentPinnedResult
            ? [currentPinnedResult.meeting_id]
            : undefined);
        const generalContext = !usePreparedAssigneeRecall
          ? explicitResolvedScope
            ? await retrieveContext(parsed, {
                pinnedResults: explicitlyScopedPinnedResults,
                query: retrievalOptionsQuery,
                meetingIds: explicitResolvedScope.meetingIds,
              })
            : temporalResolvedScope
              ? await retrieveContext(parsed, {
                  pinnedResults: restrictEvidenceToMeetingIds(
                    pinnedResults,
                    temporalResolvedScope.meetingIds,
                  ),
                  query: retrievalOptionsQuery,
                  meetingIds: temporalResolvedScope.meetingIds,
                })
              : restrictToCurrentMeeting && currentPinnedResult
                ? [currentPinnedResult]
                : multiProjectContext
                  ? multiProjectContext
                  : effectiveProjectRecall
                    ? effectiveProjectRecall.context
                    : effectivePersonWorkRecall
                      ? effectivePersonWorkRecall.context
                      : personWorkSubject && personWorkAssignmentRecall
                        ? personWorkAssignmentRecall?.context || []
                        : conversationResolution.relation === 'expansion' &&
                            !useWorkspaceRecall &&
                            expansionMeetingIds.length > 0
                          ? await retrieveContext(parsed, {
                              query: retrievalOptionsQuery,
                              meetingIds: expansionMeetingIds,
                            })
                          : restrictToPinnedCurrentComparison
                            ? pinnedResults
                            : useWorkspaceRecall && workspaceRecall
                              ? workspaceRecall.context
                              : restrictToPriorConversation
                                ? priorPinnedResults
                                : await retrieveContext(parsed, {
                                    pinnedResults,
                                    query: retrievalOptionsQuery,
                                  })
          : [];
        const projectFacetKeywords =
          effectiveProjectRecall && !multiProjectContext && !boundedMeetingIds
            ? getProjectFacetKeywords(parsed.keywords, [
                effectiveProjectRecall.project.name,
                effectiveProjectRecall.displayTitle,
              ])
            : [];
        const projectFacetContext = projectFacetKeywords.length
          ? await retrieveContext(
              {
                ...parsed,
                keywords: projectFacetKeywords,
                expanded_keywords: [],
                entity_mentions: [],
              },
              { query: queryText },
            )
          : [];
        const scopedGeneralContext =
          effectiveProjectRecall && projectFacetContext.length
            ? combineProjectFacetContext(generalContext, projectFacetContext)
            : generalContext;
        const generalContextWithFallback =
          conversationResolution.relation === 'expansion' &&
          scopedGeneralContext.length === 0
            ? priorPinnedResults.filter((result) =>
                expansionMeetingIds.includes(result.meeting_id),
              )
            : scopedGeneralContext;
        const namedPersonSubject =
          extractNamedPersonQuestionSubject(effectiveQueryText) ||
          effectivePersonWorkRecall?.person.name;
        const namedPersonEvidenceQuery = namedPersonSubject
          ? buildNamedPersonEvidenceQuery(
              effectiveQueryText,
              namedPersonSubject,
            )
          : null;
        const shouldSupplementNamedPersonContext = Boolean(
          namedPersonSubject &&
            conversationResolution.task !== 'draft' &&
            !/^\s*(?:who|which\s+person)\b/i.test(effectiveQueryText),
        );
        const namedPersonCandidates = shouldSupplementNamedPersonContext
          ? await retrieveContext(
              await parseQuery(
                namedPersonEvidenceQuery || namedPersonSubject || '',
                {
                  signal: controller.signal,
                  useModelClassification: false,
                },
              ),
              { query: namedPersonEvidenceQuery || namedPersonSubject || '' },
            )
          : [];
        const namedPersonContext = effectivePersonWorkRecall
          ? selectRecentPersonNoteContext(
              namedPersonCandidates,
              effectivePersonWorkRecall.person.name,
              effectivePersonWorkRecall.asOf,
            )
          : namedPersonCandidates;
        const omissionContexts = omissionReview
          ? await Promise.all(
              omissionReview.claims.slice(0, 6).map(async (claim) => {
                controller.signal.throwIfAborted();
                const claimParsed = await parseQuery(claim, {
                  signal: controller.signal,
                  useModelClassification: false,
                });
                return (
                  await retrieveContext(claimParsed, {
                    query: `${claim}\ngo deeper`,
                    ...(omissionReview.searchMeetingIds?.length
                      ? { meetingIds: omissionReview.searchMeetingIds }
                      : {}),
                  })
                ).slice(0, 2);
              }),
            )
          : [];
        const unguardedContext = omissionReview
          ? selectAskPlutoOmissionContext(
              omissionContexts,
              generalContextWithFallback,
            )
          : usePreparedAssigneeRecall && assigneeRecall
            ? assigneeRecall.context
            : mergeRetrievalResultsByMeeting(
                namedPersonContext,
                assigneeRecall?.context ?? [],
                generalContextWithFallback,
              );
        const removedTranscriptPassageCount = unguardedContext.reduce(
          (total, result) =>
            total +
            (result.evidence_kind === 'transcript' ? 1 : 0) +
            (result.transcript_passages?.length || 0),
          0,
        );
        const subjectFocusedContext =
          !effectiveProjectRecall &&
          !multiProjectContext &&
          !effectivePersonWorkRecall
            ? focusContextOnExplicitNamedSubject(
                effectiveQueryText,
                unguardedContext,
              )
            : unguardedContext;
        const context = enforceSynthesizedOnlyContext(
          restrictEvidenceToMeetingIds(
            effectiveProjectRecall ||
              multiProjectContext ||
              !personFocusedRequest
              ? subjectFocusedContext
              : selectNamedPersonAnswerContext(
                  effectiveQueryText,
                  subjectFocusedContext,
                  personWorkAssignmentRecall?.context,
                ),
            boundedMeetingIds,
          ),
        );
        contextCount = context.length;
        if (removedTranscriptPassageCount > 0) {
          console.warn(
            `[Pluto] Ask Pluto removed ${removedTranscriptPassageCount} raw transcript result(s) from synthesized-only context [request_id=${requestId}]`,
          );
        }
        const contextMeetings = uniqueAskPlutoEvidenceMeetings(context);
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
                kind:
                  overviewContextUsed ||
                  context.length === 0 ||
                  context.some((result) => result.source_type === 'artifact')
                    ? 'global'
                    : 'meeting_ids',
                meetingIds: contextMeetings.map((result) => result.meeting_id),
                resolvedAt: new Date().toISOString(),
                source: 'explicit',
              });
        const baseRetrievalSummary: AskPlutoRetrievalSummary =
          explicitRetrievalSummary ||
            temporalRetrievalSummary || {
              matchedMeetingCount: contextMeetings.length,
              includedMeetingCount: contextMeetings.length,
              preparedEvidenceCount: context.length,
              transcriptOnlyCount: 0,
              omittedMeetingCount: 0,
            };
        const matchedSectionCount = context.reduce(
          (total, result) => total + (result.retrieved_sections?.length || 0),
          0,
        );
        const transcriptPassageCount = context.reduce(
          (total, result) => total + (result.transcript_passages?.length || 0),
          0,
        );
        const retrievalSummary: AskPlutoRetrievalSummary = {
          ...baseRetrievalSummary,
          matchedSectionCount,
          includedSectionCount: matchedSectionCount,
          transcriptPassageCount,
          commitmentCount: assigneeRecall?.commitmentCount || 0,
          artifactCount: context.filter(
            (result) => result.source_type === 'artifact',
          ).length,
          retrievalLevel: isPlanning
            ? 'overview'
            : assigneeRecall
              ? 'commitment'
              : transcriptPassageCount > 0
                ? 'transcript'
                : overviewContextUsed
                  ? 'overview'
                  : matchedSectionCount > 0
                    ? 'section'
                    : 'note',
        };
        const retrievalTrace = {
          level: retrievalSummary.retrievalLevel || ('note' as const),
          searchedMeetingCount:
            explicitResolvedScope?.meetingIds.length ??
            temporalResolvedScope?.meetingIds.length ??
            (effectiveProjectRecall
              ? context.filter((result) => result.source_type !== 'artifact')
                  .length
              : assigneeRecall
                ? assigneeRecall.mentionedMeetingCount
                : persistedMeetings.length),
          meetings: contextMeetings.map((result) => ({
            meetingId: result.meeting_id,
            meetingTitle:
              result.meeting_title || result.mid?.title || 'Untitled meeting',
          })),
          sections: context.flatMap((result) =>
            (result.retrieved_sections || []).map((section) => ({
              meetingId: result.meeting_id,
              meetingTitle:
                result.meeting_title || result.mid?.title || 'Untitled meeting',
              sectionId: section.section_id,
              heading: section.heading,
              kind: section.kind,
              sourceRevision: section.source_revision,
            })),
          ),
          transcriptPassages: context.flatMap((result) =>
            (result.transcript_passages || []).map((passage) => ({
              meetingId: result.meeting_id,
              meetingTitle:
                result.meeting_title || result.mid?.title || 'Untitled meeting',
              quote: passage.quote,
              speaker: passage.speaker,
              ...(passage.start_ms !== undefined
                ? { startMs: passage.start_ms }
                : {}),
              ...(passage.end_ms !== undefined
                ? { endMs: passage.end_ms }
                : {}),
              sourceRevision: passage.source_revision,
              trustStatus: passage.trust_status,
            })),
          ),
          commitmentCount: assigneeRecall?.commitmentCount || 0,
          omittedResultCount: retrievalSummary.omittedMeetingCount,
        };
        if (context.length === 0) {
          return {
            status: 'answered' as const,
            answer:
              conversationResolution.relation === 'omission_follow_up'
                ? describeUnverifiedAskPlutoOmissions(
                    omissionReview?.claims.length ||
                      previousAssistantTurn?.unsupportedClaimCount,
                  )
                : ((!boundedMeetingIds ? assigneeRecall?.answer : undefined) ??
                  (personWorkSubject
                    ? buildNamedPersonNoEvidenceReply(
                        queryText,
                        personWorkSubject,
                      )
                    : null) ??
                  "I couldn't verify an answer from this search."),
            citations: [],
            currentMeeting: currentMeetingStatus,
            outcome: 'no_evidence' as const,
            resolvedScope,
            retrievalSummary,
            retrievalTrace,
          };
        }

        console.log(
          `[Pluto] Retrieval complete (${Date.now() - startTime}ms), context items: ${context.length}`,
        );

        if (usePreparedAssigneeRecall) {
          sendStatus('writing');
        } else {
          sendStatus('waiting');
        }
        let visibleValidatedAnswer = '';
        const onAnswerDelta = () => {
          if (controller.signal.aborted || event.sender.isDestroyed()) return;
          const validated = lastValidatedPresentation;
          if (!validated) return;
          const nextAnswer = validated.answer;
          if (
            !nextAnswer.startsWith(visibleValidatedAnswer) ||
            nextAnswer.length === visibleValidatedAnswer.length
          )
            return;
          firstTokenAt ??= Date.now();
          event.sender.send('intelligence:query:delta', {
            requestId,
            delta: nextAnswer.slice(visibleValidatedAnswer.length),
          });
          visibleValidatedAnswer = nextAnswer;
        };
        const onAnswerPresentation = (presentation: SafeAnswerPresentation) => {
          const distinct =
            conversationResolution.task === 'draft'
              ? presentation
              : {
                  ...presentation,
                  ...removeRepeatedAskPlutoClaims(
                    presentation.answer,
                    presentation.citations,
                    previousExpansionAnswer,
                  ),
                };
          if (distinct.answer)
            lastValidatedPresentation = {
              ...distinct,
              answer: addressConfirmedSelf(distinct.answer, answerSelfName),
            };
        };
        const answerStream =
          conversationResolution.relation === 'omission_follow_up'
            ? createValidatedAnswerStream(
                context,
                onAnswerDelta,
                'analysis',
                onAnswerPresentation,
                confirmedSelfName,
              )
            : createSynthesizedAnswerStream(
                context,
                onAnswerDelta,
                onAnswerPresentation,
                confirmedSelfName,
              );
        const extractiveAnswer = useWorkspaceRecall
          ? null
          : conversationResolution.relation === 'omission_follow_up' ||
              conversationResolution.relation === 'expansion' ||
              selfReference.refersToSelf
            ? null
            : usePreparedAssigneeRecall && assigneeRecall
              ? assigneeRecall.answer
              : buildExtractiveTemporalSummary(effectiveQueryText, context);
        let answerRaw: string;
        if (
          extractiveAnswer &&
          (usePreparedAssigneeRecall ||
            shouldUsePreparedExtractiveAnswer({
              mode: reasoningMode,
              contextCount: context.length,
            }))
        ) {
          answerRaw = extractiveAnswer;
          for (const [index, line] of answerRaw.split('\n').entries()) {
            answerStream.push(`${index > 0 ? '\n' : ''}${line}`);
          }
        } else {
          providerAcquisitionStartedAt = Date.now();
          const provider = await getProvider(settings);
          providerAcquisitionCompletedAt = Date.now();
          providerName = provider.name;
          promptStartedAt = Date.now();
          const prompt = getAskPlutoPrompt(
            conversationResolution.answerQuery,
            context,
            parsed.intent,
            !switchesNamedProject &&
              (shouldIncludePriorConversation(
                effectiveQueryText,
                Boolean(explicitMeetingScope),
                conversationResolution.relation,
              ) ||
                activeConversationContext)
              ? priorTurns.filter(
                  (turn) => !containsConfidentialAside(turn.content),
                )
              : [],
            formatAskPlutoCorrectionsForPrompt(relevantCorrections),
            conversationResolution.task,
            omissionReview
              ? {
                  claims: omissionReview.claims,
                  previousAnswer: omissionReview.visibleAnswer,
                }
              : undefined,
            safePriorConversationContext && !switchesNamedProject
              ? { previousAnswer: safePriorConversationContext }
              : undefined,
            confirmedSelfName,
            {
              userProfile: confirmedSelfName
                ? {
                    name: confirmedSelfName,
                    aliases: selfProfile?.aliases,
                  }
                : null,
              disputedEntity,
              projectContext: effectiveProjectRecall
                ? {
                    name: effectiveProjectRecall.project.name,
                    displayTitle: effectiveProjectRecall.displayTitle,
                    asOf: effectiveProjectRecall.asOf,
                    latestNoteAt: effectiveProjectRecall.latestNoteAt,
                  }
                : null,
              activeConversationContext: switchesNamedProject
                ? null
                : activeConversationContext || null,
              conversationMode: conversationResolution.turnMode,
              isPlanningQuery: isPlanning,
            },
          );
          promptCompletedAt = Date.now();
          promptCharacters = prompt.length;
          console.log(
            `[Pluto] Generating answer via provider: ${provider.name} ...`,
          );
          providerRequestedAt = Date.now();
          answerRaw = await provider.answerAskPluto(prompt, {
            signal: controller.signal,
            mode: reasoningMode,
            onStart: () => {
              recordProgress?.('started');
              providerStartedAt ??= Date.now();
              sendStatus('writing');
            },
            onToken: (delta) => {
              if (controller.signal.aborted) return;
              recordProgress?.();
              if (!rawFirstTokenAt) {
                rawFirstTokenAt = Date.now();
                sendStatus('generating');
              }
              answerStream.push(delta);
            },
          });
        }
        controller.signal.throwIfAborted();
        generationCompletedAt = Date.now();

        finalizationStartedAt = Date.now();
        let presentation = answerStream.finalize(answerRaw);
        if (
          presentation.outcome !== 'no_evidence' &&
          conversationResolution.task !== 'draft'
        ) {
          const distinct = removeRepeatedAskPlutoClaims(
            presentation.answer,
            presentation.citations,
            priorConversationContext,
          );
          presentation = {
            ...presentation,
            ...distinct,
            ...(conversationResolution.relation === 'expansion' &&
            !distinct.answer
              ? {
                  answer:
                    "I checked the same meeting again but couldn't find more supported detail to add.",
                  outcome: 'no_evidence' as const,
                  citations: [],
                  unsupportedClaimCount: 0,
                  unsupportedClaims: [],
                }
              : {}),
          };
        }
        if (
          conversationResolution.relation === 'expansion' &&
          assigneeRecall &&
          presentation.outcome === 'no_evidence'
        ) {
          const verifiedRecall = createValidatedAnswerStream(
            assigneeRecall.context,
            () => undefined,
          ).finalize(assigneeRecall.answer);
          if (verifiedRecall.outcome !== 'no_evidence') {
            presentation = {
              ...verifiedRecall,
              answer: `${verifiedRecall.answer}\n\nThat is the full extent of the explicit assignment evidence I could verify. I could not verify additional status, rationale, constraints, or related decisions in this search.`,
              outcome: 'partial',
              unsupportedClaimCount: 0,
            };
          }
        }
        if (conversationResolution.relation === 'omission_follow_up') {
          const earlierAnswer =
            omissionReview?.visibleAnswer ||
            previousAssistantTurn?.content ||
            '';
          const additional = selectAdditionalSupportedClaims(
            presentation.citations,
            earlierAnswer,
          );
          presentation = additional.claims.length
            ? {
                ...presentation,
                answer: additional.claims.join(
                  additional.claims.some((claim) => /^[-*]\s/.test(claim))
                    ? '\n'
                    : ' ',
                ),
                citations: additional.citations,
                outcome:
                  presentation.unsupportedClaimCount > 0
                    ? 'partial'
                    : 'answered',
              }
            : {
                ...presentation,
                answer: describeUnverifiedAskPlutoOmissions(
                  omissionReview?.claims.length ||
                    previousAssistantTurn?.unsupportedClaimCount,
                ),
                citations: [],
                outcome: 'no_evidence',
                unsupportedClaimCount: 0,
                unsupportedClaims: [],
              };
        }
        const coverageLimited = retrievalSummary.omittedMeetingCount > 0;
        const attributionSafeAnswer = ensureAskPlutoAttributionAnswer(
          conversationResolution.answerQuery,
          presentation.answer,
        );
        const addressedAnswer = addressConfirmedSelf(
          attributionSafeAnswer,
          answerSelfName,
        );
        const answer = coverageLimited
          ? `I found ${retrievalSummary.matchedMeetingCount} meetings, but this answer covers ${retrievalSummary.includedMeetingCount}. Narrow the time period for complete coverage.\n\n${addressedAnswer}`
          : addressedAnswer;
        const omissionRef =
          presentation.outcome === 'partial' &&
          presentation.unsupportedClaims.length > 0
            ? rememberAskPlutoOmissions({
                ownerId: event.sender.id,
                originalQuery: queryText.trim(),
                visibleAnswer: answer,
                claims: presentation.unsupportedClaims,
                scope: resolvedScope,
                searchMeetingIds:
                  explicitResolvedScope?.meetingIds ||
                  temporalResolvedScope?.meetingIds,
              })
            : undefined;
        const conversationMeetingIds = context
          .filter((result) => result.source_type !== 'artifact')
          .map((result) => result.meeting_id)
          .filter((id, index, ids) => ids.indexOf(id) === index)
          .slice(0, 8);
        const nextConversationContext = {
          anchor: conversationAnchor || queryText.trim().slice(0, 700),
          meetingIds: conversationMeetingIds,
          topic: effectiveProjectRecall
            ? {
                kind: 'project' as const,
                id: effectiveProjectRecall.project.canonicalId,
                label: effectiveProjectRecall.displayTitle,
              }
            : effectivePersonWorkRecall
              ? {
                  kind: 'person' as const,
                  id: effectivePersonWorkRecall.person.id,
                  label: effectivePersonWorkRecall.person.name,
                }
              : useWorkspaceRecall
                ? { kind: 'workspace' as const, label: 'Workspace priorities' }
                : conversationMeetingIds.length > 0
                  ? { kind: 'meeting_set' as const }
                  : { kind: 'general' as const },
        };
        outputCharacters = answer.length;
        finalizationCompletedAt = Date.now();

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
          retrievalTrace,
          trustStatus: presentation.trustStatus,
          unsupportedClaimCount: presentation.unsupportedClaimCount,
          conversationContext: nextConversationContext,
          ...(omissionRef ? { omissionRef } : {}),
        };
      })();
      const deadlineGeneration = runAskPlutoWithDeadline(
        generation,
        controller,
        Math.max(1, requestTimeoutMs - (Date.now() - startTime)),
        {
          onProgressSetup: (fn) => {
            recordProgress = fn;
          },
          idleTimeoutMs: isLocalProvider ? 60_000 : 30_000,
        },
      );
      const settled = deadlineGeneration.then(
        () => undefined,
        () => undefined,
      );
      activeAskPlutoQueries.set(requestId, { controller, settled });

      try {
        const response = await deadlineGeneration;
        outputCharacters ||= response.answer.length;
        if (response.status === 'answered') {
          sendStatus('citations_ready');
          sendStatus('completed');
        } else if (response.status === 'unavailable') {
          sendStatus('unavailable');
        }
        return {
          ...response,
          ...(turnMode ? { turnMode } : {}),
          ...(retrievalPolicy ? { retrievalPolicy } : {}),
          ...(conversationAnchor ? { conversationAnchor } : {}),
          performance: buildPerformanceDiagnostics(),
        };
      } catch (error) {
        if (
          controller.signal.aborted &&
          controller.signal.reason instanceof Error &&
          controller.signal.reason.name === 'AbortError'
        ) {
          console.log(
            `[Pluto] intelligence:query cancelled after ${Date.now() - startTime}ms [request_id=${requestId}]`,
          );
          sendStatus('cancelled');
          return {
            status: 'cancelled' as const,
            answer: '',
            citations: [],
            currentMeeting: currentMeetingStatus,
            performance: buildPerformanceDiagnostics(),
          };
        }
        const failure = classifyAskPlutoFailure(error);
        console.error(
          `[Pluto] intelligence:query failed after ${Date.now() - startTime}ms:`,
          error,
        );
        sendStatus(failure.reason === 'timeout' ? 'unavailable' : 'failed');
        if (failure.reason === 'timeout' && lastValidatedPresentation) {
          const partialAnswer = `${lastValidatedPresentation.answer}\n\n${failure.answer}`;
          outputCharacters = partialAnswer.length;
          return {
            status: 'unavailable' as const,
            answer: partialAnswer,
            citations: lastValidatedPresentation.citations,
            currentMeeting: currentMeetingStatus,
            failureReason: failure.reason,
            outcome: 'partial' as const,
            trustStatus: lastValidatedPresentation.trustStatus,
            unsupportedClaimCount:
              lastValidatedPresentation.unsupportedClaimCount,
            ...(conversationAnchor ? { conversationAnchor } : {}),
            performance: buildPerformanceDiagnostics(),
          };
        }
        outputCharacters = failure.answer.length;
        return {
          status: 'unavailable' as const,
          answer: failure.answer,
          citations: [],
          currentMeeting: currentMeetingStatus,
          failureReason: failure.reason,
          ...(conversationAnchor ? { conversationAnchor } : {}),
          performance: buildPerformanceDiagnostics(),
        };
      } finally {
        const finishedAt = Date.now();
        const performance = buildPerformanceDiagnostics(finishedAt);
        console.log(
          '[Pluto] intelligence:query timings',
          JSON.stringify({
            request_id: requestId,
            ...performance,
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
      const turns = normalizeMeetingAskPlutoTurns(request.turns);
      const conversationResolutionStartedAt = performance.now();
      const conversation = resolveMeetingAskPlutoConversation({
        query,
        turns,
      });
      const conversationResolutionMs =
        performance.now() - conversationResolutionStartedAt;

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
      if (!(await waitForMeetingAskPlutoCancellation(replacedRequests))) {
        console.warn(
          '[Pluto][Ask Pluto][main] previous meeting request did not settle after cancellation',
          { senderId: event.sender.id },
        );
      }
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
        if (conversation.relation === 'social') {
          const previousAnswer = [...turns]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.content;
          const answer = buildSocialReply({ query, previousAnswer });
          if (!event.sender.isDestroyed()) {
            event.sender.send('intelligence:meeting-chat:delta', {
              requestId,
              delta: answer,
            });
          }
          return {
            status: 'answered' as const,
            answer,
            scope:
              request.scope.type === 'live_meeting'
                ? {
                    type: 'live_meeting' as const,
                    meetingId: request.scope.meetingId ?? '',
                    title: request.scope.title,
                  }
                : {
                    type: 'meeting' as const,
                    meetingId: request.scope.meetingId,
                  },
            trustStatus: 'grounded' as const,
            claims: [],
            citations: [],
          };
        }
        const baseContext =
          request.scope.type === 'live_meeting'
            ? (() => {
                const activeMeeting = captureSessionLease.activeForOwner(
                  event.sender.id,
                );
                if (!activeMeeting) {
                  return buildLiveMeetingAskPlutoContext(request.scope);
                }
                const selection = liveMeetingContextIndex.select(
                  activeMeeting.meetingId,
                  conversation.retrievalQuery,
                  undefined,
                  conversation.routingQuery,
                );
                console.info('[Pluto][Live context] selected', {
                  meetingId: activeMeeting.meetingId,
                  intent: selection.intent,
                  selectedSegments: selection.segments.length,
                  totalConfirmedSegments: selection.totalConfirmedSegments,
                });
                const rollingContext = db.getLatestMeetingContextSnapshot(
                  activeMeeting.meetingId,
                )?.state.summary;
                const speakerContext = selection.speakerStats?.length
                  ? `Conversation signals:\n${selection.speakerStats
                      .map(
                        (speaker) =>
                          `${speaker.speaker}: ${speaker.segmentCount} turns, ${speaker.questionCount} questions, ${speaker.longTurnCount} long turns`,
                      )
                      .join('\n')}`
                  : undefined;
                const selectedContext = buildLiveMeetingAskPlutoContext({
                  ...request.scope,
                  meetingId: activeMeeting.meetingId,
                  notes: [request.scope.notes, rollingContext, speakerContext]
                    .filter((value): value is string => Boolean(value?.trim()))
                    .join('\n\n')
                    .slice(0, 1_800),
                  transcript:
                    selection.segments.length > 0
                      ? selection.segments
                      : request.scope.transcript,
                });
                return {
                  ...selectedContext,
                  statusNote: `${selectedContext.statusNote} ${selection.segments.length < selection.totalConfirmedSegments ? 'These are selected transcript excerpts, not the complete meeting. Do not claim an exhaustive list.' : 'All retained confirmed transcript turns are supplied.'}`,
                };
              })()
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
                  query: conversation.retrievalQuery,
                  entities,
                  attentionItems,
                  speakerDisplayNames:
                    db.getMeetingNotesIdentityProjection(meetingId)
                      .speakerDisplayNames,
                });
              })();

        const prepMeetingId =
          request.scope.type === 'live_meeting'
            ? captureSessionLease.activeForOwner(event.sender.id)?.meetingId
            : request.scope.meetingId;
        const context = withMeetingPrepContext(
          baseContext,
          prepMeetingId ? db.meetingPrepStore.forMeeting(prepMeetingId) : null,
        );

        console.info('[Pluto][Ask Pluto][main] context-ready', {
          requestId,
          status: context.status,
          trustStatus: context.trustStatus,
          evidenceItems: context.evidenceItems.length,
          conversationRelation: conversation.relation,
          conversationResolutionMs: Number(conversationResolutionMs.toFixed(2)),
          reusedEvidenceHints: conversation.priorEvidenceHintCount,
          elapsedMs: Date.now() - startTime,
        });

        const clarificationResponse = buildAmbiguousMeetingAskPlutoResponse(
          conversation,
          context,
        );
        if (clarificationResponse) return clarificationResponse;

        if (context.status === 'unavailable') {
          return buildUnavailableMeetingAskPlutoResponse(
            {
              id: context.scope.meetingId,
              title: context.scope.title || 'Meeting',
            },
            query,
          );
        }

        const preparedResponse =
          conversation.relation === 'new_topic'
            ? buildPreparedMeetingAskPlutoResponse(query, context)
            : null;
        if (preparedResponse) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('intelligence:meeting-chat:delta', {
              requestId,
              delta: preparedResponse.answer,
            });
          }
          return preparedResponse;
        }

        const settings = await getAllSettings(db);
        const provider = await getProvider(settings);
        const directAssistanceRoute = routeMeetingAskPlutoAssistance(query);
        const assistanceRoute =
          conversation.relation !== 'new_topic' &&
          directAssistanceRoute.mode === 'general'
            ? routeMeetingAskPlutoAssistance(conversation.routingQuery)
            : directAssistanceRoute;
        const prompt = buildMeetingAskPlutoPrompt({
          query,
          context,
          turns,
          assistanceRoute,
          conversation,
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
                  : settings.llm_provider === 'openrouter'
                    ? settings.openrouter_model
                    : settings.claude_model) ||
            'default',
          promptChars: prompt.length,
          elapsedMs: Date.now() - startTime,
        });
        const structuredLiveAnswer = context.scope.type === 'live_meeting';
        const bufferFactualAnswer =
          structuredLiveAnswer ||
          (assistanceRoute.mode === 'recall' &&
            assistanceRoute.recallKind === 'fact');
        let answerRaw = '';
        let firstTokenAt: number | undefined;
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
            live: structuredLiveAnswer,
            jsonMode: structuredLiveAnswer,
            onToken: (delta) => {
              if (delta && firstTokenAt === undefined)
                firstTokenAt = Date.now();
              if (!bufferFactualAnswer) visibleStream.push(delta);
            },
          });
        } catch (providerError) {
          if (controller.signal.aborted) throw providerError;
          console.warn(
            `[Pluto][Ask Pluto][main] provider unavailable (${requestId}) after ${Date.now() - startTime}ms:`,
            providerError,
          );
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
          firstTokenMs: firstTokenAt ? firstTokenAt - startTime : null,
          elapsedMs: Date.now() - startTime,
        });

        const response = structuredLiveAnswer
          ? await completeLiveMeetingChatAnswer({
              raw: answerRaw,
              context,
              route: assistanceRoute,
              query: conversation.priorQuestion
                ? `${conversation.priorQuestion}\nCurrent request: ${query}`
                : query,
              generate: (prompt) =>
                provider.answerAskPluto(prompt, {
                  signal: controller.signal,
                  live: true,
                  jsonMode: true,
                }),
            })
          : buildMeetingAskPlutoResponseFromAnswer({
              answerRaw,
              context,
              assistanceRoute,
            });
        if (bufferFactualAnswer && !event.sender.isDestroyed()) {
          event.sender.send('intelligence:meeting-chat:delta', {
            requestId,
            delta: response.answer,
          });
        }
        return response;
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
      const settled = await waitForMeetingAskPlutoCancellation([
        active.settled,
      ]);
      return { cancelled: true, settled };
    },
  );

  ipcMain.handle(
    'intelligence:query:debug',
    async (
      _event,
      queryText: string,
      options?: {
        useModelClassification?: boolean;
        includeProjectRecall?: boolean;
      },
    ) => {
      try {
        const parsed = await parseQuery(queryText, {
          useModelClassification: options?.useModelClassification === true,
        });
        const context = await retrieveContext(parsed, { query: queryText });
        const projectRecall = options?.includeProjectRecall
          ? buildProjectRecall(queryText, parsed.entity_mentions)
          : null;
        const projectFacetKeywords =
          projectRecall?.project.matchKind === 'explicit_label'
            ? getProjectFacetKeywords(parsed.keywords, [
                projectRecall.project.name,
                projectRecall.displayTitle,
              ])
            : [];
        const projectFacetContext = projectFacetKeywords.length
          ? await retrieveContext(
              {
                ...parsed,
                keywords: projectFacetKeywords,
                expanded_keywords: [],
                entity_mentions: [],
              },
              { query: queryText },
            )
          : [];
        return {
          parsed,
          context,
          ...(options?.includeProjectRecall
            ? {
                projectRecall,
                projectFacetKeywords,
                projectFacetContext,
                combinedProjectContext:
                  projectRecall?.project.matchKind === 'explicit_label'
                    ? combineProjectFacetContext(
                        projectRecall.context,
                        projectFacetContext,
                      )
                    : null,
              }
            : {}),
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
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );
      return false;
    }
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
    app.quit();
    return true;
  });

  ipcMain.handle('DATABASE_RETRY', () => {
    try {
      const conn = getApplicationDatabase();
      return { ok: conn.open };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle('OPEN_USER_DATA_DIR', async () => {
    try {
      await shell.openPath(app.getPath('userData'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('QUIT_APP', () => {
    app.quit();
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
  initializeKnowledgeDocs({ queue: false })
    .then((docIds) => {
      for (const docId of docIds) {
        backgroundKnowledgeRefresh?.enqueue(`doc:${docId}`);
      }
    })
    .catch((error) => {
      console.error(
        '[KnowledgeDoc] Failed to initialize synthesis pipeline:',
        error,
      );
    });
  createWindow();
  installMacApplicationMenu();
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
        minimumStartedAtMs:
          Number(db.getSetting('incident_recovery_completed_at_ms')) ||
          undefined,
        getMeeting: (meetingId) =>
          (db.getMeeting(meetingId) as db.PersistedMeeting | null) ?? null,
        saveMeeting: (meeting) => {
          const prep = db.meetingPrepStore.forMeeting(String(meeting.id));
          const saved = db.saveMeeting(
            prep &&
              (!meeting.title || /^(Meeting|New Meeting)$/i.test(meeting.title))
              ? { ...meeting, title: prep.event.title || meeting.title }
              : meeting,
          );
          if (prep) {
            db.meetingPrepStore.markStarted(String(meeting.id));
            db.calendarStore.setMeetingContext(
              String(meeting.id),
              prep.occurrenceKey,
              'user',
              prep.event,
            );
          }
          if (win && !win.isDestroyed()) {
            win.webContents.send('MEETING_NOTES_UPDATED', meeting.id);
          }
          return saved;
        },
        stitchWavSegments: async (segments, outputTag) =>
          await stitchWavSegments({ segments, outputTag }),
        mixWavSources: async (inputPaths, outputTag, meetingId) =>
          await mixWavSources({ inputPaths, outputTag, meetingId }),
        repairRawChunk: async (inputPath) => {
          const outputPath = path.join(
            app.getPath('temp'),
            `capture-repair-${randomUUID()}.wav`,
          );
          const converted = await convertAudioToMonoWav({
            inputPath,
            outputPath,
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
        transcribeChunk: async (
          inputPath,
          _config,
          journalDurationSeconds,
          encryptedContext,
        ) => {
          if (!parakeetFinalClient) {
            throw new Error('parakeet_runtime_unavailable');
          }
          const recoveryFinalClient = parakeetFinalClient;
          if (encryptedContext) {
            const result = await recoveryFinalClient.transcribe({
              meetingId: encryptedContext.meetingId,
              role: 'final_validation',
              source: encryptedContext.source,
              audioPath: inputPath,
              language: 'en',
              capability: {
                version: 1,
                meetingId: encryptedContext.meetingId,
                keyId: encryptedContext.keyId,
                meetingKeyBase64:
                  encryptedContext.meetingKey.toString('base64'),
                generation: encryptedContext.generation,
                allowedOperations: ['transcribe'],
                expiresAtMs: Date.now() + 5 * 60 * 1000,
              },
            });
            return {
              detectedLanguage: result.language ?? null,
              providerLabel: 'Parakeet (FluidAudio)',
              segments: Array.isArray(result.segments) ? result.segments : [],
            };
          }
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
                await convertAudioToMonoWav({
                  inputPath: trimInputPath,
                  outputPath,
                  startSec,
                  durationSec,
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
      plutoLog.info('Capture-journal recovery summary:', recovery);
    }
  } catch (error) {
    console.warn(
      '[Pluto] Failed to recover interrupted capture journals:',
      error,
    );
  }

  const runAutomaticAudioRetention = () => {
    const foregroundWorkActive = Object.values(
      knowledgeSynthesisPause.snapshot(),
    ).some((count) => Number(count) > 0);
    if (foregroundWorkActive) return;
    void audioRetention.sweep().catch(() => {
      console.warn('[Pluto] Audio retention sweep failed');
    });
  };
  if (encryptionRollout.retentionEnforcement) {
    const audioRetentionTimer = setTimeout(runAutomaticAudioRetention, 30_000);
    audioRetentionTimer.unref();
    const audioRetentionInterval = setInterval(
      runAutomaticAudioRetention,
      6 * 60 * 60_000,
    );
    audioRetentionInterval.unref();
  }

  const historicalMigrationKeyStore = getAudioKeyStore();
  if (
    encryptionRollout.historicalAudioMigration &&
    historicalMigrationKeyStore
  ) {
    const historicalAudioMigration = createHistoricalAudioMigrationManager({
      rootDir: getMeetingArtifactsRootDir(),
      sqlite: getApplicationDatabase(),
      listMeetings: () => db.getMeetings() as db.PersistedMeeting[],
      audioKeyStore: historicalMigrationKeyStore,
      isMeetingActive: (meetingId) =>
        activeTranscriptionMeetings.has(meetingId) ||
        activeAnalysisGenerations.has(meetingId),
      acquireMigrationLease: (meetingId) => {
        if (
          activeAudioDeletions.has(meetingId) ||
          activeTranscriptionMeetings.has(meetingId) ||
          activeAnalysisGenerations.has(meetingId)
        ) {
          return null;
        }
        activeAudioDeletions.add(meetingId);
        return () => activeAudioDeletions.delete(meetingId);
      },
    });
    const runHistoricalAudioMigration = () => {
      const foregroundWorkActive = Object.values(
        knowledgeSynthesisPause.snapshot(),
      ).some((count) => Number(count) > 0);
      if (foregroundWorkActive) return;
      void historicalAudioMigration.sweepOne().catch(() => {
        console.warn('[Pluto] Historical audio migration failed');
      });
    };
    const migrationTimer = setTimeout(runHistoricalAudioMigration, 60_000);
    migrationTimer.unref();
    const migrationInterval = setInterval(
      runHistoricalAudioMigration,
      5 * 60_000,
    );
    migrationInterval.unref();
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
