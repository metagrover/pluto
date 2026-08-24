import { useEffect, useRef, useState } from 'react';
import './App.css';

// Core
import { AudioManager } from './components/AudioManager';
import { SetupWizard } from './components/Setup/SetupWizard';
import { AutoEndToast } from './components/ui/AutoEndToast';
import { useActiveCallMonitor } from './hooks/useActiveCallMonitor';
import { useAutoEndMonitor } from './hooks/useAutoEndMonitor';

// Layout
import { Sidebar } from './components/layout/Sidebar';

import { updateAlertStatus } from './api/intelligence';
import type { Entity } from './api/knowledgeGraph';
import { AskPluto } from './components/features/AskPluto';
// Feature Views
import { Dashboard } from './components/features/Dashboard';
import { MeetingView } from './components/features/MeetingView';
import { RECORDING_SCRATCHPAD_STORAGE_KEY } from './components/features/RecordingMeetingRail';
import { ZenMode } from './components/features/ZenMode';
import {
  DASHBOARD_ACTION_COMPLETION_ERROR,
  DASHBOARD_COMMITMENT_CREATION_ERROR,
  DashboardRefreshAfterMutationError,
  persistDashboardActionCompletion,
  persistDashboardAttentionStatus,
  persistDashboardCommitmentCreation,
  persistDashboardCommitmentReview,
} from './components/features/dashboardActionCompletion';
import type {
  CaptureHealthState,
  LiveTranscriptIntegrity,
  LiveTranscriptSegment,
} from './components/features/recordingWorkspaceModel';
import { useDashboardHome } from './components/features/useDashboardHome';
import { runPersistedMeetingFinalTranscription } from './services/finalTranscription/runPersistedMeetingFinalTranscription';
import {
  canRetryMeetingFinalTranscription,
  forgetExpiredMeetingProcessingAttempts,
  isParakeetValidatedMeeting,
  meetingProcessingFingerprint,
  nextMeetingProcessingWakeDelay,
  rememberMeetingProcessingOutcome,
  selectNextMeetingForFinalTranscription,
  selectNextMeetingForProcessing,
} from './services/postMeetingProcessingCoordinator';
import { processValidatedMeetingDownstream } from './services/processValidatedMeetingDownstream';
import { retryMeetingTranscriptValidation } from './services/retryMeetingTranscriptValidation';

import {
  searchEntities,
  updateActionCommitmentState,
  updateEntityStatus,
  upsertEntity,
} from './api/knowledgeGraph';
// Knowledge Graph
import { KnowledgeTab } from './components/KnowledgeGraph/KnowledgeTab';
import { PeopleTab } from './components/KnowledgeGraph/PeopleTab';
import { ProjectsExecutionTab } from './components/KnowledgeGraph/ProjectsExecutionTab';
import { AllMeetingsTab } from './components/features/AllMeetingsTab';

import { SettingsTab } from './components/features/SettingsTab';
// Overlays
import { PermissionsOverlay } from './components/overlays/PermissionsOverlay';
import { SearchOverlay } from './components/overlays/SearchOverlay';
import { buildSearchPlutoResults } from './components/overlays/searchPlutoModel';

// Types
import type { Meeting } from './types';
import {
  isGrantedStatus,
  resolveMicrophoneStatus,
  resolveSystemAudioStatus,
  shouldRunBootPermissionProbe,
} from './utils/permissions';

const meetingPreviewEnabled =
  new URLSearchParams(window.location.search).get('preview') === 'meeting';

