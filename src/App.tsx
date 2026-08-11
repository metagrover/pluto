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
import { AskPluto } from './components/features/AskPluto';
// Feature Views
import { Dashboard } from './components/features/Dashboard';
import { MeetingView } from './components/features/MeetingView';
import { ZenMode } from './components/features/ZenMode';
import {
  DASHBOARD_ACTION_COMPLETION_ERROR,
  DashboardRefreshAfterMutationError,
  persistDashboardActionCompletion,
  persistDashboardAttentionStatus,
  persistDashboardCommitmentReview,
} from './components/features/dashboardActionCompletion';
import type {
  CaptureHealthState,
  LiveTranscriptIntegrity,
  LiveTranscriptSegment,
} from './components/features/recordingWorkspaceModel';
import { useDashboardHome } from './components/features/useDashboardHome';
import {
  forgetExpiredMeetingProcessingAttempts,
  meetingProcessingFingerprint,
  nextMeetingProcessingWakeDelay,
  rememberMeetingProcessingOutcome,
  selectNextMeetingForProcessing,
} from './services/postMeetingProcessingCoordinator';
import { retryMeetingTranscriptValidation } from './services/retryMeetingTranscriptValidation';

import {
  updateActionCommitmentState,
  updateEntityStatus,
} from './api/knowledgeGraph';
// Knowledge Graph
import { KnowledgeTab } from './components/KnowledgeGraph/KnowledgeTab';
import { PeopleTab } from './components/KnowledgeGraph/PeopleTab';
import { ProjectsExecutionTab } from './components/KnowledgeGraph/ProjectsExecutionTab';

// Overlays
import { PermissionsOverlay } from './components/overlays/PermissionsOverlay';
import { SearchOverlay } from './components/overlays/SearchOverlay';
import { SettingsOverlay } from './components/overlays/SettingsOverlay';

// Types
import type { Meeting } from './types';
import {
  isGrantedStatus,
  resolveMicrophoneStatus,
  resolveSystemAudioStatus,
} from './utils/permissions';
import type {
  TranscriptionPreset,
  WhisperModel,
} from './utils/transcriptionSettings';

