import { useState } from 'react';
import type {
  TranscriptionBackend,
  TranscriptionPreset,
  WhisperComputeType,
  WhisperDevice,
  WhisperModel,
} from '../../utils/transcriptionSettings';

interface SettingsOverlayProps {
  settingsVisible: boolean;
  setSettingsVisible: (val: boolean) => void;
  llmProvider: 'ollama' | 'gemini' | 'openai' | 'claude';
  setLlmProvider: (val: 'ollama' | 'gemini' | 'openai' | 'claude') => void;
  hfToken: string;
  setHfToken: (val: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (val: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (val: string) => void;
  claudeApiKey: string;
  setClaudeApiKey: (val: string) => void;
  ollamaModel: string;
  setOllamaModel: (val: string) => void;
  transcriptionBackend: TranscriptionBackend;
  setTranscriptionBackend: (val: TranscriptionBackend) => void;
  transcriptionPreset: TranscriptionPreset;
  setTranscriptionPreset: (val: TranscriptionPreset) => void;
  autoEndEnabled: boolean;
  setAutoEndEnabled: (val: boolean) => void;
  whisperModel: WhisperModel;
  setWhisperModel: (val: WhisperModel) => void;
  whisperDevice: WhisperDevice;
  setWhisperDevice: (val: WhisperDevice) => void;
  whisperComputeType: WhisperComputeType;
  setWhisperComputeType: (val: WhisperComputeType) => void;
  whisperLanguage: string;
  setWhisperLanguage: (val: string) => void;
  fetchMeetings: () => void;
  setSelectedMeetingId: (id: string | number | null) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (val: 'light' | 'dark' | 'system') => void;
}

const cardClass =
  'rounded-[2rem] border border-pro-border/70 bg-pro-surface/95 shadow-[0_18px_48px_-24px_rgba(0,0,0,0.35)]';
const sectionTitleClass =
  'text-[11px] font-black uppercase tracking-[0.2em] text-pro-text-main';
const labelClass =
  'text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted';
const helperClass = 'text-[11px] leading-relaxed text-pro-text-muted/75';
const controlClass =
  'w-full rounded-2xl border border-pro-border bg-pro-bg/60 px-4 py-3 text-[14px] font-bold tracking-tight text-pro-text-main outline-none transition-all placeholder:text-pro-text-muted/45 focus:border-pro-accent focus:bg-pro-surface';

const providerOptions = [
  { id: 'ollama', name: 'Ollama', detail: 'Local' },
  { id: 'gemini', name: 'Gemini', detail: 'Google' },
  { id: 'openai', name: 'OpenAI', detail: 'GPT' },
  { id: 'claude', name: 'Claude', detail: 'Anthropic' },
] as const;

const themeOptions = [
  { id: 'light', name: 'Light', icon: '☀️' },
  { id: 'dark', name: 'Dark', icon: '🌙' },
  { id: 'system', name: 'System', icon: '💻' },
] as const;

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className={`${cardClass} p-6 sm:p-7`}>
    <div className="space-y-5">
      <h3 className={sectionTitleClass}>{title}</h3>
      {children}
    </div>
  </section>
);

const Field = ({
  htmlFor,
  label,
  helper,
  children,
}: {
  htmlFor?: string;
  label: string;
  helper?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-2.5">
    <label htmlFor={htmlFor} className={labelClass}>
      {label}
    </label>
    {children}
    {helper ? <p className={helperClass}>{helper}</p> : null}
  </div>
);

export const SettingsOverlay = ({
  settingsVisible,
  setSettingsVisible,
  llmProvider,
  setLlmProvider,
  hfToken,
  setHfToken,
  geminiApiKey,
  setGeminiApiKey,
  openaiApiKey,
  setOpenaiApiKey,
  claudeApiKey,
  setClaudeApiKey,
  ollamaModel,
  setOllamaModel,
  autoEndEnabled,
  setAutoEndEnabled,
  fetchMeetings,
  setSelectedMeetingId,
  theme,
  setTheme,
}: SettingsOverlayProps) => {
  const [speakerModelsState, setSpeakerModelsState] = useState<
    'idle' | 'preparing' | 'ready' | 'error'
  >('idle');
  if (!settingsVisible) return null;

  const persistSetting = (key: string, value: string) => {
    void window.ipcRenderer.invoke('SET_SETTING', { key, value });
  };

  const providerTokenValue =
    llmProvider === 'gemini'
      ? geminiApiKey
      : llmProvider === 'openai'
        ? openaiApiKey
        : claudeApiKey;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 py-4 sm:px-6 sm:py-8 no-drag">
      <div
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-md dark:bg-slate-950/72"
        onClick={() => setSettingsVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSettingsVisible(false);
          }
        }}
      />

