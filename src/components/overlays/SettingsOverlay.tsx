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
  fetchMeetings: () => void;
  setSelectedMeetingId: (id: string | number | null) => void;
}

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
  fetchMeetings,
  setSelectedMeetingId,
}: SettingsOverlayProps) => {
  if (!settingsVisible) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-24 px-6 animate-in">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
        onClick={() => setSettingsVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSettingsVisible(false);
          }
        }}
      />
      <div className="w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
        <div className="p-10 border-b border-pro-border/40 flex items-center justify-between bg-pro-bg/50">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-3xl border border-pro-border/40 shadow-sm">
              ⚙️
            </div>
            <div>
              <h2 className="text-3xl font-black tracking-tighter">
                System Settings
              </h2>
              <p className="text-[10px] text-pro-text-muted/60 font-black uppercase tracking-[0.2em] mt-2">
                Local Intelligence Engine v4.2
              </p>
            </div>
          </div>
          <button type="button"
            onClick={() => setSettingsVisible(false)}
            className="w-12 h-12 rounded-2xl hover:bg-pro-bg transition-all flex items-center justify-center text-sm border border-pro-border/40 shadow-sm active-push group"
          >
            <span className="text-pro-text-muted group-hover:text-pro-text-main transition-colors font-bold">
              ✕
            </span>
          </button>
        </div>

        <div className="p-10 space-y-12">
          {/* Provider Selection */}
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">
                Cognitive Provider
              </p>
              <span className="text-[10px] font-black text-pro-accent uppercase bg-pro-accent/5 px-3 py-1 rounded-full border border-pro-accent/10 tracking-widest">
                {llmProvider === 'ollama' ? 'Local-First' : 'Cloud Hybrid'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { id: 'ollama', name: 'Ollama', label: 'Local', icon: '🦙' },
                { id: 'gemini', name: 'Gemini', label: 'Google', icon: '✨' },
                { id: 'openai', name: 'OpenAI', label: 'GPT-4', icon: '🤖' },
                {
                  id: 'claude',
                  name: 'Claude',
                  label: 'Anthropic',
                  icon: '🎭',
                },
              ].map((p) => (
                <button type="button"
                  key={p.id}
                  onClick={() => {
                    setLlmProvider(
                      p.id as 'ollama' | 'gemini' | 'openai' | 'claude',
                    );
                    window.ipcRenderer.invoke('SET_SETTING', {
                      key: 'llm_provider',
                      value: p.id,
                    });
                  }}
                  className={`p-6 rounded-[1.5rem] border-2 transition-all flex flex-col gap-3 text-left group ${llmProvider === p.id ? 'border-pro-accent bg-pro-accent/5 shadow-premium' : 'border-pro-border hover:border-pro-accent/20 bg-white'}`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-2xl group-hover:scale-110 transition-transform">
                      {p.icon}
                    </span>
                    {llmProvider === p.id && (
                      <div className="w-2 h-2 rounded-full bg-pro-accent shadow-status-ok" />
                    )}
                  </div>
                  <div>
                    <span className="block text-[14px] font-black tracking-tight">
                      {p.name}
                    </span>
                    <span className="text-[9px] font-black text-pro-text-muted/60 uppercase tracking-widest">
                      {p.label}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {llmProvider !== 'ollama' && (
              <div className="space-y-4 pt-4 animate-in slide-in-from-top-4">
                <label
                  htmlFor="settings-api-token"
                  className="text-[10px] font-black text-pro-text-muted uppercase tracking-[0.2em]"
                >
                  Encryption Key / API Token
                </label>
                <input
                  id="settings-api-token"
                  type="password"
                  placeholder={`Enter your ${llmProvider} credentials...`}
                  value={
                    llmProvider === 'gemini'
                      ? geminiApiKey
                      : llmProvider === 'openai'
                        ? openaiApiKey
                        : claudeApiKey
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    if (llmProvider === 'gemini') {
                      setGeminiApiKey(value);
                      window.ipcRenderer.invoke('SET_SETTING', {
                        key: 'gemini_api_key',
                        value,
                      });
                    } else if (llmProvider === 'openai') {
                      setOpenaiApiKey(value);
                      window.ipcRenderer.invoke('SET_SETTING', {
                        key: 'openai_api_key',
                        value,
                      });
                    } else if (llmProvider === 'claude') {
                      setClaudeApiKey(value);
                      window.ipcRenderer.invoke('SET_SETTING', {
                        key: 'claude_api_key',
                        value,
                      });
                    }
                  }}
                  className="w-full p-5 rounded-2xl border-2 border-pro-border bg-white text-[15px] font-bold tracking-tight focus:border-pro-accent outline-none transition-all shadow-inner"
                />
              </div>
            )}

            {llmProvider === 'ollama' && (
              <div className="space-y-4">
                <div className="p-6 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex gap-4 items-start">
                  <span className="text-xl">🛡️</span>
                  <div>
                    <p className="text-[12px] font-bold text-pro-text-main leading-relaxed">
                      Privacy-First Local Deployment
                    </p>
                    <p className="text-[11px] text-pro-text-muted/70 leading-relaxed mt-1">
                      Neural weights are processed exclusively on your machine.
                      Zero data egress.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="settings-ollama-model"
                    className="text-[10px] font-black text-pro-text-muted uppercase tracking-[0.2em]"
                  >
                    Local Model (Optional)
                  </label>
                  <input
                    id="settings-ollama-model"
                    type="text"
                    placeholder="Auto-detect installed model (e.g. llama3.2)"
                    value={ollamaModel}
                    onChange={(e) => {
                      const value = e.target.value;
                      setOllamaModel(value);
                      window.ipcRenderer.invoke('SET_SETTING', {
                        key: 'ollama_model',
                        value,
                      });
                    }}
                    className="w-full p-5 rounded-2xl border-2 border-pro-border bg-white text-[15px] font-bold tracking-tight focus:border-pro-accent outline-none transition-all shadow-inner"
                  />
                  <p className="text-[11px] text-pro-text-muted/70 leading-relaxed">
                    Leave blank to auto-use the first installed Ollama model.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="settings-hf-token"
                className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]"
              >
                Speaker Diarization
              </label>
              <span
                className={`text-[10px] font-black uppercase px-3 py-1 rounded-full border tracking-widest ${hfToken ? 'text-green-600 bg-green-500/10 border-green-500/20' : 'text-pro-text-muted/60 bg-pro-bg/60 border-pro-border/60'}`}
              >
                {hfToken ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <input
              id="settings-hf-token"
              type="password"
              placeholder="Hugging Face token (optional)"
              value={hfToken}
              onChange={(e) => {
                const value = e.target.value;
                setHfToken(value);
                window.ipcRenderer.invoke('SET_SETTING', {
                  key: 'hf_token',
                  value,
                });
              }}
              className="w-full p-5 rounded-2xl border-2 border-pro-border bg-white text-[15px] font-bold tracking-tight focus:border-pro-accent outline-none transition-all shadow-inner"
            />
            <div className="p-6 bg-pro-bg/50 rounded-2xl border border-pro-border">
              <p className="text-[10px] text-pro-text-muted/60 font-bold uppercase tracking-[0.16em]">
                Optional
              </p>
              <p className="text-[11px] text-pro-text-muted/70 leading-relaxed mt-2">
                Adds real speaker labels. If you want this, create a token in
                your HF settings.
                <a
                  className="ml-2 text-pro-accent hover:underline font-bold"
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get token
                </a>
              </p>
            </div>
          </div>

          <div className="pt-10 border-t border-pro-border/20 flex items-center justify-between">
            <button type="button"
              className="text-[10px] font-black text-red-500/40 hover:text-red-500 uppercase tracking-widest transition-colors px-4 py-2 rounded-lg hover:bg-red-50 text-left"
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
              Reset Neural Fabric
            </button>
            <button type="button"
              onClick={() => setSettingsVisible(false)}
              className="h-14 px-12 rounded-2xl bg-pro-text-main text-white font-black text-[12px] uppercase tracking-[0.2em] hover:bg-pro-accent transition-all active-push shadow-premium"
            >
              Save & Return
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