function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [isServerReady, setIsServerReady] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [transcriptValidationRetrying, setTranscriptValidationRetrying] =
    useState(false);
  const autoAnalysisAttemptsRef = useRef(new Set<string>());
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingParticipants, setMeetingParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<
    string | number | null
  >(null);
  const [activeTab, setActiveTab] = useState<
    'hub' | 'people' | 'projects' | 'wiki'
  >(window.__PLUTO_BROWSER_PREVIEW__ ? 'wiki' : 'hub');
  const [sidebarVisible, setSidebarVisible] = useState(
    !window.__PLUTO_BROWSER_PREVIEW__,
  );
  const [searchVisible, setSearchVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
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
  const [transcriptionPreset, setTranscriptionPreset] =
    useState<TranscriptionPreset>('balanced');
  const [whisperModel, setWhisperModel] = useState<WhisperModel>('small');
  const [whisperLanguage, setWhisperLanguage] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [askPlutoVisible, setAskPlutoVisible] = useState(false);
  const [updatingDashboardTaskIds, setUpdatingDashboardTaskIds] = useState<
    Set<string>
  >(new Set());
  const [dashboardActionError, setDashboardActionError] = useState<
    string | null
  >(null);
  const [currentNotes, setCurrentNotes] = useState('');
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
      .invoke('GET_SETTING', 'transcription_preset')
      .then((val) => {
        if (val) setTranscriptionPreset(val as TranscriptionPreset);
      });
    window.ipcRenderer.invoke('GET_SETTING', 'whisper_model').then((val) => {
      if (val) setWhisperModel(val as WhisperModel);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'whisper_language').then((val) => {
      if (val !== null && val !== undefined) setWhisperLanguage(String(val));
    });

    const checkServer = async () => {
      try {
        const health = await window.ipcRenderer.invoke('WHISPERX_HEALTH');
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
        setAskPlutoVisible(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsVisible(true);
      }
      if (e.key === 'Escape') {
        setSearchVisible(false);
        setAskPlutoVisible(false);
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
    const backgroundRunId = crypto.randomUUID();
    setTranscriptValidationRetrying(true);
    try {
      await window.ipcRenderer.invoke('SET_POST_MEETING_PROCESSING_ACTIVE', {
        runId: backgroundRunId,
        active: true,
      });
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
      await window.ipcRenderer
        .invoke('SET_POST_MEETING_PROCESSING_ACTIVE', {
          runId: backgroundRunId,
          active: false,
        })
        .catch(() => null);
      setTranscriptValidationRetrying(false);
    }
  };

  const handleRecordingChange = (recording: boolean) => {
    const wasRecording = isRecording;
    setIsRecording(recording);
    if (recording && !wasRecording) {
      setCurrentNotes('');
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

  useEffect(() => {
    if (transcriptValidationRetrying) return;
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

  const filteredMeetings = safeMeetings.filter(
    (m) =>
      (m.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.enhanced_notes || '')
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );

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
  }, []);

  useEffect(() => {
    const micGranted = isGrantedStatus(permissionStatus.mic);
    const systemGranted = isGrantedStatus(permissionStatus.systemAudio);
    if (micGranted && systemGranted) {
      setPermissionsVisible(false);
    }
  }, [permissionStatus]);

  const retryRecordingIfReady = async () => {
    await window.ipcRenderer.invoke('APP_RELAUNCH');
  };

  if (setupNeeded === null || (!setupNeeded && !isServerReady))
    return (
      <div className="app-init-drag h-screen w-screen bg-pro-bg flex flex-col gap-4 items-center justify-center text-pro-text-muted/40 font-black uppercase tracking-[0.2em] animate-pulse text-xs">
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
          onTranscript={() => {}}
          onSessionComplete={async (meetingId) => {
            await fetchMeetings();
            if (meetingId) {
              setSelectedMeetingId(meetingId);
            }
          }}
          onRecordingChange={handleRecordingChange}
          onProcessingChange={setIsProcessing}
          systemAudioStatus={permissionStatus.systemAudio}
          userNotes={currentNotes}
          transcriptionSettings={{
            backend: 'local_alt_apple_silicon',
            preset: transcriptionPreset,
            model: whisperModel,
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

      {!isRecording && !isProcessing && (
        <>
          <div
            className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-30 lg:hidden transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
            handleDeleteMeeting={handleDeleteMeeting}
            setSettingsVisible={setSettingsVisible}
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

      {isRecording || isProcessing ? (
        <ZenMode
          isProcessing={isProcessing}
          onEndMeeting={() => {
            if (stopSessionRef.current && !isProcessing) {
              stopSessionRef.current();
            }
          }}
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
        <main className="flex-1 flex flex-col bg-pro-bg h-full relative z-10 rounded-l-[2.5rem] overflow-hidden content-shift border-l border-pro-border/10">
          <header
            className={`app-titlebar flex items-center justify-between px-6 md:px-12 shrink-0 bg-pro-bg/40 backdrop-blur-3xl sticky top-0 border-b border-pro-border/20 z-20 ${
              !selectedMeetingId && activeTab === 'wiki' ? 'h-20' : 'h-28'
            }`}
          >
            <div className="flex items-center gap-8">
              <button
                type="button"
                onClick={() => setSidebarVisible((prev) => !prev)}
                className="w-11 h-11 rounded-xl bg-pro-surface border border-pro-border/40 shadow-premium flex items-center justify-center text-pro-text-muted hover:bg-pro-bg transition-all active-push group"
              >
                <svg
                  aria-hidden="true"
                  className={`w-5 h-5 transition-transform duration-700 ${sidebarVisible ? '' : 'rotate-180'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h2 className="text-sm font-black tracking-tight text-pro-text-main group cursor-default">
                  {isProcessing
                    ? 'Processing Intelligence...'
                    : isRecording
                      ? 'Capturing Intelligence'
                      : selectedMeetingId
                        ? selectedMeeting?.title || 'Review'
                        : activeTab === 'hub'
                          ? 'Dashboard'
                          : activeTab === 'wiki'
                            ? 'Knowledge Home'
                            : activeTab.charAt(0).toUpperCase() +
                              activeTab.slice(1)}
                </h2>
                <p className="text-[10px] font-bold text-pro-text-muted/60 uppercase tracking-widest mt-1">
                  {isRecording
                    ? 'Neural Stream Live'
                    : selectedMeetingId
                      ? 'Archived Context'
                      : activeTab === 'wiki'
                        ? 'Compiled Intelligence'
                        : 'All Activities'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setAskPlutoVisible(true)}
                className="h-10 px-5 rounded-full bg-white dark:bg-pro-surface border border-pro-border/40 dark:border-pro-border/50 shadow-sm flex items-center gap-3 hover:border-pro-accent/40 transition-all active-push group"
              >
                <span className="text-sm">🧠</span>
                <span className="text-[9px] font-black text-pro-text-muted/60 dark:text-pro-text-main/70 uppercase tracking-[0.2em] pt-[1px]">
                  Ask Pluto
                </span>
                <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity ml-2">
                  <span className="w-4 h-4 rounded border border-pro-border flex items-center justify-center text-[8px] font-bold">
                    ⌘
                  </span>
                  <span className="w-4 h-4 rounded border border-pro-border flex items-center justify-center text-[8px] font-bold">
                    K
                  </span>
                </div>
              </button>
              <div className="w-[1px] h-6 bg-pro-border/20" />
              <button
                type="button"
                onClick={() => setSettingsVisible(true)}
                className="w-11 h-11 rounded-xl bg-pro-surface border border-pro-border/40 shadow-premium flex items-center justify-center text-pro-text-muted hover:bg-pro-bg transition-all active-push"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
          </header>

          <div
            ref={contentScrollRef}
            className={`flex-1 overflow-y-auto flex flex-col scroll-smooth relative ${
              !selectedMeetingId && activeTab === 'wiki'
                ? 'px-0 py-0'
                : !selectedMeetingId && activeTab === 'hub'
                  ? 'px-4 md:px-12 lg:px-20 py-6 md:py-10 space-y-8'
                  : !selectedMeetingId && activeTab === 'people'
                    ? 'px-5 py-6 md:px-8 md:py-8'
                    : !selectedMeetingId && activeTab === 'projects'
                      ? 'px-5 py-6 md:px-8 md:py-8'
                      : 'px-4 md:px-12 lg:px-20 py-8 md:py-16 space-y-12 md:space-y-20'
            }`}
          >
            <div className="fixed top-0 right-0 w-[800px] h-[800px] bg-pro-accent/5 rounded-full blur-[120px] -mr-96 -mt-96 pointer-events-none z-0" />
            <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-pro-accent/5 rounded-full blur-[100px] -ml-40 -mb-40 pointer-events-none z-0" />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-pro-accent/5 rounded-full blur-[150px] pointer-events-none z-0 opacity-40" />

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
                onRetryTranscriptValidation={handleRetryTranscriptValidation}
                transcriptValidationRetrying={transcriptValidationRetrying}
              />
            ) : activeTab === 'hub' ? (
              <Dashboard
                model={dashboardHome.model}
                loading={dashboardHome.loading}
                isRecording={isRecording}
                setSelectedMeetingId={setSelectedMeetingId}
                setActiveTab={setActiveTab}
                setAskPlutoVisible={setAskPlutoVisible}
                updatingTaskIds={updatingDashboardTaskIds}
                actionError={dashboardActionError}
                handleCompleteTask={handleCompleteTask}
                handleReviewCommitment={handleReviewDashboardCommitment}
                handleUpdateAttentionStatus={
                  handleUpdateDashboardAttentionStatus
                }
              />
            ) : activeTab === 'people' ? (
              <div className="mx-auto w-full max-w-[1180px] animate-in pb-20">
                <PeopleTab
                  onOpenMeeting={(meetingId) => setSelectedMeetingId(meetingId)}
                />
              </div>
            ) : activeTab === 'projects' ? (
              <div className="max-w-5xl mx-auto w-full space-y-12 animate-in pb-20">
                <ProjectsExecutionTab />
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
            ) : (
              <div className="max-w-4xl mx-auto w-full space-y-24 animate-in duration-1000 text-center py-40 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pro-accent/5 rounded-full blur-[120px] pointer-events-none" />
                <div className="w-32 h-32 rounded-[3.5rem] bg-pro-surface border border-pro-border flex items-center justify-center text-5xl mx-auto mb-10 shadow-premium active-push group">
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
                  <h2 className="text-5xl font-black heading-premium tracking-tighter uppercase italic opacity-10">
                    {activeTab} Terminal
                  </h2>
                  <h2 className="text-4xl font-black tracking-tight tracking-tighter">
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
                    className="h-16 px-12 rounded-3xl bg-pro-text-main dark:bg-pro-accent text-white dark:text-[#1A2340] font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
                  >
                    Initialize Capture
                  </button>
                  <p className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.3em]">
                    Ready for M-Series Deployment
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Global Overlays */}
      <AskPluto
        visible={askPlutoVisible}
        onClose={() => setAskPlutoVisible(false)}
        onOpenMeeting={(meetingId) => {
          setSelectedMeetingId(meetingId);
          setAskPlutoVisible(false);
        }}
      />

      <SearchOverlay
        searchVisible={searchVisible}
        setSearchVisible={setSearchVisible}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filteredMeetings={filteredMeetings}
        setSelectedMeetingId={setSelectedMeetingId}
      />

      <SettingsOverlay
        settingsVisible={settingsVisible}
        setSettingsVisible={setSettingsVisible}
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
        transcriptionPreset={transcriptionPreset}
        setTranscriptionPreset={setTranscriptionPreset}
        whisperModel={whisperModel}
        setWhisperModel={setWhisperModel}
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
