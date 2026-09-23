import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

// Core
import { AudioManager } from './components/AudioManager';
import { RuntimeReadinessGate } from './components/RuntimeReadinessGate';
import { SetupWizard } from './components/Setup/SetupWizard';
import { AutoEndToast } from './components/ui/AutoEndToast';
import { useActiveCallMonitor } from './hooks/useActiveCallMonitor';
import { useAutoEndMonitor } from './hooks/useAutoEndMonitor';
import type { LiveConversationSnapshot } from './services/liveTranscription/liveConversationProjection';

// Layout
import { Sidebar } from './components/layout/Sidebar';
import { WindowDragRegion } from './components/layout/WindowDragRegion';

import type {
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
  MeetingCalendarContext,
} from '../electron/calendar/types';
import type { ProviderId } from '../electron/llm/inferenceTypes';
import {
  type MeetingNotesTemplateSettingsSnapshot,
  createMeetingNotesTemplateSettingsSnapshot,
} from '../electron/llm/meetingNotesTemplates';
import {
  connectCalendar,
  getCalendarState,
  getMeetingCalendarContext,
  listCalendarDay,
  matchActiveCalendarEvent,
  openCalendarSystemSettings,
  refreshCalendar,
  selectCalendar,
  selectCalendars,
} from './api/calendar';
import { updateAlertStatus } from './api/intelligence';
import type { Entity } from './api/knowledgeGraph';
import { CalendarStartPromptBanner } from './components/alerts/CalendarStartPromptBanner';
import { AskPluto, type AskPlutoMessage } from './components/features/AskPluto';
// Feature Views
import { Dashboard } from './components/features/Dashboard';
import { IdentityProfileInvitation } from './components/features/IdentityProfileInvitation';
import { MeetingView } from './components/features/MeetingView';
import { PreMeetingBriefSheet } from './components/features/PreMeetingBriefSheet';
import { RecordingFinalizingView } from './components/features/RecordingFinalizingView';
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
  persistDashboardPriorityOrder,
} from './components/features/dashboardActionCompletion';
import type {
  MeetingRetryKind,
  MeetingRetryOperation,
} from './components/features/meetingFailurePresentation';
import type {
  CaptureHealthState,
  LiveTranscriptIntegrity,
  LiveTranscriptSegment,
  RecordingFinalizationPreview,
} from './components/features/recordingWorkspaceModel';
import { useDashboardHome } from './components/features/useDashboardHome';
import { useCalendarPromptMonitor } from './hooks/useCalendarPromptMonitor';
import type {
  CaptureLifecycleSnapshot,
  CaptureStartResult,
} from './services/captureLifecycle';
import { runPersistedMeetingFinalTranscription } from './services/finalTranscription/runPersistedMeetingFinalTranscription';
import {
  buildRecoveredMeetingTitleInput,
  canRetryMeetingFinalTranscription,
  canRetryMeetingSpeakerLabels,
  forgetExpiredMeetingProcessingAttempts,
  isParakeetValidatedMeeting,
  meetingProcessingFingerprint,
  needsManualRetryAudioRebuild,
  needsRecoveredAudioRebuild,
  nextMeetingProcessingWakeDelay,
  rememberMeetingProcessingOutcome,
  selectNextMeetingForFinalTranscription,
  selectNextMeetingForProcessing,
  selectNextRecoveredMeetingForTitleGeneration,
  shouldGenerateRecoveredMeetingTitle,
  shouldStartMeetingFinalTranscription,
} from './services/postMeetingProcessingCoordinator';
import { processValidatedMeetingDownstream } from './services/processValidatedMeetingDownstream';
import { shouldAutoProcessMeetingAnalysis } from './services/retryMeetingTranscriptValidation';
import { retryMeetingTranscriptValidation } from './services/retryMeetingTranscriptValidation';
import {
  createMeetingStatusRequestGate,
  loadSelectedMeetingDetail,
  mergeMeetingStatus,
} from './services/selectedMeetingDetail';
import {
  getCalendarRosterNames,
  isMatchedActiveCalendarResult,
} from './utils/calendarRoster';
import { hasConferenceLink } from './utils/conferenceUrl';
import { meetingTitleNeedsGeneration } from './utils/meetingTitle';

import {
  getEntity,
  searchEntities,
  updateActionCommitmentState,
  updateEntityStatus,
  upsertEntity,
} from './api/knowledgeGraph';
// Knowledge Graph
import { PeopleTab } from './components/KnowledgeGraph/PeopleTab';
import { ProjectsExecutionTab } from './components/KnowledgeGraph/ProjectsExecutionTab';
import { AllMeetingsTab } from './components/features/AllMeetingsTab';
import { LocalSourcesTab } from './components/features/LocalSourcesTab';

import {
  SettingsTab,
  type SettingsTabId,
} from './components/features/SettingsTab';
// Overlays
import { DatabaseRecoveryOverlay } from './components/overlays/DatabaseRecoveryOverlay';
import { PermissionsOverlay } from './components/overlays/PermissionsOverlay';
import { SearchOverlay } from './components/overlays/SearchOverlay';
import { buildSearchPlutoResults } from './components/overlays/searchPlutoModel';

// Types
import type { Meeting, MeetingSummary } from './types';
import type { MeetingAskPlutoConversationMessage } from './types/askPluto';
import { previewMeeting } from './utils/browserIpcFallback';
import {
  isGrantedStatus,
  resolveMicrophoneStatus,
  resolveSystemAudioStatus,
  shouldRunBootPermissionProbe,
} from './utils/permissions';

const previewParam =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('preview')
    : null;
const meetingPreviewEnabled = previewParam === 'meeting';
const dashboardPreviewEnabled = previewParam === 'dashboard';
const chatPreviewEnabled = previewParam === 'chat';
const peoplePreviewEnabled = previewParam === 'people';
const projectsPreviewEnabled = previewParam === 'projects';

type MeetingRetryRoute =
  | 'final_transcription'
  | 'analysis'
  | 'transcript_validation'
  | 'unavailable';

export const resolveMeetingRetryRoute = (
  kind: MeetingRetryKind,
  meeting: Partial<Meeting> | null | undefined,
): MeetingRetryRoute => {
  if (kind === 'analysis') {
    if (isParakeetValidatedMeeting(meeting)) return 'analysis';
    const hasTranscript = Boolean(
      meeting?.has_transcript ||
        meeting?.transcript_json ||
        meeting?.has_transcript_text,
    );
    if (hasTranscript && meeting?.transcript_status === 'needs_attention') {
      return 'transcript_validation';
    }
    return 'unavailable';
  }
  if (kind === 'speaker_labels') {
    return canRetryMeetingSpeakerLabels(meeting)
      ? 'final_transcription'
      : 'unavailable';
  }
  return canRetryMeetingFinalTranscription(meeting)
    ? 'final_transcription'
    : 'transcript_validation';
};

