import { useState } from 'react';

interface SettingsTabProps {
  llmProvider: 'ollama' | 'gemini' | 'openai' | 'claude';
  setLlmProvider: (val: 'ollama' | 'gemini' | 'openai' | 'claude') => void;
  geminiApiKey: string;
  setGeminiApiKey: (val: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (val: string) => void;
  claudeApiKey: string;
  setClaudeApiKey: (val: string) => void;
  ollamaModel: string;
  setOllamaModel: (val: string) => void;
  whisperLanguage: string;
  setWhisperLanguage: (val: string) => void;
  autoEndEnabled: boolean;
  setAutoEndEnabled: (val: boolean) => void;
  fetchMeetings: () => void;
  setSelectedMeetingId: (id: string | number | null) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (val: 'light' | 'dark' | 'system') => void;
}

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

const sectionClass = "py-8 first:pt-0 border-b border-pro-border/20 last:border-0";
const sectionTitleClass = "text-[12px] font-semibold text-pro-text-muted mb-6 uppercase tracking-wider";
const controlClass =
  'w-full max-w-md rounded-md border border-pro-border bg-pro-bg px-4 py-3 text-[14px] font-medium text-pro-text-main outline-none transition-all placeholder:text-pro-text-muted/45 focus:border-pro-accent focus:bg-pro-surface';
const labelClass = 'text-[14px] font-medium text-pro-text-main';
const helperClass = 'text-[13px] text-pro-text-muted leading-relaxed mt-1';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className={sectionClass}>
    <h3 className={sectionTitleClass}>{title}</h3>
    <div className="space-y-6">
      {children}
    </div>
  </section>
);

const Field = ({ htmlFor, label, helper, children }: { htmlFor?: string; label: string; helper?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={htmlFor} className={labelClass}>{label}</label>
    {children}
    {helper && <p className={helperClass}>{helper}</p>}
  </div>
);

export const SettingsTab = ({
  llmProvider,
  setLlmProvider,
  geminiApiKey,
  setGeminiApiKey,
  openaiApiKey,
  setOpenaiApiKey,
  claudeApiKey,
  setClaudeApiKey,
  ollamaModel,
  setOllamaModel,
  whisperLanguage,
  setWhisperLanguage,
  autoEndEnabled,
  setAutoEndEnabled,
  fetchMeetings,
  setSelectedMeetingId,
  theme,
  setTheme,
}: SettingsTabProps) => {
  const [speakerModelsState, setSpeakerModelsState] = useState<
    'idle' | 'preparing' | 'ready' | 'error'
  >('idle');

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
    <div className="max-w-4xl mx-auto w-full animate-in pb-32">
      <div>
        <Section title="Analysis">
          <div className="space-y-8">
            <div>
              <div className={labelClass}>Provider</div>
              <p className={`${helperClass} mb-3`}>
                Analysis provider affects summaries and extraction only. It does not change the managed transcription pipeline.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
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
                      className={`rounded-lg border px-4 py-3 text-left transition-all ${
                        active
                          ? 'border-pro-accent bg-pro-accent/5 text-pro-text-main shadow-sm ring-1 ring-pro-accent/20'
                          : 'border-pro-border/60 bg-pro-bg text-pro-text-main hover:border-pro-border hover:bg-pro-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium">
                            {provider.name}
                          </div>
                          <div className="mt-0.5 text-[12px] text-pro-text-muted">
                            {provider.detail}
                          </div>
                        </div>
                        <div
                          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                            active ? 'bg-pro-accent' : 'bg-pro-border'
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {llmProvider === 'ollama' ? (
              <Field
                htmlFor="ollama-model"
                label="Local Model"
                helper="Leave blank to use the first available Ollama model."
              >
                <input
                  id="ollama-model"
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
                htmlFor="api-key"
                label="API Key"
                helper={`Used for ${llmProvider} analysis requests.`}
              >
                <input
                  id="api-key"
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
          </div>
        </Section>

        <Section title="Recording">
          <div className="space-y-8">
            <Field
              htmlFor="whisper-language"
              label="Language"
              helper="Use an ISO language code such as en, es, or fr. Leave blank for English."
            >
              <input
                id="whisper-language"
                type="text"
                value={whisperLanguage}
                placeholder="en"
                onChange={(event) => {
                  const value = event.target.value;
                  setWhisperLanguage(value);
                  persistSetting('transcription_language', value);
                }}
                className={controlClass}
              />
            </Field>

            <div className="flex items-center justify-between gap-6 py-2 max-w-2xl">
              <div className="space-y-1">
                <div className="text-[14px] font-medium text-pro-text-main">
                  Local speaker attribution
                </div>
                <p className={helperClass}>
                  Prepare the verified local models before recording finalization.
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
                className="shrink-0 rounded-md bg-pro-surface border border-pro-border px-4 py-2 text-[13px] font-medium text-pro-text-main hover:bg-pro-bg transition-colors disabled:opacity-50"
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

            <div className="flex items-center justify-between gap-6 py-2 max-w-2xl">
              <div className="space-y-1">
                <div className="text-[14px] font-medium text-pro-text-main">
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
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  autoEndEnabled ? 'bg-pro-accent' : 'bg-pro-border'
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform dark:bg-pro-surface ${
                    autoEndEnabled ? 'translate-x-5.5 left-0' : 'translate-x-0.5 left-0'
                  }`}
                  style={{ transform: autoEndEnabled ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="grid gap-4 sm:grid-cols-3 max-w-2xl">
            {themeOptions.map((option) => {
              const active = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTheme(option.id)}
                  className={`rounded-xl border px-4 py-5 text-center transition-all flex flex-col items-center justify-center gap-2 ${
                    active
                      ? 'border-pro-accent bg-pro-accent/5 text-pro-text-main shadow-sm ring-1 ring-pro-accent/20'
                      : 'border-pro-border/60 bg-pro-bg text-pro-text-main hover:border-pro-border hover:bg-pro-surface'
                  }`}
                >
                  <div className="text-2xl mb-1">{option.icon}</div>
                  <div className="text-[13px] font-medium">
                    {option.name}
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Danger Zone">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5 mt-2 max-w-2xl">
            <div className="space-y-1">
              <div className="text-[14px] font-medium text-red-500">
                Reset knowledge base
              </div>
              <p className={helperClass}>
                Deletes extracted knowledge and clears the selected meeting.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
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
              Reset Knowledge
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
};
