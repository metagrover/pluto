import {
  BookOpen,
  Check,
  CheckCircle2,
  Cloud,
  Cpu,
  FileWarning,
  Hash,
  Laptop,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CalendarIntegrationSnapshot } from '../../../electron/calendar/types';
import type {
  CloudProviderId,
  ProviderCredentialStatus,
  ProviderId,
} from '../../../electron/llm/inferenceTypes';
import {
  MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH,
  type MeetingNotesTemplate,
  type MeetingNotesTemplateSettingsSnapshot,
  type MeetingNotesTemplateSettingsUpdate,
  createMeetingNotesTemplateSettingsSnapshot,
  meetingNotesTemplateOptions,
} from '../../../electron/llm/meetingNotesTemplates';
import {
  CLOUD_CONSENT_VERSION,
  cloudConsentSettingKey,
} from '../../../electron/llm/providerCatalog';
import { useAppUpdate } from '../../api/updater';
import type { SilenceAutoStopDuration } from '../../autoStop/silenceWatchdog';
import type { AppTheme } from '../../types/theme';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../../utils/ollamaModels';
import { PageHeader } from '../ui/PageHeader';
import { SearchSelect } from '../ui/SearchSelect';
import { CalendarSettings } from './CalendarSettings';
import { ChatGptConnectionSettings } from './ChatGptConnectionSettings';
import { IdentitySettings } from './IdentitySettings';
import { ReportProblemButton } from './ReportProblemButton';

interface SettingsTabProps {
  llmProvider: ProviderId;
  setLlmProvider: (val: ProviderId) => void;
  ollamaModel: string;
  setOllamaModel: (val: string) => void;
  autoEndEnabled: boolean;
  setAutoEndEnabled: (val: boolean) => void;
  fetchMeetings: () => void;
  setSelectedMeetingId: (id: string | number | null) => void;
  theme: AppTheme;
  setTheme: (val: AppTheme) => void;
  calendarSnapshot?: CalendarIntegrationSnapshot | null;
  onCalendarSnapshotChange?: (snapshot: CalendarIntegrationSnapshot) => void;
  initialTab?: SettingsTabId;
  exportIncludeTranscript?: boolean;
  setExportIncludeTranscript?: (val: boolean) => void;
  calendarAutoNameEnabled?: boolean;
  setCalendarAutoNameEnabled?: (val: boolean) => void;
  calendarPromptEnabled?: boolean;
  setCalendarPromptEnabled?: (val: boolean) => void;
  silenceAutoStopDuration?: SilenceAutoStopDuration;
  setSilenceAutoStopDuration?: (val: SilenceAutoStopDuration) => void;
  fasterNotesEnabled?: boolean;
  setFasterNotesEnabled?: (val: boolean) => void;
  meetingNotesTemplateSettings?: MeetingNotesTemplateSettingsSnapshot;
  onMeetingNotesTemplateSettingsChange?: (
    snapshot: MeetingNotesTemplateSettingsSnapshot,
  ) => void;
}

const providerOptions = [
  { id: 'ollama', name: 'Ollama', detail: 'Local', icon: Cpu },
  { id: 'openrouter', name: 'OpenRouter', detail: 'Multi-model', icon: Cloud },
] as const;

interface ThemeOptionPreview {
  sidebarBg: string;
  canvasBg: string;
  accentColor: string;
  textColor: string;
  sidebarBorder?: string;
  sidebarTextColor?: string;
  sidebarAccentColor?: string;
}

interface ThemeOption {
  id: AppTheme;
  name: string;
  badge?: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  preview: ThemeOptionPreview;
}