function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [isServerReady, setIsServerReady] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [transcriptValidationRetrying, setTranscriptValidationRetrying] =
    useState(false);
  const finalTranscriptionAbortRef = useRef<AbortController | null>(null);
  const [finalTranscriptionMeetingId, setFinalTranscriptionMeetingId] =
    useState<string | number | null>(null);
  const autoAnalysisAttemptsRef = useRef(new Set<string>());
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingParticipants, setMeetingParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zenVisible, setZenVisible] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<
    string | number | null
  >(meetingPreviewEnabled ? 'preview-architecture-docs' : null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'hub' | 'people' | 'projects' | 'wiki' | 'meetings' | 'chat' | 'settings'
  >(
    window.__PLUTO_BROWSER_PREVIEW__ && !meetingPreviewEnabled ? 'wiki' : 'hub',
  );
  const [sidebarVisible, setSidebarVisible] = useState(
    (!window.__PLUTO_BROWSER_PREVIEW__ || meetingPreviewEnabled) &&
      window.innerWidth >= 768,
  );
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchEntitiesResults, setSearchEntitiesResults] = useState<Entity[]>(
    [],
  );
  const searchRequestIdRef = useRef(0);
  const [permissionsVisible, setPermissionsVisible] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({
    mic: 'unknown',
    systemAudio: 'unknown',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [llmProvider, setLlmProvider] = useState<
    'ollama' | 'gemini' | 'openai' | 'claude'
  >('ollama');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [whisperLanguage, setWhisperLanguage] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [updatingDashboardTaskIds, setUpdatingDashboardTaskIds] = useState<
    Set<string>
  >(new Set());
  const [dashboardActionError, setDashboardActionError] = useState<
    string | null
  >(null);
  const [currentNotes, setCurrentNotes] = useState(
    () => window.localStorage.getItem(RECORDING_SCRATCHPAD_STORAGE_KEY) || '',
  );
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [autoEndEnabled, setAutoEndEnabled] = useState(true);

  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const stopSessionRef = useRef<((endReason?: string) => void) | null>(null);
  const startSessionRef = useRef<(() => void) | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptSegment[]>(
    [],
  );
  const [interimTranscript, setInterimTranscript] = useState('');
  const [recordingStartedAtMs, setRecordingStartedAtMs] = useState<
    number | null
  >(null);
  const [captureHealth, setCaptureHealth] = useState<CaptureHealthState>({
    microphone: 'healthy',
    systemAudio: 'healthy',
    captureDurability: 'healthy',
  });
  const [liveTranscriptIntegrity, setLiveTranscriptIntegrity] =
    useState<LiveTranscriptIntegrity>('healthy');

  useActiveCallMonitor({
    setupNeeded,
    isRecording,
    isProcessing,
    startSessionRef,
  });

  const {
    autoEndTriggered,
    autoEndReason,
    autoEndAppName,
    dismissAutoEndToast,
  } = useAutoEndMonitor({
    isRecording,
    autoEndEnabled,
    stopSessionRef,
  });

  const handleCopySummary = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleCompleteTask = async (taskId: string) => {
    if (updatingDashboardTaskIds.has(taskId)) return;

    setDashboardActionError(null);
    setUpdatingDashboardTaskIds((prev) => new Set(prev).add(taskId));

    try {
      await persistDashboardActionCompletion(taskId, {
        updateEntityStatus,
        refreshDashboard: dashboardHome.refresh,
      });
    } catch (error) {
      console.error('Failed to complete dashboard follow-up', error);
      setDashboardActionError(DASHBOARD_ACTION_COMPLETION_ERROR);
    } finally {
      setUpdatingDashboardTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleUpdateDashboardAttentionStatus = async (
    attentionItemId: string,
    nextStatus: 'active' | 'dismissed' | 'snoozed',
  ) => {
    if (updatingDashboardTaskIds.has(attentionItemId)) return;

    setDashboardActionError(null);
    setUpdatingDashboardTaskIds((prev) => new Set(prev).add(attentionItemId));

    try {
      await persistDashboardAttentionStatus(attentionItemId, nextStatus, {
        updateAttentionStatus: updateAlertStatus,
        refreshDashboard: dashboardHome.refresh,
      });
    } catch (error) {
      console.error('Failed to update dashboard follow-up lifecycle', error);
      setDashboardActionError(DASHBOARD_ACTION_COMPLETION_ERROR);
    } finally {
      setUpdatingDashboardTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(attentionItemId);
        return next;
      });
    }
  };

  const handleReviewDashboardCommitment = async (
    taskId: string,
    commitmentState: 'confirmed' | 'rejected',
  ) => {
    if (updatingDashboardTaskIds.has(taskId)) return;

    setDashboardActionError(null);
    setUpdatingDashboardTaskIds((prev) => new Set(prev).add(taskId));

    try {
      await persistDashboardCommitmentReview(taskId, commitmentState, {
        updateActionCommitmentState,
        refreshDashboard: dashboardHome.refresh,
      });
    } catch (error) {
      console.error('Failed to review dashboard follow-up', error);
      setDashboardActionError(
        error instanceof DashboardRefreshAfterMutationError
          ? 'Follow-up review saved, but the dashboard could not refresh.'
          : 'Could not update follow-up review. Try again.',
      );
    } finally {
      setUpdatingDashboardTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleCreateDashboardCommitment = async (
    text: string,
    dueDate: string | null,
  ) => {
    setDashboardActionError(null);

    try {
      await persistDashboardCommitmentCreation(
        { text, dueDate },
        {
          upsertEntity,
          refreshDashboard: dashboardHome.refresh,
        },
      );
    } catch (error) {
      console.error('Failed to add dashboard commitment', error);
      setDashboardActionError(DASHBOARD_COMMITMENT_CREATION_ERROR);
      throw error;
    }
  };

  const handleDeleteMeeting = async (id: string | number) => {
    if (
      window.confirm(
        'Are you sure you want to delete this meeting and all related intelligence? This cannot be undone.',
      )
    ) {
      try {
        await window.ipcRenderer.invoke('DELETE_MEETING', id);
        setSelectedMeetingId(null);
        fetchMeetings();
      } catch (e) {
        console.error('Failed to delete meeting', e);
      }
    }
  };

  useEffect(() => {
    setTranscriptVisible(false);
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [selectedMeetingId]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const highlightEntities = (text: string) => {
    const entities = [
      { pattern: /Dave|David/g, type: 'person', icon: '👤' },
      { pattern: /API Migration|API/g, type: 'project', icon: '📁' },
      { pattern: /Knowledge Graph|Schema/g, type: 'topic', icon: '💡' },
      { pattern: /Friday|Monday|Standup/g, type: 'topic', icon: '🗓️' },
    ];

    let parts: (string | JSX.Element)[] = [text];
    for (const entity of entities) {
      const newParts: (string | JSX.Element)[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          const subParts = part.split(entity.pattern);
          const matches = part.match(entity.pattern);
          for (const [k, sp] of subParts.entries()) {
            newParts.push(sp);
            const matchText = matches?.[k];
            if (matchText) {
              newParts.push(
                <span
                  key={`${entity.type}-${k}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery(matchText);
                    setSearchVisible(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setSearchQuery(matchText);
                      setSearchVisible(true);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-pro-accent/5 border border-pro-accent/20 rounded-md text-pro-accent font-bold text-[13px] hover:bg-pro-accent hover:text-white transition-colors cursor-pointer group/pill"
                >
                  <span className="opacity-60 group-hover/pill:opacity-100">
                    {entity.icon}
                  </span>
                  {matchText}
                </span>,
              );
            }
          }
        } else {
          newParts.push(part);
        }
      }
      parts = newParts;
    }
    return parts;
  };

  useEffect(() => {
    window.ipcRenderer.invoke('GET_SETTING', 'setup_complete').then((val) => {
      setSetupNeeded(val !== 'true');
    });

    fetchMeetings();

    window.ipcRenderer.invoke('GET_SETTING', 'llm_provider').then((val) => {
      if (val) setLlmProvider(val as 'ollama' | 'gemini' | 'openai' | 'claude');
    });
    window.ipcRenderer.invoke('GET_SETTING', 'gemini_api_key').then((val) => {
      if (val) setGeminiApiKey(val);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'openai_api_key').then((val) => {
      if (val) setOpenaiApiKey(val);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'claude_api_key').then((val) => {
      if (val) setClaudeApiKey(val);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'ollama_model').then((val) => {
      if (val) setOllamaModel(val);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'auto_end_enabled').then((val) => {
      if (val !== null) setAutoEndEnabled(val !== 'false');
    });
    window.ipcRenderer.invoke('GET_SETTING', 'theme').then((val) => {
      if (val) setTheme(val as 'light' | 'dark' | 'system');
    });
    window.ipcRenderer
      .invoke('GET_SETTING', 'transcription_language')
      .then((val) => {
        if (val !== null && val !== undefined) setWhisperLanguage(String(val));
      });

    const checkServer = async () => {
      try {
        const health = await window.ipcRenderer.invoke('MLX_PREVIEW_HEALTH');
        if (health.status === 'ok') {
          setIsServerReady(true);
        } else {
          setTimeout(checkServer, 1000);
        }
      } catch (e) {
        setTimeout(checkServer, 1000);
      }
    };
    checkServer();

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarVisible((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (startSessionRef.current && !isRecording) {
          startSessionRef.current();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActiveTab((prev) => (prev === 'chat' ? 'hub' : 'chat'));
        setSelectedMeetingId(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setSearchVisible(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setActiveTab('settings');
        setSelectedMeetingId(null);
      }
      if (e.key === 'Escape') {
        setSearchVisible(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording]);

  const fetchMeetings = async () => {
    try {
      const data = await window.ipcRenderer.invoke('GET_MEETINGS');
      const fetchedMeetings = Array.isArray(data) ? (data as Meeting[]) : [];
      setMeetings(fetchedMeetings);
      return fetchedMeetings;
    } catch (e) {
      console.error('Failed to fetch meetings', e);
      setMeetings([]);
      return [];
    }
  };

  const handleRetryTranscriptValidation = async (
    meetingId: string | number | null = selectedMeetingId,
  ) => {
    if (!meetingId || transcriptValidationRetrying) return;
    setTranscriptValidationRetrying(true);
    try {
      const meeting = safeMeetings.find(
        (candidate) => String(candidate.id) === String(meetingId),
      );
      if (meeting && canRetryMeetingFinalTranscription(meeting)) {
        await runMeetingFinalTranscription(meeting);
        return;
      }
      if (meeting && isParakeetValidatedMeeting(meeting)) {
        await processValidatedMeetingDownstream(
          meeting.id,
          (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
        );
        await fetchMeetings();
        return;
      }
      const result = await retryMeetingTranscriptValidation(
        meetingId,
        (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
      );
      const refreshedMeetings = await fetchMeetings();
      if (result.status !== 'superseded') {
        rememberMeetingProcessingOutcome(
          autoAnalysisAttemptsRef.current,
          refreshedMeetings.find(
            (meeting) => String(meeting.id) === String(meetingId),
          ),
        );
      }
    } catch (error) {
      console.error('[Pluto] Transcript validation retry failed', error);
    } finally {
      setTranscriptValidationRetrying(false);
    }
  };

  const handleRecordingChange = (recording: boolean) => {
    const wasRecording = isRecording;
    setIsRecording(recording);
    if (recording && !wasRecording) {
      setZenVisible(true);
      setMeetingTitle('');
      setMeetingParticipants([]);
      setParticipantInput('');
      setSelectedMeetingId(null);
    }
  };

  const safeMeetings = Array.isArray(meetings) ? meetings : [];
  const dashboardHome = useDashboardHome({
    isRecording,
    meetings: safeMeetings,
  });
  const selectedMeeting = safeMeetings.find(
    (m) => String(m.id) === String(selectedMeetingId),
  );
  const activeRecording = isRecording || isProcessing;
  const showZenMode = activeRecording && zenVisible;
  const handleBackHomeFromZen = () => {
    setZenVisible(false);
    setSelectedMeetingId(null);
    setActiveTab('hub');
    setSidebarVisible(true);
  };

  const runMeetingFinalTranscription = async (meeting: Meeting) => {
    if (finalTranscriptionAbortRef.current) return;
    const controller = new AbortController();
    finalTranscriptionAbortRef.current = controller;
    setFinalTranscriptionMeetingId(meeting.id);
    try {
      await runPersistedMeetingFinalTranscription(
        meeting,
        (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
        { signal: controller.signal },
      );
    } catch (error) {
      console.error('[Pluto] Final transcription worker failed', error);
    } finally {
      if (finalTranscriptionAbortRef.current === controller) {
        finalTranscriptionAbortRef.current = null;
        setFinalTranscriptionMeetingId(null);
      }
      await fetchMeetings();
    }
  };

  useEffect(() => {
    if (activeRecording || finalTranscriptionAbortRef.current) return;
    const candidate = selectNextMeetingForFinalTranscription(safeMeetings);
    if (!candidate?.id) return;
    void runMeetingFinalTranscription(candidate as Meeting);
  }, [activeRecording, safeMeetings, finalTranscriptionMeetingId]);

  useEffect(() => {
    if (!activeRecording) return;
    finalTranscriptionAbortRef.current?.abort();
    if (finalTranscriptionMeetingId) {
      void window.ipcRenderer.invoke(
        'TRANSCRIPTION_CANCEL_AND_UNLOAD_FINAL',
        finalTranscriptionMeetingId,
      );
    }
  }, [activeRecording, finalTranscriptionMeetingId]);

  useEffect(() => {
    if (
      transcriptValidationRetrying ||
      finalTranscriptionAbortRef.current ||
      selectNextMeetingForFinalTranscription(safeMeetings)
    )
      return;
    const candidate = selectNextMeetingForProcessing(
      safeMeetings,
      autoAnalysisAttemptsRef.current,
    );
    if (!candidate?.id) return;
    autoAnalysisAttemptsRef.current.add(
      meetingProcessingFingerprint(candidate),
    );
    void handleRetryTranscriptValidation(candidate.id);
  }, [safeMeetings, transcriptValidationRetrying]);

  useEffect(() => {
    if (transcriptValidationRetrying) return;
    const delay = nextMeetingProcessingWakeDelay(
      safeMeetings,
      Date.now(),
      autoAnalysisAttemptsRef.current,
    );
    if (delay === null) return;
    const timeout = window.setTimeout(() => {
      forgetExpiredMeetingProcessingAttempts(
        safeMeetings,
        autoAnalysisAttemptsRef.current,
      );
      void fetchMeetings();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [safeMeetings, transcriptValidationRetrying]);

  const searchPlutoResults = buildSearchPlutoResults({
    query: searchQuery,
    meetings: safeMeetings,
    entities: searchEntitiesResults,
  });

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!searchVisible || !trimmed) {
      searchRequestIdRef.current += 1;
      setSearchEntitiesResults([]);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    const timeout = window.setTimeout(() => {
      searchEntities(trimmed)
        .then((entities) => {
          if (searchRequestIdRef.current === requestId) {
            setSearchEntitiesResults(entities);
          }
        })
        .catch((error) => {
          console.error('Failed to search entities', error);
          if (searchRequestIdRef.current === requestId) {
            setSearchEntitiesResults([]);
          }
        });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [searchQuery, searchVisible]);

  const probeMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  };

  const checkSystemAudioPermission = async (
    micStatus: string,
    allowSilent = true,
  ) => {
    try {
      const ok = await window.ipcRenderer.invoke('SYSTEM_AUDIO_PROBE', {
        durationMs: 1500,
        allowSilent,
        silentProbe: true,
      });
      const systemAudioStatus = resolveSystemAudioStatus(ok, allowSilent);
      setPermissionStatus((prev) => ({
        ...prev,
        mic: micStatus,
        systemAudio: systemAudioStatus,
      }));
      return { systemAudioStatus };
    } catch {
      const systemAudioStatus = resolveSystemAudioStatus(false, allowSilent);
      setPermissionStatus((prev) => ({
        ...prev,
        mic: micStatus,
        systemAudio: systemAudioStatus,
      }));
      return { systemAudioStatus };
    }
  };

  useEffect(() => {
    if (!shouldRunBootPermissionProbe(setupNeeded)) return;
    const probeOnBoot = async () => {
      const alreadyDone = await window.ipcRenderer.invoke('BOOT_PROBE_STATUS');
      if (alreadyDone) return;
      await window.ipcRenderer.invoke('BOOT_PROBE_MARK');
      const nativeMicStatus = await window.ipcRenderer.invoke(
        'CHECK_MICROPHONE_PERMISSION',
      );
      const micProbeSucceeded = isGrantedStatus(nativeMicStatus)
        ? true
        : await probeMicrophonePermission();
      const micStatus = resolveMicrophoneStatus(
        nativeMicStatus,
        micProbeSucceeded,
      );
      const { systemAudioStatus } = await checkSystemAudioPermission(micStatus);
      if (!isGrantedStatus(micStatus)) {
        window.dispatchEvent(
          new CustomEvent('SHOW_PERMISSION_OVERLAY', {
            detail: { micStatus, systemAudioStatus },
          }),
        );
      }
    };

    void probeOnBoot();
    const handlePermissionsOverlay = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setPermissionStatus({
        mic: detail.micStatus || 'unknown',
        systemAudio: detail.systemAudioStatus || 'unknown',
      });
      setPermissionsVisible(true);
    };
    window.addEventListener(
      'SHOW_PERMISSION_OVERLAY',
      handlePermissionsOverlay,
    );
    return () =>
      window.removeEventListener(
        'SHOW_PERMISSION_OVERLAY',
        handlePermissionsOverlay,
      );
  }, [setupNeeded]);

  useEffect(() => {
    const micGranted = isGrantedStatus(permissionStatus.mic);
    const systemGranted = isGrantedStatus(permissionStatus.systemAudio);
    if (micGranted && systemGranted) {
      setPermissionsVisible(false);
    }
  }, [permissionStatus]);

  useEffect(() => {
    const handleReadinessFailed = () => setSetupNeeded(true);
    window.addEventListener(
      'RECORDING_READINESS_FAILED' as any,
      handleReadinessFailed,
    );
    return () =>
      window.removeEventListener(
        'RECORDING_READINESS_FAILED' as any,
        handleReadinessFailed,
      );
  }, []);

  const retryRecordingIfReady = async () => {
    await window.ipcRenderer.invoke('APP_RELAUNCH');
  };

  if (setupNeeded === null || (!setupNeeded && !isServerReady))
    return (
      <div className="app-init-drag h-screen w-screen bg-pro-bg flex flex-col gap-4 items-center justify-center text-pro-text-muted/40 font-medium animate-pulse text-xs">
        <div className="w-8 h-8 rounded-full border-2 border-pro-accent border-t-transparent animate-spin mb-4" />
        <span>Initializing Neural Engine...</span>
      </div>
    );
  if (setupNeeded)
    return <SetupWizard onComplete={() => setSetupNeeded(false)} />;

  return (
    <div className="flex h-screen w-screen bg-pro-bg text-pro-text-main font-sans overflow-hidden hover:cursor-default selection:bg-pro-accent/20">
      <div className="hidden">
        <AudioManager
          onSessionComplete={async (meetingId) => {
            await fetchMeetings();
            if (meetingId) {
              window.localStorage.removeItem(RECORDING_SCRATCHPAD_STORAGE_KEY);
              setCurrentNotes('');
              setSelectedMeetingId(meetingId);
            }
          }}
          onRecordingChange={handleRecordingChange}
          onProcessingChange={setIsProcessing}
          systemAudioStatus={permissionStatus.systemAudio}
          userNotes={currentNotes}
          transcriptionSettings={{
            backend: 'mlx_preview',
            preset: 'balanced',
            model: 'base',
            device: 'mlx',
            computeType: 'float16',
            language: whisperLanguage,
          }}
          onStopSessionRef={stopSessionRef}
          onStartSessionRef={startSessionRef}
          onLiveTranscript={setLiveTranscript}
          onInterimTranscript={setInterimTranscript}
          onCaptureHealthChange={setCaptureHealth}
          onLiveTranscriptIntegrityChange={setLiveTranscriptIntegrity}
          onRecordingStarted={(startedAtMs) => {
            setRecordingStartedAtMs(startedAtMs);
            setLiveTranscript([]);
            setInterimTranscript('');
            setLiveTranscriptIntegrity('healthy');
          }}
          userTitle={meetingTitle}
          participants={meetingParticipants}
        />
      </div>

      {!showZenMode && (
        <>
          <div
            className={`fixed inset-0 bg-black/20 z-30 lg:hidden transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setSidebarVisible(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSidebarVisible(false);
              }
            }}
          />
          <Sidebar
            sidebarVisible={sidebarVisible}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedMeetingId={selectedMeetingId}
            setSelectedMeetingId={setSelectedMeetingId}
            safeMeetings={safeMeetings}
            onStartRecording={() => {
              if (startSessionRef.current) {
                startSessionRef.current();
              }
            }}
            isRecordingActive={activeRecording}
            onReturnToRecording={() => setZenVisible(true)}
            onOpenSearch={() => setSearchVisible(true)}
            handleDeleteMeeting={handleDeleteMeeting}
            theme={theme}
            setTheme={(newTheme) => {
              setTheme(newTheme);
              window.ipcRenderer.invoke('SET_SETTING', {
                key: 'theme',
                value: newTheme,
              });
            }}
          />
        </>
      )}

      {showZenMode ? (
        <ZenMode
          isProcessing={isProcessing}
          onEndMeeting={() => {
            if (stopSessionRef.current && !isProcessing) {
              stopSessionRef.current();
            }
          }}
          onBackHome={handleBackHomeFromZen}
          meetingTitle={meetingTitle}
          setMeetingTitle={setMeetingTitle}
          meetingParticipants={meetingParticipants}
          setMeetingParticipants={setMeetingParticipants}
          participantInput={participantInput}
          setParticipantInput={setParticipantInput}
          currentNotes={currentNotes}
          setCurrentNotes={setCurrentNotes}
          liveTranscript={liveTranscript}
          interimText={interimTranscript}
          captureHealth={captureHealth}
          liveTranscriptIntegrity={liveTranscriptIntegrity}
          recordingStartedAtMs={recordingStartedAtMs}
        />
      ) : (
                <main
          className={`flex-1 flex flex-col bg-pro-bg h-full relative z-10 overflow-hidden content-shift ${
            selectedMeetingId
              ? 'meeting-app-shell'
              : 'rounded-l-[2.5rem] border-l border-pro-border/10'
          }`}
        >
          <div className="h-10 w-full shrink-0 drag-region bg-transparent z-50 pointer-events-auto" />
          <div
            ref={contentScrollRef}
            className={`flex-1 flex flex-col scroll-smooth relative ${
              activeTab === 'wiki' && !selectedMeetingId
                ? 'overflow-hidden'
                : 'overflow-y-scroll'
            } ${
              selectedMeetingId
                ? 'meeting-app-scroll'
                : activeTab === 'wiki'
                  ? 'px-0 py-0'
                  : activeTab === 'chat'
                    ? 'px-0 py-0'
                    : activeTab === 'settings'
                      ? 'px-5 pt-[50px] pb-6 md:px-8 md:pb-8'
                      : !selectedMeetingId && activeTab === 'hub'
                        ? 'px-4 md:px-12 lg:px-20 py-6 md:py-10 space-y-8'
                        : !selectedMeetingId && activeTab === 'people'
                          ? 'px-5 pt-[50px] pb-6 md:px-8 md:pb-8'
                          : !selectedMeetingId && activeTab === 'projects'
                            ? 'px-5 pt-[50px] pb-6 md:px-8 md:pb-8'
                            : !selectedMeetingId && activeTab === 'meetings'
                              ? 'px-5 pt-[50px] pb-6 md:px-8 md:pb-8'
                              : 'px-4 md:px-12 lg:px-20 py-8 md:py-16 space-y-12 md:space-y-20'
            }`}
          >
            <>
              <div className="app-background-glow fixed top-0 right-0 w-[800px] h-[800px] rounded-full blur-[120px] -mr-96 -mt-96 pointer-events-none z-0" />
              <div className="app-background-glow fixed bottom-0 left-0 w-[600px] h-[600px] rounded-full blur-[100px] -ml-40 -mb-40 pointer-events-none z-0" />
              <div className="app-background-glow fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[150px] pointer-events-none z-0 opacity-40" />
            </>

            {selectedMeetingId ? (
              <MeetingView
                selectedMeeting={selectedMeeting}
                editingTitle={editingTitle}
                setEditingTitle={setEditingTitle}
                titleValue={titleValue}
                setTitleValue={setTitleValue}
                fetchMeetings={fetchMeetings}
                handleCopySummary={handleCopySummary}
                copySuccess={copySuccess}
                handleDeleteMeeting={handleDeleteMeeting}
                highlightEntities={highlightEntities}
                transcriptVisible={transcriptVisible}
                setTranscriptVisible={setTranscriptVisible}
                onRetryTranscriptValidation={() => {
                  void handleRetryTranscriptValidation();
                }}
                transcriptValidationRetrying={transcriptValidationRetrying}
              />
            ) : activeTab === 'hub' ? (
              <Dashboard
                model={dashboardHome.model}
                loading={dashboardHome.loading}
                isRecording={isRecording}
                setSelectedMeetingId={setSelectedMeetingId}
                setActiveTab={setActiveTab}
                updatingTaskIds={updatingDashboardTaskIds}
                actionError={dashboardActionError}
                handleCompleteTask={handleCompleteTask}
                handleReviewCommitment={handleReviewDashboardCommitment}
                handleCreateCommitment={handleCreateDashboardCommitment}
                handleUpdateAttentionStatus={
                  handleUpdateDashboardAttentionStatus
                }
              />
            ) : activeTab === 'people' ? (
              <div className="mx-auto w-full max-w-[1180px] animate-in pb-20">
                <PeopleTab
                  selectedPersonId={selectedPersonId}
                  onOpenMeeting={(meetingId) => setSelectedMeetingId(meetingId)}
                />
              </div>
            ) : activeTab === 'projects' ? (
              <div className="max-w-5xl mx-auto w-full space-y-12 animate-in pb-20">
                <ProjectsExecutionTab selectedProjectId={selectedProjectId} />
              </div>
            ) : activeTab === 'wiki' ? (
              <div className="h-full w-full animate-in pb-10">
                <KnowledgeTab
                  onOpenMeeting={(meetingId) => {
                    setSelectedMeetingId(meetingId);
                    setActiveTab('hub');
                  }}
                  onOpenProjectsTab={() => setActiveTab('projects')}
                />
              </div>
            ) : activeTab === 'meetings' ? (
              <AllMeetingsTab
                meetings={safeMeetings}
                onOpenMeeting={(meetingId) => setSelectedMeetingId(meetingId)}
                handleDeleteMeeting={handleDeleteMeeting}
              />
            ) : activeTab === 'chat' ? (
              <div className="flex-1 w-full animate-in flex flex-col">
                <AskPluto
                  visible={true}
                  onClose={() => setActiveTab('hub')}
                  onOpenMeeting={(meetingId) => setSelectedMeetingId(meetingId)}
                />
              </div>
            ) : activeTab === 'settings' ? (
              <SettingsTab
                llmProvider={llmProvider}
                setLlmProvider={setLlmProvider}
                geminiApiKey={geminiApiKey}
                setGeminiApiKey={setGeminiApiKey}
                openaiApiKey={openaiApiKey}
                setOpenaiApiKey={setOpenaiApiKey}
                claudeApiKey={claudeApiKey}
                setClaudeApiKey={setClaudeApiKey}
                ollamaModel={ollamaModel}
                setOllamaModel={setOllamaModel}
                whisperLanguage={whisperLanguage}
                setWhisperLanguage={setWhisperLanguage}
                autoEndEnabled={autoEndEnabled}
                setAutoEndEnabled={setAutoEndEnabled}
                fetchMeetings={fetchMeetings}
                setSelectedMeetingId={setSelectedMeetingId}
                theme={theme}
                setTheme={(newTheme) => {
                  setTheme(newTheme);
                  window.ipcRenderer.invoke('SET_SETTING', {
                    key: 'theme',
                    value: newTheme,
                  });
                }}
              />
            ) : (
              <div className="max-w-4xl mx-auto w-full space-y-24 animate-in duration-1000 text-center py-40 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pro-accent/5 rounded-full blur-[120px] pointer-events-none" />
                <div className="w-32 h-32 rounded-lg bg-pro-surface border border-pro-border flex items-center justify-center text-5xl mx-auto mb-10 shadow-sm  group">
                  <span className="group-hover:rotate-12 transition-transform duration-500">
                    {activeTab === 'people'
                      ? '👤'
                      : activeTab === 'projects'
                        ? '📁'
                        : activeTab === 'wiki'
                          ? '🧠'
                          : '🎯'}
                  </span>
                </div>
                <div className="space-y-6 relative z-10">
                  <h2 className="text-5xl font-semibold heading-premiumer italic opacity-10">
                    {activeTab} Terminal
                  </h2>
                  <h2 className="text-4xl font-semibolder">
                    Your {activeTab} space is{' '}
                    <span className="gradient-text">awaiting context.</span>
                  </h2>
                  <p className="text-lg text-pro-text-muted/60 font-medium max-w-xl mx-auto leading-relaxed">
                    The extraction engine is indexing your local nebula. Record
                    a session to populate this space with interconnected
                    insights.
                  </p>
                </div>
                <div className="pt-10 flex flex-col items-center gap-6 relative z-10">
                  <button
                    type="button"
                    onClick={() => {
                      if (startSessionRef.current) startSessionRef.current();
                    }}
                    className="h-16 px-12 rounded-lg bg-pro-text-main dark:bg-pro-accent text-white font-semibold text-xs font-medium shadow-2xl hover:bg-pro-accent hover:scale-[1.02] transition-all "
                  >
                    Initialize Capture
                  </button>
                  <p className="text-[10px] font-semibold text-pro-text-muted/30 font-medium">
                    Ready for M-Series Deployment
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Global Overlays */}
      <SearchOverlay
        searchVisible={searchVisible}
        setSearchVisible={setSearchVisible}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        results={searchPlutoResults}
        onOpenMeeting={(meetingId) => {
          setSelectedMeetingId(meetingId);
          setSelectedProjectId(null);
          setSelectedPersonId(null);
          setActiveTab('hub');
        }}
        onOpenProjects={(projectId) => {
          setSelectedProjectId(String(projectId));
          setSelectedPersonId(null);
          setActiveTab('projects');
          setSelectedMeetingId(null);
        }}
        onOpenPeople={(personId) => {
          setSelectedPersonId(String(personId));
          setSelectedProjectId(null);
          setActiveTab('people');
          setSelectedMeetingId(null);
        }}
      />

      <PermissionsOverlay
        visible={permissionsVisible}
        onClose={() => setPermissionsVisible(false)}
        micStatus={permissionStatus.mic}
        systemAudioStatus={permissionStatus.systemAudio}
        onRetry={retryRecordingIfReady}
        onOpenSystemSettings={(pane) => {
          window.ipcRenderer.invoke('OPEN_SYSTEM_SETTINGS_PRIVACY', pane);
        }}
      />

      {autoEndTriggered && (
        <AutoEndToast
          reason={autoEndReason}
          appName={autoEndAppName}
          onReopen={() => {
            dismissAutoEndToast();
            if (startSessionRef.current) {
              startSessionRef.current();
            }
          }}
          onDismiss={dismissAutoEndToast}
        />
      )}
    </div>
  );
}

export default App;