      <div
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[2.5rem] border border-pro-border bg-pro-bg shadow-[0_32px_100px_-32px_rgba(0,0,0,0.5)] sm:max-h-[calc(100vh-4rem)] no-drag"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-pro-border/50 bg-gradient-to-br from-pro-surface via-pro-surface to-pro-bg/90 px-5 py-5 sm:px-7 sm:py-6 no-drag">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[1.2rem] border border-pro-border/60 bg-pro-surface text-xl shadow-sm">
                ⚙️
              </div>
              <h2 className="text-2xl font-black tracking-tight text-pro-text-main sm:text-[2rem]">
                System Settings
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsVisible(false);
              }}
              className="no-drag flex h-11 w-11 items-center justify-center rounded-2xl border border-pro-border/80 bg-pro-bg/80 text-pro-text-main transition-all hover:border-pro-accent/40 hover:bg-pro-surface active:scale-[0.98]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_top_left,rgba(56,189,248,0.06),transparent_28%)] px-4 py-4 pb-6 sm:px-6 sm:py-6 sm:pb-8">
          <Section title="Analysis">
            <div className="grid gap-3 sm:grid-cols-2">
              {providerOptions.map((provider) => {
                const active = llmProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      setLlmProvider(provider.id);
                      persistSetting('llm_provider', provider.id);
                    }}
                    className={`rounded-[1.25rem] border px-4 py-3.5 text-left transition-all ${
                      active
                        ? 'border-pro-accent bg-pro-accent/8 text-pro-text-main shadow-premium'
                        : 'border-pro-border/80 bg-pro-bg/55 text-pro-text-main hover:border-pro-accent/30 hover:bg-pro-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[14px] font-black tracking-tight">
                          {provider.name}
                        </div>
                        <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-pro-text-muted/65">
                          {provider.detail}
                        </div>
                      </div>
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          active ? 'bg-pro-accent' : 'bg-pro-border'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-[1.25rem] border border-pro-border/70 bg-pro-bg/45 px-4 py-3">
              <p className={helperClass}>
                Analysis provider affects summaries and extraction only. It does
                not change the managed transcription pipeline.
              </p>
            </div>

            {llmProvider === 'ollama' ? (
              <Field
                htmlFor="settings-ollama-model"
                label="Local Model"
                helper="Leave blank to use the first available Ollama model."
              >
                <input
                  id="settings-ollama-model"
                  type="text"
                  placeholder="Auto-detect installed model"
                  value={ollamaModel}
                  onChange={(e) => {
                    const value = e.target.value;
                    setOllamaModel(value);
                    persistSetting('ollama_model', value);
                  }}
                  className={controlClass}
                />
              </Field>
            ) : (
              <Field
                htmlFor="settings-api-token"
                label="API Key"
                helper={`Used for ${llmProvider} analysis requests.`}
              >
                <input
                  id="settings-api-token"
                  type="password"
                  placeholder={`Enter your ${llmProvider} API key`}
                  value={providerTokenValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (llmProvider === 'gemini') {
                      setGeminiApiKey(value);
                      persistSetting('gemini_api_key', value);
                    } else if (llmProvider === 'openai') {
                      setOpenaiApiKey(value);
                      persistSetting('openai_api_key', value);
                    } else if (llmProvider === 'claude') {
                      setClaudeApiKey(value);
                      persistSetting('claude_api_key', value);
                    }
                  }}
                  className={controlClass}
                />
              </Field>
            )}
          </Section>

          <Section title="Recording">
            <Field
              htmlFor="settings-transcription-backend"
              label="Transcription Engine"
              helper="Choose between standard PyTorch WhisperX or Apple Silicon MLX framework."
            >
              <select
                id="settings-transcription-backend"
                value={transcriptionBackend}
                onChange={(e) => {
                  const value = e.target.value as TranscriptionBackend;
                  setTranscriptionBackend(value);
                  persistSetting('transcription_backend', value);
                }}
                className={controlClass}
              >
                <option value="whisperx_current">
                  WhisperX Current (PyTorch CPU)
                </option>
                <option value="whisperx_tuned">WhisperX Tuned</option>
                <option value="local_alt_apple_silicon">
                  Local Alt (Apple Silicon MLX)
                </option>
              </select>
            </Field>

            <div className="flex items-center justify-between gap-6 rounded-2xl border border-pro-border bg-pro-bg/50 px-4 py-4">
              <div className="space-y-1.5">
                <div className="text-[14px] font-black tracking-tight text-pro-text-main">
                  Local speaker attribution
                </div>
                <p className={helperClass}>
                  Prepare the verified local models before recording
                  finalization.
                </p>
              </div>
              <button
                type="button"
                disabled={speakerModelsState === 'preparing'}
                onClick={async () => {
                  setSpeakerModelsState('preparing');
                  try {
                    const result = await window.ipcRenderer.invoke(
                      'WHISPER_PREPARE_DIARIZATION_MODELS',
                    );
                    setSpeakerModelsState(result?.ready ? 'ready' : 'error');
                  } catch {
                    setSpeakerModelsState('error');
                  }
                }}
                className="shrink-0 rounded-xl bg-pro-text-main px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 dark:bg-pro-accent dark:text-[#1A2340]"
              >
                {speakerModelsState === 'preparing'
                  ? 'Preparing…'
                  : speakerModelsState === 'ready'
                    ? 'Ready'
                    : speakerModelsState === 'error'
                      ? 'Retry setup'
                      : 'Prepare'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-6 rounded-2xl border border-pro-border bg-pro-bg/50 px-4 py-4">
              <div className="space-y-1.5">
                <div className="text-[14px] font-black tracking-tight text-pro-text-main">
                  Auto-end when the call ends
                </div>
                <p className={helperClass}>
                  Stop recording when the call app closes or audio goes silent.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !autoEndEnabled;
                  setAutoEndEnabled(next);
                  persistSetting('auto_end_enabled', next ? 'true' : 'false');
                }}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  autoEndEnabled ? 'bg-pro-accent' : 'bg-pro-border'
                }`}
              >
                <div
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform dark:bg-pro-surface ${
                    autoEndEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <Field
              htmlFor="settings-hf-token"
              label="Speaker Diarization Token"
              helper="Optional enhancement. Pluto's default speaker attribution is local and credential-free."
            >
              <input
                id="settings-hf-token"
                type="password"
                placeholder="Hugging Face token"
                value={hfToken}
                onChange={(e) => {
                  const value = e.target.value;
                  setHfToken(value);
                  persistSetting('hf_token', value);
                }}
                className={controlClass}
              />
            </Field>

            <a
              className="inline-flex text-[11px] font-bold text-pro-accent hover:underline"
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              Open Hugging Face token settings
            </a>
          </Section>

          <Section title="Appearance">
            <div className="grid gap-3 sm:grid-cols-3">
              {themeOptions.map((option) => {
                const active = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    className={`rounded-[1.4rem] border px-4 py-4 text-left transition-all ${
                      active
                        ? 'border-pro-accent bg-pro-accent/8 text-pro-text-main shadow-premium'
                        : 'border-pro-border/80 bg-pro-bg/55 text-pro-text-main hover:border-pro-accent/35 hover:bg-pro-surface'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="text-2xl">{option.icon}</div>
                      <div className="text-[14px] font-black tracking-tight">
                        {option.name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Danger Zone">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="text-[14px] font-black tracking-tight text-pro-text-main">
                  Reset knowledge base
                </div>
                <p className={helperClass}>
                  Deletes extracted knowledge and clears the selected meeting.
                </p>
              </div>
              <button
                type="button"
                className="rounded-2xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-red-500 transition-colors hover:bg-red-500/14"
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
                      setSettingsVisible(false);
                    } catch (e) {
                      console.error('Failed to reset knowledge', e);
                      alert('Failed to reset knowledge base');
                    }
                  }
                }}
              >
                Reset Knowledge
              </button>
            </div>
          </Section>
        </div>

        <div className="flex justify-end border-t border-pro-border/70 bg-pro-surface/85 px-6 py-4 sm:px-8 no-drag">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSettingsVisible(false);
            }}
            className="no-drag rounded-full bg-pro-text-main px-8 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-pro-accent dark:bg-pro-accent dark:text-[#1A2340]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