const themeOptions: ThemeOption[] = [
  {
    id: 'light',
    name: 'Light',
    description: 'Crisp white & neutral gray',
    icon: Sun,
    preview: {
      sidebarBg: '#F7F7F5',
      canvasBg: '#FFFFFF',
      accentColor: '#155DB1',
      textColor: '#37352F',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Deep charcoal & slate',
    icon: Moon,
    preview: {
      sidebarBg: '#202020',
      canvasBg: '#191919',
      accentColor: '#60A5FA',
      textColor: '#E5E5E5',
    },
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    badge: 'Claude',
    description: 'Warm sand & earthy clay',
    icon: Sparkles,
    preview: {
      sidebarBg: '#EEEDE8',
      canvasBg: '#FBF9F5',
      accentColor: '#D97757',
      textColor: '#24211D',
      sidebarBorder: '#DDDDD7',
    },
  },
  {
    id: 'pluto-site',
    name: 'Pluto',
    description: 'Soft white canvas & deep blue sidebar',
    icon: BookOpen,
    preview: {
      sidebarBg: '#192B43',
      canvasBg: '#F9FBFC',
      accentColor: '#3467A8',
      textColor: '#202C3C',
      sidebarBorder: '#354A63',
      sidebarTextColor: '#F4F4EF',
      sidebarAccentColor: '#A5C9F0',
    },
  },
  {
    id: 'aubergine',
    name: 'Aubergine',
    badge: 'Slack',
    description: 'Slack purple & workspace',
    icon: Hash,
    preview: {
      sidebarBg: '#3F0E40',
      canvasBg: '#FFFFFF',
      accentColor: '#007A5A',
      textColor: '#1D1C1D',
      sidebarBorder: '#522653',
    },
  },
  {
    id: 'system',
    name: 'System',
    description: 'Matches macOS appearance',
    icon: Laptop,
    preview: {
      sidebarBg: '#F7F7F5',
      canvasBg: '#FFFFFF',
      accentColor: '#155DB1',
      textColor: '#37352F',
    },
  },
];

const settingsTabs = [
  { id: 'personal', label: 'Personal' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'help', label: 'Help' },
] as const;

export type SettingsTabId = (typeof settingsTabs)[number]['id'];

type AudioRetentionSnapshot = {
  budgetGb: 2 | 10 | 20 | null;
  retainedBytes: number;
  measurementComplete: boolean;
  overBudget: boolean;
};

const formatStorageBytes = (bytes: number) => {
  const gib = bytes / 1024 ** 3;
  return gib >= 0.1
    ? `${gib.toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
};

const defaultMeetingNotesTemplateSettings =
  createMeetingNotesTemplateSettingsSnapshot('auto', {});

const Section = ({
  title,
  children,
}: { title: string; children: React.ReactNode }) => (
  <section className="mb-8 last:mb-0">
    <h3 className="text-[13px] font-semibold text-pro-text-main mb-3 ml-1">
      {title}
    </h3>
    <div className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/70">
      {children}
    </div>
  </section>
);

const SettingsRow = ({
  htmlFor,
  label,
  helper,
  children,
  actionControl = false,
}: {
  htmlFor?: string;
  label: React.ReactNode;
  helper?: React.ReactNode;
  children: React.ReactNode;
  actionControl?: boolean;
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 border-b border-pro-border/40 last:border-0 hover:bg-pro-bg/30 transition-colors">
    <div className="space-y-1 text-left flex-1">
      <label
        htmlFor={htmlFor}
        className="block text-[14px] font-medium text-pro-text-main cursor-pointer"
      >
        {label}
      </label>
      {helper && (
        <div className="text-[13px] text-pro-text-muted leading-relaxed">
          {helper}
        </div>
      )}
    </div>
    <div
      className={`shrink-0 ${actionControl ? '' : 'sm:max-w-[280px] w-full'}`}
    >
      {children}
    </div>
  </div>
);

const Toggle = ({
  checked,
  onChange,
}: { checked: boolean; onChange: () => void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={onChange}
    className={`relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-offset-2 ${
      checked ? 'bg-pro-accent' : 'bg-pro-border/80'
    }`}
  >
    <span className="sr-only">Toggle setting</span>
    <span
      className={`pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        checked ? 'translate-x-[20px]' : 'translate-x-0'
      }`}
    />
  </button>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2.5 text-[14px] font-medium text-pro-text-main outline-none transition-all placeholder:text-pro-text-muted/45 focus:border-pro-accent focus:ring-1 focus:ring-pro-accent/50 ${props.className || ''}`}
  />
);

