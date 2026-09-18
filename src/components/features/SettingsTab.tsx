import {
  CheckCircle2,
  Cloud,
  Cpu,
  FileWarning,
  Laptop,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CalendarIntegrationSnapshot } from '../../../electron/calendar/types';
import type {
  CloudProviderId,
  ProviderCredentialStatus,
  ProviderId,
} from '../../../electron/llm/inferenceTypes';
import {
  CLOUD_CONSENT_VERSION,
  cloudConsentSettingKey,
} from '../../../electron/llm/providerCatalog';
import { useAppUpdate } from '../../api/updater';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../../utils/ollamaModels';
import { PageHeader } from '../ui/PageHeader';
import { SearchSelect } from '../ui/SearchSelect';
import { CalendarSettings } from './CalendarSettings';
import { IdentitySettings } from './IdentitySettings';

interface SettingsTabProps {
  llmProvider: ProviderId;
  setLlmProvider: (val: ProviderId) => void;
  ollamaModel: string;
  setOllamaModel: (val: string) => void;
  autoEndEnabled: boolean;
  setAutoEndEnabled: (val: boolean) => void;
  fetchMeetings: () => void;
  setSelectedMeetingId: (id: string | number | null) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (val: 'light' | 'dark' | 'system') => void;
  calendarSnapshot?: CalendarIntegrationSnapshot | null;
  onCalendarSnapshotChange?: (snapshot: CalendarIntegrationSnapshot) => void;
  initialTab?: SettingsTabId;
  exportIncludeTranscript?: boolean;
  setExportIncludeTranscript?: (val: boolean) => void;
  calendarAutoNameEnabled?: boolean;
  setCalendarAutoNameEnabled?: (val: boolean) => void;
  calendarPromptEnabled?: boolean;
  setCalendarPromptEnabled?: (val: boolean) => void;
  silenceAutoStopDuration?: '3' | '5' | '10' | 'disabled';
  setSilenceAutoStopDuration?: (val: '3' | '5' | '10' | 'disabled') => void;
  fasterNotesEnabled?: boolean;
  setFasterNotesEnabled?: (val: boolean) => void;
}

const providerOptions = [
  { id: 'ollama', name: 'Ollama', detail: 'Local', icon: Cpu },
  { id: 'openai', name: 'OpenAI', detail: 'GPT', icon: Cloud },
  { id: 'openrouter', name: 'OpenRouter', detail: 'Multi-model', icon: Cloud },
  { id: 'gemini', name: 'Gemini', detail: 'Google', icon: Zap },
  { id: 'claude', name: 'Claude', detail: 'Anthropic', icon: Cloud },
] as const;

const themeOptions = [
  { id: 'light', name: 'Light', icon: Sun },
  { id: 'dark', name: 'Dark', icon: Moon },
  { id: 'system', name: 'System', icon: Laptop },
] as const;

const settingsTabs = [
  { id: 'personal', label: 'Personal' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'advanced', label: 'Advanced' },
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
  silenceAutoStopDuration = '5',
  setSilenceAutoStopDuration,
  fasterNotesEnabled = true,
  setFasterNotesEnabled,
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
  const [audioRetention, setAudioRetention] =
    useState<AudioRetentionSnapshot | null>(null);
  const [audioRetentionError, setAudioRetentionError] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
    for (const provider of [
      'openai',
      'openrouter',
      'gemini',
      'claude',
    ] as const) {
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
    if (llmProvider === 'ollama') return;
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
            <SettingsRow
              label="Theme"
              helper="Choose how Pluto looks on this device."
              actionControl={false}
            >
              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map((option) => {
                  const active = theme === option.id;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTheme(option.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border py-3 transition-all ${
                        active
                          ? 'border-pro-accent bg-pro-accent/5 text-pro-text-main shadow-sm ring-1 ring-pro-accent/20'
                          : 'border-pro-border/60 bg-pro-bg text-pro-text-muted hover:border-pro-border hover:bg-pro-surface hover:text-pro-text-main'
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 ${active ? 'text-pro-accent' : 'opacity-70'}`}
                        strokeWidth={active ? 2.5 : 2}
                      />
                      <span className="text-[12px] font-medium">
                        {option.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
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
              label="Auto-name meetings from calendar"
              helper="Automatically title new recordings and attach attendees from matching calendar events."
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
              helper="Automatically stop recording after continuous silence once the scheduled meeting ends or conference audio goes quiet."
              actionControl={false}
            >
              <SearchSelect
                ariaLabel="Auto-stop on prolonged silence duration"
                value={silenceAutoStopDuration || '5'}
                searchable={false}
                options={[
                  { value: '3', label: '3 minutes' },
                  { value: '5', label: '5 minutes (Default)' },
                  { value: '10', label: '10 minutes' },
                  { value: 'disabled', label: 'Disabled' },
                ]}
                onValueChange={(value) => {
                  const val = value as '3' | '5' | '10' | 'disabled';
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
            ) : (
              <>
                <SettingsRow
                  htmlFor="cloud-model"
                  label="Model"
                  helper={
                    llmProvider === 'openrouter'
                      ? 'Use an OpenRouter author/model ID, such as openai/gpt-4o-mini.'
                      : 'Choose a tested model or enter an advanced provider model ID.'
                  }
                >
                  <Input
                    id="cloud-model"
                    type="text"
                    placeholder={
                      llmProvider === 'openrouter'
                        ? 'openai/gpt-4o-mini'
                        : 'Provider default'
                    }
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
                      : 'Enter a key to store it with macOS secure storage.'
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