function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selectedMeetingDetail, setSelectedMeetingDetail] =
    useState<Meeting | null>(meetingPreviewEnabled ? previewMeeting : null);
  const selectedMeetingIdRef = useRef<string | number | null>(null);
  const notesStatusRequestsRef = useRef(createMeetingStatusRequestGate());
  const [
    transcriptValidationRetryOperation,
    setTranscriptValidationRetryOperation,
  ] = useState<MeetingRetryOperation | null>(null);
  const finalTranscriptionAbortRef = useRef<AbortController | null>(null);
  const [finalTranscriptionMeetingId, setFinalTranscriptionMeetingId] =
    useState<string | number | null>(null);
  const autoAnalysisAttemptsRef = useRef(new Set<string>());
  const recoveredTitleAttemptsRef = useRef(new Set<string>());
  const [titleGenerationMeetingId, setTitleGenerationMeetingId] = useState<
    string | number | null
  >(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingParticipants, setMeetingParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState('');
  const [meetingAskPlutoConversation, setMeetingAskPlutoConversation] =
    useState<MeetingAskPlutoConversationMessage[]>([]);
  const [askPlutoConversation, setAskPlutoConversation] = useState<
    AskPlutoMessage[]
  >(
    chatPreviewEnabled
      ? [
          {
            id: 'preview-chat-q1',
            role: 'user',
            content:
              'What decisions were made about API Migration and SOC2 compliance across our recent syncs?',
          },
          {
            id: 'preview-chat-a1',
            role: 'assistant',
            content: `Across the **Architecture docs review** and **Q2 roadmap sync**:

1. **Docs-as-Code Workflow**: The team confirmed adopting a Markdown-based docs-as-code workflow versioned directly inside the repository, using CI for automated validation.
2. **SOC2 Audit & Credential Rotation**: Token rotation is completed. Maya Chen confirmed database credential rotation will be finalized by **Thursday at 5:00 PM** before production cutover.
3. **CoreML Engine Benchmark**: Local on-device transcription latency was validated at **3.2x faster than real-time** on M-series Apple Silicon chips with zero cloud audio leakage.`,
            citations: [
              {
                claim: 'Docs-as-code workflow adoption',
                meeting_id: 'preview-architecture-docs',
                meeting_title: 'Architecture docs review',
                evidence_span:
                  "I'd like us to adopt a docs-as-code approach using Markdown in the repo so that documentation lives alongside the code and can be versioned and reviewed the same way.",
                evidence_valid: true,
                trust_status: 'grounded',
                source_type: 'meeting',
              },
              {
                claim: 'SOC2 credential rotation deadline',
                meeting_id: 'preview-roadmap-sync',
                meeting_title: 'Q2 roadmap sync',
                evidence_span:
                  'Token rotation is completed. We just need to verify the database credential rotation before production cutover.',
                evidence_valid: true,
                trust_status: 'grounded',
                source_type: 'meeting',
              },
            ],
            trustStatus: 'grounded',
            outcome: 'answered',
            resolvedScope: {
              kind: 'meeting_ids',
              meetingIds: ['preview-architecture-docs', 'preview-roadmap-sync'],
              resolvedAt: new Date().toISOString(),
              source: 'explicit',
            },
            retrievalSummary: {
              matchedMeetingCount: 2,
              includedMeetingCount: 2,
              preparedEvidenceCount: 6,
              transcriptOnlyCount: 0,
              omittedMeetingCount: 0,
            },
          },
        ]
      : [],
  );
  const [meetingAskPlutoMinimized, setMeetingAskPlutoMinimized] =
    useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [captureLifecycle, setCaptureLifecycle] =
    useState<CaptureLifecycleSnapshot>({ state: 'idle' });
  const [finalizingMeeting, setFinalizingMeeting] =
    useState<RecordingFinalizationPreview | null>(null);
  const [zenVisible, setZenVisible] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<
    string | number | null
  >(meetingPreviewEnabled ? 'preview-architecture-docs' : null);
  const [askPlutoCitationTarget, setAskPlutoCitationTarget] = useState<{
    meetingId: string;
    sectionId?: string;
    timestampMs?: number;
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(
    peoplePreviewEnabled ? 'preview-maya' : null,
  );
  const [navHistory, setNavHistory] = useState<
    Array<{
      tab:
        | 'hub'
        | 'people'
        | 'projects'
        | 'sources'
        | 'meetings'
        | 'chat'
        | 'settings';
      meetingId: string | number | null;
      personId: string | null;
      personName?: string | null;
      projectId: string | null;
      projectName?: string | null;
      label?: string;
    }>
  >([]);
  const [activeTab, setActiveTab] = useState<
    'hub' | 'people' | 'projects' | 'sources' | 'meetings' | 'chat' | 'settings'
  >(
    chatPreviewEnabled
      ? 'chat'
      : peoplePreviewEnabled
        ? 'people'
        : projectsPreviewEnabled
          ? 'projects'
          : dashboardPreviewEnabled || meetingPreviewEnabled
            ? 'hub'
            : window.__PLUTO_BROWSER_PREVIEW__
              ? 'projects'
              : 'hub',
  );
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(
    Boolean(previewParam) ||
      (!window.__PLUTO_BROWSER_PREVIEW__ && window.innerWidth >= 1024),
  );
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchEntitiesResults, setSearchEntitiesResults] = useState<Entity[]>(
    [],
  );
  const [searchMeetingResults, setSearchMeetingResults] = useState<Meeting[]>(
    [],
  );
  const searchRequestIdRef = useRef(0);
  const [permissionsVisible, setPermissionsVisible] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({
    mic: 'unknown',
    systemAudio: 'unknown',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [llmProvider, setLlmProvider] = useState<ProviderId>('ollama');
  const [ollamaModel, setOllamaModel] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
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
  const [databaseRecovery, setDatabaseRecovery] = useState<{
    visible: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>({ visible: false });
  const [autoEndEnabled, setAutoEndEnabled] = useState(true);
  const [exportIncludeTranscript, setExportIncludeTranscript] = useState(false);
  const [calendarSnapshot, setCalendarSnapshot] =
    useState<CalendarIntegrationSnapshot | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [meetingCalendarContext, setMeetingCalendarContext] =
    useState<MeetingCalendarContext | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [preMeetingBriefVisible, setPreMeetingBriefVisible] = useState(false);
  const [preMeetingBriefEvent, setPreMeetingBriefEvent] =
    useState<CalendarEvent | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabId>('personal');
  const [calendarAutoNameEnabled, setCalendarAutoNameEnabled] = useState(true);
  const [calendarPromptEnabled, setCalendarPromptEnabled] = useState(true);
  const [silenceAutoStopDuration, setSilenceAutoStopDuration] = useState<
    '3' | '5' | '10' | 'disabled'
  >('5');
  const [fasterNotesEnabled, setFasterNotesEnabled] = useState(true);
  const [meetingNotesTemplateSettings, setMeetingNotesTemplateSettings] =
    useState<MeetingNotesTemplateSettingsSnapshot>(() =>
      createMeetingNotesTemplateSettingsSnapshot('auto', {}),
    );
  const [activeCalendarEvent, setActiveCalendarEvent] =
    useState<CalendarEvent | null>(null);
  const activeCalendarEventRef = useRef<CalendarEvent | null>(null);

  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const stopSessionRef = useRef<((endReason?: string) => void) | null>(null);
  const startSessionRef = useRef<(() => Promise<CaptureStartResult>) | null>(
    null,
  );
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptSegment[]>(
    [],
  );
  const [liveConversation, setLiveConversation] =
    useState<LiveConversationSnapshot | null>(null);
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

  const loadCalendarAgenda = async (
    providedSnapshot?: CalendarIntegrationSnapshot,
  ) => {
    setCalendarLoading(true);
    try {
      const snapshot = providedSnapshot ?? (await getCalendarState());
      setCalendarSnapshot(snapshot);
      if (
        snapshot.enabled &&
        (snapshot.state === 'ready' || snapshot.state === 'read_failed')
      ) {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 30);
        const events = await listCalendarDay(
          start.toISOString(),
          end.toISOString(),
        );
        setCalendarEvents(
          events.filter(
            (event) => new Date(event.end).getTime() > now.getTime(),
          ),
        );
      } else {
        setCalendarEvents([]);
      }
    } catch (error) {
      console.error('[Calendar] Failed to load dashboard agenda', error);
      setCalendarEvents([]);
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleCalendarConnect = async () => {
    setCalendarLoading(true);
    try {
      let snapshot = await connectCalendar();
      if (
        snapshot.state === 'needs_selection' &&
        snapshot.calendars.length === 1
      ) {
        snapshot = await selectCalendar(snapshot.calendars[0]);
      }
      await loadCalendarAgenda(snapshot);
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleCalendarSelect = async (calendar: CalendarDescriptor) => {
    setCalendarLoading(true);
    try {
      await loadCalendarAgenda(await selectCalendar(calendar));
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleCalendarSelectCalendars = async (
    calendars: CalendarDescriptor[],
  ) => {
    setCalendarLoading(true);
    try {
      await loadCalendarAgenda(await selectCalendars(calendars));
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleCalendarRefresh = async () => {
    setCalendarLoading(true);
    try {
      await loadCalendarAgenda(await refreshCalendar());
    } catch (error) {
      console.error('[Calendar] Failed to refresh dashboard agenda', error);
      await loadCalendarAgenda();
    } finally {
      setCalendarLoading(false);
    }
  };

  const handleCalendarOpenSettings = () => {
    if (
      calendarSnapshot?.state === 'denied' ||
      calendarSnapshot?.state === 'restricted'
    ) {
      void openCalendarSystemSettings('privacy');
      return;
    }
    if (calendarSnapshot?.state === 'no_calendars') {
      void openCalendarSystemSettings('accounts');
      return;
    }
    // Refresh inventory so newly added accounts/calendars in Apple Calendar appear without restarting Pluto
    void refreshCalendar()
      .then((snapshot) => {
        setCalendarSnapshot(snapshot);
      })
      .catch(() => {
        void getCalendarState().then((snapshot) =>
          setCalendarSnapshot(snapshot),
        );
      });
    setSettingsInitialTab('meetings');
    setActiveTab('settings');
    setSelectedMeetingId(null);
  };

  useEffect(() => {
    void loadCalendarAgenda();
  }, []);

  useEffect(() => {
    if (selectedMeetingId == null) {
      setMeetingCalendarContext(null);
      return;
    }
    let current = true;
    void getMeetingCalendarContext(String(selectedMeetingId))
      .then((context) => {
        if (current) setMeetingCalendarContext(context);
      })
      .catch(() => {
        if (current) setMeetingCalendarContext(null);
      });
    return () => {
      current = false;
    };
  }, [selectedMeetingId, selectedPersonId]);

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
      return await persistDashboardCommitmentCreation(
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

  const handleSetDashboardDailyCommitments = async (
    orderedIds: string[],
    previousIds: string[],
    dateKey: string,
  ) => {
    setDashboardActionError(null);
    setUpdatingDashboardTaskIds((previous) => {
      const next = new Set(previous);
      for (const id of new Set([...orderedIds, ...previousIds])) next.add(id);
      return next;
    });

    try {
      await persistDashboardPriorityOrder(
        { orderedIds, previousIds, dateKey },
        {
          getEntity,
          upsertEntity,
          refreshDashboard: dashboardHome.refresh,
        },
      );
    } catch (error) {
      console.error("Failed to update today's priorities", error);
      setDashboardActionError(
        "Could not save today's priority order. Try again.",
      );
      throw error;
    } finally {
      setUpdatingDashboardTaskIds((previous) => {
        const next = new Set(previous);
        for (const id of new Set([...orderedIds, ...previousIds]))
          next.delete(id);
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
      if (val) setLlmProvider(val as ProviderId);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'ollama_model').then((val) => {
      if (val) setOllamaModel(val);
    });
    window.ipcRenderer.invoke('GET_SETTING', 'auto_end_enabled').then((val) => {
      if (val !== null) setAutoEndEnabled(val !== 'false');
    });
    window.ipcRenderer
      .invoke('GET_SETTING', 'export_include_transcript')
      .then((val) => {
        if (val !== null) setExportIncludeTranscript(val === 'true');
      });
    window.ipcRenderer.invoke('GET_SETTING', 'theme').then((val) => {
      if (val) setTheme(val as 'light' | 'dark' | 'system');
    });
    window.ipcRenderer
      .invoke('GET_SETTING', 'calendar_auto_name_enabled')
      .then((val) => {
        if (val !== null) setCalendarAutoNameEnabled(val !== 'false');
      });
    window.ipcRenderer
      .invoke('GET_SETTING', 'calendar_prompt_enabled')
      .then((val) => {
        if (val !== null) setCalendarPromptEnabled(val !== 'false');
      });
    window.ipcRenderer
      .invoke('GET_SETTING', 'silence_auto_stop_duration')
      .then((val) => {
        if (val && ['3', '5', '10', 'disabled'].includes(val)) {
          setSilenceAutoStopDuration(val as '3' | '5' | '10' | 'disabled');
        }
      });
    window.ipcRenderer
      .invoke('GET_SETTING', 'faster_notes_enabled')
      .then((val) => {
        if (val !== null) setFasterNotesEnabled(val !== 'false');
      });
    window.ipcRenderer
      .invoke('GET_MEETING_NOTES_TEMPLATE_SETTINGS')
      .then((snapshot: MeetingNotesTemplateSettingsSnapshot) => {
        if (snapshot?.defaultTemplateId && Array.isArray(snapshot.templates)) {
          setMeetingNotesTemplateSettings(snapshot);
        }
      })
      .catch(() => {
        // Keep the backward-compatible Auto default when settings are unavailable.
      });
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarVisible((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (startSessionRef.current && captureLifecycle.state === 'idle') {
          void startSessionRef.current();
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
  }, [captureLifecycle.state]);

  const fetchMeetings = async () => {
    try {
      const [data, processingData] = await Promise.all([
        window.ipcRenderer.invoke('GET_MEETINGS'),
        window.ipcRenderer.invoke('GET_MEETING_PROCESSING_STATUSES'),
      ]);
      const fetchedMeetings = Array.isArray(data)
        ? (data as MeetingSummary[])
        : [];
      const processingById = new Map(
        (Array.isArray(processingData) ? processingData : []).map((status) => [
          String(status.id),
          status,
        ]),
      );
      const meetingsWithProcessingStatus = fetchedMeetings.map((meeting) => ({
        ...meeting,
        ...processingById.get(String(meeting.id)),
      }));
      setMeetings(meetingsWithProcessingStatus);
      return meetingsWithProcessingStatus;
    } catch (e) {
      console.error('Failed to fetch meetings', e);
      setMeetings([]);
      return [];
    }
  };

  const refreshSelectedMeeting = async () => {
    const meetingId = selectedMeetingIdRef.current;
    if (meetingId == null) return null;
    const detail = await loadSelectedMeetingDetail<Meeting>({
      meetingId,
      load: async () =>
        (await window.ipcRenderer.invoke(
          'GET_MEETING',
          meetingId,
        )) as Meeting | null,
      isCurrent: (candidateId) =>
        String(selectedMeetingIdRef.current) === String(candidateId),
    });
    if (detail) setSelectedMeetingDetail(detail);
    return detail;
  };

  const refreshSelectedMeetingState = async (): Promise<void> => {
    await Promise.all([fetchMeetings(), refreshSelectedMeeting()]);
  };

  useEffect(() => {
    selectedMeetingIdRef.current = selectedMeetingId;
    const legacyEmbeddedDetail = (meetings as unknown as Meeting[]).find(
      (meeting) =>
        String(meeting.id) === String(selectedMeetingId) &&
        (Object.hasOwn(meeting, 'transcript_json') ||
          Object.hasOwn(meeting, 'analysis_json')),
    );
    setSelectedMeetingDetail(legacyEmbeddedDetail ?? null);
    if (selectedMeetingId != null) void refreshSelectedMeeting();
  }, [selectedMeetingId]);

  useEffect(
    () =>
      window.ipcRenderer.on('MEETING_NOTES_UPDATED', (_event, meetingId) => {
        if (meetingId == null) {
          void fetchMeetings();
          return;
        }
        const statusRequest = notesStatusRequestsRef.current.start(
          String(meetingId),
        );
        void window.ipcRenderer
          .invoke('GET_MEETING_STATUS', meetingId)
          .then((status) => {
            if (!statusRequest.isLatest()) return;
            if (!status) return;
            setMeetings((current) => {
              const index = current.findIndex(
                (meeting) => String(meeting.id) === String(status.id),
              );
              if (index < 0) return [status as MeetingSummary, ...current];
              return current.map((meeting, meetingIndex) =>
                meetingIndex === index ? (status as MeetingSummary) : meeting,
              );
            });
            if (String(selectedMeetingIdRef.current) === String(meetingId)) {
              setSelectedMeetingDetail((current) =>
                current
                  ? (mergeMeetingStatus(
                      current as unknown as Record<string, unknown>,
                      status as Record<string, unknown>,
                    ) as unknown as Meeting)
                  : current,
              );
              const run = JSON.parse(status.analysis_run_json || '{}') as {
                notes_status?: unknown;
              };
              if (run.notes_status === 'published') {
                void refreshSelectedMeeting();
              }
            }
          })
          .catch((error) => {
            console.error('Failed to refresh meeting status', error);
          })
          .finally(() => {
            statusRequest.finish();
          });
      }),
    [],
  );

  const handleRetryTranscriptValidation = async (
    meetingId: string | number | null = selectedMeetingId,
    kind: MeetingRetryKind = 'analysis',
  ) => {
    if (!meetingId || transcriptValidationRetryOperation !== null) return;
    setTranscriptValidationRetryOperation({ meetingId, kind });
    try {
      const summary = safeMeetings.find(
        (candidate) => String(candidate.id) === String(meetingId),
      );
      const meeting =
        selectedMeetingDetail &&
        String(selectedMeetingDetail.id) === String(meetingId)
          ? selectedMeetingDetail
          : ((await window.ipcRenderer.invoke(
              'GET_MEETING',
              summary?.id ?? meetingId,
            )) as Meeting | null);
      const route = resolveMeetingRetryRoute(kind, meeting);
      if (route === 'final_transcription' && meeting) {
        await runMeetingFinalTranscription(
          meeting,
          kind === 'speaker_labels' ? 'speaker_labels' : 'manual',
        );
        return;
      }
      if (route === 'analysis' && meeting) {
        await processValidatedMeetingDownstream(
          meeting.id,
          (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
          { reason: 'manual' },
        );
        await fetchMeetings();
        return;
      }
      if (route === 'unavailable') {
        console.warn('[Pluto] Meeting retry is no longer available', {
          meetingId,
          kind,
        });
        await fetchMeetings();
        return;
      }
      const result = await retryMeetingTranscriptValidation(
        meetingId,
        (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
        { reason: 'manual' },
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
      setTranscriptValidationRetryOperation((current) =>
        current && String(current.meetingId) === String(meetingId)
          ? null
          : current,
      );
    }
  };

  const handleCalendarAutoNameToggle = (enabled: boolean) => {
    setCalendarAutoNameEnabled(enabled);
    window.ipcRenderer.invoke(
      'SET_SETTING',
      'calendar_auto_name_enabled',
      String(enabled),
    );
  };

  const handleCalendarPromptToggle = (enabled: boolean) => {
    setCalendarPromptEnabled(enabled);
    window.ipcRenderer.invoke(
      'SET_SETTING',
      'calendar_prompt_enabled',
      String(enabled),
    );
  };

  const handleSilenceAutoStopDurationChange = (
    duration: '3' | '5' | '10' | 'disabled',
  ) => {
    setSilenceAutoStopDuration(duration);
    window.ipcRenderer.invoke(
      'SET_SETTING',
      'silence_auto_stop_duration',
      duration,
    );
  };

  const { activePromptEvent, dismissPrompt } = useCalendarPromptMonitor({
    events: calendarEvents,
    isRecording,
    promptEnabled: calendarPromptEnabled,
  });

  const handleStartFromPrompt = useCallback(
    async (event: CalendarEvent) => {
      dismissPrompt(event.occurrenceKey);
      activeCalendarEventRef.current = event;
      setActiveCalendarEvent(event);
      setMeetingTitle(event.title || 'Meeting');
      setMeetingParticipants([]);
      setParticipantInput('');
      if (startSessionRef.current) {
        await startSessionRef.current();
      }
    },
    [dismissPrompt],
  );

  const handlePrepareMeeting = useCallback((event: CalendarEvent) => {
    setPreMeetingBriefEvent(event);
    setPreMeetingBriefVisible(true);
  }, []);

  const handlePrepareAnother = useCallback(() => {
    setPreMeetingBriefEvent(null);
    setPreMeetingBriefVisible(true);
  }, []);

  // Synchronize calendar meeting prompt with the native macOS notification alert window (outside the app)
  useEffect(() => {
    if (!window.ipcRenderer) return;

    if (activePromptEvent && !isRecording) {
      void window.ipcRenderer.invoke('SHOW_CALENDAR_PROMPT_ALERT', {
        event: {
          occurrenceKey: activePromptEvent.occurrenceKey,
          title: activePromptEvent.title || 'Upcoming Meeting',
          start: activePromptEvent.start,
          hasConferenceLink: hasConferenceLink(activePromptEvent),
          attendeeCount: activePromptEvent.attendees?.length ?? 0,
        },
      });
    } else {
      void window.ipcRenderer.invoke('HIDE_CALENDAR_PROMPT_ALERT');
    }
  }, [activePromptEvent, isRecording]);

  useEffect(() => {
    if (!window.ipcRenderer) return;

    const handleRecordIpc = async (
      _event: unknown,
      payload?: { occurrenceKey?: string },
    ) => {
      const target =
        calendarEvents.find(
          (e) => e.occurrenceKey === payload?.occurrenceKey,
        ) || activePromptEvent;
      if (target) {
        await handleStartFromPrompt(target);
      }
    };

    const handleDismissIpc = (
      _event: unknown,
      payload?: { occurrenceKey?: string },
    ) => {
      if (payload?.occurrenceKey) {
        dismissPrompt(payload.occurrenceKey);
      }
    };

    const handlePrepareIpc = (
      _event: unknown,
      payload?: { occurrenceKey?: string },
    ) => {
      const target =
        calendarEvents.find(
          (calendarEvent) =>
            calendarEvent.occurrenceKey === payload?.occurrenceKey,
        ) || activePromptEvent;
      if (target) handlePrepareMeeting(target);
    };

    const unsubRecord = window.ipcRenderer.on(
      'CALENDAR_PROMPT_START_RECORDING',
      handleRecordIpc,
    );
    const unsubDismiss = window.ipcRenderer.on(
      'CALENDAR_PROMPT_DISMISSED',
      handleDismissIpc,
    );
    const unsubPrepare = window.ipcRenderer.on(
      'CALENDAR_PROMPT_PREPARE',
      handlePrepareIpc,
    );

    return () => {
      unsubRecord?.();
      unsubDismiss?.();
      unsubPrepare?.();
    };
  }, [
    calendarEvents,
    activePromptEvent,
    handleStartFromPrompt,
    handlePrepareMeeting,
    dismissPrompt,
  ]);

  const handleRecordingChange = (recording: boolean) => {
    const wasRecording = isRecording;
    setIsRecording(recording);
    if (recording && !wasRecording) {
      setZenVisible(true);
      setMeetingAskPlutoConversation([]);
      setSelectedMeetingId(null);
      if (!meetingTitle && !activeCalendarEventRef.current) {
        setMeetingTitle('');
        setMeetingParticipants([]);
        setParticipantInput('');
      }
    } else if (!recording && wasRecording) {
      activeCalendarEventRef.current = null;
      setActiveCalendarEvent(null);
    }
  };

  const handleStartingChange = async (starting: boolean) => {
    setIsStartingRecording(starting);
    if (!starting) return;
    setZenVisible(true);
    setSelectedMeetingId(null);
    setFinalizingMeeting(null);

    if (activeCalendarEventRef.current) {
      setMeetingTitle(activeCalendarEventRef.current.title || 'Meeting');
      setMeetingParticipants([]);
      setParticipantInput('');
      return;
    }

    if (calendarAutoNameEnabled) {
      try {
        const result = await matchActiveCalendarEvent();
        if (isMatchedActiveCalendarResult(result)) {
          const matchedEvent = result.event;
          activeCalendarEventRef.current = matchedEvent;
          setActiveCalendarEvent(matchedEvent);
          setMeetingTitle(matchedEvent.title || 'Meeting');
          setMeetingParticipants([]);
          setParticipantInput('');
          return;
        }
      } catch (err) {
        console.warn('[Calendar] Auto-match failed:', err);
      }
    }

    activeCalendarEventRef.current = null;
    setActiveCalendarEvent(null);
    setMeetingTitle('');
    setMeetingParticipants([]);
    setParticipantInput('');
  };

  const handleFinalizationStarted = (meeting: RecordingFinalizationPreview) => {
    setFinalizingMeeting(meeting);
    setZenVisible(false);
    setSelectedMeetingId(null);
    setActiveTab('hub');
    setSidebarVisible(true);
  };

  const safeMeetings = Array.isArray(meetings) ? meetings : [];
  const dashboardHome = useDashboardHome({
    isRecording,
    meetings: safeMeetings,
  });
  const selectedMeeting =
    selectedMeetingDetail &&
    String(selectedMeetingDetail.id) === String(selectedMeetingId)
      ? selectedMeetingDetail
      : undefined;
  const activeRecording = isStartingRecording || isRecording;
  const showZenMode = activeRecording && zenVisible;
  const resolvedActiveCalendarEvent =
    activeCalendarEvent ||
    (recordingStartedAtMs
      ? (calendarEvents.find((event) => {
          const start = new Date(event.start).getTime();
          const end = new Date(event.end).getTime();
          return (
            start <= recordingStartedAtMs + 15 * 60_000 &&
            end >= recordingStartedAtMs - 5 * 60_000
          );
        }) ?? null)
      : null);
  const activeCalendarRosterNames = resolvedActiveCalendarEvent
    ? getCalendarRosterNames(resolvedActiveCalendarEvent)
    : [];
  const handleBackHomeFromZen = () => {
    setZenVisible(false);
    setSelectedMeetingId(null);
    setActiveTab('hub');
    setSidebarVisible(true);
  };

  const handleOpenMeeting = useCallback(
    (
      meetingId: string | number,
      sourceContext?: {
        personId?: string | null;
        personName?: string | null;
        projectId?: string | null;
        projectName?: string | null;
        label?: string;
      },
    ) => {
      const activePersonId =
        sourceContext?.personId !== undefined
          ? sourceContext.personId
          : selectedPersonId;
      const activeProjectId =
        sourceContext?.projectId !== undefined
          ? sourceContext.projectId
          : selectedProjectId;

      let defaultLabel = 'Back';
      if (sourceContext?.label) {
        defaultLabel = sourceContext.label;
      } else if (sourceContext?.personName) {
        defaultLabel = `Back to ${sourceContext.personName}`;
      } else if (activeTab === 'people' && activePersonId) {
        defaultLabel = 'Back to Person';
      } else if (activeTab === 'people') {
        defaultLabel = 'Back to People';
      } else if (sourceContext?.projectName) {
        defaultLabel = `Back to ${sourceContext.projectName}`;
      } else if (activeTab === 'projects' && activeProjectId) {
        defaultLabel = 'Back to Project';
      } else if (activeTab === 'projects') {
        defaultLabel = 'Back to Projects';
      } else if (activeTab === 'sources') {
        defaultLabel = 'Back to Sources';
      } else if (activeTab === 'meetings') {
        defaultLabel = 'All meetings';
      } else if (activeTab === 'chat') {
        defaultLabel = 'Back to Chat';
      } else if (activeTab === 'hub') {
        defaultLabel = 'Back to Dashboard';
      }

      setNavHistory((prev) => [
        ...prev,
        {
          tab: activeTab,
          meetingId: selectedMeetingId,
          personId: activePersonId,
          personName: sourceContext?.personName,
          projectId: activeProjectId,
          projectName: sourceContext?.projectName,
          label: defaultLabel,
        },
      ]);
      setSelectedMeetingId(meetingId);
    },
    [activeTab, selectedMeetingId, selectedPersonId, selectedProjectId],
  );

  const handleOpenPerson = useCallback(
    (
      personId: string,
      sourceContext?: {
        meetingId?: string | number | null;
        meetingTitle?: string | null;
        label?: string;
      },
    ) => {
      const currentMeeting = safeMeetings.find(
        (m) => String(m.id) === String(selectedMeetingId),
      );
      const title =
        sourceContext?.meetingTitle ||
        currentMeeting?.title ||
        selectedMeetingDetail?.title;

      let defaultLabel = 'Back';
      if (sourceContext?.label) {
        defaultLabel = sourceContext.label;
      } else if (selectedMeetingId != null) {
        defaultLabel = title ? `Back to ${title}` : 'Back to Meeting';
      } else if (activeTab === 'people') {
        defaultLabel = 'All people';
      }

      setNavHistory((prev) => [
        ...prev,
        {
          tab: activeTab,
          meetingId: selectedMeetingId,
          personId: selectedPersonId,
          projectId: selectedProjectId,
          label: defaultLabel,
        },
      ]);
      setSelectedMeetingId(null);
      setSelectedPersonId(personId);
      setActiveTab('people');
    },
    [
      activeTab,
      safeMeetings,
      selectedMeetingDetail?.title,
      selectedMeetingId,
      selectedPersonId,
      selectedProjectId,
    ],
  );

  const handleBack = useCallback(() => {
    if (navHistory.length > 0) {
      setNavHistory((prev) => {
        const next = [...prev];
        const previous = next.pop()!;
        setActiveTab(previous.tab);
        setSelectedPersonId(previous.personId);
        setSelectedProjectId(previous.projectId);
        setSelectedMeetingId(previous.meetingId);
        return next;
      });
      return;
    }

    if (selectedMeetingId != null) {
      setSelectedMeetingId(null);
      return;
    }
    if (selectedPersonId != null) {
      setSelectedPersonId(null);
      return;
    }
    if (selectedProjectId != null) {
      setSelectedProjectId(null);
      return;
    }
    setActiveTab('hub');
  }, [
    navHistory.length,
    selectedMeetingId,
    selectedPersonId,
    selectedProjectId,
  ]);

  const currentBackLabel = useMemo(() => {
    if (navHistory.length > 0) {
      const top = navHistory[navHistory.length - 1];
      if (top.label) return top.label;
      if (top.personName) return `Back to ${top.personName}`;
      if (top.projectName) return `Back to ${top.projectName}`;
      if (top.tab === 'people' && top.personId) return 'Back to Person';
      if (top.tab === 'people') return 'Back to People';
      if (top.tab === 'projects') return 'Back to Projects';
      if (top.tab === 'meetings') return 'All meetings';
      if (top.tab === 'chat') return 'Back to Chat';
      if (top.tab === 'hub') return 'Back to Dashboard';
    }
    if (selectedMeetingId != null) {
      if (activeTab === 'people' && selectedPersonId) return 'Back to Person';
      if (activeTab === 'people') return 'Back to People';
      if (activeTab === 'projects') return 'Back to Projects';
      if (activeTab === 'meetings') return 'All meetings';
      if (activeTab === 'chat') return 'Back to Chat';
      return 'Back to Dashboard';
    }
    if (activeTab === 'people' && selectedPersonId) {
      return 'All people';
    }
    return 'Back';
  }, [navHistory, selectedMeetingId, activeTab, selectedPersonId]);

  const runMeetingFinalTranscription = async (
    meeting: Pick<Meeting, 'id'>,
    reason: 'automatic' | 'manual' | 'speaker_labels' = 'automatic',
  ) => {
    if (finalTranscriptionAbortRef.current) return;
    const detail = (await window.ipcRenderer.invoke(
      'GET_MEETING',
      meeting.id,
    )) as Meeting | null;
    if (!detail || !shouldStartMeetingFinalTranscription(detail, reason))
      return;
    const controller = new AbortController();
    finalTranscriptionAbortRef.current = controller;
    setFinalTranscriptionMeetingId(meeting.id);
    try {
      await runPersistedMeetingFinalTranscription(
        detail,
        (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
        {
          signal: controller.signal,
          manualRetry: reason !== 'automatic',
          rebuildSealedAudio:
            reason === 'speaker_labels' ||
            needsRecoveredAudioRebuild(detail) ||
            (reason === 'manual' && needsManualRetryAudioRebuild(detail)),
          onTranscriptCommitted: refreshSelectedMeetingState,
        },
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
    void runMeetingFinalTranscription({ id: candidate.id });
  }, [activeRecording, safeMeetings, finalTranscriptionMeetingId]);

  useEffect(() => {
    if (
      activeRecording ||
      finalTranscriptionAbortRef.current ||
      titleGenerationMeetingId !== null
    )
      return;
    const candidate = selectNextRecoveredMeetingForTitleGeneration(
      safeMeetings,
      recoveredTitleAttemptsRef.current,
    );
    if (!candidate?.id) return;
    const meetingId = candidate.id;
    recoveredTitleAttemptsRef.current.add(String(meetingId));
    setTitleGenerationMeetingId(meetingId);
    void (async () => {
      try {
        const detail = (await window.ipcRenderer.invoke(
          'GET_MEETING',
          meetingId,
        )) as Meeting | null;
        if (!detail || !shouldGenerateRecoveredMeetingTitle(detail)) return;
        const transcript = buildRecoveredMeetingTitleInput(detail);
        if (!transcript) return;
        const generatedTitle = await window.ipcRenderer.invoke(
          'GENERATE_TITLE',
          { transcript },
        );
        if (
          typeof generatedTitle !== 'string' ||
          generatedTitle.trim().length > 120 ||
          meetingTitleNeedsGeneration(generatedTitle)
        )
          return;
        await window.ipcRenderer.invoke('UPDATE_MEETING_TITLE_IF_CURRENT', {
          meetingId,
          expectedTitle: detail.title,
          title: generatedTitle.trim(),
        });
      } catch (error) {
        console.error(
          '[Pluto] Recovered meeting title generation failed',
          error,
        );
      } finally {
        setTitleGenerationMeetingId(null);
        await fetchMeetings();
      }
    })();
  }, [activeRecording, safeMeetings, titleGenerationMeetingId]);

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
      activeRecording ||
      transcriptValidationRetryOperation !== null ||
      finalTranscriptionAbortRef.current ||
      titleGenerationMeetingId !== null ||
      selectNextRecoveredMeetingForTitleGeneration(
        safeMeetings,
        recoveredTitleAttemptsRef.current,
      ) ||
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
    void processValidatedMeetingDownstream(
      candidate.id,
      (channel, ...args) => window.ipcRenderer.invoke(channel, ...args),
      { reason: 'automatic' },
    )
      .then(async () => {
        const refreshedMeetings = await fetchMeetings();
        rememberMeetingProcessingOutcome(
          autoAnalysisAttemptsRef.current,
          refreshedMeetings.find(
            (meeting) => String(meeting.id) === String(candidate.id),
          ),
        );
      })
      .catch((error) => {
        console.error('[Pluto] Automatic meeting processing failed', error);
      });
  }, [
    activeRecording,
    safeMeetings,
    titleGenerationMeetingId,
    transcriptValidationRetryOperation,
  ]);

  useEffect(() => {
    if (activeRecording || transcriptValidationRetryOperation !== null) return;
    const candidate = safeMeetings.find(shouldAutoProcessMeetingAnalysis);
    if (!candidate?.id) return;
    const delay = nextMeetingProcessingWakeDelay(
      safeMeetings,
      Date.now(),
      autoAnalysisAttemptsRef.current,
    );
    if (delay === null) return;
    const timeout = window.setTimeout(async () => {
      forgetExpiredMeetingProcessingAttempts(
        safeMeetings,
        autoAnalysisAttemptsRef.current,
      );
      try {
        const status = (await window.ipcRenderer.invoke(
          'GET_MEETING_STATUS',
          candidate.id,
        )) as MeetingSummary | null;
        if (!status) return;
        setMeetings((current) =>
          current.map((meeting) =>
            String(meeting.id) === String(status.id) ? status : meeting,
          ),
        );
      } catch (error) {
        console.error('Failed to refresh meeting processing status', error);
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [activeRecording, safeMeetings, transcriptValidationRetryOperation]);

  const searchPlutoResults = buildSearchPlutoResults({
    query: searchQuery,
    meetings: safeMeetings,
    meetingMatches: searchMeetingResults,
    entities: searchEntitiesResults,
  });

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!searchVisible || !trimmed) {
      searchRequestIdRef.current += 1;
      setSearchEntitiesResults([]);
      setSearchMeetingResults([]);
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
      window.ipcRenderer
        .invoke('SEARCH_MEETING_SUMMARIES', trimmed)
        .then((meetings) => {
          if (searchRequestIdRef.current === requestId) {
            setSearchMeetingResults(
              Array.isArray(meetings) ? (meetings as Meeting[]) : [],
            );
          }
        })
        .catch((error) => {
          console.error('Failed to search meetings', error);
          if (searchRequestIdRef.current === requestId) {
            setSearchMeetingResults([]);
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

  useEffect(() => {
    const handleDbRecovery = (event: Event) => {
      const detail =
        (
          event as CustomEvent<{
            errorCode?: string;
            errorMessage?: string;
          }>
        ).detail || {};
      setDatabaseRecovery({
        visible: true,
        errorCode: detail.errorCode,
        errorMessage: detail.errorMessage,
      });
    };
    window.addEventListener('SHOW_DATABASE_RECOVERY_OVERLAY', handleDbRecovery);
    const removeIpc = window.ipcRenderer?.on?.(
      'database-recovery-required',
      (_event, payload: { errorCode?: string; errorMessage?: string }) => {
        setDatabaseRecovery({
          visible: true,
          errorCode: payload?.errorCode,
          errorMessage: payload?.errorMessage,
        });
      },
    );
    return () => {
      window.removeEventListener(
        'SHOW_DATABASE_RECOVERY_OVERLAY',
        handleDbRecovery,
      );
      removeIpc?.();
    };
  }, []);

  const retryRecordingIfReady = async () => {
    await window.ipcRenderer.invoke('APP_RELAUNCH');
  };

  if (setupNeeded === null)
    return (
      <div className="app-init-drag h-screen w-screen bg-pro-bg flex flex-col gap-4 items-center justify-center text-pro-text-muted/40 font-medium animate-pulse text-xs">
        <div className="w-8 h-8 rounded-full border-2 border-pro-accent border-t-transparent animate-spin mb-4" />
        <span>Initializing Neural Engine...</span>
      </div>
    );
  if (setupNeeded)
    return <SetupWizard onComplete={() => setSetupNeeded(false)} />;

  const workspace = (
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
            setFinalizingMeeting(null);
          }}
          onSessionUpdated={async () => {
            await fetchMeetings();
          }}
          onStartingChange={handleStartingChange}
          onRecordingChange={handleRecordingChange}
          onProcessingChange={setIsProcessing}
          onCaptureLifecycleChange={setCaptureLifecycle}
          onFinalizationStarted={handleFinalizationStarted}
          systemAudioStatus={permissionStatus.systemAudio}
          userNotes={currentNotes}
          transcriptionSettings={{
            language: 'en',
          }}
          onStopSessionRef={stopSessionRef}
          onStartSessionRef={startSessionRef}
          onLiveTranscript={setLiveTranscript}
          onLiveConversation={setLiveConversation}
          onInterimTranscript={setInterimTranscript}
          onCaptureHealthChange={setCaptureHealth}
          onLiveTranscriptIntegrityChange={setLiveTranscriptIntegrity}
          silenceAutoStopDuration={silenceAutoStopDuration}
          fasterNotesEnabled={fasterNotesEnabled}
          calendarEndTimeMs={
            resolvedActiveCalendarEvent
              ? new Date(resolvedActiveCalendarEvent.end).getTime()
              : null
          }
          onRecordingStarted={(startedAtMs) => {
            setRecordingStartedAtMs(startedAtMs);
            setLiveTranscript([]);
            setLiveConversation(null);
            setInterimTranscript('');
            setLiveTranscriptIntegrity('healthy');
          }}
          userTitle={meetingTitle}
          participants={meetingParticipants}
          transcriptionParticipantHints={activeCalendarRosterNames}
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
                void startSessionRef.current();
              }
            }}
            isRecordingActive={activeRecording}
            recordingState={captureLifecycle.state}
            onReturnToRecording={() => {
              if (finalizingMeeting) {
                setZenVisible(false);
                setSelectedMeetingId(null);
                setActiveTab('hub');
                return;
              }
              setZenVisible(true);
            }}
            onOpenSearch={() => setSearchVisible(true)}
            onOpenPeopleHome={() => {
              if (selectedMeetingId != null) {
                setSelectedMeetingId(null);
                setActiveTab('people');
              } else {
                setSelectedPersonId(null);
                setSelectedProjectId(null);
                setSelectedMeetingId(null);
                setActiveTab('people');
              }
            }}
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
          isStarting={isStartingRecording}
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
          liveConversation={liveConversation}
          interimText={interimTranscript}
          captureHealth={captureHealth}
          liveTranscriptIntegrity={liveTranscriptIntegrity}
          recordingStartedAtMs={recordingStartedAtMs}
          calendarEvent={resolvedActiveCalendarEvent}
          askPlutoConversation={meetingAskPlutoConversation}
          setAskPlutoConversation={setMeetingAskPlutoConversation}
          askPlutoMinimized={meetingAskPlutoMinimized}
          setAskPlutoMinimized={setMeetingAskPlutoMinimized}
          onOpenSettings={(tab = 'meetings') => {
            setSettingsInitialTab(tab);
            setActiveTab('settings');
            setZenVisible(false);
          }}
        />
      ) : (
        <main
          className={`flex-1 flex flex-col bg-pro-bg h-full relative z-10 overflow-hidden content-shift ${
            selectedMeetingId
              ? 'meeting-app-shell'
              : 'rounded-l-[2.5rem] border-l border-pro-border/10'
          }`}
        >
          <WindowDragRegion
            className={`h-10 w-full shrink-0 z-50 ${
              activeTab === 'chat' ? 'bg-pro-bg' : 'bg-transparent'
            }`}
          />
          <div className="pointer-events-none absolute right-5 top-3 z-[60] rounded-full border border-pro-border/60 bg-pro-surface/90 px-2.5 py-1 text-[11px] font-medium text-pro-text-muted shadow-sm backdrop-blur">
            {llmProvider === 'ollama'
              ? 'Local · Ollama'
              : `Cloud · ${llmProvider === 'openrouter' ? 'OpenRouter' : llmProvider}`}
          </div>
          <div
            ref={contentScrollRef}
            className={`flex-1 flex flex-col scroll-smooth relative overflow-y-scroll ${
              selectedMeetingId
                ? 'meeting-app-scroll'
                : activeTab === 'chat'
                  ? 'px-0 py-0'
                  : activeTab === 'settings'
                    ? 'px-5 pt-[50px] pb-6 md:px-8 md:pb-8'
                    : !selectedMeetingId && activeTab === 'hub'
                      ? previewParam
                        ? 'px-4 md:px-8 lg:px-10 py-5 space-y-5'
                        : 'px-4 md:px-12 lg:px-20 py-6 md:py-10 space-y-8'
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

            {finalizingMeeting ? (
              <RecordingFinalizingView meeting={finalizingMeeting} />
            ) : selectedMeetingId ? (
              <MeetingView
                key={selectedMeeting?.id}
                selectedMeeting={selectedMeeting}
                isLoadingDetail={
                  selectedMeetingId != null &&
                  (!selectedMeetingDetail ||
                    String(selectedMeetingDetail.id) !==
                      String(selectedMeetingId))
                }
                citationTarget={
                  askPlutoCitationTarget?.meetingId ===
                  String(selectedMeeting?.id)
                    ? askPlutoCitationTarget
                    : undefined
                }
                editingTitle={editingTitle}
                setEditingTitle={setEditingTitle}
                titleValue={titleValue}
                setTitleValue={setTitleValue}
                fetchMeetings={refreshSelectedMeetingState}
                handleCopySummary={handleCopySummary}
                copySuccess={copySuccess}
                handleDeleteMeeting={handleDeleteMeeting}
                highlightEntities={highlightEntities}
                transcriptVisible={transcriptVisible}
                setTranscriptVisible={setTranscriptVisible}
                onRetryTranscriptValidation={(kind) => {
                  void handleRetryTranscriptValidation(undefined, kind);
                }}
                transcriptValidationRetryOperation={
                  transcriptValidationRetryOperation
                }
                calendarContext={meetingCalendarContext}
                exportIncludeTranscript={exportIncludeTranscript}
                meetingNotesDefaultTemplate={
                  meetingNotesTemplateSettings.defaultTemplateId
                }
                onBack={handleBack}
                backLabel={currentBackLabel}
                onOpenPerson={handleOpenPerson}
              />
            ) : activeTab === 'hub' ? (
              <>
                <IdentityProfileInvitation
                  onOpenSettings={() => {
                    setActiveTab('settings');
                    setSelectedMeetingId(null);
                  }}
                />
                <Dashboard
                  model={dashboardHome.model}
                  loading={dashboardHome.loading}
                  isRecording={isRecording}
                  setSelectedMeetingId={(id) => {
                    if (id != null) {
                      handleOpenMeeting(id, { label: 'Back to Dashboard' });
                    } else {
                      setSelectedMeetingId(null);
                    }
                  }}
                  setActiveTab={setActiveTab}
                  updatingTaskIds={updatingDashboardTaskIds}
                  actionError={dashboardActionError}
                  dashboardError={dashboardHome.error}
                  onRetryDashboard={dashboardHome.refresh}
                  handleCompleteTask={handleCompleteTask}
                  handleReviewCommitment={handleReviewDashboardCommitment}
                  handleCreateCommitment={handleCreateDashboardCommitment}
                  handleSetDailyCommitments={handleSetDashboardDailyCommitments}
                  handleUpdateAttentionStatus={
                    handleUpdateDashboardAttentionStatus
                  }
                  calendarSnapshot={calendarSnapshot}
                  calendarEvents={calendarEvents}
                  calendarLoading={calendarLoading}
                  onCalendarConnect={handleCalendarConnect}
                  onCalendarSelect={handleCalendarSelect}
                  onCalendarSelectCalendars={handleCalendarSelectCalendars}
                  onCalendarRefresh={handleCalendarRefresh}
                  onCalendarOpenSettings={handleCalendarOpenSettings}
                  onPrepareMeeting={handlePrepareMeeting}
                  onPrepareAnother={handlePrepareAnother}
                />
              </>
            ) : activeTab === 'people' ? (
              <div className="mx-auto w-full max-w-[1180px] animate-in pb-20">
                <PeopleTab
                  selectedPersonId={selectedPersonId}
                  onSelectPerson={setSelectedPersonId}
                  onOpenMeeting={(meetingId, personContext) =>
                    handleOpenMeeting(meetingId, {
                      personId: selectedPersonId,
                      personName: personContext?.name,
                    })
                  }
                  backLabel={
                    navHistory.length > 0 &&
                    navHistory[navHistory.length - 1].meetingId != null
                      ? currentBackLabel
                      : undefined
                  }
                  onBack={
                    navHistory.length > 0 &&
                    navHistory[navHistory.length - 1].meetingId != null
                      ? handleBack
                      : undefined
                  }
                />
              </div>
            ) : activeTab === 'projects' ? (
              <div className="max-w-5xl mx-auto w-full space-y-12 animate-in pb-20">
                <ProjectsExecutionTab
                  selectedProjectId={selectedProjectId}
                  onOpenMeeting={(meetingId) =>
                    handleOpenMeeting(meetingId, {
                      projectId: selectedProjectId,
                    })
                  }
                  onOpenPerson={(personId) => handleOpenPerson(personId)}
                />
              </div>
            ) : activeTab === 'meetings' ? (
              <AllMeetingsTab
                meetings={safeMeetings}
                onOpenMeeting={(meetingId) =>
                  handleOpenMeeting(meetingId, { label: 'All meetings' })
                }
                handleDeleteMeeting={handleDeleteMeeting}
              />
            ) : activeTab === 'sources' ? (
              <LocalSourcesTab selectedSourceId={selectedSourceId} />
            ) : activeTab === 'chat' ? (
              <div className="flex-1 w-full animate-in flex flex-col">
                <AskPluto
                  visible={true}
                  messages={askPlutoConversation}
                  setMessages={setAskPlutoConversation}
                  onClose={() => setActiveTab('hub')}
                  onOpenMeeting={(meetingId, target) => {
                    setAskPlutoCitationTarget({ meetingId, ...target });
                    handleOpenMeeting(meetingId, { label: 'Back to Chat' });
                  }}
                  onOpenArtifact={(artifactId) => {
                    setSelectedSourceId(artifactId);
                    setActiveTab('sources');
                  }}
                  activeMeetingSnapshot={
                    captureLifecycle.state === 'recording' &&
                    captureLifecycle.meetingId
                      ? {
                          meetingId: captureLifecycle.meetingId,
                          title: meetingTitle.trim() || 'Meeting',
                          participants: meetingParticipants,
                          notes: currentNotes,
                          transcript: liveTranscript,
                          interimText: interimTranscript,
                          capturedAt: new Date().toISOString(),
                        }
                      : undefined
                  }
                />
              </div>
            ) : activeTab === 'settings' ? (
              <SettingsTab
                llmProvider={llmProvider}
                setLlmProvider={setLlmProvider}
                ollamaModel={ollamaModel}
                setOllamaModel={setOllamaModel}
                autoEndEnabled={autoEndEnabled}
                setAutoEndEnabled={setAutoEndEnabled}
                fetchMeetings={fetchMeetings}
                setSelectedMeetingId={setSelectedMeetingId}
                theme={theme}
                initialTab={settingsInitialTab}
                calendarSnapshot={calendarSnapshot}
                onCalendarSnapshotChange={(snapshot) => {
                  void loadCalendarAgenda(snapshot);
                }}
                setTheme={(newTheme) => {
                  setTheme(newTheme);
                  window.ipcRenderer.invoke('SET_SETTING', {
                    key: 'theme',
                    value: newTheme,
                  });
                }}
                exportIncludeTranscript={exportIncludeTranscript}
                setExportIncludeTranscript={setExportIncludeTranscript}
                calendarAutoNameEnabled={calendarAutoNameEnabled}
                setCalendarAutoNameEnabled={handleCalendarAutoNameToggle}
                calendarPromptEnabled={calendarPromptEnabled}
                setCalendarPromptEnabled={handleCalendarPromptToggle}
                silenceAutoStopDuration={silenceAutoStopDuration}
                setSilenceAutoStopDuration={handleSilenceAutoStopDurationChange}
                fasterNotesEnabled={fasterNotesEnabled}
                setFasterNotesEnabled={setFasterNotesEnabled}
                meetingNotesTemplateSettings={meetingNotesTemplateSettings}
                onMeetingNotesTemplateSettingsChange={
                  setMeetingNotesTemplateSettings
                }
              />
            ) : (
              <div className="max-w-4xl mx-auto w-full space-y-24 animate-in duration-1000 text-center py-40 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pro-accent/5 rounded-full blur-[120px] pointer-events-none" />
                <div className="w-32 h-32 rounded-lg bg-pro-surface border border-pro-border flex items-center justify-center text-5xl mx-auto mb-10 shadow-sm  group">
                  <span className="group-hover:rotate-12 transition-transform duration-500">
                    {(activeTab as string) === 'people'
                      ? '👤'
                      : (activeTab as string) === 'projects'
                        ? '📁'
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
                      if (startSessionRef.current)
                        void startSessionRef.current();
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
          handleOpenMeeting(meetingId);
        }}
        onOpenProjects={(projectId) => {
          setSelectedProjectId(String(projectId));
          setSelectedPersonId(null);
          setActiveTab('projects');
          setSelectedMeetingId(null);
        }}
        onOpenPeople={(personId) => {
          handleOpenPerson(String(personId));
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

      <DatabaseRecoveryOverlay
        visible={databaseRecovery.visible}
        errorCode={databaseRecovery.errorCode}
        errorMessage={databaseRecovery.errorMessage}
        onRetry={() => {
          setDatabaseRecovery({ visible: false });
          void window.ipcRenderer?.invoke?.('DATABASE_RETRY');
        }}
        onOpenDataFolder={() => {
          void window.ipcRenderer?.invoke?.('OPEN_USER_DATA_DIR');
        }}
        onQuit={() => {
          void window.ipcRenderer?.invoke?.('QUIT_APP');
        }}
      />

      <PreMeetingBriefSheet
        visible={preMeetingBriefVisible}
        event={preMeetingBriefEvent}
        onClose={() => setPreMeetingBriefVisible(false)}
        onOpenMeeting={(meetingId) => {
          setPreMeetingBriefVisible(false);
          handleOpenMeeting(meetingId, { label: 'Back to Dashboard' });
        }}
      />

      {autoEndTriggered && (
        <AutoEndToast
          reason={autoEndReason}
          appName={autoEndAppName}
          onReopen={() => {
            dismissAutoEndToast();
            if (startSessionRef.current) {
              void startSessionRef.current();
            }
          }}
          onDismiss={dismissAutoEndToast}
        />
      )}

      {activePromptEvent && !isRecording && !window.ipcRenderer && (
        <CalendarStartPromptBanner
          event={activePromptEvent}
          onStartRecording={handleStartFromPrompt}
          onPrepare={handlePrepareMeeting}
          onDismiss={dismissPrompt}
        />
      )}
    </div>
  );

  return <RuntimeReadinessGate>{workspace}</RuntimeReadinessGate>;
}

export default App;