export const SettingsTab = ({
  llmProvider,
  setLlmProvider,
  ollamaModel,
  setOllamaModel,
  autoEndEnabled,
  setAutoEndEnabled,
  fetchMeetings,
  setSelectedMeetingId,
  theme,
  setTheme,
  calendarSnapshot = null,
  onCalendarSnapshotChange = () => {},
  initialTab,
  exportIncludeTranscript = false,
  setExportIncludeTranscript,
  calendarAutoNameEnabled = true,
  setCalendarAutoNameEnabled,
  calendarPromptEnabled = true,
  setCalendarPromptEnabled,
  silenceAutoStopDuration = '0.5',
  setSilenceAutoStopDuration,
  fasterNotesEnabled = true,
  setFasterNotesEnabled,
  meetingNotesTemplateSettings = defaultMeetingNotesTemplateSettings,
  onMeetingNotesTemplateSettingsChange = () => {},
}: SettingsTabProps) => {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>(
    initialTab ?? 'personal',
  );

  useEffect(() => {
    if (initialTab) {
      setActiveSettingsTab(initialTab);
    }
  }, [initialTab]);
  const [ollamaFastModel, setOllamaFastModel] = useState('');
  const [credentialDraft, setCredentialDraft] = useState('');
  const [credentialEditing, setCredentialEditing] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<
    Partial<Record<CloudProviderId, ProviderCredentialStatus>>
  >({});
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [pendingCloudProvider, setPendingCloudProvider] =
    useState<CloudProviderId | null>(null);
  const [cloudModel, setCloudModel] = useState('');
  const [speakerModelsState, setSpeakerModelsState] = useState<
    'idle' | 'preparing' | 'ready' | 'error'
  >('idle');
  const [browserCallDetectionEnabled, setBrowserCallDetectionEnabled] =
    useState(false);
  useEffect(() => {
    void window.ipcRenderer
      .invoke('GET_SETTING', 'browser_call_detection_enabled')
      .then((value) => setBrowserCallDetectionEnabled(value === 'true'));
  }, []);
  const [audioRetention, setAudioRetention] =
    useState<AudioRetentionSnapshot | null>(null);
  const [audioRetentionError, setAudioRetentionError] = useState(false);
  const [databaseStorageMode, setDatabaseStorageMode] = useState<
    'standard' | 'encrypted' | null
  >(null);
  const [templateToEdit, setTemplateToEdit] =
    useState<MeetingNotesTemplate>('auto');
  const [templateGuidanceDraft, setTemplateGuidanceDraft] = useState('');
  const [templateSaveState, setTemplateSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'reset' | 'error'
  >('idle');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedTemplate =
    meetingNotesTemplateSettings.templates.find(
      (template) => template.id === templateToEdit,
    ) ?? meetingNotesTemplateSettings.templates[0];

  useEffect(() => {
    setTemplateGuidanceDraft(selectedTemplate?.resolvedGuidance ?? '');
    setTemplateSaveState('idle');
  }, [selectedTemplate?.id, selectedTemplate?.resolvedGuidance]);

  const {
    status: updateStatus,
    isChecking: isCheckingUpdate,
    isUpdating: isApplyingUpdate,
    checkNow: checkUpdateNow,
    applyUpdate: triggerApplyUpdate,
    openReleaseUrl,
  } = useAppUpdate();

  useEffect(() => {
    void window.ipcRenderer
      .invoke('GET_SETTING', 'ollama_fast_model')
      .then((value) => {
        if (typeof value === 'string') setOllamaFastModel(value);
      });
  }, []);

  useEffect(() => {
    for (const provider of ['openrouter'] as const) {
      void window.ipcRenderer
        .invoke('PROVIDER_CREDENTIAL_STATUS', provider)
        .then((status: ProviderCredentialStatus) =>
          setCredentialStatus((current) => ({
            ...current,
            [provider]: status,
          })),
        );
    }
  }, []);

  useEffect(() => {
    setCredentialDraft('');
    setCredentialEditing(false);
    setCredentialError(null);
    if (llmProvider !== 'openrouter') return;
    void window.ipcRenderer
      .invoke('GET_SETTING', `${llmProvider}_model`)
      .then((value) => setCloudModel(typeof value === 'string' ? value : ''));
  }, [llmProvider]);

  useEffect(() => {
    void window.ipcRenderer
      .invoke('AUDIO_RETENTION_GET_STATUS')
      .then((snapshot: AudioRetentionSnapshot) => {
        setAudioRetention(snapshot);
        setAudioRetentionError(false);
      })
      .catch(() => setAudioRetentionError(true));
  }, []);

  useEffect(() => {
    void window.ipcRenderer
      .invoke('RECORDING_READINESS_STATUS')
      .then((res: any) => {
        const isTranscriptionReady =
          res?.details?.parakeetClient &&
          res?.details?.parakeetModel &&
          res?.details?.parakeetEouReady &&
          res?.details?.audiocapExists &&
          res?.details?.audiocapExecutable;
        setSpeakerModelsState(isTranscriptionReady ? 'ready' : 'idle');
      });
  }, []);

  const persistSetting = (key: string, value: string) => {
    void window.ipcRenderer.invoke('SET_SETTING', { key, value });
  };

  useEffect(() => {
    void window.ipcRenderer
      .invoke('DATABASE_STORAGE_MODE')
      .then((mode: unknown) => {
        if (mode === 'standard' || mode === 'encrypted')
          setDatabaseStorageMode(mode);
      })
      .catch(() => setDatabaseStorageMode(null));
  }, []);

  const updateMeetingNotesTemplateSettings = async (
    update: MeetingNotesTemplateSettingsUpdate,
    successState: 'saved' | 'reset' = 'saved',
  ) => {
    setTemplateSaveState('saving');
    try {
      const snapshot = (await window.ipcRenderer.invoke(
        'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS',
        update,
      )) as MeetingNotesTemplateSettingsSnapshot;
      onMeetingNotesTemplateSettingsChange(snapshot);
      setTemplateSaveState(successState);
    } catch {
      setTemplateSaveState('error');
    }
  };

  const activateProvider = (provider: ProviderId) => {
    setLlmProvider(provider);
    persistSetting('llm_provider', provider);
  };

  const requestProviderActivation = (provider: ProviderId) => {
    if (provider === 'ollama') return activateProvider(provider);
    void window.ipcRenderer
      .invoke('GET_SETTING', cloudConsentSettingKey(provider))
      .then((version) => {
        if (version === CLOUD_CONSENT_VERSION) activateProvider(provider);
        else setPendingCloudProvider(provider);
      });
  };

  const refreshCredentialStatus = async (provider: CloudProviderId) => {
    const status = (await window.ipcRenderer.invoke(
      'PROVIDER_CREDENTIAL_STATUS',
      provider,
    )) as ProviderCredentialStatus;
    setCredentialStatus((current) => ({ ...current, [provider]: status }));
  };

  const selectAndFocusTab = (index: number) => {
    const nextTab = settingsTabs[index];
    setActiveSettingsTab(nextTab.id);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % settingsTabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = settingsTabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    selectAndFocusTab(nextIndex);
  };

  return (
    <div className="max-w-3xl mx-auto w-full animate-in pb-32">
      <PageHeader title="Settings" />
      <div className="-mx-1 mb-8 overflow-x-auto px-1">
        <div
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="horizontal"
          className="flex min-w-max border-b border-pro-border/50"
        >
          {settingsTabs.map((tab, index) => {
            const active = activeSettingsTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveSettingsTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`relative min-h-11 border-b-2 px-4 text-[13px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-inset ${
                  active
                    ? 'border-pro-accent text-pro-text-main'
                    : 'border-transparent text-pro-text-muted hover:border-pro-border hover:text-pro-text-main'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeSettingsTab === 'personal' ? (
        <div
          id="settings-panel-personal"
          role="tabpanel"
          aria-labelledby="settings-tab-personal"
        >
          <IdentitySettings />
          <Section title="Appearance">
            <div className="p-5">
              <div className="mb-4">
                <h4 className="text-[14px] font-medium text-pro-text-main">
                  Theme
                </h4>
                <p className="text-[13px] text-pro-text-muted mt-0.5">
                  Choose how Pluto looks on this device.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                {themeOptions.map((option) => {
                  const active =
                    theme === option.id ||
                    (option.id === 'terracotta' &&
                      (theme === 'claude' ||
                        theme === 'celestial' ||
                        theme === 'botanical')) ||
                    (option.id === 'pluto-site' &&
                      (theme === 'coral' || theme === 'airbnb')) ||
                    (option.id === 'aubergine' && theme === 'slack');
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTheme(option.id)}
                      className={`group relative flex flex-col rounded-xl border p-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent ${
                        active
                          ? 'border-pro-accent bg-pro-accent/[0.04] ring-1 ring-pro-accent shadow-xs'
                          : 'border-pro-border/70 bg-pro-bg hover:border-pro-border hover:bg-pro-surface hover:shadow-xs'
                      }`}
                    >
                      {/* Visual Mini-UI Preview Swatch */}
                      <div
                        className="relative h-20 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10 shadow-xs flex mb-2.5 transition-transform duration-200 group-hover:scale-[1.01]"
                        style={{ backgroundColor: option.preview.canvasBg }}
                      >
                        {option.id === 'system' ? (
                          <div className="relative flex h-full w-full">
                            {/* Left Half: Light */}
                            <div className="flex h-full w-1/2 border-r border-black/10 bg-[#FFFFFF]">
                              <div className="h-full w-[34%] bg-[#F7F7F5] border-r border-black/5 flex flex-col p-1.5 gap-1 shrink-0">
                                <div className="h-1.5 w-1.5 rounded-full bg-[#155DB1]" />
                                <div className="h-0.5 w-full rounded-full bg-black/15 mt-0.5" />
                                <div className="h-0.5 w-3/4 rounded-full bg-black/10" />
                              </div>
                              <div className="flex-1 p-2 flex flex-col justify-between overflow-hidden">
                                <div className="space-y-1">
                                  <div className="h-1 w-1/2 rounded-full bg-black/40" />
                                  <div className="h-0.5 w-full rounded-full bg-black/15" />
                                </div>
                                <div className="h-2 w-6 rounded-xs bg-[#155DB1]" />
                              </div>
                            </div>

                            {/* Right Half: Dark */}
                            <div className="flex h-full w-1/2 bg-[#191919]">
                              <div className="h-full w-[34%] bg-[#202020] border-r border-white/5 flex flex-col p-1.5 gap-1 shrink-0">
                                <div className="h-1.5 w-1.5 rounded-full bg-[#60A5FA]" />
                                <div className="h-0.5 w-full rounded-full bg-white/20 mt-0.5" />
                                <div className="h-0.5 w-3/4 rounded-full bg-white/15" />
                              </div>
                              <div className="flex-1 p-2 flex flex-col justify-between overflow-hidden">
                                <div className="space-y-1">
                                  <div className="h-1 w-1/2 rounded-full bg-white/50" />
                                  <div className="h-0.5 w-full rounded-full bg-white/20" />
                                </div>
                                <div className="h-2 w-6 rounded-xs bg-[#60A5FA]" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Mini Sidebar */}
                            <div
                              className="h-full w-[32%] border-r flex flex-col p-1.5 gap-1 shrink-0"
                              style={{
                                backgroundColor: option.preview.sidebarBg,
                                borderColor:
                                  option.preview.sidebarBorder ||
                                  'rgba(0,0,0,0.08)',
                              }}
                            >
                              <div
                                className="h-1.5 w-1.5 rounded-full"
                                style={{
                                  backgroundColor:
                                    option.preview.sidebarAccentColor ||
                                    option.preview.accentColor,
                                }}
                              />
                              <div
                                className="h-0.5 w-full rounded-full opacity-40 mt-0.5"
                                style={{
                                  backgroundColor:
                                    option.preview.sidebarTextColor ||
                                    option.preview.textColor,
                                }}
                              />
                              <div
                                className="h-0.5 w-3/4 rounded-full opacity-25"
                                style={{
                                  backgroundColor:
                                    option.preview.sidebarTextColor ||
                                    option.preview.textColor,
                                }}
                              />
                              <div
                                className="h-0.5 w-1/2 rounded-full opacity-25"
                                style={{
                                  backgroundColor:
                                    option.preview.sidebarTextColor ||
                                    option.preview.textColor,
                                }}
                              />
                            </div>

                            {/* Mini Main Canvas */}
                            <div className="flex-1 p-2 flex flex-col justify-between overflow-hidden">
                              <div className="space-y-1.5">
                                <div
                                  className="h-1 w-3/5 rounded-full opacity-70"
                                  style={{
                                    backgroundColor: option.preview.textColor,
                                  }}
                                />
                                <div
                                  className="h-0.5 w-full rounded-full opacity-25"
                                  style={{
                                    backgroundColor: option.preview.textColor,
                                  }}
                                />
                                <div
                                  className="h-0.5 w-4/5 rounded-full opacity-20"
                                  style={{
                                    backgroundColor: option.preview.textColor,
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <div
                                  className="h-2 w-7 rounded-xs"
                                  style={{
                                    backgroundColor: option.preview.accentColor,
                                  }}
                                />
                                <div
                                  className="h-1.5 w-1.5 rounded-full opacity-40"
                                  style={{
                                    backgroundColor: option.preview.accentColor,
                                  }}
                                />
                              </div>
                            </div>
                          </>
                        )}

                        {/* Active Checkmark Badge */}
                        {active && (
                          <div className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-pro-accent text-white shadow-xs">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </div>
                        )}
                      </div>

                      {/* Theme Name, Accent Dot & Inspiration Tag */}
                      <div className="flex items-baseline justify-between gap-1.5 w-full px-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: option.preview.accentColor,
                            }}
                          />
                          <span className="text-[13px] font-semibold text-pro-text-main truncate">
                            {option.name}
                          </span>
                        </div>
                        {option.badge && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-pro-surface border border-pro-border/70 text-pro-text-muted shrink-0">
                            {option.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-pro-text-muted/80 leading-normal line-clamp-1 mt-0.5 px-0.5">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>
        </div>
      ) : null}

      {activeSettingsTab === 'meetings' ? (
        <div
          id="settings-panel-meetings"
          role="tabpanel"
          aria-labelledby="settings-tab-meetings"
        >
          <CalendarSettings
            snapshot={calendarSnapshot}
            onSnapshotChange={onCalendarSnapshotChange}
          />
          <Section title="Note templates">
            <SettingsRow
              htmlFor="default-meeting-notes-template"
              label="Default note template"
              helper="Used for new automatic notes. You can still choose a different template when regenerating one meeting."
            >
              <SearchSelect
                id="default-meeting-notes-template"
                ariaLabel="Default note template"
                value={meetingNotesTemplateSettings.defaultTemplateId}
                searchable
                options={meetingNotesTemplateOptions}
                onValueChange={(value) =>
                  void updateMeetingNotesTemplateSettings({
                    operation: 'set_default',
                    templateId: value as MeetingNotesTemplate,
                  })
                }
              />
            </SettingsRow>
            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <label
                  htmlFor="meeting-notes-template-editor-select"
                  className="block text-[14px] font-medium text-pro-text-main"
                >
                  Customize template guidance
                </label>
                <p className="text-[13px] leading-relaxed text-pro-text-muted">
                  Change what Pluto emphasizes while its evidence, decisions,
                  action-item, and note-structure safeguards stay in place.
                </p>
              </div>
              <SearchSelect
                id="meeting-notes-template-editor-select"
                ariaLabel="Template to customize"
                value={templateToEdit}
                searchable
                options={meetingNotesTemplateOptions}
                onValueChange={(value) =>
                  setTemplateToEdit(value as MeetingNotesTemplate)
                }
              />
              {selectedTemplate ? (
                <div className="space-y-3">
                  <p className="text-[12px] leading-relaxed text-pro-text-muted">
                    {selectedTemplate.description}
                    {selectedTemplate.customized ? ' · Customized' : ''}
                  </p>
                  <label
                    htmlFor="meeting-notes-template-guidance"
                    className="sr-only"
                  >
                    {selectedTemplate.label} template guidance
                  </label>
                  <textarea
                    id="meeting-notes-template-guidance"
                    rows={6}
                    maxLength={MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH}
                    value={templateGuidanceDraft}
                    onChange={(event) => {
                      setTemplateGuidanceDraft(event.target.value);
                      setTemplateSaveState('idle');
                    }}
                    className="w-full resize-y rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2.5 text-[13px] leading-5 text-pro-text-main outline-none transition-all placeholder:text-pro-text-muted/45 focus:border-pro-accent focus:ring-1 focus:ring-pro-accent/50"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] text-pro-text-muted">
                      {templateGuidanceDraft.length}/
                      {MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          templateSaveState === 'saving' ||
                          !selectedTemplate.customized
                        }
                        onClick={() =>
                          void updateMeetingNotesTemplateSettings(
                            {
                              operation: 'reset_override',
                              templateId: templateToEdit,
                            },
                            'reset',
                          )
                        }
                        className="rounded-lg border border-pro-border px-3 py-2 text-xs font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Reset to built-in
                      </button>
                      <button
                        type="button"
                        disabled={
                          templateSaveState === 'saving' ||
                          !templateGuidanceDraft.trim() ||
                          templateGuidanceDraft.trim() ===
                            selectedTemplate.resolvedGuidance
                        }
                        onClick={() =>
                          void updateMeetingNotesTemplateSettings({
                            operation: 'save_override',
                            templateId: templateToEdit,
                            guidance: templateGuidanceDraft,
                          })
                        }
                        className="rounded-lg bg-pro-accent px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {templateSaveState === 'saving'
                          ? 'Saving…'
                          : 'Save guidance'}
                      </button>
                    </div>
                  </div>
                  <div
                    role="status"
                    aria-live="polite"
                    className={`min-h-4 text-[12px] ${
                      templateSaveState === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-pro-text-muted'
                    }`}
                  >
                    {templateSaveState === 'saved'
                      ? 'Template guidance saved.'
                      : templateSaveState === 'reset'
                        ? 'Built-in guidance restored.'
                        : templateSaveState === 'error'
                          ? 'Pluto could not save this template. Check the guidance and try again.'
                          : ''}
                  </div>
                </div>
              ) : null}
            </div>
          </Section>
          <Section title="Recording">
            <SettingsRow
              label="Parakeet local transcription"
              helper="English-only live and final transcription, fully local on this Mac."
              actionControl
            >
              <button
                type="button"
                disabled={speakerModelsState === 'preparing'}
                onClick={async () => {
                  setSpeakerModelsState('preparing');
                  try {
                    const result = await window.ipcRenderer.invoke(
                      'RECORDING_READINESS_PREPARE',
                    );
                    const isTranscriptionReady =
                      result?.details?.parakeetClient &&
                      result?.details?.parakeetModel &&
                      result?.details?.parakeetEouReady &&
                      result?.details?.audiocapExists &&
                      result?.details?.audiocapExecutable;
                    setSpeakerModelsState(
                      isTranscriptionReady ? 'ready' : 'error',
                    );
                  } catch {
                    setSpeakerModelsState('error');
                  }
                }}
                className={`shrink-0 flex items-center justify-center gap-2 min-w-[100px] rounded-lg border px-4 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                  speakerModelsState === 'ready'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : speakerModelsState === 'error'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
                      : 'border-pro-border bg-pro-bg text-pro-text-main hover:bg-pro-surface disabled:opacity-50'
                }`}
              >
                {speakerModelsState === 'preparing' && (
                  <RefreshCw className="w-4 h-4 animate-spin opacity-70" />
                )}
                {speakerModelsState === 'ready' && (
                  <CheckCircle2 className="w-4 h-4 opacity-70" />
                )}
                {speakerModelsState === 'error' && (
                  <FileWarning className="w-4 h-4 opacity-70" />
                )}

                {speakerModelsState === 'preparing'
                  ? 'Preparing…'
                  : speakerModelsState === 'ready'
                    ? 'Ready'
                    : speakerModelsState === 'error'
                      ? 'Retry'
                      : 'Prepare'}
              </button>
            </SettingsRow>

            <SettingsRow
              label="Auto-end recording"
              helper="Stop automatically when the call app closes or audio goes silent."
              actionControl
            >
              <Toggle
                checked={autoEndEnabled}
                onChange={() => {
                  const next = !autoEndEnabled;
                  setAutoEndEnabled(next);
                  persistSetting('auto_end_enabled', next ? 'true' : 'false');
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Detect calls in browser tabs"
              helper="Use browser tabs to recognize meetings and detect when they end. Enabling this asks macOS for permission to control your browser."
              actionControl
            >
              <Toggle
                checked={browserCallDetectionEnabled}
                onChange={() => {
                  const next = !browserCallDetectionEnabled;
                  setBrowserCallDetectionEnabled(next);
                  persistSetting(
                    'browser_call_detection_enabled',
                    next ? 'true' : 'false',
                  );
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Generate notes during meetings"
              helper="Precomputes notes in the background while recording so they are ready immediately when the meeting ends. Turn this off when using large local models to keep live transcription smooth."
              actionControl
            >
              <Toggle
                checked={fasterNotesEnabled !== false}
                onChange={() => {
                  const next = !(fasterNotesEnabled !== false);
                  setFasterNotesEnabled?.(next);
                  persistSetting(
                    'faster_notes_enabled',
                    next ? 'true' : 'false',
                  );
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Suggest calendar meetings"
              helper="Suggest matching calendar invites during a recording. An invite is linked only when you add it."
              actionControl
            >
              <Toggle
                checked={calendarAutoNameEnabled !== false}
                onChange={() => {
                  const next = !(calendarAutoNameEnabled !== false);
                  setCalendarAutoNameEnabled?.(next);
                  persistSetting(
                    'calendar_auto_name_enabled',
                    next ? 'true' : 'false',
                  );
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Prompt to record upcoming meetings"
              helper="Show a quick start prompt when a scheduled calendar meeting with conference links begins."
              actionControl
            >
              <Toggle
                checked={calendarPromptEnabled !== false}
                onChange={() => {
                  const next = !(calendarPromptEnabled !== false);
                  setCalendarPromptEnabled?.(next);
                  persistSetting(
                    'calendar_prompt_enabled',
                    next ? 'true' : 'false',
                  );
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Auto-stop on prolonged silence"
              helper="Stop recording after 30 seconds of continuous silence once the scheduled meeting ends, or when conference audio is quiet with no scheduled meeting."
              actionControl={false}
            >
              <SearchSelect
                ariaLabel="Auto-stop on prolonged silence duration"
                value={silenceAutoStopDuration || '0.5'}
                searchable={false}
                options={[
                  { value: '0.5', label: '30 seconds (Default)' },
                  { value: 'disabled', label: 'Disabled' },
                ]}
                onValueChange={(value) => {
                  const val = value as SilenceAutoStopDuration;
                  setSilenceAutoStopDuration?.(val);
                  persistSetting('silence_auto_stop_duration', val);
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Recording storage limit"
              helper={
                audioRetentionError
                  ? 'Storage usage is temporarily unavailable. Your recordings were not changed.'
                  : `${audioRetention ? `${audioRetention.measurementComplete ? '' : 'At least '}${formatStorageBytes(audioRetention.retainedBytes)} currently used. ` : ''}${audioRetention && !audioRetention.measurementComplete ? 'Some recording storage could not be measured or safely cleaned. ' : ''}When the limit is exceeded, Pluto removes the oldest eligible recording audio first. Transcripts and notes stay available.`
              }
              actionControl={false}
            >
              <SearchSelect
                ariaLabel="Recording storage limit"
                value={
                  audioRetention?.budgetGb === null
                    ? 'unlimited'
                    : String(audioRetention?.budgetGb ?? 10)
                }
                searchable={false}
                options={[
                  { value: '2', label: '2 GB' },
                  { value: '10', label: '10 GB (Default)' },
                  { value: '20', label: '20 GB' },
                  { value: 'unlimited', label: 'Unlimited' },
                ]}
                onValueChange={(value) => {
                  setAudioRetentionError(false);
                  void window.ipcRenderer
                    .invoke('AUDIO_RETENTION_SET_BUDGET', value)
                    .then((snapshot: AudioRetentionSnapshot) =>
                      setAudioRetention(snapshot),
                    )
                    .catch(() => setAudioRetentionError(true));
                }}
              />
            </SettingsRow>
          </Section>

          <Section title="Export">
            <SettingsRow
              label="Include transcript in exports"
              helper="Append the speaker-attributed transcript to exported Markdown notes."
              actionControl
            >
              <Toggle
                checked={Boolean(exportIncludeTranscript)}
                onChange={() => {
                  const next = !exportIncludeTranscript;
                  setExportIncludeTranscript?.(next);
                  persistSetting(
                    'export_include_transcript',
                    next ? 'true' : 'false',
                  );
                }}
              />
            </SettingsRow>
          </Section>
        </div>
      ) : null}

      {activeSettingsTab === 'intelligence' ? (
        <div
          id="settings-panel-intelligence"
          role="tabpanel"
          aria-labelledby="settings-tab-intelligence"
        >
          <Section title="Analysis">
            <SettingsRow
              label="AI Provider"
              helper="Used for meeting summaries and knowledge extraction."
              actionControl={false}
            >
              <div className="grid grid-cols-2 gap-2">
                {providerOptions.map((provider) => {
                  const active = llmProvider === provider.id;
                  const Icon = provider.icon;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => requestProviderActivation(provider.id)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-all text-left ${
                        active
                          ? 'border-pro-accent bg-pro-accent/5 text-pro-text-main shadow-sm ring-1 ring-pro-accent/20'
                          : 'border-pro-border/60 bg-pro-bg text-pro-text-muted hover:border-pro-border hover:bg-pro-surface hover:text-pro-text-main'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${active ? 'text-pro-accent' : 'opacity-60'}`}
                      />
                      <span className="text-[13px] font-medium tracking-tight truncate">
                        {provider.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsRow>

            {llmProvider === 'ollama' ? (
              <>
                <SettingsRow
                  htmlFor="ollama-model"
                  label="Local Analysis & Deep Model"
                  helper={`Used for meeting preparation and deeper cross-meeting analysis. Leave blank to use ${OLLAMA_GENERAL_MODEL}.`}
                >
                  <Input
                    id="ollama-model"
                    type="text"
                    placeholder={`Default: ${OLLAMA_GENERAL_MODEL}`}
                    value={ollamaModel}
                    onChange={(e) => {
                      const value = e.target.value;
                      setOllamaModel(value);
                      persistSetting('ollama_model', value);
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  htmlFor="ollama-fast-model"
                  label="Fast Chat Model"
                  helper={`Quick Ask Pluto answers use ${OLLAMA_QUICK_CHAT_MODEL} by default. Deep questions continue to use the analysis model.`}
                >
                  <Input
                    id="ollama-fast-model"
                    type="text"
                    placeholder={`Default: ${OLLAMA_QUICK_CHAT_MODEL}`}
                    value={ollamaFastModel}
                    onChange={(e) => {
                      const value = e.target.value;
                      setOllamaFastModel(value);
                      persistSetting('ollama_fast_model', value);
                    }}
                  />
                </SettingsRow>
              </>
            ) : llmProvider === 'openrouter' ? (
              <>
                <SettingsRow
                  htmlFor="cloud-model"
                  label="Model"
                  helper="Use an OpenRouter author/model ID, such as openai/gpt-4o-mini."
                >
                  <Input
                    id="cloud-model"
                    type="text"
                    placeholder="openai/gpt-4o-mini"
                    value={cloudModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCloudModel(value);
                      persistSetting(`${llmProvider}_model`, value);
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  htmlFor={
                    credentialStatus[llmProvider]?.configured &&
                    !credentialEditing
                      ? undefined
                      : 'api-key'
                  }
                  label="API Key"
                  helper={
                    credentialStatus[llmProvider]?.configured
                      ? 'Stored securely in macOS encrypted storage.'
                      : 'Saving a key uses macOS secure storage and may request Keychain permission, even with standard database setup.'
                  }
                >
                  <div className="space-y-2">
                    {credentialStatus[llmProvider]?.configured &&
                    !credentialEditing ? (
                      <>
                        <div
                          role="status"
                          aria-label={`Configured ${llmProvider} API key`}
                          onCopy={(event) => event.preventDefault()}
                          onCut={(event) => event.preventDefault()}
                          className="select-none rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2.5 font-mono text-[14px] text-pro-text-main"
                        >
                          {credentialStatus[llmProvider]?.maskedHint ??
                            '********'}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCredentialEditing(true)}
                            className="rounded-lg bg-pro-accent px-3 py-2 text-xs font-semibold text-white"
                          >
                            Replace key
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCredentialError(null);
                              void window.ipcRenderer
                                .invoke(
                                  'PROVIDER_CREDENTIAL_DELETE',
                                  llmProvider,
                                )
                                .then(() => {
                                  setCredentialEditing(false);
                                  return refreshCredentialStatus(llmProvider);
                                });
                            }}
                            className="rounded-lg border border-pro-border px-3 py-2 text-xs font-medium text-pro-text-muted"
                          >
                            Remove key
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <Input
                          id="api-key"
                          type="password"
                          autoComplete="off"
                          placeholder={`Enter a new ${llmProvider} API key`}
                          value={credentialDraft}
                          onChange={(event) =>
                            setCredentialDraft(event.target.value)
                          }
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!credentialDraft.trim()}
                            onClick={() => {
                              setCredentialError(null);
                              void window.ipcRenderer
                                .invoke('PROVIDER_CREDENTIAL_SET', {
                                  provider: llmProvider,
                                  value: credentialDraft,
                                })
                                .then(() => {
                                  setCredentialDraft('');
                                  setCredentialEditing(false);
                                  return refreshCredentialStatus(llmProvider);
                                })
                                .catch(() =>
                                  setCredentialError(
                                    'The key could not be stored securely. Cloud access remains disabled.',
                                  ),
                                );
                            }}
                            className="rounded-lg bg-pro-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            {credentialStatus[llmProvider]?.configured
                              ? 'Save replacement'
                              : 'Save key'}
                          </button>
                          {credentialStatus[llmProvider]?.configured ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCredentialDraft('');
                                setCredentialError(null);
                                setCredentialEditing(false);
                              }}
                              className="rounded-lg border border-pro-border px-3 py-2 text-xs font-medium text-pro-text-muted"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                    {credentialError ? (
                      <p className="text-xs text-red-500">{credentialError}</p>
                    ) : null}
                  </div>
                </SettingsRow>
              </>
            ) : (
              <p className="px-4 py-3 text-xs leading-relaxed text-pro-text-muted">
                Setup for your previously selected provider is temporarily
                hidden. Choose Ollama or OpenRouter above to configure a model.
                Your saved provider settings and credentials have been retained.
              </p>
            )}
          </Section>
        </div>
      ) : null}

      {activeSettingsTab === 'advanced' ? (
        <div
          id="settings-panel-advanced"
          role="tabpanel"
          aria-labelledby="settings-tab-advanced"
        >
          <ChatGptConnectionSettings />
          <Section title="Local data">
            <SettingsRow
              label="Database encryption"
              helper="Your database setup is fixed for this profile. Encryption protects stored transcripts, notes, and people; recording files have separate protection. Cloud-provider keys use secure storage with either setup."
              actionControl
            >
              <span
                className="text-sm text-pro-text-muted"
                role="status"
                aria-label="Database encryption status"
              >
                {databaseStorageMode === 'encrypted'
                  ? 'On'
                  : databaseStorageMode === 'standard'
                    ? 'Off'
                    : 'Unavailable'}
              </span>
            </SettingsRow>
          </Section>
          <Section title="Application updates">
            <SettingsRow
              label="Pluto Version"
              helper={
                updateStatus.hasUpdate
                  ? `Update ${updateStatus.latestVersion} is available. Current version: v${updateStatus.currentVersion || '0.1.0'}.`
                  : `Pluto is up to date (v${updateStatus.currentVersion || '0.1.0'}).`
              }
              actionControl
            >
              <div className="flex items-center gap-2">
                {updateStatus.hasUpdate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openReleaseUrl(updateStatus.releaseUrl)}
                      className="rounded-lg border border-pro-border bg-pro-surface px-3 py-2 text-[13px] font-medium text-pro-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      Release Notes
                    </button>
                    <button
                      type="button"
                      onClick={triggerApplyUpdate}
                      disabled={isApplyingUpdate}
                      className="flex items-center gap-2 rounded-lg bg-pro-accent px-4 py-2 text-[13px] font-medium text-white dark:text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isApplyingUpdate ? 'animate-spin' : ''}`}
                      />
                      {isApplyingUpdate ? 'Updating...' : 'Update Now'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={checkUpdateNow}
                    disabled={isCheckingUpdate}
                    className="flex items-center gap-2 rounded-lg border border-pro-border bg-pro-surface px-4 py-2 text-[13px] font-medium text-pro-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`}
                    />
                    {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
                  </button>
                )}
              </div>
            </SettingsRow>
          </Section>

          <Section title="Knowledge data">
            <SettingsRow
              label={<span className="text-red-500">Reset knowledge base</span>}
              helper="Permanently delete extracted knowledge and clear the selected meeting."
              actionControl
            >
              <button
                type="button"
                className="shrink-0 flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                onClick={async () => {
                  if (
                    confirm(
                      'Are you sure you want to reset all knowledge? This action is irreversible.',
                    )
                  ) {
                    try {
                      await window.ipcRenderer.invoke('RESET_KNOWLEDGE');
                      fetchMeetings();
                      setSelectedMeetingId(null);
                    } catch (e) {
                      console.error('Failed to reset knowledge', e);
                      alert('Failed to reset knowledge base');
                    }
                  }
                }}
              >
                <Trash2 className="w-4 h-4 opacity-80" />
                Reset Knowledge
              </button>
            </SettingsRow>
          </Section>
        </div>
      ) : null}

      {activeSettingsTab === 'help' ? (
        <div
          id="settings-panel-help"
          role="tabpanel"
          aria-labelledby="settings-tab-help"
        >
          <Section title="Support">
            <SettingsRow
              label="Report a problem"
              helper="Share a diagnostic report through GitHub or email. You can review everything before sending."
              actionControl
            >
              <ReportProblemButton />
            </SettingsRow>
          </Section>
        </div>
      ) : null}

      {pendingCloudProvider ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cloud-consent-title"
            className="max-w-md rounded-2xl border border-pro-border bg-pro-bg p-6 shadow-2xl"
          >
            <h2
              id="cloud-consent-title"
              className="text-lg font-semibold text-pro-text-main"
            >
              Allow cloud inference with {pendingCloudProvider}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-pro-text-muted">
              Selected transcript excerpts, notes, questions, and relevant local
              context may leave this Mac. Audio never leaves. Requests are
              stateless, and Pluto remains the only durable memory store.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCloudProvider(null)}
                className="rounded-lg border border-pro-border px-4 py-2 text-sm text-pro-text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const provider = pendingCloudProvider;
                  persistSetting(
                    cloudConsentSettingKey(provider),
                    CLOUD_CONSENT_VERSION,
                  );
                  activateProvider(provider);
                  setPendingCloudProvider(null);
                }}
                className="rounded-lg bg-pro-accent px-4 py-2 text-sm font-semibold text-white"
              >
                Allow and select
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
